import ApiError from "../utils/ApiError.js";
import { emailQueue } from "../jobs/email.queue.js";
import { withTransaction } from "../utils/withTransaction.js";
import { generateAccountNumber } from "../utils/account.utils.js";
import { ACCOUNT_TYPES, ACCOUNT_STATUS, ACCOUNT_CURRENCIES } from "../constants/account.constants.js";
import accountRepository from "../repositories/account.repository.js";
import userRepository from "../repositories/user.repository.js";
import { UUID_RE } from "../utils/idempotency.utils.js";
import idempotencyRepository from "../repositories/idempotency.repository.js";
import { IDEMPOTENCY_PURPOSES } from "../constants/idempotency.constant.js";
import { EMAIL_TEMPLATES } from "../constants/email.constants.js";

class AccountService {
    async createAccount(req) {
        const userId = req.user.id;
        const user = await userRepository.findAccountCreationUser(userId);

        if (!user)
            throw new ApiError(404, "User not found");

        if (!user.isVerified)
            throw new ApiError(
                403,
                "Please verify your email first"
            );

        if (!user.isActive) throw new ApiError(403, "Account is suspended");

        const { accountType = ACCOUNT_TYPES.SAVINGS } = req.body || {};
        const validAccountTypes = Object.values(ACCOUNT_TYPES);

        if (!validAccountTypes.includes(accountType))
            throw new ApiError(400, `Invalid account type. Must be one of: ${validAccountTypes.join(", ")}`);


        const idempotencyKey =
            req.headers["x-idempotency-key"];

        if (!idempotencyKey) {
            throw new ApiError(
                400,
                "Idempotency key is required"
            );
        }
        if (!UUID_RE.test(idempotencyKey)) {
            throw new ApiError(400, "X-Idempotency-Key must be a valid UUID v4");
        }


        const duplicate =
            await idempotencyRepository.findByKey(
                userId,
                idempotencyKey,
                IDEMPOTENCY_PURPOSES.CREATE_BANK_ACCOUNT
            );

        if (duplicate) {
            return {
                ...duplicate.responseBody
            };
        }

        const account =
            await withTransaction(
                async (session) => {
                    const count =
                        await accountRepository.countByUserId(
                            userId,
                            session
                        );

                    if (count >= 3) {
                        throw new ApiError(
                            400,
                            "Maximum account limit reached"
                        );
                    }

                    if (accountType === ACCOUNT_TYPES.SAVINGS) {
                        const hasSavings =
                            await accountRepository.findSavingsByUserId(
                                userId,
                                session
                            );

                        if (hasSavings) {
                            throw new ApiError(
                                400,
                                "You already have a savings account"
                            );
                        }
                    }

                    const [account] =
                        await accountRepository.create({
                            userId,
                            accountNumber:
                                generateAccountNumber(),
                            accountType,
                        },
                            session
                        );


                    await idempotencyRepository.create(
                        [{
                            userId,
                            key: idempotencyKey,
                            purpose: IDEMPOTENCY_PURPOSES.CREATE_BANK_ACCOUNT,
                            accountId: account._id,
                            responseBody: {
                                account: {
                                    id: account._id,
                                    accountType:
                                        account.accountType,
                                    accountNumber:
                                        account.accountNumber,
                                    balance: account.balance,
                                    createdAt:
                                        account.createdAt,
                                },
                            },
                            statusCode: 201,

                        }],
                        session
                    );


                    return account;
                }
            );

        await emailQueue.add(EMAIL_TEMPLATES.CREATE_BANK_ACCOUNT, { email: user.email, });

        return {
            account: {
                id: account._id,
                accountType:
                    account.accountType,
                accountNumber:
                    account.accountNumber,
                balance: account.balance,
                createdAt:
                    account.createdAt,
            },
        };
    }

    async getAccountDetails(userId) {
        const accounts = await accountRepository.findByUserId(userId);
        return { accounts };
    }

    async freezeAccount(accountId, userId) {
        const account =
            await accountRepository.findByIdAndUser(accountId, userId);

        if (!account) throw new ApiError(404, "Account not found");

        if (account.isActive === ACCOUNT_STATUS.CLOSED) throw new ApiError(400, "Closed accounts cannot be frozen");

        if (account.isActive === ACCOUNT_STATUS.SUSPENDED)
            throw new ApiError(400, "Account is already frozen");

        account.isActive = ACCOUNT_STATUS.SUSPENDED;

        await accountRepository.save(account);
    }

    async unfreezeAccount(accountId, userId) {
        const account = await accountRepository.findByIdAndUser(accountId, userId);

        if (!account) throw new ApiError(404, "Account not found");

        if (account.isActive === ACCOUNT_STATUS.CLOSED) throw new ApiError(400, "Closed accounts cannot be reactivated");

        if (account.isActive !== ACCOUNT_STATUS.SUSPENDED)
            throw new ApiError(400, "Account is not frozen");

        account.isActive = ACCOUNT_STATUS.ACTIVE;

        await accountRepository.save(account);
    }
}

export default new AccountService();