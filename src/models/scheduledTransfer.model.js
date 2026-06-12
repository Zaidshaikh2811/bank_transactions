
import mongoose from 'mongoose';

export const SCHEDULED_TRANSFER_STATUSES = {
    PENDING: "PENDING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED"
};

const scheduledTransferSchema = new mongoose.Schema({
    senderAccountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BankAccount"
    },

    receiverAccountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BankAccount"
    },

    amount: Number,

    executeAt: Date,

    status: {
        type: String,
        enum: Object.values(SCHEDULED_TRANSFER_STATUSES),
        default: SCHEDULED_TRANSFER_STATUSES.PENDING
    }
});

const ScheduledTransfer =
    mongoose.models.scheduledTransferSchema ||
    mongoose.model("ScheduledTransfer", scheduledTransferSchema);

export default ScheduledTransfer;