import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const otpSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },

    purpose: {
        type: String,
        enum: ["add_beneficiary", "login", "reset_password", "high_value_transfer", "account-reactivation"],
        required: true,
    },

    hashedOtp: {
        type: String,
        required: true,
        select: false,
    },

    attempts: {
        type: Number,
        default: 0,
    },

    expiresAt: {
        type: Date,
        required: true,
        index: { expireAfterSeconds: 0 },
    },

    meta: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },

    maskedContact: {
        type: String,
        default: "",
    },
});


/**
 * Generate, hash, and save a new OTP.
 * Returns the doc (with maskedContact) and the plaintext OTP for dispatch.
 */
otpSchema.statics.createOtp = async function ({ userId, purpose, meta = {}, maskedContact = "" }) {
    const plaintext = crypto.randomInt(100000, 999999).toString(); // 6-digit
    const hashed = await bcrypt.hash(plaintext, 10);
    const ttl = Number(process.env.OTP_TTL_MINUTES || 10);

    const doc = await this.create({
        userId,
        purpose,
        hashedOtp: hashed,
        expiresAt: new Date(Date.now() + ttl * 60 * 1000),
        meta,
        maskedContact,
    });

    return { doc, plaintext, hashed }; // caller dispatches plaintext via SMS/email
};


/**
 * Compare a submitted OTP against the stored hash.
 * Must select hashedOtp explicitly: Otp.findOne(...).select('+hashedOtp')
 */
otpSchema.methods.verify = async function (plaintext) {
    return bcrypt.compare(plaintext, this.hashedOtp);
};

export default mongoose.model("Otp", otpSchema);