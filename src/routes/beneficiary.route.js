import express from "express";
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
    addBeneficiary,
    getBeneficiaries,
    removeBeneficiary,
    transferToBeneficiary
} from "../controller/beneficiary.controller.js";

const router = express.Router();

router.post("/", authMiddleware, addBeneficiary);

router.get("/", authMiddleware, getBeneficiaries);

router.delete("/:beneficiaryId", authMiddleware, removeBeneficiary);

router.post("/beneficiary-transfer", authMiddleware, transferToBeneficiary);

export default router;