import asyncHandler from "../utils/asyncHandler.js";
import Account from "../models/account.model.js";
import Transaction from "../models/transaction.model.js";
import ApiError from "../utils/ApiError.js";
import { acquireRedisLock, checkRedisCache, parseAndValidateIdempotency, releaseLock, validateAmount } from "../utils/transaction.utils.js";
import { withTransaction } from "../utils/withTransaction.js";
import ApiResponse from "../utils/ApiResponse.js";
import { emailQueue } from "../queues/emailQueue.js";
import { TRANSACTION_TYPES } from "../models/transaction.model.js";
import LedgerEntry from "../models/ledger.model.js";
import User from "../models/user.model.js";
import mongoose from "mongoose";
import redis from "../config/redis.js";
import Idempotency from "../models/idempotency.model.js";
import crypto from "crypto";


export const deposit = asyncHandler(async (req, res) => {
    const { accountId } = req.params;
    const { description } = req.body;
    const idempotencyKey = req.headers["x-idempotency-key"];
    const amountCents = toCents(req.body.rawAmount);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new ApiError(400, "Invalid amount");
    }

    if (!amountCents) {
        throw new ApiError(400, "Amount is required");
    }
    if (!accountId) {
        throw new ApiError(400, "Account ID is required");
    }
    if (!idempotencyKey) {
        throw new ApiError(400, "Idempotency key is required");
    }
    if (!UUID_RE.test(idempotencyKey)) {
        throw new ApiError(400, "X-Idempotency-Key must be a valid UUID v4");
    }

    const maxCents = toCents(process.env.MAX_TRANSFER_AMOUNT || 500_000);

    validateAmount(amountCents, maxCents);

    const duplicate = await Transaction.findOne({ idempotencyKey });
    if (duplicate) {
        return res.status(200).json({ message: "Transaction already processed", transactionId: duplicate._id });
    }

    const user = await User.findById(req.user.id).select("email");
    if (!user) throw new ApiError(404, "User not found");

    const userId = req.user.id;
    const lockToken = crypto.randomUUID();
    const lockKey = `idempotency:lock:${userId}:${idempotencyKey}`;
    const cacheKey = `idempotency:done:${userId}:${idempotencyKey}`;

    let cache = null;
    try {
        cache = await redis.get(cacheKey);
    }
    catch (err) {
        console.error("[deposit] Redis GET failed, falling through to DB:", err.message);
    }

    if (cache) {
        const { statusCode, body } = JSON.parse(cache);
        return res
            .status(statusCode)
            .set("X-Idempotent-Replayed", "true")
            .json(body);
    }
    let lockAcquired = false;
    try {
        const result = await redis.set(lockKey, lockToken, "NX", "PX", 30000);
        lockAcquired = result === "OK";
    }
    catch (err) {
        console.error("[deposit] Redis lock unavailable:", err.message);
        throw new ApiError(503, "Deposit service temporarily unavailable. Please try again shortly.");
    }
    if (!lockAcquired) {
        return res.status(409).json({
            success: false, message: "A deposit with this idempotency key is already being processed. Please wait and retry.",
            retryAfterMs: 30000,
        });
    }

    try {
        const dbRecord = await Idempotency.findOne({
            userId,
            key: idempotencyKey,
            purpose: "deposit",
        });

        if (dbRecord) {
            await redis.set(
                cacheKey,
                JSON.stringify({ statusCode: dbRecord.statusCode, body: dbRecord.responseBody }),
                "EX", Number(process.env.CACHE_TTL_SECONDS)
            );
            return res
                .status(dbRecord.statusCode)
                .set("X-Idempotent-Replayed", "true")
                .json(dbRecord.responseBody);
        }



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

            account.balance = parseFloat((account.balance + fromCents(amountCents)).toFixed(2));
            await account.save({ session });
            const transaction = new Transaction({
                receiverAccount: account._id,
                type: TRANSACTION_TYPES.DEPOSIT,
                amount: fromCents(amountCents),
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

            await ledger.create({
                transactionId: transaction._id,
                accountId: account._id,
                type: "DEPOSIT",
                amount: amountCents,
                balanceBefore: account.balance - amountCents,
                balanceAfter: account.balance,
                currency: account.currency,
                description: description || "Deposit into account",
            }, { session });

            await transaction.save({ session });

            return transaction;
        });


        await emailQueue.add("deposit", {
            email: user.email,
            amount: fromCents(amountCents),
            balance: transaction.balanceAfter
        }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });

        return new ApiResponse(201, "Deposit successful", { transaction }).send(res);
    } catch (err) {
        await redis.del(lockKey).catch((e) => console.error("[deposit] Failed to release lock after DB error:", e.message));
        console.error("[deposit] Redis GET failed during idempotency check, falling through to DB:", err.message);
    }
});


