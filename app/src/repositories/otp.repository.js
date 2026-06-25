
import Otp from "../models/otp.model.js";

class OtpRepository {

    findReactivationOtp({ userId, maskedContact }) {
        return Otp.findOne({
            userId,
            maskedContact,
            purpose: "account-reactivation",
        });
    }

}


export default new OtpRepository();