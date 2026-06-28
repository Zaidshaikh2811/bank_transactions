import mongoose from "mongoose";
import { IDEMPOTENCY_PURPOSES } from "../constants/idempotency.constant.js";
const idempotencySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        key: {
            type: String,
            required: true,
            trim: true,
        },
        purpose: {
            type: String,
            enum: Object.values(IDEMPOTENCY_PURPOSES),
            required: true,
        },
        statusCode: {
            type: Number,
            required: true,
        },
        responseBody: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
            index: { expireAfterSeconds: 0 },
        },
    },
    { timestamps: true }
);

idempotencySchema.index({ userId: 1, key: 1, purpose: 1 }, { unique: true });

export default mongoose.model("Idempotency", idempotencySchema);