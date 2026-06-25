
import User from "../models/user.model.js";
import ApiError from "../utils/ApiError.js";
import userRepository from "../repositories/user.repository.js";
import { emailQueue } from "../jobs/email.queue.js";
import { randomUUID } from "crypto";
import RefreshToken from "../models/refreshToken.model.js";
import RefreshTokenRepository from "../repositories/refreshToken.repository.js";
import jwt from "jsonwebtoken";
import { sendOtp } from "../utils/opt.utils.js";
import OtpRepository from "../repositories/otp.repository.js";
import { USER_ROLES, KYC_STATUS } from "../constants/user.constants.js";
import { maskEmail } from "../utils/opt.utils.js";


class AuthService {
    async register(data) {
        const {
            name,
            email,
            password,
            phone,
        } = data;

        const existingUser =
            await User.findOne({
                $or: [
                    { email },
                    { phone }
                ]
            });

        if (existingUser?.email === email)
            throw new ApiError(400, "Email already in use");

        if (existingUser?.phone === phone)
            throw new ApiError(400, "Phone number already in use");

        const user =
            await userRepository.create({
                name,
                email,
                password,
                phone,
            });

        emailQueue.add(
            "welcome",
            {
                email: user.email,
            },
            {
                attempts: 3,
                backoff: {
                    type: "exponential",
                    delay: 2000,
                },
            }
        );

        return {
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                balance: user.balance,
            },
        };
    }


    async login(data) {
        const { email, password } = data;

        if (!email || !password) {
            throw new ApiError(400, "Email and password are required");
        }

        const user = await userRepository.findByEmailWithPassword(email);

        if (!user) {
            throw new ApiError(401, "Invalid credentials");
        }

        if (user.isActive === false) {
            throw new ApiError(403, "Account is deactivated. Please contact support.");
        }

        if (!(await user.comparePassword(password))) {
            throw new ApiError(401, "Invalid credentials");
        }

        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();
        await RefreshTokenRepository.save({
            userId: user._id,
            token: refreshToken,
            family: randomUUID(),
            expiresAt: new Date(Date.now() + Number(process.env.REFRESH_TOKEN_EXPIRY))
        });

        return {
            user: {
                name: user.name,
                email: user.email,
                phone: user.phone,
            },
            refreshToken,
            accessToken,
        };

    }

    async refreshToken(refreshToken) {


        if (!refreshToken) {
            throw new ApiError(400, "Refresh token is required");
        }
        let storedToken = await RefreshTokenRepository.findByToken(refreshToken);

        if (!storedToken) {
            throw new ApiError(404, "Invalid refresh token");
        }

        if (storedToken.isRevoked) {
            await RefreshTokenRepository.revokeFamily(storedToken.family);
            throw new ApiError(401, "Token reuse detected. Please log in again");
        }

        let decoded;


        try {
            decoded = jwt.verify(
                refreshToken,
                process.env.REFRESH_TOKEN_SECRET
            );
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new ApiError(
                    401,
                    "Refresh token has expired. Please log in again"
                );
            }

            if (error instanceof jwt.JsonWebTokenError) {
                throw new ApiError(
                    401,
                    "Invalid refresh token"
                );
            }

            throw error;
        }

        if (storedToken.expiresAt < new Date()) {
            throw new ApiError(
                401,
                "Refresh token expired"
            );
        }

        const user = await userRepository.findById(
            decoded.id
        );
        if (!user) {
            throw new ApiError(401, "User not found");
        }
        if (!user.isActive) {
            throw new ApiError(403, "Account is inactive");
        }
        // if (!user.isVerified) {
        //     throw new ApiError(403, "Account is not verified");
        // }
        storedToken.isRevoked = true;
        await storedToken.save();
        const newAccessToken = user.generateAccessToken();
        const newRefreshToken = user.generateRefreshToken();
        await RefreshTokenRepository.save({
            userId: user._id,
            token: newRefreshToken,
            family: storedToken.family,
            expiresAt: new Date(
                Date.now() +
                Number(process.env.REFRESH_TOKEN_EXPIRY)
            )
        });

        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
        };

    }

    async requestReactivationOtp(email) {
        const user = await userRepository.findByEmail(email);
        if (!user) {
            throw new ApiError(404, "User not found");
        }

        if (user.isActive) {
            throw new ApiError(400, "User is already active");
        }


        const otp = await sendOtp({
            userId: user._id,
            purpose: "account-reactivation",
            meta: { email: user.email },
        });



        // user.isActive = true;
        // user.deactivatedAt = null;
        // user.deactivatedReason = null;
        // await user.save();
        emailQueue.add("account-reactivated", {
            email: user.email
        });

        return {
            message: "OTP sent to your email for account reactivation",
            otp,
        };
    }

    async deactivateUser(userId, reason) {
        const user = await userRepository.findById(userId);

        if (!user) {
            throw new ApiError(404, "User not found");
        }
        if (!user.isActive) {
            throw new ApiError(400, "User is already deactivated");
        }

        if (user.role === USER_ROLES.ADMIN) {
            throw new ApiError(403, "Cannot deactivate an admin account");
        }
        user.isActive = false;
        user.deactivatedAt = new Date();
        user.deactivatedReason = reason.trim() || "No reason provided";
        await user.save();
        emailQueue.add("account-deactivated", {
            email: user.email, reason: reason.trim() || "No reason provided"
        }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });

        return {
            message: "User deactivated successfully",
        };

    }

    async activateUser(token) {
        if (!token) {
            throw new ApiError(401, "Unauthorized");
        }

        let decoded;

        try {
            decoded = jwt.verify(
                token,
                process.env.ACCESS_TOKEN_SECRET
            );
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new ApiError(
                    401,
                    "Verification link has expired. Please request a new one"
                );
            }

            if (error instanceof jwt.JsonWebTokenError) {
                throw new ApiError(
                    401,
                    "Invalid verification link"
                );
            }

            throw error;
        }


        const userId = decoded.id;

        const user = await userRepository.findById(userId).select("+password");
        if (!user) {
            throw new ApiError(404, "Invalid verification token");
        }

        if (user.isVerified) {
            throw new ApiError(400, "User is already verified");
        }

        user.isVerified = true;
        await user.save();

        emailQueue.add("account-activated", {
            email: user.email
        });

        return {
            message: "User verified successfully",
        };

    }

    async deactivateOwnAccount(userId, reason) {
        const user = await userRepository.findById(userId);
        if (!user) throw new ApiError(404, "User not found");

        user.isActive = false;
        user.deactivatedAt = new Date();
        user.deactivatedReason = reason || "Self deactivated";
        await user.save();


        emailQueue.add("account-deactivated", {
            email: user.email, reason: reason || "Self deactivated"
        });

        // await invalidateUserTokens(req.user.id);

        return {
            message: "Account deactivated successfully",
        }
    }

    async logoutAllSessions(userId) {
        await RefreshTokenRepository.revokeAllForUser(userId);
        return {
            message: "Logged out from all sessions successfully",
        };
    }

    async getActiveSessions(userId) {
        const sessions = await RefreshTokenRepository.findAllActiveForUser(userId);
        return sessions.map(session => ({
            id: session._id,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            userAgent: session.userAgent,
            ipAddress: session.ipAddress,
        }));
    }

    async verifyReactivationOtp(email, otp) {

        console.log("email", email, "otp", otp);
        const user = await userRepository.findByEmail(email);
        if (!user) {
            throw new ApiError(404, "User not found");
        }

        if (user.isActive) {
            throw new ApiError(400, "Account is already active");
        }

        const maskedEmail = maskEmail(user.email);
        console.log("maskedEmail", maskedEmail);


        const otpRecord = await OtpRepository.findReactivationOtp({
            userId: user._id,
            purpose: "account-reactivation",
            maskedContact: maskedEmail,
        });

        console.log("otpRecord", otpRecord);

        if (!otpRecord || !(await otpRecord.verify(otp))) {
            throw new ApiError(400, "Invalid OTP");
        }

        if (user.otpExpiry < Date.now()) {
            throw new ApiError(400, "OTP expired");
        }

        user.isActive = true;
        user.deactivatedAt = null;
        user.deactivationReason = null;
        await user.save();

        emailQueue.add("account-reactivated", {
            email: user.email,
        });

        return {
            message: "Account reactivated successfully",
        };
    }
}

export default new AuthService();