export const transfer = asyncHandler(async (req, res) => {
    const { senderAccountId, receiverAccountId, amount: rawAmount, description, deviceId } = req.body;


    if (!senderAccountId || !receiverAccountId || !rawAmount) {
        throw new ApiError(400, "Sender account ID, receiver account ID, and amount are required");
    }

    if (senderAccountId === receiverAccountId) {
        throw new ApiError(400, "Cannot transfer to the same account");
    }

    const amountCents = toCents(rawAmount);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new ApiError(400, "Invalid amount");
    }

    const maxCents = toCents(process.env.MAX_TRANSFER_AMOUNT || 500_000);
    validateAmount(amountCents, maxCents);


    const idempotencyKey = req.headers["x-idempotency-key"];
    if (!idempotencyKey) {
        throw new ApiError(400, "Idempotency key is required");
    }
    if (!UUID_RE.test(idempotencyKey)) {
        throw new ApiError(400, "X-Idempotency-Key must be a valid UUID v4");
    }

    const userId = req.user.id;
    const lockToken = crypto.randomUUID();
    const lockKey = `idempotency:lock:${userId}:${idempotencyKey}`;
    const cacheKey = `idempotency:done:${userId}:${idempotencyKey}`;

    let cached = null;
    try {
        cached = await redis.get(cacheKey);
    } catch (err) {
        console.error("[transfer] Redis GET failed, falling through to DB:", err.message);
    }

    if (cached) {
        const { statusCode, body } = JSON.parse(cached);
        return res
            .status(statusCode)
            .set("X-Idempotent-Replayed", "true")
            .json(body);
    }

    let lockAcquired = false;
    try {
        const result = await redis.set(lockKey, lockToken, "NX", "PX", LOCK_TTL_MS);
        lockAcquired = result === "OK";
    } catch (err) {
        console.error("[transfer] Redis lock unavailable:", err.message);
        throw new ApiError(503, "Transfer service temporarily unavailable. Please try again shortly.");
    }

    if (!lockAcquired) {
        return res.status(409).json({
            success: false,
            message: "A transfer with this idempotency key is already being processed. Please wait and retry.",
            retryAfterMs: LOCK_TTL_MS,
        });
    }



    try {
        const dbRecord = await Idempotency.findOne({
            userId,
            key: idempotencyKey,
            purpose: "beneficiary_transfer",
        });

        if (dbRecord) {
            await redis.set(
                cacheKey,
                JSON.stringify({ statusCode: dbRecord.statusCode, body: dbRecord.responseBody }),
                "EX", Number(process.env.CACHE_TTL_SECONDS)
            );
            return res
                .status(dbRecord.statusCode)
                .set("X-Idempotent-Replayed", "true")
                .json(dbRecord.responseBody);
        }




        const senderUser = await User.findById(req.user.id).select("email isActive isVerified");
        if (!senderUser) {
            throw new ApiError(404, "Sender account not found");
        }
        if (!senderUser.isVerified) {
            throw new ApiError(403, "Please verify your email first");
        }
        if (!senderUser.isActive) {
            throw new ApiError(403, "Sender account is not active");
        }




        const transaction = await withTransaction(async (session) => {
            const senderAccount = await Account.findOne({ userId: senderAccountId }).session(session);
            const receiverAccount = await Account.findOne({ userId: receiverAccountId }).session(session);



            if (!senderAccount) throw new ApiError(404, "Sender account not found");
            if (!receiverAccount) throw new ApiError(404, "Receiver account not found");
            if (senderAccount.userId.toString() !== req.user.id) throw new ApiError(403, "You do not own the sender account");


            if (senderAccount.isActive !== "active") throw new ApiError(403, "Sender account is inactive");
            if (receiverAccount.isActive !== "active") throw new ApiError(403, "Receiver account is inactive");


            if (senderAccount.currency !== receiverAccount.currency) {
                throw new ApiError(400,
                    `Currency mismatch: sender uses ${senderAccount.currency}, ` +
                    `receiver uses ${receiverAccount.currency}`
                );
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
                        total: { $sum: "$amountCents" }
                    }
                }
            ]);

            const dailySpent = todayTotal[0]?.total || 0;
            const dailyLimitCents = toCents(process.env.DAILY_TRANSFER_LIMIT);
            if (dailySpent + amountCents > dailyLimitCents) {
                throw new ApiError(400,
                    `Daily transfer limit of $${fromCents(dailyLimitCents)} exceeded. ` +
                    `You have $${fromCents(dailyLimitCents - dailySpent)} remaining today`
                );
            }

            const debitedSender = await Account.findOneAndUpdate(
                {
                    _id: senderAccount._id,
                    balance: { $gte: amountCents },
                    isActive: "active",
                    __v: senderAccount.__v,
                },
                { $inc: { balance: -amountCents, __v: 1 } },
                { new: true, session }
            );

            if (!debitedSender) {
                throw new ApiError(400, "Insufficient funds or account locked");
            }

            const creditedReceiver = await Account.findOneAndUpdate(
                { _id: receiverAccount._id, isActive: "active", __v: receiverAccount.__v, },
                { $inc: { balance: amountCents, __v: 1 } },
                { new: true, session }
            );

            if (!creditedReceiver) {
                throw new ApiError(400, "Transfer failed: receiver account unavailable");
            }
            const responseBody = {
                success: true,
                message: "Transfer successful",
                data: {
                    transactionId: null,
                    amount: fromCents(amountCents),
                    currency: senderAccount.currency,
                    senderBalance: fromCents(debitedSender.balance),
                    receiverBalance: fromCents(creditedReceiver.balance),
                    processedAt: new Date(),
                },
            };


            const txn = new Transaction({
                senderAccount: senderAccount._id,
                receiverAccount: receiverAccount._id,
                type: TRANSACTION_TYPES.TRANSFER,
                amount: amountCents,
                currency: senderAccount.currency,
                description: description || TRANSACTION_TYPES.TRANSFER,
                idempotencyKey: idempotencyKey,
                balanceAfter: debitedSender.balance,
                metadata: {
                    ip: req.ip,
                    userAgent: req.get("User-Agent"),
                    deviceId
                },
                processedAt: new Date(),
            });
            await txn.save({ session });
            responseBody.data.transactionId = txn._id;
            const ledgerEntries = [
                new LedgerEntry({
                    transactionId: txn._id,
                    accountId: senderAccount._id,
                    type: "DEBIT",
                    amount: amountCents,
                    balanceBefore: debitedSender.balance + amountCents,
                    balanceAfter: debitedSender.balance,
                    currency: senderAccount.currency,
                    description: description || "Transfer to " + receiverAccount.accountNumber,
                }),
                new LedgerEntry({
                    transactionId: txn._id,
                    accountId: receiverAccount._id,
                    type: "CREDIT",
                    amount: amountCents,
                    balanceBefore: creditedReceiver.balance - amountCents,
                    balanceAfter: creditedReceiver.balance,
                    currency: receiverAccount.currency,
                    description: description || "Transfer from " + senderAccount.accountNumber,
                })
            ];
            await LedgerEntry.insertMany(ledgerEntries, { session });
            await Idempotency.create(
                [{
                    userId,
                    key: idempotencyKey,
                    purpose: "beneficiary_transfer",
                    statusCode: 200,
                    responseBody,
                }],
                { session }
            );

            return {
                responseBody,
                transaction: txn,
                senderBalance: fromCents(debitedSender.balance),
                receiverBalance: fromCents(creditedReceiver.balance),
                receiverUserId: receiverAccount.userId,
            };
        })



        await redis.set(
            cacheKey,
            JSON.stringify({ statusCode: 200, body: transaction.responseBody }),
            "EX", Number(process.env.CACHE_TTL_SECONDS)
        ).catch((err) => {
            console.error("[transfer] Failed to set Redis cache:", err.message);
        });
        const receiverUser = await User.findById(transaction.receiverUserId).select("email");


        await Promise.all([
            emailQueue.add("transaction-notification", {
                email: senderUser.email,
                amount: fromCents(amountCents),
                balance: transaction.senderBalance,
                type: "sent",
            }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } }),

            emailQueue.add("transaction-notification", {
                email: receiverUser.email,
                amount: fromCents(amountCents),
                balance: transaction.receiverBalance,
                type: "received",
            }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } }),
        ]).catch((err) => {
            console.error("[transfer] Failed to enqueue email notifications:", err.message);
        });
        return new ApiResponse(201, "Transfer successful", transaction.responseBody).send(res);
    } finally {
        await redis.eval(LOCK_RELEASE_SCRIPT, 1, lockKey, lockToken)
            .catch((err) => console.error("[transfer] Lock release failed:", err.message));
    }
})


