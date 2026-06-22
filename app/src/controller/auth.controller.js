import RefreshToken from "../models/refreshToken.model.js";
import User from "../models/user.model.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import cookie from "cookie";
import { emailQueue } from "../queues/emailQueue.js";
import { sendOtp } from "../utils/opt.utils.js";
import Otp from "../models/otp.model.js";

/**
 * - User Register Controller
 * - POST /api/auth/register
 * - Body: { name, email, password }
 */

export const register = asyncHandler(async (req, res) => {

    const { name, email, password, phone } = req.body;
    if (!name || !email || !password || !phone) {
        throw new ApiError(400, "Name, email, password and phone are required");
    }
    const existingUser = await User.findOne({ email });

    if (existingUser) {
        throw new ApiError(400, "Email already in use");
    }
    const newUser = await User.create({ name, email, password, phone });


    await emailQueue.add("welcome", { email: newUser.email }, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 }
    });

    return new ApiResponse(201, "User registered successfully", {
        user: {
            id: newUser._id,
            name: newUser.name,
            email: newUser.email,
            phone: newUser.phone,
            balance: newUser.balance
        }
    }).send(res);
})


/**
 * - User Login Controller
 * - POST /api/auth/login
 * - Body: { email, password }
 */

export const login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        throw new ApiError(400, "Email and password are required");
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
        throw new ApiError(401, "Invalid credentials");
    }

    if (user.isActive === false) {
        throw new ApiError(403, "Account is deactivated. Please contact support.");
    }

    if (!user || !(await user.comparePassword(password))) {
        throw new ApiError(401, "Invalid credentials");
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid credentials");
    }

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();
    await RefreshToken.create({
        userId: user._id,
        token: refreshToken,
        family: randomUUID(),
        expiresAt: new Date(Date.now() + Number(process.env.REFRESH_TOKEN_EXPIRY))
    });

    res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
        expires: new Date(Date.now() + Number(process.env.REFRESH_TOKEN_EXPIRY))
    });

    return new ApiResponse(200, "User logged in successfully", {
        accessToken,
        user: {
            name: user.name,
            email: user.email,
            balance: user.balance,
        }
    }).send(res);

})

/**
 * - Refresh Token Controller
 * - POST /api/auth/refresh-token
 * - Cookies: { refreshToken }
 */

export const refreshToken = asyncHandler(async (req, res) => {

    const cookies = cookie.parse(req.headers.cookie || "");

    const refreshToken = cookies.refreshToken;;
    if (!refreshToken) {
        throw new ApiError(400, "Refresh token is required");
    }
    let storedToken = await RefreshToken.findOne({
        token: refreshToken,
    });

    if (!storedToken) {
        throw new ApiError(404, "Invalid refresh token");
    }

    if (storedToken.isRevoked) {
        await RefreshToken.updateMany(
            { family: storedToken.family },
            { isRevoked: true }
        );
        throw new ApiError(401, "Token reuse detected. Please log in again");
    }

    let decoded;

    try {

        decoded = jwt.verify(
            refreshToken,
            process.env.REFRESH_TOKEN_SECRET
        );

    } catch (error) {

        throw new ApiError(
            401,
            "Invalid refresh token"
        );
    }



    if (storedToken.expiresAt < new Date()) {
        throw new ApiError(
            401,
            "Refresh token expired"
        );
    }


    const user = await User.findById(
        decoded.id
    );
    console.log(user);
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
    await RefreshToken.create({
        userId: user._id,
        token: newRefreshToken,
        family: storedToken.family,
        expiresAt: new Date(
            Date.now() +
            Number(process.env.REFRESH_TOKEN_EXPIRY)
        )
    });

    res.cookie("refreshToken", newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
        expires: new Date(Date.now() + Number(process.env.REFRESH_TOKEN_EXPIRY))
    });

    return new ApiResponse(200, "Token refreshed successfully", {
        accessToken: newAccessToken,
    }).send(res);

})

export const logout = asyncHandler(async (req, res) => {
    const cookies = cookie.parse(req.headers.cookie || "");
    const { refreshToken } = cookies;
    await RefreshToken.findOneAndUpdate(
        { token: refreshToken },
        { isRevoked: true }
    );

    res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict"
    });
    return new ApiResponse(200, "Logged out successfully").send(res);
});


