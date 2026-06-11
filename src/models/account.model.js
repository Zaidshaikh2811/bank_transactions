import mongoose from "mongoose";

export const VALID_ACCOUNT_TYPES = ["savings", "current", "fixed"];

const bankAccountSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "User ID is required"],
        index: true
    },
    isActive: {
        type: String,
        enum: {
            values: ["active", "suspended", "closed"],
            message: "Status must be either active, suspended, or closed"
        },
        default: "active"
    },
    accountNumber: {
        type: String,
        unique: true,
        required: true,
        immutable: true
    },

    accountType: {
        type: String,
        enum: { values: VALID_ACCOUNT_TYPES, message: "Account type must be either savings, current, or fixed" },
        default: "savings",
    },
    currency: {
        type: String,
        required: [true, "Currency is required"],
        uppercase: true,
        match: [/^[A-Z]{3}$/, "Currency must be a valid 3-letter ISO code"],
        index: true,
        default: "INR"
    },
    dailyTransferLimit: {
        type: Number,
        default: 100000,
    },
    balance: {
        type: Number,
        default: 0,
        min: 0,
    },
    idempotencyKey: {
        type: String,
        unique: true,
    }
}, {
    timestamps: true
});

bankAccountSchema.index({ userId: 1, currency: 1 });


const BankAccount =
    mongoose.models.BankAccount ||
    mongoose.model("BankAccount", bankAccountSchema);

export default BankAccount;;
