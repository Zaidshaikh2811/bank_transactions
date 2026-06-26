import Transaction from "../models/transaction.model.js";

class TransactionRepository {
    async create(data, session) {
        const [transaction] = await Transaction.create(
            [data],
            { session }
        );

        return transaction;
    }

    findById(id) {
        return Transaction.findById(id);
    }

    findByIdempotencyKey(key) {
        return Transaction.findOne({ idempotencyKey: key });
    }

    aggregate(pipeline) {
        return Transaction.aggregate(pipeline);
    }

    findMany(filter, { page, limit }) {
        return Transaction.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .select("-metadata");
    }

    count(filter) {
        return Transaction.countDocuments(filter);
    }

    findByIdWithAccounts(id) {
        return Transaction.findById(id)
            .populate("senderAccount", "accountNumber userId")
            .populate("receiverAccount", "accountNumber userId")
            .select("-metadata");
    }
}

export default new TransactionRepository();