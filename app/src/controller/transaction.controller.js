import asyncHandler from "../utils/asyncHandler.js";
import Account from "../models/account.model.js";
import Transaction from "../models/transaction.model.js";
import ApiError from "../utils/ApiError.js";
import { acquireRedisLock, checkRedisCache, fromCents, parseAndValidateIdempotency, releaseLock, toCents, validateAmount } from "../utils/transaction.utils.js";
import { withTransaction } from "../utils/withTransaction.js";
import ApiResponse from "../utils/ApiResponse.js";
import { emailQueue } from "../jobs/email.queue.js";
import { TRANSACTION_TYPES } from "../constants/transaction.constants.js";
import LedgerEntry from "../models/ledger.model.js";
import User from "../models/user.model.js";
import mongoose from "mongoose";
import redis from "../config/redis.js";
import Idempotency from "../models/idempotency.model.js";
import crypto from "crypto";


import TransactionService from "../services/transaction.service.js";

export const deposit = asyncHandler(async (req, res) => {

    const { accountNumber } = req.params;
    const { amount, description } = req.body;
    const { headers, ip, userAgent } = req;

    const depositDto = {
        accountNumber,
        amount,
        description,
        user: req.user,
        headers,
        ip,
        userAgent
    };

    const responseBody = await TransactionService.deposit(depositDto);

    return new ApiResponse(responseBody.statusCode, responseBody.message, { responseBody: responseBody.body }).send(res);

});


export const transfer = asyncHandler(async (req, res) => {


    const response = await transactionService.transfer({
        ...req.body,
        user: req.user,
        headers: req.headers,
    });

    return new ApiResponse(
        201,
        "Transfer successful",
        response
    ).send(res);
})


export const withdraw = asyncHandler(async (req, res) => {
    const { accountNumber } = req.params;
    const amount = parseFloat(req.body.amount);
    const { description } = req.body;

    const result = await TransactionService.withdraw({
        accountNumber,
        amount,
        description,
        user: req.user,
        headers: req.headers,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
    });

    return new ApiResponse(result.statusCode, result.message, result.body).send(res);

})


export const getTransactionHistory = asyncHandler(async (req, res) => {
    const { accountNumber } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const { type, startDate, endDate } = req.query;

    const result = await TransactionService.getTransactionHistory({
        accountNumber,
        page,
        limit,
        type,
        startDate,
        endDate,
        user: req.user,
    });

    return new ApiResponse(result.statusCode, result.message, result.body).send(res);
});


export const getTransactionById = asyncHandler(async (req, res) => {
    const { transactionId } = req.params;

    const result = await TransactionService.getTransactionById({
        transactionId,
        user: req.user,
    });

    return new ApiResponse(result.statusCode, result.message, result.body).send(res);

})



export const getLedgerHistory = asyncHandler(async (req, res) => {
    const { accountNumber } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));

    const result = await TransactionService.getLedgerHistory({
        accountNumber,
        page,
        limit,
        user: req.user,
    });

    return new ApiResponse(result.statusCode, result.message, result.body).send(res);
});

export const verifyBalance = asyncHandler(async (req, res) => {
    const { accountNumber } = req.params;

    const result = await TransactionService.verifyBalance({
        accountNumber,
        user: req.user,
    });

    return new ApiResponse(result.statusCode, result.message, result.body).send(res);
});