import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { deposit, transfer, withdraw, getTransactionHistory, getLedgerHistory, verifyBalance, getTransactionById } from '../controller/transaction.controller.js';




const router = express.Router();



router.post('/deposit/:accountId', authMiddleware, deposit);
router.post("/withdraw/:accountId", authMiddleware, withdraw)
router.post("/transfer", authMiddleware, transfer);

router.get("/history/:accountId", authMiddleware, getTransactionHistory);
router.get("/ledger/:accountId", authMiddleware, getLedgerHistory);
router.get("/verify/:accountId", authMiddleware, verifyBalance);
router.get("/:transactionId", authMiddleware, getTransactionById);


export default router;