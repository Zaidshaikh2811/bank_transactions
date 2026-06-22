import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { deposit, transfer, withdraw, getTransactionHistory, getLedgerHistory, verifyBalance, getTransactionById } from '../controller/transaction.controller.js';




const router = express.Router();




router.post('/deposit/:accountNumber', authMiddleware, deposit);
router.post("/withdraw/:accountNumber", authMiddleware, withdraw)
router.post("/transfer", authMiddleware, transfer);

router.get("/history/:accountNumber", authMiddleware, getTransactionHistory);
router.get("/ledger/:accountNumber", authMiddleware, getLedgerHistory);
router.get("/verify/:accountNumber", authMiddleware, verifyBalance);
router.get("/:transactionId", authMiddleware, getTransactionById);



export default router;