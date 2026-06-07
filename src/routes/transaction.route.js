import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { deposit, transfer } from '../controller/transaction.controller.js';




const router = express.Router();



router.post('/deposit/:accountId', authMiddleware, deposit);
router.post("/transfer", authMiddleware, transfer);



export default router;