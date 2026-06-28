import { body, param } from "express-validator";


export const validateBeneficiaryInput = [

    body("accountNumber").isString().trim().notEmpty().withMessage("Account number is required"),
    body("nickname").isString().trim().isLength({ min: 2, max: 50 }).withMessage("Nickname must be between 2 and 50 characters")

]

export const validateOTPConfirmationInput = [
    body("otp").isString().trim().notEmpty().withMessage("OTP is required")
]

export const validateRemoveBeneficiaryInput = [
    param("beneficiaryId").isString().trim().notEmpty().withMessage("Beneficiary ID is required")
]

export const validateTransferToBeneficiaryInput = [
    param("beneficiaryId").isString().trim().notEmpty().withMessage("Beneficiary ID is required"),
    body("amount").isFloat({ gt: 0 }).withMessage("Amount must be a positive number"),

]