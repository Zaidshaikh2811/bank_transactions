import express from 'express';
import { login, refreshToken, register, reactivateUser, deactivateUser, logout, deactivateOwnAccount, activateUser, logoutAllSessions, activeSessions } from '../controller/auth.controller.js';
import { adminMiddleware } from '../middleware/admin.middleware.js';
import { authMiddleware } from '../middleware/auth.middleware.js';


const router = express.Router();


router.get("/sessions", authMiddleware, activeSessions);

router.post('/login', login);
router.post('/register', register);
router.post("/refresh-token", refreshToken);
router.post("/logout", authMiddleware, logout);
router.post("/logout-all", authMiddleware, logoutAllSessions);
router.patch("/verify/:token", activateUser);
router.patch("/users/:userId/deactivate", authMiddleware, adminMiddleware, deactivateUser);
router.patch("/users/:userId/reactivate", authMiddleware, adminMiddleware, reactivateUser);
router.patch("/deactivate-my-account", authMiddleware, deactivateOwnAccount);

export default router;

