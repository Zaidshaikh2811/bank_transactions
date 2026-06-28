import Beneficiary from "../models/beneficiary.model.js";


class BeneficiaryRepository {

    findExisting(userId, accountId) {
        return Beneficiary.findOne({
            userId,
            beneficiaryAccountId: accountId,
        });
    }

    countActive(userId) {
        return Beneficiary.countDocuments({
            userId,
            isActive: true,
        });
    }

    create(data) {
        return Beneficiary.create(data);
    }

    save(document) {
        return document.save();
    }

    findOne(query) {
        return Beneficiary.findOne(query);
    }

}

export default new BeneficiaryRepository();