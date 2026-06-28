import mongoose from "mongoose";
import {
    ACCOUNT_TYPES,
    ACCOUNT_STATUS,
    ACCOUNT_CURRENCIES,
} from "../constants/account.constants.js";

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
            values: Object.values(ACCOUNT_STATUS),
            message: "Status must be either active, suspended, or closed"
        },
        default: ACCOUNT_STATUS.ACTIVE,
    },
    accountNumber: {
        type: String,
        unique: true,
        required: true,
        immutable: true
    },

    accountType: {
        type: String,
        enum: { values: Object.values(ACCOUNT_TYPES), message: "Account type must be either savings, current, or fixed" },
        default: ACCOUNT_TYPES.SAVINGS,
    },
    currency: {
        type: String,
        required: [true, "Currency is required"],
        uppercase: true,
        enum: {
            values: Object.values(ACCOUNT_CURRENCIES),
            message: "Currency must be a valid 3-letter ISO code"
        },
        match: [/^[A-Z]{3}$/, "Currency must be a valid 3-letter ISO code"],
        index: true,
        default: ACCOUNT_CURRENCIES.INR
    },
    dailyTransferLimit: {
        type: Number,
        default: 100000,
    },
    balance: {
        type: Number,
        default: 0,
        min: 0,
    }
}, {
    timestamps: true,
    optimisticConcurrency: true
});

bankAccountSchema.index({ userId: 1, currency: 1 });


const BankAccount =
    mongoose.models.BankAccount ||
    mongoose.model("BankAccount", bankAccountSchema);

export default BankAccount;;
