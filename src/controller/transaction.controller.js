import asyncHandler from "../utils/asyncHandler.js";
import Account from "../models/account.model.js";
import Transaction from "../models/transaction.model.js";
import ApiError from "../utils/ApiError.js";
import { validateAmount } from "../utils/transaction.utils.js";
import { withTransaction } from "../utils/withTransaction.js";
import ApiResponse from "../utils/ApiResponse.js";
import { emailQueue } from "../queues/emailQueue.js";
import { TRANSACTION_TYPES } from "../models/transaction.model.js";
import LedgerEntry from "../models/ledger.model.js";
import User from "../models/user.model.js";
import mongoose from "mongoose";



export const deposit = asyncHandler(async (req, res) => {
    console.log("Deposit request body:", req.body);
    const { accountId } = req.params;
    const amount = parseFloat(req.body.amount);
    const { description } = req.body;
    const idempotencyKey = req.headers["x-idempotency-key"];

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

    const user = await User.findById(req.user.id).select("email");
    console.log("User found for deposit:", user);
    if (!user) throw new ApiError(404, "User not found");

    const transaction = await withTransaction(async (session) => {
        const account = await Account.findById(accountId).session(session);
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
    const idempotencyKey = req.headers["x-idempotency-key"];


    if (!senderAccountId || !receiverAccountId || !rawAmount) {
        throw new ApiError(400, "Sender account ID, receiver account ID, and amount are required");
    }

    if (!idempotencyKey) {
        throw new ApiError(400, "Idempotency key is required");
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
        const txn = new Transaction({
            senderAccount: senderAccount._id,
            receiverAccount: receiverAccount._id,
            type: TRANSACTION_TYPES.TRANSFER,
            amount,
            currency: senderAccount.currency,
            description: description || TRANSACTION_TYPES.TRANSFER,
            idempotencyKey: idempotencyKey,
            balanceAfter: senderAccount.balance,
            metadata: {
                ip: req.ip,
                userAgent: req.get("User-Agent"),
                deviceId
            },
            processedAt: new Date(),
        });
        await txn.save({ session });
        console.log("Transaction record created:", txn);
        const ledgerEntries = [
            new LedgerEntry({
                transactionId: txn._id,
                accountId: senderAccount._id,
                type: "DEBIT",
                amount,
                balanceBefore: senderAccount.balance + amount,
                balanceAfter: senderAccount.balance,
                currency: senderAccount.currency,
                description: description || "Transfer to " + receiverAccount.accountNumber,
            }),
            new LedgerEntry({
                transactionId: txn._id,
                accountId: receiverAccount._id,
                type: "CREDIT",
                amount,
                balanceBefore: receiverAccount.balance - amount,
                balanceAfter: receiverAccount.balance,
                currency: receiverAccount.currency,
                description: description || "Transfer from " + senderAccount.accountNumber,
            })
        ];
        await LedgerEntry.insertMany(ledgerEntries, { session });

        console.log("Transaction record created:", txn);
        return {
            transaction: txn,
            senderBalance: senderAccount.balance,
            receiverBalance: receiverAccount.balance,
            receiverUserId: receiverAccount.userId,
        };
    })

    const receiverUser = await User.findById(transaction.receiverUserId).select("email");
    console.log("Receiver user:", receiverUser);

    await Promise.all([
        emailQueue.add("transfer", {
            email: senderUser.email,
            amount,
            balance: transaction.senderBalance,
            type: "sent",
        }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } }),

        emailQueue.add("transfer", {
            email: receiverUser.email,
            amount,
            balance: transaction.receiverBalance,
            type: "received",
        }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } }),
    ]);
    console.log("Email jobs added to queue");

    return new ApiResponse(201, "Transfer successful", { transaction }).send(res);

})


