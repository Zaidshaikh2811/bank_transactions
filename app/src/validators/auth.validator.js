import { body, param } from "express-validator";

export const registerValidator = [
    body("name")
        .trim()
        .notEmpty()
        .withMessage("Name is required"),

    body("email")
        .trim()
        .isEmail()
        .withMessage("Invalid email"),

    body("phone")
        .matches(/^\+?[1-9]\d{1,14}$/)
        .withMessage(
            "Invalid phone number format. Must be in E.164 format."
        ),

    body("password")
        .isLength({ min: 6 })
        .withMessage(
            "Password must be at least 6 characters long"
        ),
];


export const loginValidator = [
    body("email")
        .trim()
        .isEmail()
        .withMessage("Invalid email"),

    body("password")
        .notEmpty()
        .withMessage("Password is required"),
];


export const requestReactivationOtpValidator = [
    body("email")
        .trim()
        .isEmail()
        .withMessage("Invalid email"),
];

export const deactivateUserValidator = [
    param("userId")
        .isMongoId()
        .withMessage("Invalid user ID"),
];
export const verifyReactivationOtpValidator = [
    body("email")
        .trim()
        .isEmail()
        .withMessage("Invalid email"),
    body("otp")
        .isLength({ min: 6, max: 6 })
        .withMessage("OTP must be 6 digits"),
];