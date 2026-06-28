
import ApiError from "../utils/ApiError.js";
import { acquireRedisLock, checkRedisCache, fromCents, parseAndValidateIdempotency, releaseLock, toCents, validateAmount } from "../utils/transaction.utils.js";
import { withTransaction } from "../utils/withTransaction.js";
import { emailQueue } from "../jobs/email.queue.js";
import userRepository from "../repositories/user.repository.js";
import accountRepository from "../repositories/account.repository.js";
import IdempotencyRepository from "../repositories/idempotency.repository.js";
import transactionRepository from "../repositories/transaction.repository.js";
import ledgerRepository from "../repositories/ledger.repository.js";
import { TRANSACTION_TYPES } from "../constants/transaction.constants.js";
import redis from "../config/redis.js";
import logger from "../utils/logger.js";
import idempotencyRepository from "../repositories/idempotency.repository.js";
import {
    ACCOUNT_TYPES,
    ACCOUNT_STATUS,
    ACCOUNT_CURRENCIES,
} from "../constants/account.constants.js";
import { EMAIL_TEMPLATES } from "../constants/email.constants.js";


class TransactionService {

    async deposit(dto) {

        const {
            accountNumber,
            amount,
            description,
            user,
            headers,
            ip,
            userAgent
        } = dto;

        const { amountCents, idempotencyKey } = parseAndValidateIdempotency(
            amount,
            headers["x-idempotency-key"],
            "MAX_TRANSFER_AMOUNT",
            Number(process.env.MAX_TRANSFER_AMOUNT),
        );


        const dbUser = await userRepository.findById(user.id);
        if (!dbUser) throw new ApiError(404, "User not found");

        const userId = user.id;
        const lockKey = `idempotency:lock:${userId}:${idempotencyKey}`;
        const cacheKey = `idempotency:done:${userId}:${idempotencyKey}`;

        let cached = await checkRedisCache(cacheKey, "Deposit");
        if (cached) return { statusCode: cached.statusCode, message: "Already processed", body: cached.body };

        const { lockAcquired, lockToken } = await acquireRedisLock(lockKey, "Deposit");
        if (!lockAcquired) {
            throw new ApiError(409, "Another request with the same idempotency key is being processed. Please try again later.");
        }

        try {
            const dbRecord = await idempotencyRepository.findByKey(userId, idempotencyKey, "deposit");
            if (dbRecord) {
                await redis.set(
                    cacheKey,
                    JSON.stringify({ statusCode: dbRecord.statusCode, body: dbRecord.responseBody }),
                    "EX", Number(process.env.CACHE_TTL_SECONDS)
                ).catch((e) => logger.error("[deposit] Failed to set Redis cache:", e.message));
                return { statusCode: dbRecord.statusCode, message: "Already processed", body: dbRecord.responseBody }
            }



            const { transaction, responseBody } = await withTransaction(async (session) => {
                const account = await accountRepository.findByAccountNumber(accountNumber, session);
                if (!account) {
                    throw new ApiError(404, "Account not found ");
                }

                if (account.userId.toString() !== userId) {
                    throw new ApiError(403, "Unauthorized to deposit into this account");
                }

                if (account.isActive !== ACCOUNT_STATUS.ACTIVE) {
                    throw new ApiError(403, "Account is not active");
                }
                const balanceBeforeCents = account.balance;
                account.balance = account.balance + amountCents;
                await account.save(session);
                const transaction = await transactionRepository.create({
                    receiverAccount: account._id,
                    type: TRANSACTION_TYPES.DEPOSIT,
                    amount: amountCents,
                    currency: account.currency,
                    description: description || TRANSACTION_TYPES.DEPOSIT,
                    idempotencyKey,
                    balanceAfter: account.balance,
                    metadata: {
                        ip, userAgent
                    },
                    processedAt: new Date(),
                }, session);
                await ledgerRepository.create([{
                    transactionId: transaction._id,
                    accountId: account._id,
                    type: "CREDIT",
                    amount: amountCents,
                    balanceBeforeCents: balanceBeforeCents,
                    balanceAfterCents: account.balance,
                    currency: account.currency,
                    description: description || "Deposit into account",
                }], session);

                await idempotencyRepository.create([{
                    userId,
                    key: idempotencyKey,
                    purpose: "deposit",
                    statusCode: 200,
                    responseBody: { transactionId: transaction._id, amount: fromCents(amountCents), balanceAfter: fromCents(account.balance) },
                }], session);

                return {
                    transaction,
                    responseBody: {
                        transactionId: transaction._id,
                        amount: fromCents(amountCents),
                        balanceAfter: fromCents(account.balance),
                    },
                };
            });

            await redis.set(
                cacheKey,
                JSON.stringify({ statusCode: 200, body: responseBody }),
                "EX", Number(process.env.CACHE_TTL_SECONDS)
            ).catch((e) => logger.error("[deposit] Failed to set Redis cache:", e.message));

            try {
                emailQueue.add("deposit", {
                    email: dbUser.email,
                    amount: fromCents(amountCents),
                    balance: fromCents(transaction.balanceAfter)
                });
            } catch (e) {
                logger.error("[deposit] Failed to enqueue email:", e.message);
            }
            return { statusCode: 200, message: "Deposit successful", body: responseBody };
        } catch (err) {
            if (err instanceof ApiError) throw err;
            logger.error("[deposit] Error processing deposit:", err);
            throw new ApiError(500, err.message || "Internal server error");
        }
        finally {
            await releaseLock(lockKey, lockToken, "Deposit");
        }


    }


