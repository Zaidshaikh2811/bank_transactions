import accountModel from "../models/account.model.js";
import asyncHandler from "../utils/asyncHandler.js";
import { emailQueue } from "../jobs/email.queue.js";
import ApiResponse from "../utils/ApiResponse.js";
import ApiError from "../utils/ApiError.js";
import { withTransaction } from "../utils/withTransaction.js";
import User from "../models/user.model.js";
import { generateAccountNumber } from "../utils/account.utils.js";
import accountService from "../services/account.service.js";
import { ACCOUNT_STATUS } from "../constants/account.constants.js";

export const createAccount = asyncHandler(async (req, res) => {
    const response = await accountService.createAccount(req);
    return new ApiResponse(201, "Account created successfully", response).send(res);
})

export const getAccountDetails = asyncHandler(async (req, res) => {
    const accounts = await accountModel.find({ userId: req.user.id }).select("-__v -idempotencyKey");
    res.json(new ApiResponse(200, "Accounts retrieved successfully", { accounts }));
})

export const freezeAccount = asyncHandler(async (req, res) => {
    const { accountId } = req.params;

    const account = await accountModel.findOne({
        _id: accountId,
        userId: req.user.id,
    });

    if (!account) {
        throw new ApiError(404, "Account not found");
    }

    if (account.isActive === "closed") {
        throw new ApiError(400, "Closed accounts cannot be frozen");
    }

    if (account.isActive === "suspended") {
        throw new ApiError(400, "Account is already frozen");
    }

    account.isActive = "suspended";

    await account.save();

    return new ApiResponse(
        200,
        "Account frozen successfully"
    ).send(res);
});

export const unfreezeAccount = asyncHandler(async (req, res) => {
    const { accountId } = req.params;

    const account = await accountModel.findOne({
        _id: accountId,
        userId: req.user.id,
    });

    if (!account) {
        throw new ApiError(404, "Account not found");
    }

    if (account.isActive === "closed") {
        throw new ApiError(
            400,
            "Closed accounts cannot be reactivated"
        );
    }

    if (account.isActive !== "suspended") {
        throw new ApiError(
            400,
            "Account is not frozen"
        );
    }

    account.isActive = "active";

    await account.save();

    return new ApiResponse(
        200,
        "Account unfrozen successfully"
    ).send(res);
});