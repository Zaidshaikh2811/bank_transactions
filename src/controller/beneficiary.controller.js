
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import Beneficiary from "../models//beneficiary.model.js";
import Account from "../models/account.model.js";
import { withTransaction } from "../utils/withTransaction.js";
import { maskAccountNumber } from "../utils/account.utils.js";
import mongoose from "mongoose";

export const addBeneficiary = asyncHandler(async (req, res) => {
    const { accountNumber, nickname } = req.body;

    if (!accountNumber || !nickname) {
        throw new ApiError(400, "Account number and nickname are required");
    }

    const trimmedNickname = nickname.trim();
    if (trimmedNickname.length < 2 || trimmedNickname.length > 50) {
        throw new ApiError(400, "Nickname must be between 2 and 50 characters");
    }

    if (!/^[a-zA-Z0-9 _'-]+$/.test(trimmedNickname)) {
        throw new ApiError(400, "Nickname contains invalid characters");
    }

    const activeCount = await Beneficiary.countDocuments({
        userId: req.user.id,
        isActive: true,
    });
    if (activeCount >= process.env.MAX_BENEFICIARIES) {
        throw new ApiError(
            400,
            `You can have at most ${process.env.MAX_BENEFICIARIES} active beneficiaries`
        );
    }

    const account = await Account.findById(accountNumber).select(
        "_id userId accountNumber accountType currency isActive"
    );

    if (!account) {
        throw new ApiError(404, "Beneficiary account not found");
    }

    if (account.userId.toString() === req.user.id.toString()) {
        throw new ApiError(400, "Cannot add your own account as a beneficiary");
    }

    if (account.isActive !== "active") {
        throw new ApiError(400, "Beneficiary account is not active");
    }

    const exists = await Beneficiary.findOne({
        userId: req.user.id,
        beneficiaryAccountId: account._id,
    });

    if (exists) {
        if (!exists.isVerified) {
            exists.isVerified = true;
            exists.nickname = trimmedNickname;
            await exists.save();

            return new ApiResponse(200, "Beneficiary re-activated successfully", {
                id: exists._id,
                nickname: exists.nickname,
                accountNumber: maskAccountNumber(account.accountNumber),
                accountType: account.accountType,
                currency: account.currency,
            }).send(res);
        }

        throw new ApiError(409, "Beneficiary already exists");
    }

    const beneficiary = await Beneficiary.create({
        userId: req.user.id,
        beneficiaryAccountId: account._id,
        nickname: trimmedNickname,
    });

    return new ApiResponse(201, "Beneficiary added successfully", {
        id: beneficiary._id,
        nickname: beneficiary.nickname,
        accountNumber: maskAccountNumber(account.accountNumber),
        accountType: account.accountType,
        currency: account.currency,
        createdAt: beneficiary.createdAt,
    }).send(res);
});


export const getBeneficiaries = asyncHandler(async (req, res) => {
    const beneficiaries = await Beneficiary.find({
        userId: req.user.id,
        isVerified: true,
    })
        .populate("beneficiaryAccountId", "accountNumber accountType currency")
        .sort({ createdAt: -1 })
        .lean();

    const sanitized = beneficiaries.map((b) => ({
        id: b._id,
        nickname: b.nickname,
        accountNumber: maskAccountNumber(
            b.beneficiaryAccountId?.accountNumber ?? ""
        ),
        accountType: b.beneficiaryAccountId?.accountType,
        currency: b.beneficiaryAccountId?.currency,
        createdAt: b.createdAt,
    }));

    return new ApiResponse(
        200,
        "Beneficiaries fetched successfully",
        sanitized
    ).send(res);
});


export const removeBeneficiary = asyncHandler(async (req, res) => {
    const { beneficiaryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(beneficiaryId)) {
        throw new ApiError(400, "Invalid beneficiary ID");
    }

    const beneficiary = await Beneficiary.findOne({
        _id: beneficiaryId,
        userId: req.user.id,
        isVerified: true,
    });

    if (!beneficiary) {
        throw new ApiError(404, "Beneficiary not found");
    }

    beneficiary.isVerified = false;
    await beneficiary.save();

    return new ApiResponse(200, "Beneficiary removed successfully").send(res);
});


export const transferToBeneficiary = asyncHandler(async (req, res) => {
    const { beneficiaryId, amount, note } = req.body;

    if (!beneficiaryId || amount === undefined) {
        throw new ApiError(400, "Beneficiary ID and amount are required");
    }

    if (!mongoose.Types.ObjectId.isValid(beneficiaryId)) {
        throw new ApiError(400, "Invalid beneficiary ID");
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < process.env.MIN_AMOUNT) {
        throw new ApiError(
            400,
            `Transfer amount must be at least ${process.env.MIN_AMOUNT}`
        );
    }
    if (parsedAmount > process.env.MAX_TRANSFER_AMOUNT) {
        throw new ApiError(
            400,
            `Transfer amount cannot exceed ${process.env.MAX_TRANSFER_AMOUNT}`
        );
    }
    if (!/^\d+(\.\d{1,2})?$/.test(String(amount))) {
        throw new ApiError(400, "Amount must have at most 2 decimal places");
    }

    const senderAccount = await Account.findOne({
        userId: req.user.id,
        isActive: "active",
    }).select("_id accountNumber balance currency");

    if (!senderAccount) {
        throw new ApiError(404, "Your account was not found or is inactive");
    }

    const beneficiary = await Beneficiary.findOne({
        _id: beneficiaryId,
        userId: req.user.id,
        isVerified: true,
    }).populate(
        "beneficiaryAccountId",
        "_id accountNumber accountType currency isVerified balance userId"
    );

    if (!beneficiary) {
        throw new ApiError(404, "Beneficiary not found");
    }

    const recipientAccount = beneficiary.beneficiaryAccountId;

    if (!recipientAccount || recipientAccount.isVerified !== true) {
        throw new ApiError(400, "Recipient account is not verified");
    }

    if (senderAccount.currency !== recipientAccount.currency) {
        throw new ApiError(
            400,
            `Currency mismatch: your account is ${senderAccount.currency}, ` +
            `recipient is ${recipientAccount.currency}`
        );
    }

    if (senderAccount._id.equals(recipientAccount._id)) {
        throw new ApiError(400, "Cannot transfer to your own account");
    }

    if (senderAccount.balance < parsedAmount) {
        throw new ApiError(400, "Insufficient balance");
    }


    const transaction = withTransaction(async (session) => {
        const debitedSender = await Account.findOneAndUpdate(
            {
                _id: senderAccount._id,
                balance: { $gte: parsedAmount },
                isActive: "active",
            },
            { $inc: { balance: -parsedAmount } },
            { new: true, session }
        );

        if (!debitedSender) {
            throw new ApiError(
                400,
                "Transfer failed: insufficient balance or account locked"
            );
        }


        const creditedRecipient = await Account.findOneAndUpdate(
            { _id: recipientAccount._id, isActive: "active" },
            { $inc: { balance: parsedAmount } },
            { new: true, session }
        );

        if (!creditedRecipient) {
            throw new ApiError(400, "Transfer failed: recipient account unavailable");
        }


        const [transaction] = await Transaction.create(
            [
                {
                    senderId: req.user.id,
                    senderAccountId: senderAccount._id,
                    recipientAccountId: recipientAccount._id,
                    beneficiaryId: beneficiary._id,
                    amount: parsedAmount,
                    currency: senderAccount.currency,
                    note: note?.trim().substring(0, 200) || "",
                    status: "completed",
                    type: "beneficiary_transfer",
                    balanceAfterDebit: debitedSender.balance,
                },
            ],
            { session }
        );

    });
    return new ApiResponse(200, "Transfer successful", {
        transactionId: transaction._id,
        amount: parsedAmount,
        currency: senderAccount.currency,
        recipient: {
            nickname: beneficiary.nickname,
            accountNumber: maskAccountNumber(recipientAccount.accountNumber),
            accountType: recipientAccount.accountType,
        },
        newBalance: debitedSender.balance,
        timestamp: transaction.createdAt,
    }).send(res);



});