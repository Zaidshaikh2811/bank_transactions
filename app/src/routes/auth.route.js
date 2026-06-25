import express from 'express';
import { login, refreshToken, register, requestReactivationOtp, deactivateUser, verifyReactivationOtp, logout, deactivateOwnAccount, activateUser, logoutAllSessions, activeSessions } from '../controller/auth.controller.js';
import { adminMiddleware } from '../middleware/admin.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { registerValidator, loginValidator, requestReactivationOtpValidator, verifyReactivationOtpValidator, deactivateUserValidator } from '../validators/auth.validator.js';
import { validate } from '../middleware/validate.middleware.js';


const router = express.Router();


router.get("/sessions", authMiddleware, activeSessions);

router.post('/login', loginValidator, validate, login);
router.post('/register', registerValidator, validate, register);
router.post("/refresh-token", refreshToken);
router.post("/logout", authMiddleware, logout);
router.post("/logout-all", authMiddleware, logoutAllSessions);
router.post("/reactivate/verify-otp", verifyReactivationOtpValidator, validate, verifyReactivationOtp);
router.post("/reactivate/request", requestReactivationOtpValidator, validate, requestReactivationOtp);
router.patch("/verify", activateUser);
router.patch("/users/:userId/deactivate", deactivateUserValidator, validate, authMiddleware, deactivateUser);
router.patch("/deactivate-my-account", authMiddleware, deactivateOwnAccount);

export default router;