export const withdraw = asyncHandler(async (req, res) => {
    const { accountId } = req.params;
    const amount = parseFloat(req.body.amount);
    const { description } = req.body;
    const idempotencyKey = req.headers["x-idempotency-key"];

    if (!amount) throw new ApiError(400, "Amount is required");
    if (!accountId) throw new ApiError(400, "Account ID is required");
    if (!idempotencyKey) throw new ApiError(400, "Idempotency key is required");

    validateAmount(amount, Number(process.env.MAX_WITHDRAW_AMOUNT) || 1_000_000);

    const duplicate = await Transaction.findOne({ idempotencyKey });
    if (duplicate) return res.status(200).json({ message: "Transaction already processed", transactionId: duplicate._id });

    const user = await User.findById(req.user.id).select("email");
    if (!user) throw new ApiError(404, "User not found");
    const transaction = await withTransaction(async (session) => {
        const account = await Account.findById(accountId).session(session);
        if (!account) throw new ApiError(404, "Account not found");
        const balanceBefore = account.balance;
        if (account.userId.toString() !== req.user.id) throw new ApiError(403, "Unauthorized to withdraw from this account");
        if (!account.isActive) throw new ApiError(403, "Account is not active");
        if (account.balance < amount) throw new ApiError(400, "Insufficient funds");

        account.balance = parseFloat((account.balance - amount).toFixed(2));
        await account.save({ session });
        const transaction = new Transaction({
            senderAccount: account._id,
            type: TRANSACTION_TYPES.WITHDRAW,
            amount,
            currency: account.currency,
            description: description || TRANSACTION_TYPES.WITHDRAW,
            idempotencyKey,
            balanceAfter: account.balance,
            metadata: {
                ip: req.ip,
                userAgent: req.get("User-Agent"),
            },
            processedAt: new Date(),
        });

        await transaction.save({ session });
        const ledger = new LedgerEntry({
            transactionId: transaction._id,
            accountId: account._id,
            type: "WITHDRAW",
            amount,
            balanceBefore,
            balanceAfter: account.balance,
            currency: account.currency,
            description: description || "Withdrawal from account",
        });

        await ledger.save({ session });
        console.log("Withdrawal transaction and ledger entry created");

        return transaction;
    });

    await emailQueue.add("withdraw", {
        email: user.email,
        amount,
        balance: transaction.balanceAfter
    }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });
    return new ApiResponse(200, "Withdrawal successful", { transaction }).send(res);
})


export const getTransactionHistory = asyncHandler(async (req, res) => {
    const { accountId } = req.params;
    const { page = 1, limit = 10, type, startDate, endDate } = req.query;

    const account = await Account.findById(accountId);
    if (!account) throw new ApiError(404, "Account not found");
    if (account.userId.toString() !== req.user.id) throw new ApiError(403, "Unauthorized to view transactions for this account");
    const filter = {
        $or: [{ senderAccount: accountId }, { receiverAccount: accountId }]
    };

    if (type) {
        filter.type = type.toUpperCase();
    }

    if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const [transactions, total] = await Promise.all([
        Transaction.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .select("-metadata"),
        Transaction.countDocuments(filter)
    ]);

    return new ApiResponse(200, "Transaction history", {
        transactions,
        pagination: {
            total,
            page: Number(page),
            totalPages: Math.ceil(total / limit),
            limit: Number(limit)
        }
    }).send(res);
});


export const getTransactionById = asyncHandler(async (req, res) => {
    const { transactionId } = req.params;
    const transaction = await Transaction.findById(transactionId)
        .populate("senderAccount", "accountNumber currency")
        .populate("receiverAccount", "accountNumber currency")
        .select("-metadata");

    if (!transaction) throw new ApiError(404, "Transaction not found");

    const account = await Account.findOne({
        _id: { $in: [transaction.senderAccount?._id, transaction.receiverAccount?._id] },
        userId: req.user.id
    });
    if (!account) throw new ApiError(403, "Unauthorized to view this transaction");

    return new ApiResponse(200, "Transaction found", { transaction }).send(res);

})



export const getLedgerHistory = asyncHandler(async (req, res) => {
    const { accountId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const account = await Account.findById(accountId);
    if (!account) throw new ApiError(404, "Account not found");
    if (account.userId.toString() !== req.user.id) throw new ApiError(403, "Unauthorized to view ledger for this account");

    const filter = { accountId };

    const [entries, total] = await Promise.all([
        LedgerEntry.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit)),
        LedgerEntry.countDocuments(filter)
    ]);

    return new ApiResponse(200, "Ledger history", {
        entries,
        pagination: {
            total,
            page: Number(page),
            totalPages: Math.ceil(total / limit),
            limit: Number(limit)
        }
    }).send(res);
});

export const verifyBalance = asyncHandler(async (req, res) => {
    const { accountId } = req.params;
    const account = await Account.findById(accountId);
    if (!account) throw new ApiError(404, "Account not found");
    if (account.userId.toString() !== req.user.id) throw new ApiError(403, "Unauthorized to verify balance for this account");
    const entries = await LedgerEntry.find({ accountId }).sort({ createdAt: 1 });

    let reconstructed = 0;
    for (const entry of entries) {
        if (entry.type === "credit") reconstructed += entry.amount;
        if (entry.type === "debit") reconstructed -= entry.amount;
        reconstructed = parseFloat(reconstructed.toFixed(2));
    }

    const isConsistent = reconstructed === account.balance;

    return new ApiResponse(200, "Balance verification", {
        currentBalance: account.balance,
        reconstructedBalance: reconstructed,
        isConsistent,         // false = something is wrong, alert your team
    }).send(res);
});