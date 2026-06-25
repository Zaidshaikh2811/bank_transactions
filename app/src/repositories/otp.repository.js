
import Otp from "../models/otp.model.js";

class OtpRepository {

    findReactivationOtp({ userId, maskedContact }) {
        return Otp.findOne({
            userId,
            maskedContact,
            purpose: "account-reactivation",
        }).select("+hashedOtp");
    }

    saveOtp({ userId, maskedContact, has, expiresAt }) {
        const otpRecord = new Otp({
            userId,
            maskedContact,
            has,
            expiresAt,
            purpose: "account-reactivation",
        });
        return otpRecord.save();
    }

}


export default new OtpRepository();