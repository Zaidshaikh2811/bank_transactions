
import accountModel from "../models/account.model.js";

class AccountRepository {
    findByUserId(userId) {
        return accountModel.find({
            userId,
        });
    }

    findByAccountNumber(accountNumber, session) {
        return accountModel.findOne({
            accountNumber,
        }).session(session);
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

    save(account, session) {
        return account.save({ session });
    }

    findOneAndUpdate(query, update, session) {
        return accountModel.findOneAndUpdate(query, update, { new: true }).session(session);
    }
}

export default new AccountRepository();