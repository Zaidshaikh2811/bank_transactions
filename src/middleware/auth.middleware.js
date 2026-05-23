
import jwt from 'jsonwebtoken';


export async function authMiddleware(req, res, next) {
    try {
        console.log(req.headers);
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        console.log(decoded);
        req.user = decoded;

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

