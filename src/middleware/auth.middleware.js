
import jwt from 'jsonwebtoken';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import User from '../models/user.model.js';


export async function authMiddleware(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        const user = await User.findById(decoded.id);
        if (!user) return res.status(401).json({ message: 'Unauthorized' });
        if (!user.isActive) return next(new ApiError(403, "Account is suspended"));
        if (!user.isVerified) return next(new ApiError(403, "Email not verified"));
        if (user.tokenVersion !== decoded.tokenVersion) {
            return next(new ApiError(401, "Token is no longer valid, please login again"));
        }
        if (decoded.ip !== req.ip) {
            logger.warn(`IP mismatch for user ${decoded.id}`);
        }

        req.user = { ...decoded, role: user.role };
        next();
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            return next(new ApiError(401, "Access token expired"));
        }
        if (error.name === "JsonWebTokenError") {
            return next(new ApiError(401, "Invalid access token"));
        }
        next(error);
    }
}

