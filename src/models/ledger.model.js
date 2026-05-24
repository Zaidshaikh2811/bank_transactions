import mongoose from "mongoose";


const ledgerSchema = new mongoose.Schema({
    transactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Transaction",
        required: [true, "Transaction ID is required"],
        index: true,
        immutable: true,
    },
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BankAccount",
        required: [true, "Account ID is required"],
        index: true,
        immutable: true,
    },
    type: {
        type: String,
        enum: ["TRANSFER",
            "DEPOSIT",
            "WITHDRAW",
            "BILL_PAYMENT",
            "REFUND",],
        required: [true, "Ledger entry type is required"],
        immutable: true,
    },
    amount: {
        type: Number,
        required: [true, "Amount is required"],
        min: [0.01, "Amount must be at least 0.01"],
        immutable: true,
    },
    currency: {
        type: String,
        required: [true, "Currency is required"],
        uppercase: true,
        match: [/^[A-Z]{3}$/, "Currency must be a valid 3-letter ISO code"],
        index: true,
        default: "INR"
    },
    description: {
        type: String,
        maxlength: [200, "Description must be at most 200 characters long"],
    },
}, {
    timestamps: true,
});


function preventLedgerEntryModification() {
    throw new Error("Ledger entries cannot be modified after creation");
}

ledgerSchema.pre("updateOne", preventLedgerEntryModification);
ledgerSchema.pre("findOneAndUpdate", preventLedgerEntryModification);
ledgerSchema.pre("updateMany", preventLedgerEntryModification);
ledgerSchema.pre("replaceOne", preventLedgerEntryModification);

const LedgerEntry = mongoose.model("LedgerEntry", ledgerSchema);
export default LedgerEntry;