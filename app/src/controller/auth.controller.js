import RefreshToken from "../models/refreshToken.model.js";
import User from "../models/user.model.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import cookie from "cookie";
import { emailQueue } from "../jobs/email.queue.js";
import { sendOtp } from "../utils/opt.utils.js";
import Otp from "../models/otp.model.js";


import authService from "../services/auth.service.js";

/**
 * - User Register Controller
 * - POST /api/auth/register
 * - Body: { name, email, password }
 */

export const register = asyncHandler(async (req, res) => {

    const response = await authService.register(req.body);

    return new ApiResponse(201, "User registered successfully", response).send(res);
})


/**
 * - User Login Controller
 * - POST /api/auth/login
 * - Body: { email, password }
 */

export const login = asyncHandler(async (req, res) => {

    const { user, refreshToken, accessToken } = await authService.login(req.body);
    res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
        expires: new Date(Date.now() + Number(process.env.REFRESH_TOKEN_EXPIRY))
    });
    return new ApiResponse(200, "User logged in successfully", { user, accessToken }).send(res);

})

/**
 * - Refresh Token Controller
 * - POST /api/auth/refresh-token
 * - Cookies: { refreshToken }
 */

export const refreshToken = asyncHandler(async (req, res) => {

    const refreshToken = req.headers.cookie ? cookie.parse(req.headers.cookie).refreshToken : null;
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await authService.refreshToken(refreshToken);

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
    const refreshToken = req.headers.cookie ? cookie.parse(req.headers.cookie).refreshToken : null;
    if (!refreshToken) {
        return new ApiResponse(400, "Refresh token not found").send(res);
    }
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

    const response = await authService.requestReactivationOtp(req.body.email);

    return new ApiResponse(200, "OTP sent successfully", response).send(res);

});



export const verifyReactivationOtp = asyncHandler(async (req, res) => {

    const response = await authService.verifyReactivationOtp(req.body.email, req.body.otp);

    return new ApiResponse(200, "OTP verified successfully", response).send(res);
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
    const { reason } = req.body || { reason: "No reason provided" };
    const response = await authService.deactivateUser(req.params.userId, reason);
    return new ApiResponse(200, response.message).send(res);
});



export const activateUser = asyncHandler(async (req, res) => {
    const accessToken = req.headers.authorization?.split(' ')[1];
    if (!accessToken) {
        return new ApiResponse(401, "Access token not found").send(res);
    }
    const response = await authService.activateUser(accessToken);
    return new ApiResponse(200, response.message).send(res);
});



export const deactivateOwnAccount = asyncHandler(async (req, res) => {
    const { reason } = req.body || { reason: "No reason provided" };
    const response = await authService.deactivateOwnAccount(req.user.id, reason);
    return new ApiResponse(200, response.message).send(res);
});


export const activeSessions = asyncHandler(async (req, res) => {
    const response = await authService.getActiveSessions(req.user.id);
    return new ApiResponse(200, "Active sessions retrieved successfully", { sessions: response }).send(res);
});

export const logoutAllSessions = asyncHandler(async (req, res) => {
    const response = await authService.logoutAllSessions(req.user.id);
    return new ApiResponse(200, response.message).send(res);
})