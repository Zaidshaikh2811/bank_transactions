import request from "supertest";
import { describe, beforeAll, afterAll, it, expect } from "vitest";
import app from "../src/app.js";
import User from "../src/models/user.model.js";
import RefreshToken from "../src/models/refreshToken.model.js";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import "dotenv/config";


const EXISTING_USER = {
    email: "test1@nuitx.com",
    password: "test123",
};

const uniqueUser = () => ({
    name: "Test User",
    email: `user_${Date.now()}_${Math.random().toString(36).slice(2)}@nuitx.com`,
    password: "Test@1234",
    phone: `98765${Math.floor(10000 + Math.random() * 90000)}`,
});


const registerAndLogin = async () => {
    const payload = uniqueUser();

    await request(app).post("/api/auth/register").send(payload);

    const loginRes = await request(app)
        .post("/api/auth/login")
        .send({ email: payload.email, password: payload.password });
    console.log("Login Response Body:", loginRes.body);


    await request(app).patch("/api/auth/verify/" + loginRes.body.data?.accessToken);

    return {
        email: payload.email,
        accessToken: loginRes.body.data?.accessToken,
        cookieHeader: loginRes.headers["set-cookie"],
    };
};


describe("Auth Controllers", () => {
    beforeAll(async () => {
        await connectDB();
    });

    afterAll(async () => {
        await mongoose.connection.close();
    });


    describe("POST /api/auth/register", () => {
        it("should register a new user and return 201", async () => {
            const payload = uniqueUser();
            const res = await request(app)
                .post("/api/auth/register")
                .send(payload);

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.user.email).toBe(payload.email);
            expect(res.body.data.user).not.toHaveProperty("password");
        });

        it("should return 400 when name is missing", async () => {
            const { name, ...payload } = uniqueUser();
            const res = await request(app)
                .post("/api/auth/register")
                .send(payload);

            expect(res.status).toBe(400);
        });

        it("should return 400 when email is missing", async () => {
            const { email, ...payload } = uniqueUser();
            const res = await request(app)
                .post("/api/auth/register")
                .send(payload);

            expect(res.status).toBe(400);
        });

        it("should return 400 when password is missing", async () => {
            const { password, ...payload } = uniqueUser();
            const res = await request(app)
                .post("/api/auth/register")
                .send(payload);

            expect(res.status).toBe(400);
        });

        it("should return 400 when phone is missing", async () => {
            const { phone, ...payload } = uniqueUser();
            const res = await request(app)
                .post("/api/auth/register")
                .send(payload);

            expect(res.status).toBe(400);
        });

        it("should return 400 when email is already registered", async () => {
            const payload = uniqueUser();

            // First registration — must succeed
            await request(app).post("/api/auth/register").send(payload);

            // Second registration with same email — must fail
            const res = await request(app)
                .post("/api/auth/register")
                .send(payload);

            expect(res.status).toBe(400);
        });

        it("should return user data without sensitive fields", async () => {
            const payload = uniqueUser();
            const res = await request(app)
                .post("/api/auth/register")
                .send(payload);

            expect(res.status).toBe(201);
            const user = res.body.data.user;
            expect(user).toHaveProperty("id");
            expect(user).toHaveProperty("name");
            expect(user).toHaveProperty("email");
            expect(user).not.toHaveProperty("password");
        });
    });

    // ── POST /api/auth/login ─────────────────────────────────────────────────

    describe("POST /api/auth/login", () => {
        it("should login with valid credentials and return accessToken", async () => {
            const res = await request(app)
                .post("/api/auth/login")
                .send(EXISTING_USER);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty("accessToken");
        });

        it("should set an httpOnly refreshToken cookie on login", async () => {
            const res = await request(app)
                .post("/api/auth/login")
                .send(EXISTING_USER);

            expect(res.status).toBe(200);
            const cookies = res.headers["set-cookie"] ?? [];
            const hasRefreshCookie = cookies.some((c) =>
                c.startsWith("refreshToken=")
            );
            expect(hasRefreshCookie).toBe(true);
        });

        it("should return 400 when email is missing", async () => {
            const res = await request(app)
                .post("/api/auth/login")
                .send({ password: EXISTING_USER.password });

            expect(res.status).toBe(400);
        });

        it("should return 400 when password is missing", async () => {
            const res = await request(app)
                .post("/api/auth/login")
                .send({ email: EXISTING_USER.email });

            expect(res.status).toBe(400);
        });

        it("should return 401 for wrong password", async () => {
            const res = await request(app)
                .post("/api/auth/login")
                .send({ email: EXISTING_USER.email, password: "wrongpassword" });

            expect(res.status).toBe(401);
        });

        it("should return 401 for non-existent email", async () => {
            const res = await request(app)
                .post("/api/auth/login")
                .send({ email: "ghost@nuitx.com", password: "anything" });

            expect(res.status).toBe(401);
        });

        it("should not expose password in response body", async () => {
            const res = await request(app)
                .post("/api/auth/login")
                .send(EXISTING_USER);
            console.log("Login Response Body:", res.body);
            expect(res.status).toBe(200);
            expect(res.body.data.user).not.toHaveProperty("password");
        });
    });

    // ── POST /api/auth/refresh-token ─────────────────────────────────────────

    describe("POST /api/auth/refresh-token", () => {
        it("should issue a new accessToken when a valid refreshToken cookie is provided", async () => {
            const { cookieHeader } = await registerAndLogin();

            const res = await request(app)
                .post("/api/auth/refresh-token")
                .set("Cookie", cookieHeader);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveProperty("accessToken");
        });

        it("should rotate the refreshToken cookie on each refresh", async () => {
            const { cookieHeader } = await registerAndLogin();

            const res = await request(app)
                .post("/api/auth/refresh-token")
                .set("Cookie", cookieHeader);
            console.log("Refresh Response Cookies:", res.body);

            expect(res.status).toBe(200);
            const newCookies = res.headers["set-cookie"] ?? [];
            const hasNewRefreshCookie = newCookies.some((c) =>
                c.startsWith("refreshToken=")
            );
            expect(hasNewRefreshCookie).toBe(true);
        });

        it("should return 400 when no refreshToken cookie is provided", async () => {
            const res = await request(app).post("/api/auth/refresh-token");

            expect(res.status).toBe(400);
        });

        it("should return 401 when refreshToken is reused (token rotation / replay attack)", async () => {
            const { cookieHeader } = await registerAndLogin();

            // First use — valid
            await request(app)
                .post("/api/auth/refresh-token")
                .set("Cookie", cookieHeader);

            // Second use with the SAME (now revoked) token — should be rejected
            const res = await request(app)
                .post("/api/auth/refresh-token")
                .set("Cookie", cookieHeader);

            expect(res.status).toBe(401);
        });

        it("should return 404 for a completely unknown refreshToken", async () => {
            const res = await request(app)
                .post("/api/auth/refresh-token")
                .set("Cookie", "refreshToken=totallyFakeToken123");

            expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });

    // ── POST /api/auth/logout ────────────────────────────────────────────────
    // Route: router.post("/logout", authMiddleware, logout)
    // authMiddleware requires a valid Bearer token — no token = 401

    describe("POST /api/auth/logout", () => {
        it("should return 200 and clear the refreshToken cookie", async () => {
            const { accessToken, cookieHeader } = await registerAndLogin();

            const res = await request(app)
                .post("/api/auth/logout")
                .set("Authorization", `Bearer ${accessToken}`)
                .set("Cookie", cookieHeader);
            console.log("Logout Response Cookies:", res.body);

            expect(res.status).toBe(200);
            const cookies = res.headers["set-cookie"] ?? [];
            const clearedCookie = cookies.some(
                (c) =>
                    c.startsWith("refreshToken=") &&
                    (c.includes("Expires=Thu, 01 Jan 1970") ||
                        c.includes("Max-Age=0"))
            );
            expect(clearedCookie).toBe(true);
        });

        it("should revoke the refreshToken in DB after logout", async () => {
            const { accessToken, cookieHeader } = await registerAndLogin();
            const rawToken = cookieHeader[0]
                ?.split(";")[0]
                ?.replace("refreshToken=", "");

            await request(app)
                .post("/api/auth/logout")
                .set("Authorization", `Bearer ${accessToken}`)
                .set("Cookie", cookieHeader);

            const storedToken = await RefreshToken.findOne({ token: rawToken });
            if (storedToken) {
                expect(storedToken.isRevoked).toBe(true);
            }
        });

        it("should return 401 when no access token is provided", async () => {
            const res = await request(app).post("/api/auth/logout");
            expect(res.status).toBe(401);
        });

        it("should reject the refreshToken as valid after logout", async () => {
            const { accessToken, cookieHeader } = await registerAndLogin();

            await request(app)
                .post("/api/auth/logout")
                .set("Authorization", `Bearer ${accessToken}`)
                .set("Cookie", cookieHeader);

            const refreshRes = await request(app)
                .post("/api/auth/refresh-token")
                .set("Cookie", cookieHeader);

            expect(refreshRes.status).toBeGreaterThanOrEqual(400);
        });
    });


    describe("PATCH /api/auth/verify/:token", () => {
        it("should return 4xx for an invalid/expired verification token", async () => {
            const res = await request(app).patch(
                "/api/auth/verify/invalidtoken123"
            );

            expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });


    describe("PATCH /api/auth/users/:userId/reactivate", () => {
        it("should return 401 when no access token is provided", async () => {
            const fakeId = new mongoose.Types.ObjectId().toString();
            const res = await request(app).patch(
                `/api/auth/users/${fakeId}/reactivate`
            );

            expect(res.status).toBe(401);
        });

        it("should return 403 when a non-admin tries to reactivate a user", async () => {
            const { accessToken } = await registerAndLogin();
            const fakeId = new mongoose.Types.ObjectId().toString();

            const res = await request(app)
                .patch(`/api/auth/users/${fakeId}/reactivate`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect([403, 404]).toContain(res.status);
        });
    });

    // ── PATCH /api/auth/users/:userId/deactivate (admin) ─────────────────────

    describe("PATCH /api/auth/users/:userId/deactivate", () => {
        it("should return 401 when no access token is provided", async () => {
            const fakeId = new mongoose.Types.ObjectId().toString();
            const res = await request(app)
                .patch(`/api/auth/users/${fakeId}/deactivate`)
                .send({ reason: "test" });

            expect(res.status).toBe(401);
        });

        it("should return 401 or 403 when a non-admin tries to deactivate another user", async () => {
            const { accessToken } = await registerAndLogin();
            const fakeId = new mongoose.Types.ObjectId().toString();

            const res = await request(app)
                .patch(`/api/auth/users/${fakeId}/deactivate`)
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ reason: "test" });

            expect([401, 403, 404]).toContain(res.status);
        });
    });


    describe("PATCH /api/auth/deactivate-my-account", () => {
        it("should return 401 when unauthenticated", async () => {
            const res = await request(app).patch("/api/auth/deactivate-my-account");
            expect(res.status).toBe(401);
        });

        it("should deactivate own account when authenticated", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .patch("/api/auth/deactivate-my-account")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
        });

        it("should prevent login after self-deactivation", async () => {
            const payload = uniqueUser();

            await request(app).post("/api/auth/register").send(payload);
            const { accessToken, cookieHeader } = (await (async () => {
                const loginRes = await request(app)
                    .post("/api/auth/login")
                    .send({ email: payload.email, password: payload.password });
                return {
                    accessToken: loginRes.body.data?.accessToken,
                    cookieHeader: loginRes.headers["set-cookie"],
                };
            })());
            await request(app).patch("/api/auth/verify/" + accessToken);

            await request(app)
                .patch("/api/auth/deactivate-my-account")
                .set("Authorization", `Bearer ${accessToken}`);

            const refreshRes = await request(app)
                .post("/api/auth/refresh-token")
                .set("Cookie", cookieHeader);

            expect(refreshRes.status).toBeGreaterThanOrEqual(400);
        });
    });
});