import ApiError from "../utils/ApiError.js";

export function adminMiddleware(req, res, next) {

    if (!req.user) {
        return next(new ApiError(401, "Unauthorized"));
    }

    if (req.user.role !== "ADMIN") {
        return next(new ApiError(403, "Forbidden: Admins only"));
    }

    next();
}