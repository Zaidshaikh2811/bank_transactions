
import Otp from "../models/otp.model.js";
import User from "../models/user.model.js";
import { emailQueue } from "../jobs/email.queue.js";
import { EMAIL_TEMPLATES } from "../constants/email.constants.js";

export const maskEmail = (email = "") => {
    const [local, domain] = email.split("@");
    return local.slice(0, 2) + "*".repeat(Math.max(local.length - 2, 3)) + "@" + domain;
};


export const sendOtp = async ({ userId, purpose, meta = {} }) => {
    const user = await User.findById(userId).select("email phone").lean();
    if (!user) throw new Error("User not found when sending OTP");
    console.log("Sending OTP to user:", user);


    const maskedContact = user.email ? maskEmail(user.email) : "****";

    const { doc, plaintext } = await Otp.createOtp({
        userId,
        purpose,
        meta,
        maskedContact,
    });

    await emailQueue.add(EMAIL_TEMPLATES.OTP_CONFIRMATION, {
        email: user.email,
        otp: plaintext,
        expiresInMinutes: Number(process.env.OTP_TTL_MINUTES) || 10,
    });

    return { maskedContact: doc.maskedContact, otp: plaintext };
};
