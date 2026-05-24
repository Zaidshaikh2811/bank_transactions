const transactionSchema = new mongoose.Schema(
    {
        transactionId: {
            type: String,
            unique: true,
            required: true,
        },

        senderAccount: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "BankAccount",
            required: [true, "Sender account is required"],
            index: true,
        },

        receiverAccount: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "BankAccount",
            required: [true, "Receiver account is required"],
            index: true,
        },

        type: {
            type: String,
            enum: [
                "TRANSFER",
                "DEPOSIT",
                "WITHDRAW",
                "BILL_PAYMENT",
                "REFUND",
            ],
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
            enum: { values: ["PENDING", "SUCCESS", "FAILED", "REVERSED"], message: "Status must be either PENDING, SUCCESS, FAILED, or REVERSED" },
            default: "PENDING",
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

        processedAt: Date,
    },
    { timestamps: true }
);

export default mongoose.model("Transaction", transactionSchema);