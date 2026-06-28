import express from "express";
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
    addBeneficiary,
    getBeneficiaries,
    removeBeneficiary,
    transferToBeneficiary,
    confirmBeneficiaryOtp
} from "../controller/beneficiary.controller.js";
import { validateBeneficiaryInput } from "../validators/beneficiary.validator.js";
import { validate } from '../middleware/validate.middleware.js';
const router = express.Router();

router.post("/", authMiddleware, validateBeneficiaryInput, validate, addBeneficiary);

router.get("/", authMiddleware, getBeneficiaries);

router.post("/confirm-otp", authMiddleware, confirmBeneficiaryOtp);

router.delete("/:beneficiaryId", authMiddleware, removeBeneficiary);

router.post("/beneficiary-transfer", authMiddleware, transferToBeneficiary);

export default router;