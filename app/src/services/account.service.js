import ApiError from "../utils/ApiError.js";
import { emailQueue } from "../jobs/email.queue.js";
import { withTransaction } from "../utils/withTransaction.js";
import { generateAccountNumber } from "../utils/account.utils.js";
import { ACCOUNT_TYPES, ACCOUNT_STATUS, ACCOUNT_CURRENCIES } from "../constants/account.constants.js";
import accountRepository from "../repositories/account.repository.js";
import userRepository from "../repositories/user.repository.js";



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

        if (!ACCOUNT_TYPES.includes(accountType)) throw new ApiError(400, `Invalid account type. Must be one of: ${ACCOUNT_TYPES.join(", ")}`);


        const idempotencyKey =
            req.headers["x-idempotency-key"];

        if (!idempotencyKey) {
            throw new ApiError(
                400,
                "Idempotency key is required"
            );
        }

        const duplicate =
            await accountRepository.findByIdempotencyKey(
                idempotencyKey
            );

        if (duplicate) {
            throw new ApiError(
                400,
                "Account with this idempotency key already exists",
                {
                    account: duplicate,
                }
            );
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

                    if (accountType === "savings") {
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
                            idempotencyKey,
                        },
                            session
                        );

                    return account;
                }
            );

        await emailQueue.add("welcome", { email: user.email, });

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

        if (account.isActive === "closed") throw new ApiError(400, "Closed accounts cannot be frozen");

        if (account.isActive === "suspended")
            throw new ApiError(400, "Account is already frozen");

        account.isActive = "suspended";

        await accountRepository.save(account);
    }

    async unfreezeAccount(accountId, userId) {
        const account = await accountRepository.findByIdAndUser(accountId, userId);

        if (!account) throw new ApiError(404, "Account not found");

        if (account.isActive === "closed") throw new ApiError(400, "Closed accounts cannot be reactivated");

        if (account.isActive !== "suspended")
            throw new ApiError(400, "Account is not frozen");

        account.isActive = "active";

        await accountRepository.save(account);
    }
}

export default new AccountService();