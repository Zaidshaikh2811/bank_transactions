import express from 'express';
import { createAccount } from '../controller/account.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';




const router = express.Router();



router.post('/', authMiddleware, createAccount);



export default router;