    async transfer(dto) {
        const { senderAccountNumber, receiverAccountNumber, amount: rawAmount, description, deviceId, user, headers } = dto;

        if (senderAccountNumber === receiverAccountNumber) {
            throw new ApiError(400, "Cannot transfer to the same account");
        }

        const { amountCents, idempotencyKey } = parseAndValidateIdempotency(
            rawAmount,
            headers["x-idempotency-key"],
            "MAX_TRANSFER_AMOUNT",
            Number(process.env.MAX_TRANSFER_AMOUNT),
        );



        const userId = user.id;
        const lockKey = `idempotency:lock:${userId}:${idempotencyKey}`;
        const cacheKey = `idempotency:done:${userId}:${idempotencyKey}`;

        let cached = await checkRedisCache(cacheKey, "transfer");
        if (cached) {
            const { statusCode, body } = cached;
            return { statusCode, message: "Already processed", body };
        }

        const { lockAcquired, lockToken } = await acquireRedisLock(lockKey, "Transfer");
        if (!lockAcquired) throw new ApiError(409, "Already processing. Try again later.", {
            retryAfterMs: Number(process.env.LOCK_TTL_MS)
        });


        try {
            const dbRecord = await idempotencyRepository.findOne({
                userId,
                key: idempotencyKey,
                purpose: "transfer",
            });

            if (dbRecord) {
                await redis.set(
                    cacheKey,
                    JSON.stringify({ statusCode: dbRecord.statusCode, body: dbRecord.responseBody }),
                    "EX", Number(process.env.CACHE_TTL_SECONDS)
                );
                return { statusCode: dbRecord.statusCode, message: "Already processed", body: dbRecord.responseBody };
            }



            const transaction = await withTransaction(async (session) => {
                const senderUser = await userRepository.findById(user.id, { select: "email isActive isVerified" });
                if (!senderUser) {
                    throw new ApiError(404, "Sender account not found");
                }
                if (!senderUser.isVerified) {
                    throw new ApiError(403, "Please verify your email first");
                }
                if (!senderUser.isActive) {
                    throw new ApiError(403, "Sender account is not active");
                }


                const senderAccount = await accountRepository.findByAccountNumber(senderAccountNumber, session);
                const receiverAccount = await accountRepository.findByAccountNumber(receiverAccountNumber, session);


                if (!senderAccount) throw new ApiError(404, "Sender account not found");
                if (!receiverAccount) throw new ApiError(404, "Receiver account not found");
                if (senderAccount.userId.toString() !== user.id) throw new ApiError(403, "You do not own the sender account");


                if (senderAccount.isActive !== ACCOUNT_STATUS.ACTIVE) {
                    throw new ApiError(403, "Sender account is not active");
                }

                if (receiverAccount.isActive !== ACCOUNT_STATUS.ACTIVE) {
                    throw new ApiError(403, "Receiver account is not active");
                }

                if (senderAccount.currency !== receiverAccount.currency) {
                    throw new ApiError(400,
                        `Currency mismatch: sender uses ${senderAccount.currency}, ` +
                        `receiver uses ${receiverAccount.currency}`
                    );
                }
                const startDate = new Date();
                startDate.setHours(0, 0, 0, 0);

                const todayTotal = await transactionRepository.aggregate([
                    {
                        $match: {
                            senderAccount: senderAccount._id,
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
                const dailyLimitCents = toCents(process.env.DAILY_TRANSFER_LIMIT);
                if (dailySpent + amountCents > dailyLimitCents) {
                    throw new ApiError(400,
                        `Daily transfer limit of $${fromCents(dailyLimitCents)} exceeded. ` +
                        `You have $${fromCents(dailyLimitCents - dailySpent)} remaining today`
                    );
                }

                const debitedSender = await accountRepository.findOneAndUpdate(
                    {
                        _id: senderAccount._id,
                        balance: { $gte: amountCents },
                        isActive: ACCOUNT_STATUS.ACTIVE,
                        __v: senderAccount.__v,
                    },
                    { $inc: { balance: -amountCents, __v: 1 } },
                    session
                );

                if (!debitedSender) {
                    throw new ApiError(400, "Insufficient funds or account locked");
                }

                const creditedReceiver = await accountRepository.findOneAndUpdate(
                    { _id: receiverAccount._id, isActive: ACCOUNT_STATUS.ACTIVE, __v: receiverAccount.__v, },
                    { $inc: { balance: amountCents, __v: 1 } },
                    session
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


                const txn = await transactionRepository.create({
                    senderAccount: senderAccount._id,
                    receiverAccount: receiverAccount._id,
                    type: TRANSACTION_TYPES.TRANSFER,
                    amount: amountCents,
                    currency: senderAccount.currency,
                    description: description || TRANSACTION_TYPES.TRANSFER,
                    idempotencyKey: idempotencyKey,
                    balanceAfter: debitedSender.balance,
                    metadata: {
                        ip: headers["x-forwarded-for"] || headers["x-real-ip"] || "unknown",
                        userAgent: headers["user-agent"],
                        deviceId: headers["x-device-id"]
                    },
                    processedAt: new Date(),
                }, session);
                responseBody.data.transactionId = txn._id;

                await ledgerRepository.createMany([
                    {
                        transactionId: txn._id,
                        accountId: senderAccount._id,
                        type: "DEBIT",
                        amount: amountCents,
                        balanceBeforeCents: debitedSender.balance + amountCents,
                        balanceAfterCents: debitedSender.balance,
                        currency: senderAccount.currency,
                        description: description || "Transfer to " + receiverAccount.accountNumber,
                    },
                    {
                        transactionId: txn._id,
                        accountId: receiverAccount._id,
                        type: "CREDIT",
                        amount: amountCents,
                        balanceBeforeCents: creditedReceiver.balance - amountCents,
                        balanceAfterCents: creditedReceiver.balance,
                        currency: receiverAccount.currency,
                        description: description || "Transfer from " + senderAccount.accountNumber,
                    }
                ], session);


                await idempotencyRepository.create(
                    [{
                        userId,
                        key: idempotencyKey,
                        purpose: "transfer",
                        statusCode: 200,
                        responseBody,
                    }],
                    { session }
                );

                return {
                    responseBody,
                    transaction: txn,
                    senderUserEmail: senderUser.email,
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
                logger.error("[transfer] Failed to set Redis cache:", err.message);
            });
            const receiverUser = await userRepository.findById(transaction.receiverUserId, { select: "email" });

            try {
                await
                    Promise.all([
                        emailQueue.add(EMAIL_TEMPLATES.TRANSACTION_NOTIFICATION, {
                            email: transaction.senderUserEmail,
                            amount: fromCents(amountCents),
                            balance: transaction.senderBalance,
                            type: "sent",
                        }),

                        emailQueue.add(EMAIL_TEMPLATES.TRANSACTION_NOTIFICATION, {
                            email: receiverUser.email,
                            amount: fromCents(amountCents),
                            balance: transaction.receiverBalance,
                            type: "received",
                        }),
                    ])
            } catch (e) {
                logger.error("[transfer] Email queue failed:", e.message);
            }
            return { statusCode: 201, message: "Transfer successful", body: transaction.responseBody };
        }
        catch (error) {
            if (error instanceof ApiError) throw error;
            logger.error("[transfer] Unexpected error:", error.message);
            throw new ApiError(500, error.message || "Internal server error");
        }
        finally {
            await releaseLock(lockKey, lockToken, "transfer");
        }

    }
    async withdraw(dto) {
        const { accountNumber, amount, description, user, headers, ip, userAgent } = dto;

        const { amountCents, idempotencyKey } = parseAndValidateIdempotency(
            amount,
            headers["x-idempotency-key"],
            "MAX_WITHDRAW_AMOUNT",
            Number(process.env.MAX_WITHDRAW_AMOUNT),
        );

        const userId = user.id;
        const lockKey = `idempotency:lock:${userId}:${idempotencyKey}`;
        const cacheKey = `idempotency:done:${userId}:${idempotencyKey}`;

        const cached = await checkRedisCache(cacheKey, "withdraw");
        if (cached) return {
            statusCode: cached.statusCode,
            message: "Already processed",
            body: cached.body,
            alreadyProcessed: true,
        };

        const { lockAcquired, lockToken } = await acquireRedisLock(lockKey, "withdraw");
        if (!lockAcquired) throw new ApiError(409, "Already processing. Try again later.", {
            retryAfterMs: Number(process.env.LOCK_TTL_MS),
        });

        try {
            const dbRecord = await idempotencyRepository.findByKey(userId, idempotencyKey, "withdrawal");
            if (dbRecord) {
                await redis.set(
                    cacheKey,
                    JSON.stringify({ statusCode: dbRecord.statusCode, body: dbRecord.responseBody }),
                    "EX", Number(process.env.CACHE_TTL_SECONDS)
                ).catch(e => logger.error("[withdraw] Redis warm-up failed:", e.message));

                return {
                    statusCode: dbRecord.statusCode,
                    message: "Already processed",
                    body: dbRecord.responseBody,
                    alreadyProcessed: true,
                };
            }

            const { withdrawnTxn, responseBody, dbUser } = await withTransaction(async (session) => {
                const dbUser = await userRepository.findById(userId, { select: "email" });
                if (!dbUser) throw new ApiError(404, "User not found");

                const account = await accountRepository.findByAccountNumber(accountNumber, session);
                if (!account) throw new ApiError(404, "Account not found");
                if (account.userId.toString() !== userId) throw new ApiError(403, "Unauthorized");
                if (account.isActive !== "active") throw new ApiError(403, "Account is not active");
                if (account.balance < amountCents) throw new ApiError(400, "Insufficient funds");

                const balanceBeforeCents = account.balance;

                const updated = await accountRepository.findOneAndUpdate(
                    {
                        _id: account._id,
                        balance: { $gte: amountCents },
                        isActive: "active",
                        __v: account.__v,
                    },
                    { $inc: { balance: -amountCents, __v: 1 } },
                    session
                );
                if (!updated) throw new ApiError(400, "Insufficient funds or account locked");

                const withdrawnTxn = await transactionRepository.create({
                    senderAccount: account._id,
                    type: TRANSACTION_TYPES.WITHDRAW,
                    amount: amountCents,
                    currency: account.currency,
                    description: description || TRANSACTION_TYPES.WITHDRAW,
                    idempotencyKey,
                    balanceAfter: updated.balance,
                    metadata: { ip, userAgent },
                    processedAt: new Date(),
                }, session);

                await ledgerRepository.create({
                    transactionId: withdrawnTxn._id,
                    accountId: account._id,
                    type: "DEBIT",
                    amount: amountCents,
                    balanceBeforeCents,
                    balanceAfterCents: updated.balance,
                    currency: account.currency,
                    description: description || "Withdrawal from account",
                }, session);

                const responseBody = {
                    transactionId: withdrawnTxn._id,
                    amount: fromCents(amountCents),
                    currency: account.currency,
                    balance: fromCents(updated.balance),
                    processedAt: withdrawnTxn.processedAt,
                };

                await idempotencyRepository.create([{
                    userId,
                    key: idempotencyKey,
                    purpose: "withdrawal",
                    statusCode: 200,
                    responseBody,
                }], session);

                return { withdrawnTxn, responseBody, dbUser };
            });

            await redis.set(
                cacheKey,
                JSON.stringify({ statusCode: 200, body: responseBody }),
                "EX", Number(process.env.CACHE_TTL_SECONDS)
            ).catch(e => logger.error("[withdraw] Redis cache failed:", e.message));

            try {
                await emailQueue.add("withdraw", {
                    email: dbUser.email,
                    amount: fromCents(amountCents),
                    balance: fromCents(withdrawnTxn.balanceAfter),
                });
            } catch (e) {
                logger.error("[withdraw] Email queue failed:", e.message);
            }

            return {
                statusCode: 200,
                message: "Withdrawal successful",
                body: responseBody,
                alreadyProcessed: false,
            };

        } catch (err) {
            if (err instanceof ApiError) throw err;
            logger.error("[withdraw] Unexpected error:", err.message);
            throw new ApiError(500, err.message || "Internal server error");
        } finally {
            await releaseLock(lockKey, lockToken, "withdraw");
        }
    }

    async getTransactionHistory({ accountNumber, page, limit, type, startDate, endDate, userId }) {

        const account = await accountRepository.findByAccountNumber(accountNumber);
        if (!account) throw new ApiError(404, "Account not found");
        if (account.userId.toString() !== userId) throw new ApiError(403, "Unauthorized");

        const cacheKey = `txn:history:${account._id}:p${page}:l${limit}:t${type || ""}:s${startDate || ""}:e${endDate || ""}`;
        const cached = await checkRedisCache(cacheKey, "getTransactionHistory");
        if (cached) return cached.body;

        const filter = {
            $or: [{ senderAccount: account._id }, { receiverAccount: account._id }]
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
            transactionRepository.findMany(filter, { page, limit }),
            transactionRepository.count(filter),
        ]);

        const responseBody = {
            transactions,
            pagination: {
                total,
                page,
                totalPages: Math.ceil(total / limit),
                limit,
            },
        };

        await redis.set(cacheKey, JSON.stringify({ body: responseBody }), "EX", Number(process.env.CACHE_TTL_SECONDS))
            .catch(e => logger.error("[getTransactionHistory] Redis SET failed:", e.message));

        return responseBody;
    }

    async getTransactionById({ transactionId, userId }) {
        if (!mongoose.Types.ObjectId.isValid(transactionId)) {
            throw new ApiError(400, "Invalid transaction ID");
        }

        const cacheKey = `txn:id:${transactionId}:u:${userId}`;
        const cached = await checkRedisCache(cacheKey, "getTransactionById");
        if (cached) return cached.body;

        const transaction = await transactionRepository.findByIdWithAccounts(transactionId);
        if (!transaction) throw new ApiError(404, "Transaction not found");

        const ownsSender = transaction.senderAccount?.userId?.toString() === userId;
        const ownsReceiver = transaction.receiverAccount?.userId?.toString() === userId;
        if (!ownsSender && !ownsReceiver) throw new ApiError(403, "Unauthorized");

        const result = transaction.toObject();
        if (result.senderAccount) delete result.senderAccount.userId;
        if (result.receiverAccount) delete result.receiverAccount.userId;

        await redis.set(cacheKey, JSON.stringify({ body: { transaction: result } }), "EX", Number(process.env.CACHE_TTL_SECONDS))
            .catch(e => logger.error("[getTransactionById] Redis SET failed:", e.message));

        return { transaction: result };
    }


    async getLedgerHistory({ accountNumber, page, limit, userId }) {
        const account = await accountRepository.findByAccountNumber(accountNumber);
        if (!account) throw new ApiError(404, "Account not found");
        if (account.userId.toString() !== userId) throw new ApiError(403, "Unauthorized");

        const cacheKey = `ledger:history:${account._id}:p${page}:l${limit}`;
        const cached = await checkRedisCache(cacheKey, "getLedgerHistory");
        if (cached) return { body: cached.body, fromCache: true };

        const filter = { accountId: account._id };
        const [entries, total] = await Promise.all([
            ledgerRepository.findMany(filter, { page, limit }),
            ledgerRepository.count(filter),
        ]);

        const body = {
            entries,
            pagination: {
                total,
                page,
                totalPages: Math.ceil(total / limit),
                limit,
            },
        };

        await redis.set(cacheKey, JSON.stringify({ body }), "EX", Number(process.env.CACHE_TTL_SECONDS))
            .catch(e => logger.error("[getLedgerHistory] Redis SET failed:", e.message));

        return { body, fromCache: false };
    }


    async verifyBalance({ accountNumber, userId }) {
        const account = await accountRepository.findByAccountNumber(accountNumber);
        if (!account) throw new ApiError(404, "Account not found");
        if (account.userId.toString() !== userId) throw new ApiError(403, "Unauthorized");

        const entries = await ledgerRepository.findAllForBalance(account._id);

        let reconstructed = 0;
        for (const entry of entries) {
            const amount = Math.round(entry.amount);
            if (entry.type === "CREDIT") reconstructed += amount;
            if (entry.type === "DEBIT") reconstructed -= amount;
        }

        const actualBalance = Math.round(account.balance);
        const isConsistent = reconstructed === actualBalance;

        return {
            currentBalance: fromCents(actualBalance),
            reconstructedBalance: fromCents(reconstructed),
            isConsistent,
            ...(isConsistent ? {} : { discrepancy: fromCents(actualBalance - reconstructed) }),
        };
    }

}


export default new TransactionService();