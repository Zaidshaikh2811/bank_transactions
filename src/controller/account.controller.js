import accountModel from "../models/account.model.js";
import asyncHandler from "../utils/asyncHandler.js";
import { emailQueue } from "../queues/emailQueue.js";
import ApiResponse from "../utils/ApiResponse.js";

export const createAccount = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const newAccount = await new accountModel({ userId });
    await newAccount.save();

    await emailQueue.add("Accounts", { email: req.user.email }, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 }
    });
    return new ApiResponse(201, "Account created successfully", {
        account: {
            id: newAccount._id,
            balance: newAccount.balance,
            createdAt: newAccount.createdAt
        }
    }).send(res);
})