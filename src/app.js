import express from "express";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/auth.route.js";
import userRoutes from "./routes/accounts.route.js";
import errorHandler from "./middleware/error.middleware.js";
import cookies from "cookie-parser";
import { authLimiter } from "./middleware/rateLimit.js";
import cookieParser from "cookie-parser";




const app = express();
app.use(authLimiter)
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(cookies());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);


app.use(errorHandler);
export default app;