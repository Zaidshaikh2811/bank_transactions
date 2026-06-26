import { body, param } from "express-validator";


export const depositValidator = [
    body("amount")
        .isFloat({ gt: 0 })
        .withMessage("Amount must be a positive number"),
    param("accountNumber")
        .notEmpty()
        .withMessage("Account number must be numeric"),
    body("description")
        .optional()
        .trim()
        .isLength({ max: 250 })
];

export const transferValidator = [

    body("senderAccountNumber")
        .notEmpty(),

    body("receiverAccountNumber")
        .notEmpty(),

    body("amount")
        .isFloat({ gt: 0 }),

    body("description")
        .optional()
        .isLength({ max: 250 }),

    body("deviceId")
        .optional()
];


export const withdrawValidator = [
    body("amount")
        .isFloat({ gt: 0 })
        .withMessage("Amount must be a positive number"),
    param("accountNumber")
        .notEmpty()
        .withMessage("Account number must be numeric"),
    body("description")
        .optional()
        .trim()
        .isLength({ max: 250 })
];

export const getTransactionHistoryValidator = [
    param("accountNumber")
        .notEmpty()
        .withMessage("Account number must be numeric"),
    body("page")
        .optional()
        .isInt({ min: 1 })
        .withMessage("Page must be a positive integer"),
    body("limit")
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage("Limit must be a positive integer between 1 and 100"),
    body("type")
        .optional()
        .isIn(["credit", "debit"])
        .withMessage("Type must be either 'credit' or 'debit'"),
    body("startDate")
        .optional()
        .isISO8601()
        .withMessage("Start date must be a valid ISO 8601 date"),
    body("endDate")
        .optional()
        .isISO8601()
        .withMessage("End date must be a valid ISO 8601 date")
];

export const getTransactionByIdValidator = [
    param("transactionId")
        .notEmpty()
        .withMessage("Transaction ID is required")
        .isMongoId()
        .withMessage("Transaction ID must be a valid MongoDB ObjectId")
];

export const getTransactionByUserValidator = [
    param("userId")
        .notEmpty()
        .withMessage("User ID is required")
        .isMongoId()
        .withMessage("User ID must be a valid MongoDB ObjectId")
];

export const getTransactionByAccountValidator = [
    param("accountNumber")
        .notEmpty()
        .withMessage("Account number is required")
        .isNumeric()
        .withMessage("Account number must be numeric")
];