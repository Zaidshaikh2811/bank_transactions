
import User from "../models/user.model.js";


class UserRepository {
    findById(id) {
        return User.findById(id);
    }

    findByEmail(email) {
        return User.findOne({
            email,
        });
    }

    findByEmailWithPassword(email) {
        return User.findOne({
            email,
        }).select("+password");
    }

    save(user) {
        return user.save();
    }

    findByIdWithPassword(id) {
        return User.findById(id)
            .select("+password");
    }

    findAccountCreationUser(id) {
        return User.findById(id)
            .select("email isVerified isActive");
    }
}

export default new UserRepository();