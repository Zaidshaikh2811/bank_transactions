import RefreshToken from "../models/refreshToken.model.js";
import User from "../models/user.model.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import cookie from "cookie";
import { emailQueue } from "../queues/emailQueue.js";

/**
 * - User Register Controller
 * - POST /api/auth/register
 * - Body: { name, email, password }
 */

export const register = asyncHandler(async (req, res) => {

    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        throw new ApiError(400, "Name, email and password are required");
    }
    const existingUser = await User.findOne({ email });
    console.log(existingUser);

    if (existingUser) {
        throw new ApiError(400, "Email already in use");
    }
    const newUser = await new User({ name, email, password });
    newUser.save();;


    await emailQueue.add("welcome", { email: newUser.email }, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 }
    });

    return new ApiResponse(201, "User registered successfully", {
        user: {
            id: newUser._id,
            name: newUser.name,
            email: newUser.email,
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

    return new ApiResponse(201, "User logged in successfully", {
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

    storedToken.isRevoked = true;
    await storedToken.save();
    const user = await User.findById(
        decoded.id
    );
    if (!user || !(await user.comparePassword(password))) {
        throw new ApiError(401, "Invalid credentials");
    }
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
    user.save();

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