
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import Beneficiary from "../models//beneficiary.model.js";
import Account from "../models/account.model.js";
import { withTransaction } from "../utils/withTransaction.js";
import { maskAccountNumber } from "../utils/account.utils.js";
import { emailQueue } from "../queues/emailQueue.js";
import Otp from "../models/otp.model.js";
import mongoose from "mongoose";
import { sendOtp } from "../utils/opt.utils.js";
import Idoempotency from "../models/idempotency.model.js";

export const addBeneficiary = asyncHandler(async (req, res) => {
    const { accountNumber, nickname } = req.body;
    const idempotencyKey = req.header("X-Idempotency-Key");

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

    const existingIdoempotency = await Idoempotency.findOne({
        userId: req.user.id,
        key: idempotencyKey,
        purpose: "add_beneficiary",
    });

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

    const account = await Account.findOne({ accountNumber }).select(
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
        if (exists.isVerified === true) {
            throw new ApiError(409, "Beneficiary already exists and is active");
        }
        exists.isVerified = false;
        exists.nickname = trimmedNickname;
        await exists.save();

    }
    else {
        await Beneficiary.create({
            userId: req.user.id,
            beneficiaryAccountId: account._id,
            nickname: trimmedNickname,
            isVerified: false,
        });
    }

    await Otp.deleteMany({ userId: req.user.id, purpose: "add_beneficiary" });

    const otp = await sendOtp({
        userId: req.user.id,
        purpose: "add_beneficiary",
        meta: { beneficiaryAccountId: account._id.toString() },
    });


    return new ApiResponse(201, "OTP sent. Please confirm to activate beneficiary.", {
        expiresInMinutes: process.env.OTP_TTL_MINUTES,
        maskedContact: otp.maskedContact,
    }).send(res);
});

export const confirmBeneficiaryOtp = asyncHandler(async (req, res) => {
    const { otp } = req.body;

    if (!otp) throw new ApiError(400, "OTP is required");

    const otpRecord = await Otp.findOne({
        userId: req.user.id,
        purpose: "add_beneficiary",
    });

    if (!otpRecord) {
        throw new ApiError(400, "No pending OTP found. Please add a beneficiary first.");
    }
    if (otpRecord.expiresAt < new Date()) {
        await otpRecord.deleteOne();
        throw new ApiError(400, "OTP has expired. Please add the beneficiary again.");
    }
    if (!otpRecord.verify(otp)) {
        otpRecord.attempts += 1;
        if (otpRecord.attempts >= 3) {
            await otpRecord.deleteOne();
            throw new ApiError(429, "Too many incorrect attempts. OTP invalidated.");
        }
        await otpRecord.save();
        throw new ApiError(400, `Incorrect OTP. ${3 - otpRecord.attempts} attempt(s) remaining.`);
    }

    const beneficiary = await Beneficiary.findOneAndUpdate(
        {
            userId: req.user.id,
            beneficiaryAccountId: otpRecord.meta.beneficiaryAccountId,
            isVerified: false,
        },
        { isVerified: true },
        { new: true }
    ).populate("beneficiaryAccountId", "accountNumber accountType currency");

    if (!beneficiary) {
        throw new ApiError(404, "Pending beneficiary not found. It may have been removed.");
    }

    await otpRecord.deleteOne();

    return new ApiResponse(200, "Beneficiary confirmed and activated", {
        id: beneficiary._id,
        nickname: beneficiary.nickname,
        accountNumber: maskAccountNumber(beneficiary.beneficiaryAccountId.accountNumber),
        accountType: beneficiary.beneficiaryAccountId.accountType,
        currency: beneficiary.beneficiaryAccountId.currency,
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
    const { beneficiaryId, amount, note, senderAccountId } = req.body;

    if (!beneficiaryId || amount === undefined || !senderAccountId) {
        throw new ApiError(400, "Beneficiary ID, amount, and sender account ID are required");
    }

    if (!mongoose.Types.ObjectId.isValid(beneficiaryId)) {
        throw new ApiError(400, "Invalid beneficiary ID");
    }

    if (!mongoose.Types.ObjectId.isValid(senderAccountId)) {
        throw new ApiError(400, "Invalid sender account ID");
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
        _id: senderAccountId,
        userId: req.user.id,
        isActive: "active",
    }).select("_id accountNumber balance currency");

    if (!senderAccount) {
        throw new ApiError(404, "Sender account not found or inactive");
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
    if (recipientAccount.userId?.toString() === req.user.id.toString()) {
        throw new ApiError(400, "Cannot transfer to your own account");
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


    const { transaction, debitedSender } = await withTransaction(async (session) => {
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


        const [completedTransaction] = await Transaction.create(
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
        return { completedTransaction, debitedSender };

    });
    return new ApiResponse(200, "Transfer successful", {
        transactionId: completedTransaction._id,
        amount: parsedAmount,
        currency: senderAccount.currency,
        recipient: {
            nickname: beneficiary.nickname,
            accountNumber: maskAccountNumber(recipientAccount.accountNumber),
            accountType: recipientAccount.accountType,
        },
        newBalance: debitedSender.balance,
        timestamp: completedTransaction.createdAt,
    }).send(res);



});