export const withdraw = asyncHandler(async (req, res) => {
    const { accountId } = req.params;
    const amount = parseFloat(req.body.amount);
    const { description } = req.body;
    const { amountCents, idempotencyKey } = parseAndValidateIdempotency(
        amount,
        req.headers["x-idempotency-key"],
        "MAX_WITHDRAW_AMOUNT",
        Number(process.env.MAX_WITHDRAW_AMOUNT),
    );
    if (!amount) throw new ApiError(400, "Amount is required");
    if (!accountId) throw new ApiError(400, "Account ID is required");;


    const userId = req.user.id;
    const lockKey = `idempotency:lock:${userId}:${idempotencyKey}`;
    const cacheKey = `idempotency:done:${userId}:${idempotencyKey}`;

    let cached = await checkRedisCache(cacheKey, "withdraw");
    if (cached) {
        return res
            .status(cached.statusCode)
            .set("X-Idempotent-Replayed", "true")
            .json(cached.body);
    }


    const { lockAcquired, lockToken } = await acquireRedisLock(lockKey, "withdraw");
    if (!lockAcquired) {
        return res.status(409).json({
            success: false,
            message: "A withdrawal with this idempotency key is already being processed. Please wait and retry.",
            retryAfterMs: LOCK_TTL_MS,
        });
    }

    try {

        const dbRecord = await Idempotency.findOne({
            userId,
            key: idempotencyKey,
            purpose: "withdraw",
        });

        if (dbRecord) {
            await redis.set(
                cacheKey,
                JSON.stringify({ statusCode: dbRecord.statusCode, body: dbRecord.responseBody }),
                "EX", Number(process.env.CACHE_TTL_SECONDS)
            );
            return res
                .status(dbRecord.statusCode)
                .set("X-Idempotent-Replayed", "true")
                .json(dbRecord.responseBody);
        }






        const user = await User.findById(req.user.id).select("email");
        if (!user) throw new ApiError(404, "User not found");
        const { transaction: txn, responseBody } = await withTransaction(async (session) => {
            const account = await Account.findById(accountId).session(session);
            if (!account) throw new ApiError(404, "Account not found");
            const balanceBefore = account.balance;
            if (account.userId.toString() !== req.user.id) throw new ApiError(403, "Unauthorized to withdraw from this account");
            if (!account.isActive) throw new ApiError(403, "Account is not active");
            if (account.balance < amountCents) throw new ApiError(400, "Insufficient funds");



            const updated = await Account.findOneAndUpdate(
                {
                    _id: account._id,
                    balance: { $gte: amountCents },
                    isActive: "active",
                    __v: account.__v,
                },
                { $inc: { balance: -amountCents, __v: 1 } },
                { new: true, session },
            );

            if (!updated) {
                throw new ApiError(400, "Insufficient funds or account locked");
            }

            await account.save({ session });
            const transaction = new Transaction({
                senderAccount: account._id,
                type: TRANSACTION_TYPES.WITHDRAW,
                amount: fromCents(amountCents),
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
                amount: fromCents(amountCents),
                balanceBefore,
                balanceAfter: account.balance,
                currency: account.currency,
                description: description || "Withdrawal from account",
            });

            await ledger.save({ session });

            const responseBody = {
                success: true,
                message: "Withdrawal successful",
                data: {
                    transactionId: transaction._id,
                    amount: fromCents(amountCents),
                    currency: account.currency,
                    balance: fromCents(account.balance),
                    processedAt: transaction.processedAt,
                },
            };

            await Idempotency.create({
                userId,
                key: idempotencyKey,
                purpose: "withdraw",
                statusCode: 200,
                responseBody,
            }, { session });

            return { transaction, responseBody };
        });

        await redis
            .set(cacheKey, JSON.stringify({ statusCode: 200, body: responseBody }), "EX", Number(process.env.CACHE_TTL_SECONDS))
            .catch((e) => console.error("[withdraw] Failed to set Redis cache:", e.message));


        await emailQueue.add("withdraw", {
            email: user.email,
            amount: fromCents(amountCents),
            balance: transaction.balanceAfter
        }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });
        return new ApiResponse(200, "Withdrawal successful", { transaction }).send(res);
    }
    finally {
        await releaseLock(lockKey, lockToken, "withdraw");
    }
})


