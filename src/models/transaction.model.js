export const TRANSACTION_TYPES = {
    TRANSFER: "TRANSFER",
    DEPOSIT: "DEPOSIT",
    WITHDRAW: "WITHDRAW",
    BILL_PAYMENT: "BILL_PAYMENT",
    REFUND: "REFUND"
};

export const TRANSACTION_STATUSES = {
    PENDING: "PENDING",
    SUCCESS: "SUCCESS",
    FAILED: "FAILED",
    REVERSED: "REVERSED"
};

import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
    {
        transactionId: {
            type: String,
            unique: true,
            required: true,
            default: () => `txn_${new mongoose.Types.ObjectId()}`,
        },

        senderAccount: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "BankAccount",
            index: true,
        },

        receiverAccount: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "BankAccount",
            index: true,
        },

        type: {
            type: String,
            enum: Object.values(TRANSACTION_TYPES),
            required: [true, "Transaction type is required"],
        },

        amount: {
            type: Number,
            required: [true, "Amount is required"],
            min: [0.01, "Amount must be at least 0.01"],
        },

        currency: {
            type: String,
            default: "INR",
        },

        status: {
            type: String,
            enum: { values: Object.values(TRANSACTION_STATUSES), message: "Status must be either PENDING, SUCCESS, FAILED, or REVERSED" },
            default: TRANSACTION_STATUSES.PENDING,
        },

        description: {
            type: String,
        },

        referenceNote: {
            type: String,
        },

        failureReason: {
            type: String,
        },
        idempotencyKey: {
            type: String,
            required: true,
        },
        balanceAfter: { type: Number },  // snapshot of balance after transaction
        metadata: {
            ip: { type: String },
            userAgent: { type: String },
        },
        processedAt: Date,
    },
    { timestamps: true }
);



transactionSchema.index({ fromAccount: 1, createdAt: -1 });
transactionSchema.index({ toAccount: 1, createdAt: -1 });
transactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });


export default mongoose.model("Transaction", transactionSchema);