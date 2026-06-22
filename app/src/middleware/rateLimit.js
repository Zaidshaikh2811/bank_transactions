import rateLimit, { ipKeyGenerator } from "express-rate-limit";

const keyGenerator = (req) =>
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ??
    ipKeyGenerator(req.ip) ??
    "unknown";

/**
 * authLimiter — aggressive, protects login / register / password-reset
 * 10 requests per 15 minutes per IP
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many authentication attempts, please try again later." },
    skipSuccessfulRequests: false,
});

/**
 * transferLimiter — moderate, protects financial transaction routes
 * 30 requests per minute per IP
 */
export const transferLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 50,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many transaction requests, please slow down." },
});

/**
 * generalLimiter — lenient, for account reads and non-critical writes
 * 200 requests per minute per IP
 */
export const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Rate limit exceeded. Please slow down." },
});