import RefreshToken from "../models/refreshToken.model.js";

class RefreshTokenRepository {
    save(data) {
        return RefreshToken.create(data);
    }

    findByToken(token) {
        return RefreshToken.findOne({
            token,
        });
    }

    revoke(token) {
        return RefreshToken.findOneAndUpdate(
            { token },
            { isRevoked: true }
        );
    }

    revokeFamily(family) {
        return RefreshToken.updateMany(
            { family },
            { isRevoked: true }
        );
    }

    revokeAll(userId) {
        return RefreshToken.updateMany(
            { userId },
            { isRevoked: true }
        );
    }

    getActiveSessions(userId) {
        return RefreshToken.find({
            userId,
            isRevoked: false,
        }).select("-__v -_id -userId");
    }
}

export default new RefreshTokenRepository();