export const getTransactionHistory = asyncHandler(async (req, res) => {
    const { accountId } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const { type, startDate, endDate } = req.query;


    const account = await Account.findById(accountId);
    if (!account) throw new ApiError(404, "Account not found");
    if (account.userId.toString() !== req.user.id) throw new ApiError(403, "Unauthorized to view transactions for this account");

    const cacheKey = `txn:history:${accountId}:p${page}:l${limit}:t${type || ""}:s${startDate || ""}:e${endDate || ""}`;
    const cached = await checkRedisCache(cacheKey, "getTransactionHistory");
    if (cached) {
        return res.set("X-Cache", "HIT").status(200).json(cached.body);
    }


    const filter = {
        $or: [{ senderAccount: accountId }, { receiverAccount: accountId }]
    };
    const ALLOWED_TYPES = new Set(Object.values(TRANSACTION_TYPES));
    if (type) {
        const upperType = type.toUpperCase();
        if (!ALLOWED_TYPES.has(upperType)) {
            throw new ApiError(400, `Invalid transaction type. Allowed: ${[...ALLOWED_TYPES].join(", ")}`);
        }
        filter.type = upperType;
    }

    if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) {
            const d = new Date(startDate);
            if (isNaN(d)) throw new ApiError(400, "Invalid startDate");
            filter.createdAt.$gte = d;
        }
        if (endDate) {
            const d = new Date(endDate);
            if (isNaN(d)) throw new ApiError(400, "Invalid endDate");
            filter.createdAt.$lte = d;
        }
    }

    const [transactions, total] = await Promise.all([
        Transaction.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit))
            .select("-metadata"),
        Transaction.countDocuments(filter)
    ]);
    await redis
        .set(cacheKey, JSON.stringify({ body: responseBody }), "EX", Number(process.env.CACHE_TTL_SECONDS))
        .catch((e) => console.error("[getTransactionHistory] Redis SET failed:", e.message));


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
    if (!mongoose.Types.ObjectId.isValid(transactionId)) {
        throw new ApiError(400, "Invalid transaction ID");
    }
    const cacheKey = `txn:id:${transactionId}:u:${req.user.id}`;
    const cached = await checkRedisCache(cacheKey, "getTransactionById");
    if (cached) {
        return res.set("X-Cache", "HIT").status(200).json(cached.body);
    }

    const transaction = await Transaction.findById(transactionId)
        .populate("senderAccount", "accountNumber currency")
        .populate("receiverAccount", "accountNumber currency")
        .select("-metadata");

    if (!transaction) throw new ApiError(404, "Transaction not found");

    const userId = req.user.id;
    const ownsSender = transaction.senderAccount?.userId?.toString() === userId;
    const ownsReceiver = transaction.receiverAccount?.userId?.toString() === userId;

    if (!ownsSender && !ownsReceiver) {
        throw new ApiError(403, "Unauthorized to view this transaction");
    }
    if (transaction.senderAccount) delete transaction.senderAccount.userId;
    if (transaction.receiverAccount) delete transaction.receiverAccount.userId;

    const responseBody = { transaction };
    await redis
        .set(cacheKey, JSON.stringify({ body: responseBody }), "EX", Number(process.env.CACHE_TTL_SECONDS))
        .catch((e) => console.error("[getTransactionById] Redis SET failed:", e.message));

    return new ApiResponse(200, "Transaction found", { transaction }).send(res);

})