/**
 * - Activate User Controller
 * - POST /api/auth/activate-user
 * - Body: { email }
 */


export const requestReactivationOtp = asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) {
        throw new ApiError(400, "Email is required");
    }
    const user = await User.findOne({ email });
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (user.isActive === "active") {
        throw new ApiError(400, "User is already active");
    }


    const otp = await sendOtp({
        userId: user._id,
        purpose: "account-reactivation",
        meta: { email: user.email },
    });

    user.isActive = true;
    user.deactivatedAt = null;
    user.deactivatedReason = null;
    await user.save();
    await emailQueue.add("account-reactivated", {
        email: user.email
    }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });

    return new ApiResponse(200, "OTP sent successfully").send(res);
});



export const verifyReactivationOtp = asyncHandler(async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        throw new ApiError(400, "Email and OTP are required");
    }

    const user = await User.findOne({
        email: email.toLowerCase(),
    });

    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (user.isActive === "active") {
        throw new ApiError(400, "Account is already active");
    }

    const otpRecord = await Otp.findOne({
        userId: user._id,
        purpose: "account-reactivation",
        maskedContact: otp.maskedContact,
    });

    if (!otpRecord || otpRecord.otp !== otp) {
        throw new ApiError(400, "Invalid OTP");
    }

    if (user.otpExpiry < Date.now()) {
        throw new ApiError(400, "OTP expired");
    }

    user.isActive = "active";
    user.deactivatedAt = null;
    user.deactivationReason = null;

    user.otp = undefined;
    user.otpExpiry = undefined;

    await user.save();

    await emailQueue.add("account-reactivated", {
        email: user.email,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            {},
            "Account reactivated successfully"
        )
    );
});


/**
 * 
 * - Deactivate User Controller
 * - PATCH /api/auth/users/:userId/deactivate
 * - Headers: { Authorization: "Bearer <accessToken>" }
 * - Only accessible by admin users
 * - Sets isActive to false, preventing the user from logging in or performing any actions until reactivated
 */
export const deactivateUser = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { reason } = req.body || { reason: "No reason provided" };

    if (!userId) {
        throw new ApiError(400, "User ID is required");
    }

    const user = await User.findById(userId);
    if (!user) {
        throw new ApiError(404, "User not found");
    }
    if (!user.isActive) {
        throw new ApiError(400, "User is already deactivated");
    }

    if (user.role === "admin") {
        throw new ApiError(403, "Cannot deactivate an admin account");
    }
    user.isActive = false;
    user.deactivatedAt = new Date();
    user.deactivatedReason = reason.trim() || "No reason provided";
    await user.save();
    await emailQueue.add("account-deactivated", {
        email: user.email, reason: reason.trim() || "No reason provided"
    }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });
    return new ApiResponse(200, "User deactivated successfully").send(res);
});



export const activateUser = asyncHandler(async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    const userId = decoded.id;

    const user = await User.findById(userId).select("+password");
    if (!user) {
        throw new ApiError(404, "Invalid verification token");
    }

    if (user.isVerified) {
        throw new ApiError(400, "User is already verified");
    }

    user.isVerified = true;
    await user.save();

    await emailQueue.add("account-activated", {
        email: user.email
    }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });

    return new ApiResponse(200, "User verified successfully").send(res);
});



export const deactivateOwnAccount = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) throw new ApiError(404, "User not found");

    user.isActive = false;
    user.deactivatedAt = new Date();
    user.deactivatedReason = "Self deactivated";
    await user.save();


    await emailQueue.add("account-deactivated", {
        email: user.email, reason: "Self deactivated"
    }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });

    // await invalidateUserTokens(req.user.id);

    return new ApiResponse(200, "Account deactivated successfully").send(res);
});


export const activeSessions = asyncHandler(async (req, res) => {
    const refreshTokens = await RefreshToken.find({ userId: req.user.id, isRevoked: false }).select("-__v -_id -userId");
    return new ApiResponse(200, "Active sessions retrieved successfully", { sessions: refreshTokens }).send(res);
});

export const logoutAllSessions = asyncHandler(async (req, res) => {
    await RefreshToken.updateMany({ userId: req.user.id }, { isRevoked: true });
    return new ApiResponse(200, "Logged out of all sessions successfully").send(res);
})