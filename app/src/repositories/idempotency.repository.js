import Idempotency from "../models/idempotency.model.js";


class IdempotencyRepository {

    findByKey(userId, key, purpose) {
        return Idempotency.findOne({
            userId,
            key,
            purpose,
        });
    }
    create(data, session) {
        return Idempotency.create(
            data,
            { session }
        );
    }

    save(document) {
        return document.save();
    }
}

export default new IdempotencyRepository();