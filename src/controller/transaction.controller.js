import asyncHandler from "../utils/asyncHandler.js";
import Account from "../models/account.model.js";
import Transaction from "../models/transaction.model.js";
import ApiError from "../utils/ApiError.js";
import { validateAmount } from "../utils/transaction.utils.js";
import { withTransaction } from "../utils/withTransaction.js";
import ApiResponse from "../utils/ApiResponse.js";
import { emailQueue } from "../queues/emailQueue.js";
import { TRANSACTION_TYPES } from "../models/transaction.model.js";
import User from "../models/user.model.js";
import mongoose from "mongoose";



export const deposit = asyncHandler(async (req, res) => {
    console.log("Deposit request body:", req.body);
    const { accountId } = req.params;
    const amount = parseFloat(req.body.amount);
    const { description, idempotencyKey } = req.body;

    if (!amount) {
        throw new ApiError(400, "Amount is required");
    }
    if (!accountId) {
        throw new ApiError(400, "Account ID is required");
    }
    if (!idempotencyKey) {
        throw new ApiError(400, "Idempotency key is required");
    }

    validateAmount(amount, Number(process.env.MAX_DEPOSIT_AMOUNT) || 1_000_000);

    const duplicate = await Transaction.findOne({ idempotencyKey });
    if (duplicate) {
        return res.status(200).json({ message: "Transaction already processed", transactionId: duplicate._id });
    }

    const user = await User.findOne({ userId: req.user.id }).select("email");
    if (!user) throw new ApiError(404, "User not found");

    const transaction = await withTransaction(async (session) => {
        const account = await Account.findOne({ userId: accountId }).session(session);
        if (!account) {
            throw new ApiError(404, "Account not found");
        }

        if (account.userId.toString() !== req.user.id) {
            throw new ApiError(403, "Unauthorized to deposit into this account");
        }

        if (!account.isActive) {
            throw new ApiError(403, "Account is not active");
        }

        account.balance = parseFloat((account.balance + amount).toFixed(2));
        await account.save({ session });
        const transaction = new Transaction({
            receiverAccount: account._id,
            type: TRANSACTION_TYPES.DEPOSIT,
            amount,
            currency: account.currency,
            description: description || TRANSACTION_TYPES.DEPOSIT,
            idempotencyKey,
            balanceAfter: account.balance,
            metadata: {
                ip: req.ip,
                userAgent: req.get("User-Agent"),
            },
            processedAt: new Date(),
        });

        await transaction.save({ session });

        return transaction;
    });

    await emailQueue.add("deposit", {
        email: user.email,
        amount,
        balance: transaction.balanceAfter
    }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });

    return new ApiResponse(201, "Deposit successful", { transaction }).send(res);

});


export const transfer = asyncHandler(async (req, res) => {
    const { senderAccountId, receiverAccountId, amount: rawAmount, description, deviceId } = req.body;


    if (!senderAccountId || !receiverAccountId || !rawAmount) {
        throw new ApiError(400, "Sender account ID, receiver account ID, and amount are required");
    }

    if (senderAccountId === receiverAccountId) {
        throw new ApiError(400, "Cannot transfer to the same account");
    }

    const amount = parseFloat(rawAmount);
    validateAmount(amount, Number(process.env.MAX_TRANSFER_AMOUNT) || 500_000);


    const idoptencyKey = req.headers["x-idempotency-key"];
    if (!idoptencyKey) {
        throw new ApiError(400, "Idempotency key is required");
    }

    const duplicate = await Transaction.findOne({ idempotencyKey: idoptencyKey });
    console.log("Duplicate transaction check:", duplicate);
    if (duplicate) {
        return res.status(200).json({ message: "Transaction already processed", transactionId: duplicate._id });
    }

    const senderUser = await User.findById(req.user.id).select("email isActive isVerified");
    console.log("Sender user:", senderUser);
    if (!senderUser) {
        throw new ApiError(404, "Sender account not found");
    }
    if (!senderUser.isVerified) {
        throw new ApiError(403, "Please verify your email first");
    }
    if (senderUser._id.toString() !== req.user.id) {
        throw new ApiError(403, "Unauthorized to transfer from this account");
    }
    if (!senderUser.isActive) {
        throw new ApiError(403, "Sender account is not active");
    }

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    const todayTotal = await Transaction.aggregate([
        {
            $match: {
                senderAccount: new mongoose.Types.ObjectId(senderAccountId),
                type: TRANSACTION_TYPES.TRANSFER,
                status: "completed",
                createdAt: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: null,
                total: { $sum: "$amount" }
            }
        }
    ]);

    const dailySpent = todayTotal[0]?.total || 0;
    if (dailySpent + amount > process.env.DAILY_TRANSFER_LIMIT) {
        throw new ApiError(400,
            `Daily transfer limit of $${process.env.DAILY_TRANSFER_LIMIT} exceeded. ` +
            `You have $${process.env.DAILY_TRANSFER_LIMIT - dailySpent} remaining today`
        );
    }

    console.log("Starting transaction with session...");

    const transaction = await withTransaction(async (session) => {
        console.log("Transaction session started");
        const senderAccount = await Account.findById(senderAccountId).session(session);
        const receiverAccount = await Account.findById(receiverAccountId).session(session);

        console.log("Sender account:", senderAccount);
        console.log("Receiver account:", receiverAccount);


        if (!senderAccount) throw new ApiError(404, "Sender account not found");
        if (!receiverAccount) throw new ApiError(404, "Receiver account not found");
        if (senderAccount.userId.toString() !== req.user.id) throw new ApiError(403, "You do not own the sender account");
        console.log("Account ownership verified");

        if (senderAccount.isActive !== "active") throw new ApiError(403, "Sender account is inactive");
        if (receiverAccount.isActive !== "active") throw new ApiError(403, "Receiver account is inactive");

        console.log("Account status verified");

        if (senderAccount.currency !== receiverAccount.currency) {
            throw new ApiError(400,
                `Currency mismatch: sender uses ${senderAccount.currency}, ` +
                `receiver uses ${receiverAccount.currency}`
            );
        }
        if (senderAccount.balance < amount) throw new ApiError(400, "Insufficient funds in sender account");

        senderAccount.balance = parseFloat((senderAccount.balance - amount).toFixed(2));
        receiverAccount.balance = parseFloat((receiverAccount.balance + amount).toFixed(2));

        await Promise.all([
            senderAccount.save({ session }),
            receiverAccount.save({ session })
        ]);
        console.log("Account balances updated");
        const [txn] = await Transaction.create({
            senderAccount: senderAccount._id,
            receiverAccount: receiverAccount._id,
            type: TRANSACTION_TYPES.TRANSFER,
            amount,
            currency: senderAccount.currency,
            description: description || TRANSACTION_TYPES.TRANSFER,
            idempotencyKey: idoptencyKey,
            balanceAfter: senderAccount.balance,
            metadata: {
                ip: req.ip,
                userAgent: req.get("User-Agent"),
                deviceId
            },
            processedAt: new Date(),
        }, { session });

        return txn;
    })

    const receiverUser = await User.findById(receiverUserId).select("email");

    await Promise.all([
        emailQueue.add("transfer", {
            email: senderUser.email,
            amount,
            balance: senderAccount.balance,
            type: "sent",
        }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } }),

        emailQueue.add("transfer", {
            email: receiverUser.email,
            amount,
            balance: receiverAccount.balance,
            type: "received",
        }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } }),
    ]);

    return new ApiResponse(201, "Transfer successful", { transaction }).send(res);

})


