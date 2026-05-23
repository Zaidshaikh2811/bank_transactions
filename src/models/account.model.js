import mongoose from "mongoose";


const bankAccountSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "User ID is required"],
        index: true
    },
    status: {
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
    },

    accountType: {
        type: String,
        enum: ["SAVINGS", "CURRENT"],
        default: "SAVINGS",
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
}, {
    timestamps: true
});

bankAccountSchema.index({ userId: 1, currency: 1 });

const BankAccount = mongoose.model("BankAccount", bankAccountSchema);
export default BankAccount; 