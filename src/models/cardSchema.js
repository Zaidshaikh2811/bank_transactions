const cardSchema = new mongoose.Schema(
    {
        accountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "BankAccount",
            required: true,
        },

        cardNumber: {
            type: String,
            unique: true,
        },

        cardType: {
            type: String,
            enum: ["DEBIT", "CREDIT"],
            default: "DEBIT",
        },

        expiryDate: String,

        isFrozen: {
            type: Boolean,
            default: false,
        },

        dailyLimit: {
            type: Number,
            default: 50000,
        },
    },
    { timestamps: true }
);

export default mongoose.model("Card", cardSchema);