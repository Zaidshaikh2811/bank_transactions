
import mongoose from 'mongoose';

const beneficiarySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    beneficiaryAccountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BankAccount",
        required: true
    },

    nickname: {
        type: String,
        required: true
    },

    isVerified: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});


beneficiarySchema.index(
    {
        userId: 1,
        beneficiaryAccountId: 1,
    },
    {
        unique: true,
    }
);

const Beneficiary =
    mongoose.models.beneficiarySchema ||
    mongoose.model("Beneficiary", beneficiarySchema);

export default Beneficiary;;
