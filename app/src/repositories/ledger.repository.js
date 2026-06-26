import LedgerEntry from "../models/ledger.model.js";

class LedgerRepository {
    async create(data, session) {
        const [ledgerEntry] = await LedgerEntry.create(
            data,
            { session }
        );

        return ledgerEntry;
    }

    findByTransactionId(transactionId) {
        return LedgerEntry.find({
            transactionId,
        });
    }

    async createMany(entries, session) {
        const ledgerEntries = await LedgerEntry.insertMany(entries, { session });
        return ledgerEntries;
    }
    findMany(filter, { page, limit }) {
        return LedgerEntry.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);
    }

    count(filter) {
        return LedgerEntry.countDocuments(filter);
    }

    findAllForBalance(accountId) {
        return LedgerEntry.find({ accountId })
            .sort({ createdAt: 1 })
            .select("type amount")
            .lean();
    }
}

export default new LedgerRepository();