export const getLedgerHistory = asyncHandler(async (req, res) => {
    const { accountId } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const account = await Account.findById(accountId);
    if (!account) throw new ApiError(404, "Account not found");
    if (account.userId.toString() !== req.user.id) throw new ApiError(403, "Unauthorized to view ledger for this account");

    const cacheKey = `ledger:history:${accountId}:p${page}:l${limit}`;
    const cached = await checkRedisCache(cacheKey, "getLedgerHistory");

    if (cached) {
        return res.set("X-Cache", "HIT").status(200).json(cached.body);
    }

    const filter = { accountId };

    const [entries, total] = await Promise.all([
        LedgerEntry.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(Number(limit)),
        LedgerEntry.countDocuments(filter)
    ]);

    await redis
        .set(cacheKey, JSON.stringify({ body: { entries, pagination: { total, page, totalPages: Math.ceil(total / limit), limit } } }), "EX", Number(process.env.CACHE_TTL_SECONDS))
        .catch((e) => console.error("[getLedgerHistory] Redis SET failed:", e.message));

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

    const TYPE_SIGN = {
        CREDIT: +1,
        DEPOSIT: +1,
        DEBIT: -1,
    };


    const entries = await LedgerEntry.find({ accountId }).sort({ createdAt: 1 }).select("type amount balanceBefore balanceAfter")
        .lean();;

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
        isConsistent,
    }).send(res);
});