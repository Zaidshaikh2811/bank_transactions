import mongoose from "mongoose";


const refreshTokenSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true, index: true
    },
    token: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    family: {
        type: String,
        required: true,
        index: true
    },

    expiresAt: {
        type: Date,
        required: true,
    },

    isRevoked: {
        type: Boolean,
        default: false,
    },
}, {
    timestamps: true
});

refreshTokenSchema.index(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 }
);
const RefreshToken =
    mongoose.models.RefreshToken ||
    mongoose.model("RefreshToken", refreshTokenSchema);

export default RefreshToken;
