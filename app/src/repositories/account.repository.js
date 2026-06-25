
import accountModel from "../models/account.model.js";

class AccountRepository {
    findByUserId(userId) {
        return accountModel.find({
            userId,
        });
    }

    countByUserId(userId, session) {
        return accountModel
            .countDocuments({ userId })
            .session(session);
    }

    findSavingsByUserId(userId, session) {
        return accountModel
            .findOne({
                userId,
                accountType: "savings",
            })
            .session(session);
    }

    findByIdempotencyKey(key) {
        return accountModel.findOne({
            idempotencyKey: key,
        });
    }

    create(data, session) {
        return accountModel.create(
            [data],
            { session }
        );
    }

    findByIdAndUser(accountId, userId) {
        return accountModel.findOne({
            _id: accountId,
            userId,
        });
    }

    save(account) {
        return account.save();
    }
}

export default new AccountRepository();