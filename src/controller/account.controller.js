import accountModel from "../models/account.model.js";
import asyncHandler from "../utils/asyncHandler.js";
import { emailQueue } from "../queues/emailQueue.js";
import ApiResponse from "../utils/ApiResponse.js";
import ApiError from "../utils/ApiError.js";
import { withTransaction } from "../utils/withTransaction.js";
import User from "../models/user.model.js";
import { generateAccountNumber } from "../utils/account.utils.js";
import { VALID_ACCOUNT_TYPES } from "../models/account.model.js";

export const createAccount = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const user = await User.findById(userId).select("email isVerified isActive");
    if (!user) throw new ApiError(404, "User not found");
    if (!user.isVerified) throw new ApiError(403, "Please verify your email first");
    if (!user.isActive) throw new ApiError(403, "Account is suspended");



    const { accountType = "savings" } = req.body;
    if (!VALID_ACCOUNT_TYPES.includes(accountType)) {
        throw new ApiError(400, `Invalid account type. Must be one of: ${VALID_ACCOUNT_TYPES.join(", ")}`);
    }


    const idempotencyKey = req.headers["x-idempotency-key"];
    if (!idempotencyKey) {
        throw new ApiError(400, "Idempotency key is required");
    }
    const duplicate = await accountModel.findOne({ idempotencyKey });
    if (duplicate) {
        return new ApiResponse(200, "Account already exists", {
            account: duplicate
        }).send(res);
    }

    const newAccount = await withTransaction(async (session) => {

        const count = await accountModel
            .countDocuments({ userId: req.user.id })
            .session(session);


        if (count >= 3) throw new ApiError(400, "Maximum account limit reached");

        if (accountType === "savings") {
            const hasSavings = await accountModel
                .findOne({ userId, accountType: "savings" })
                .session(session);
            if (hasSavings) throw new ApiError(400, "You already have a savings account");
        }

        const [account] = await accountModel.create(
            [{ userId: req.user.id, accountNumber: generateAccountNumber(), accountType, idempotencyKey }],
            { session }
        );
        return account;

    })

    await emailQueue.add("Accounts", { email: user.email }, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 }
    });
    return new ApiResponse(201, "Account created successfully", {
        account: {
            id: newAccount._id,
            accountType: newAccount.accountType,
            accountNumber: newAccount.accountNumber,
            balance: newAccount.balance,
            createdAt: newAccount.createdAt
        }
    }).send(res);
})