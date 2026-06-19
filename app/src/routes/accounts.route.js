import express from 'express';
import { createAccount, getAccountDetails, unfreezeAccount, freezeAccount } from '../controller/account.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';




const router = express.Router();



router.post('/', authMiddleware, createAccount);
router.get('/', authMiddleware, getAccountDetails);
router.patch("/:accountId/unfreeze", authMiddleware, unfreezeAccount);
router.patch("/:accountId/freeze", authMiddleware, freezeAccount);


export default router;