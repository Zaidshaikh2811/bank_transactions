import request from "supertest";
import { describe, beforeAll, afterAll, it, expect } from "vitest";

import app from "../src/app.js";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import crypto from "crypto";
import "dotenv/config";


describe("Deposit API", () => {
    let accessToken;
    const accountId = "6a2527e994667490f5cfc3bf";
    beforeAll(async () => {
        await connectDB();
        const loginRes = await request(app)
            .post("/api/auth/login")
            .send({
                email: "test1@nuitx.com",
                password: "test123"
            });

        expect(loginRes.status).toBe(200);

        accessToken = loginRes.body.data.accessToken;

    });

    afterAll(async () => {
        await mongoose.connection.close();
    });

    it("should deposit successfully", async () => {

        const response = await request(app)
            .post(`/api/transaction/deposit/${accountId}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", crypto.randomUUID())
            .send({
                amount: 1000,
                description: "Salary Deposit"
            });

        expect(response.status).toBe(201);

        expect(response.body.success).toBe(true);

        expect(response.body.message)
            .toBe("Deposit successful");

        expect(response.body.data.transaction)
            .toBeDefined();
    });

    it("should reject duplicate idempotency key", async () => {

        const key = crypto.randomUUID();

        await request(app)
            .post(`/api/transaction/deposit/${accountId}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", key)
            .send({
                amount: 1000
            });

        const second = await request(app)
            .post(`/api/transaction/deposit/${accountId}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", key)
            .send({
                amount: 1000
            });

        expect(second.status).toBe(200);

        expect(second.body.message)
            .toBe("Transaction already processed");
    });

    it("should reject missing amount", async () => {

        const response = await request(app)
            .post(`/api/transaction/deposit/${accountId}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", crypto.randomUUID())
            .send({});

        expect(response.status).toBe(400);
    });

    it("should reject missing idempotency key", async () => {

        const response = await request(app)
            .post(`/api/transaction/deposit/${accountId}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .send({
                amount: 1000
            });

        expect(response.status).toBe(400);
    });
});

describe("Withdraw API", () => {
    let accessToken;
    const accountId = "6a2527e994667490f5cfc3bf";

    beforeAll(async () => {
        await connectDB();

        const loginRes = await request(app)
            .post("/api/auth/login")
            .send({
                email: "test1@nuitx.com",
                password: "test123"
            });

        console.log(loginRes.body);

        expect(loginRes.status).toBe(200);

        accessToken = loginRes.body.data.accessToken;
    }, 30000);

    afterAll(async () => {
        await mongoose.connection.close();
    });

    it("should withdraw successfully", async () => {
        const response = await request(app)
            .post(`/api/transaction/withdraw/${accountId}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", crypto.randomUUID())
            .send({
                amount: 100,
                description: "ATM Withdrawal",
            });
        console.log(response.body);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });

    it("should reject duplicate idempotency key", async () => {
        const key = crypto.randomUUID();

        await request(app)
            .post(`/api/transaction/withdraw/${accountId}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", key)
            .send({
                amount: 100,
            });

        const response = await request(app)
            .post(`/api/transaction/withdraw/${accountId}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", key)
            .send({
                amount: 100,
            });

        expect(response.status).toBe(200);
        expect(response.body.message)
            .toBe("Transaction already processed");
    });

    it("should reject missing amount", async () => {
        const response = await request(app)
            .post(`/api/transaction/withdraw/${accountId}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", crypto.randomUUID())
            .send({});

        expect(response.status).toBe(400);
    });

    it("should reject missing idempotency key", async () => {
        const response = await request(app)
            .post(`/api/transaction/withdraw/${accountId}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .send({
                amount: 100
            });

        expect(response.status).toBe(400);
    });

    it("should reject insufficient funds", async () => {
        const response = await request(app)
            .post(`/api/transaction/withdraw/${accountId}`)
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", crypto.randomUUID())
            .send({
                amount: 999999
            });

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toContain("Insufficient funds");
    });

    it("should reject invalid account id", async () => {
        const response = await request(app)
            .post(`/api/transaction/withdraw/123`)
            .set("Authorization", `Bearer ${accessToken}`)
            .send({
                amount: 100,
                idempotencyKey: crypto.randomUUID()
            });

        expect(response.status).toBeGreaterThanOrEqual(400);
    });
});

describe("Transfer API", () => {
    let accessToken;

    const senderAccountId = "6a2527e994667490f5cfc3bf";
    const receiverAccountId = "6a25283b46f0532297f369c4";

    beforeAll(async () => {
        await connectDB();

        const loginRes = await request(app)
            .post("/api/auth/login")
            .send({
                email: "test1@nuitx.com",
                password: "test123",
            });

        expect(loginRes.status).toBe(200);

        accessToken = loginRes.body.data.accessToken;
    }, 30000);

    afterAll(async () => {
        await mongoose.connection.close();
    });

    it("should transfer successfully", async () => {
        const response = await request(app)
            .post("/api/transaction/transfer")
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", crypto.randomUUID())
            .send({
                senderAccountId,
                receiverAccountId,
                amount: 100,
                description: "Test Transfer",
                deviceId: "test-device",
            });

        console.log(response.body);
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe("Transfer successful");
    });

    it("should reject transfer to same account", async () => {
        const response = await request(app)
            .post("/api/transaction/transfer")
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", crypto.randomUUID())
            .send({
                senderAccountId,
                receiverAccountId: senderAccountId,
                amount: 100,
            });

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toContain("Cannot transfer to the same account");
    });

    it("should reject missing amount", async () => {
        const response = await request(app)
            .post("/api/transaction/transfer")
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", crypto.randomUUID())
            .send({
                senderAccountId,
                receiverAccountId,
            });

        expect(response.status).toBe(400);
    });

    it("should reject missing idempotency key", async () => {
        const response = await request(app)
            .post("/api/transaction/transfer")
            .set("Authorization", `Bearer ${accessToken}`)
            .send({
                senderAccountId,
                receiverAccountId,
                amount: 100,
            });

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toContain("Idempotency key");
    });

    it("should reject duplicate transaction", async () => {
        const key = crypto.randomUUID();

        await request(app)
            .post("/api/transaction/transfer")
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", key)
            .send({
                senderAccountId,
                receiverAccountId,
                amount: 100,
            });

        const second = await request(app)
            .post("/api/transaction/transfer")
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", key)
            .send({
                senderAccountId,
                receiverAccountId,
                amount: 100,
            });

        expect(second.status).toBe(200);
        expect(second.body.message)
            .toBe("Transaction already processed");
    });

    it("should reject insufficient funds", async () => {
        const response = await request(app)
            .post("/api/transaction/transfer")
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", crypto.randomUUID())
            .send({
                senderAccountId,
                receiverAccountId,
                amount: 20000, // Assuming this exceeds the sender's balance
            });

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toContain("Insufficient funds");
    });

    it("should reject invalid sender account", async () => {
        const response = await request(app)
            .post("/api/transaction/transfer")
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", crypto.randomUUID())
            .send({
                senderAccountId: "684000000000000000000000",
                receiverAccountId,
                amount: 100,
            });

        expect(response.status).toBe(404);
    });

    it("should reject invalid receiver account", async () => {
        const response = await request(app)
            .post("/api/transaction/transfer")
            .set("Authorization", `Bearer ${accessToken}`)
            .set("x-idempotency-key", crypto.randomUUID())
            .send({
                senderAccountId,
                receiverAccountId: "684000000000000000000000",
                amount: 100,
            });

        expect(response.status).toBe(404);
    });
});