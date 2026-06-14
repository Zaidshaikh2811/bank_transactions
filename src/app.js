import express from "express";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/auth.route.js";
import userRoutes from "./routes/accounts.route.js";
import transactionRoutes from "./routes/transaction.route.js";
import beneficiaryRoutes from "./routes/beneficiary.route.js";
import adminRoutes from "./routes/admin.route.js";
import bullMq from "./routes/bullMQ.route.js";
import errorHandler from "./middleware/error.middleware.js";
import cookies from "cookie-parser";
import { authLimiter, generalLimiter, transferLimiter } from "./middleware/rateLimit.js";
import cookieParser from "cookie-parser";
import compression from "compression";





const app = express();

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'none'"],
                frameAncestors: ["'none'"],
            },
        },
        crossOriginEmbedderPolicy: true,
        crossOriginOpenerPolicy: { policy: "same-origin" },
        crossOriginResourcePolicy: { policy: "same-origin" },
        referrerPolicy: { policy: "no-referrer" },
    })
);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

app.use(
    cors({
        origin(origin, callback) {
            if (!origin && process.env.NODE_ENV !== "production") {
                return callback(null, true);
            }
            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            callback(new Error(`CORS: origin '${origin}' is not allowed`));
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "X-Idempotency-Key",
            "X-Request-ID",
        ],
    })
);

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000;
app.use((req, res, next) => {
    res.setTimeout(REQUEST_TIMEOUT_MS, () => {
        res.status(503).json({ message: "Request timed out" });
    });
    next();
});

app.use(express.json());
app.use(cookies());
app.use(compression());
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(cookieParser());


app.get("/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));
app.use("/admin/queues", authLimiter, bullMq);

app.use("/api/admin", authLimiter, adminRoutes);
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/account", generalLimiter, userRoutes);
app.use("/api/transaction", transferLimiter, transactionRoutes);
app.use("/api/beneficiary", transferLimiter, beneficiaryRoutes);

app.use(errorHandler);
export default app;