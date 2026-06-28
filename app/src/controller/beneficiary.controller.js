
import asyncHandler from "../utils/asyncHandler.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import Beneficiary from "../models/beneficiary.model.js";
import Account from "../models/account.model.js";
import { withTransaction } from "../utils/withTransaction.js";
import { maskAccountNumber } from "../utils/account.utils.js";
import { emailQueue } from "../jobs/email.queue.js";
import Otp from "../models/otp.model.js";
import mongoose from "mongoose";
import { sendOtp } from "../utils/opt.utils.js";
import Idoempotency from "../models/idempotency.model.js";
import Transaction from "../models/transaction.model.js";
import beneficiaryService from "../services/beneficiary.service.js";
import { OTP_PURPOSES } from "../constants/otp.constants.js";

export const addBeneficiary = asyncHandler(async (req, res) => {


    const resule = await beneficiaryService.addBeneficiary(req.user.id, req.body, req.header("X-Idempotency-Key"));

    return new ApiResponse(201, "OTP sent. Please confirm to activate beneficiary.", resule).send(res);


});

export const confirmBeneficiaryOtp = asyncHandler(async (req, res) => {

    const result = await beneficiaryService.confirmBeneficiaryOtp({ userId: req.user.id, otp: req.body.otp, });
    return new ApiResponse(200, "Beneficiary confirmed and activated", result).send(res);

});


export const getBeneficiaries = asyncHandler(async (req, res) => {
    const beneficiaries = await beneficiaryService.getBeneficiaries(req.user.id);
    return new ApiResponse(200, "Beneficiaries retrieved successfully", beneficiaries).send(res);

});


export const removeBeneficiary = asyncHandler(async (req, res) => {

    const result = await beneficiaryService.removeBeneficiary(req.user.id, req.params.beneficiaryId);
    return new ApiResponse(200, "Beneficiary removed successfully", result).send(res);
});


export const transferToBeneficiary = asyncHandler(async (req, res) => {
    const result = await beneficiaryService.transferToBeneficiary({ userId: req.user.id, beneficiaryId: req.body.beneficiaryId, senderAccountId: req.body.senderAccountId, amount: req.body.amount, note: req.body.note, idempotencyKey: req.header("X-Idempotency-Key"), });
    return new ApiResponse(200, "Transfer successful", result).send(res);
});



