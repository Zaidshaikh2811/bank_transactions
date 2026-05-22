import express from "express";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/auth.route.js";
import errorHandler from "./middleware/error.middleware.js";





const app = express();

app.use(express.json());
app.use(cors());
app.use(helmet());


app.use("/api/auth", authRoutes);


app.use(errorHandler);
export default app;