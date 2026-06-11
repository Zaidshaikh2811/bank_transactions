import request from "supertest";
import { describe, beforeAll, afterAll, it, expect } from "vitest";

import app from "../src/app.js";
import User from "../src/models/user.model.js";
import Account from "../src/models/account.model.js";
import Transaction from "../src/models//transaction.model.js";
import LedgerEntry from "../src/models/ledger.model.js";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import crypto from "crypto";
import "dotenv/config";

describe("Transaction", () => {
    let token;
    let userId;
    let accountId;
    let transactionId;
    let idempotencyKey;
    let receiverAccountId;

    beforeAll(async () => {
        await connectDB();


        const login = await request(app)
            .post("/api/auth/login")
            .send({
                email: "test1@nuitx.com",
                password: "test123",
            });


        token = login.body.data.accessToken;

        const user = await User.findOne({ email: "test1@nuitx.com" });
        userId = user._id;

        const account = await Account.findOne({ userId });
        accountId = account._id;

        const receiver = await Account.findOne({
            _id: { $ne: accountId }
        });

        receiverAccountId = receiver._id.toString();

        idempotencyKey = crypto.randomUUID();

        const transaction = await Transaction.create({
            senderAccount: accountId,
            receiverAccount: accountId,
            type: "DEPOSIT",
            amount: 200,
            currency: "INR",
            balanceAfter: 200,
            idempotencyKey,
            status: "SUCCESS",
            processedAt: new Date(),
        });

        transactionId = transaction._id;

        await LedgerEntry.create({
            transactionId,
            accountId,
            type: "DEPOSIT",
            amount: 200,
            balanceBefore: 0,
            balanceAfter: 200,
            currency: "INR",
        });
    });

    describe("GET /transaction/history/:accountId", () => {
        it("should reject unauthenticated requests", async () => {
            const response = await request(app)
                .get(`/api/transaction/history/${accountId}`);

            expect(response.status).toBe(401);
        });
        it("should reject malformed account id", async () => {
            const response = await request(app)
                .get("/api/transaction/history/123")
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBeGreaterThanOrEqual(400);
        });

        it("should filter by transaction type", async () => {
            const response = await request(app)
                .get(`/api/transaction/history/${accountId}?type=DEPOSIT`)
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(200);

            response.body.data.transactions.forEach(tx => {
                expect(tx.type).toBe("DEPOSIT");
            });
        });
        it("should filter by date range", async () => {
            const response = await request(app)
                .get(
                    `/api/transaction/history/${accountId}?startDate=2026-01-01&endDate=2026-12-31`
                )
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(200);
        });


        it("should get transaction history", async () => {
            const response = await request(app)
                .get(`/api/transaction/history/${accountId}`)
                .set("Authorization", `Bearer ${token}`);

            console.log(response.body.data.transactions);
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(Array.isArray(response.body.data.transactions)).toBe(true);
        });

        it("should support pagination", async () => {
            const response = await request(app)
                .get(`/api/transaction/history/${accountId}?page=1&limit=5`)
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data.pagination.limit).toBe(5);
        });

        it("should return 404 for invalid account", async () => {
            const response = await request(app)
                .get(`/api/transaction/history/685000000000000000000000`)
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(404);
        });
    });

    describe("GET /transaction/:transactionId", () => {



        it("should get transaction by id", async () => {
            const response = await request(app)
                .get(`/api/transaction/${transactionId}`)
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data.transaction._id).toBe(
                transactionId.toString()
            );
        });

        it("should return 404 for non-existent transaction", async () => {
            const response = await request(app)
                .get(`/api/transaction/685000000000000000000000`)
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(404);
        });
    });

    describe("GET /ledger/:accountId", () => {
        it("should get ledger history", async () => {
            const response = await request(app)
                .get(`/api/transaction/ledger/${accountId}`)
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data.entries)).toBe(true);
        });

        it("should paginate ledger entries", async () => {
            const response = await request(app)
                .get(`/api/transaction/ledger/${accountId}?page=1&limit=5`)
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.data.pagination.limit).toBe(5);
        });

        it("should return 404 for invalid account", async () => {
            const response = await request(app)
                .get(`/api/transaction/ledger/685000000000000000000000`)
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(404);
        });
    });

    describe("GET /verify-balance/:accountId", () => {
        it("should verify account balance", async () => {
            const response = await request(app)
                .get(`/api/transaction/verify/${accountId}`)
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(200);
            console.log(response.body.data);

            expect(response.body.data).toHaveProperty(
                "currentBalance"
            );

            expect(response.body.data).toHaveProperty(
                "reconstructedBalance"
            );

            expect(response.body.data).toHaveProperty(
                "isConsistent"
            );
        });

        it("should return 404 for invalid account", async () => {
            const response = await request(app)
                .get(`/api/transaction/verify-balance/685000000000000000000000`)
                .set("Authorization", `Bearer ${token}`);

            expect(response.status).toBe(404);
        });
    });

    describe("Deposit API", () => {

        it("should reject negative deposit", async () => {
            const response = await request(app)
                .post(`/api/transaction/deposit/${accountId}`)
                .set("Authorization", `Bearer ${token}`)
                .set("x-idempotency-key", crypto.randomUUID())
                .send({
                    amount: -100
                });

            expect(response.status).toBe(400);
        });

        it("should deposit successfully", async () => {

            const response = await request(app)
                .post(`/api/transaction/deposit/${accountId}`)
                .set("Authorization", `Bearer ${token}`)
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
                .set("Authorization", `Bearer ${token}`)
                .set("x-idempotency-key", key)
                .send({
                    amount: 1000
                });

            const second = await request(app)
                .post(`/api/transaction/deposit/${accountId}`)
                .set("Authorization", `Bearer ${token}`)
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
                .set("Authorization", `Bearer ${token}`)
                .set("x-idempotency-key", crypto.randomUUID())
                .send({});

            expect(response.status).toBe(400);
        });

        it("should reject missing idempotency key", async () => {

            const response = await request(app)
                .post(`/api/transaction/deposit/${accountId}`)
                .set("Authorization", `Bearer ${token}`)
                .send({
                    amount: 1000
                });

            expect(response.status).toBe(400);
        });
    });

    describe("Withdraw API", () => {

        it("should withdraw successfully", async () => {
            const response = await request(app)
                .post(`/api/transaction/withdraw/${accountId}`)
                .set("Authorization", `Bearer ${token}`)
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
                .set("Authorization", `Bearer ${token}`)
                .set("x-idempotency-key", key)
                .send({
                    amount: 100,
                });

            const response = await request(app)
                .post(`/api/transaction/withdraw/${accountId}`)
                .set("Authorization", `Bearer ${token}`)
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
                .set("Authorization", `Bearer ${token}`)
                .set("x-idempotency-key", crypto.randomUUID())
                .send({});

            expect(response.status).toBe(400);
        });

        it("should reject missing idempotency key", async () => {
            const response = await request(app)
                .post(`/api/transaction/withdraw/${accountId}`)
                .set("Authorization", `Bearer ${token}`)
                .send({
                    amount: 100
                });

            expect(response.status).toBe(400);
        });

        it("should reject insufficient funds", async () => {
            const response = await request(app)
                .post(`/api/transaction/withdraw/${accountId}`)
                .set("Authorization", `Bearer ${token}`)
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
                .set("Authorization", `Bearer ${token}`)
                .send({
                    amount: 100,
                    idempotencyKey: crypto.randomUUID()
                });

            expect(response.status).toBeGreaterThanOrEqual(400);
        });
    });

    describe("Transfer API", () => {




        it("should transfer successfully", async () => {
            const response = await request(app)
                .post("/api/transaction/transfer")
                .set("Authorization", `Bearer ${token}`)
                .set("x-idempotency-key", crypto.randomUUID())
                .send({
                    senderAccountId: accountId,
                    receiverAccountId,
                    amount: 100,
                    description: "Test Transfer",
                    deviceId: "test-device",
                });

            expect(response.status).toBe(201);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe("Transfer successful");
        });

        it("should reject transfer to same account", async () => {
            const response = await request(app)
                .post("/api/transaction/transfer")
                .set("Authorization", `Bearer ${token}`)
                .set("x-idempotency-key", crypto.randomUUID())
                .send({
                    senderAccountId: accountId,
                    receiverAccountId: accountId,
                    amount: 100,
                });

            expect(response.status).toBe(400);
            expect(response.body.message)
                .toContain("Cannot transfer to the same account");
        });

        it("should reject missing amount", async () => {
            const response = await request(app)
                .post("/api/transaction/transfer")
                .set("Authorization", `Bearer ${token}`)
                .set("x-idempotency-key", crypto.randomUUID())
                .send({
                    senderAccountId: accountId,
                    receiverAccountId,
                });

            expect(response.status).toBe(400);
        });

        it("should reject missing idempotency key", async () => {
            const response = await request(app)
                .post("/api/transaction/transfer")
                .set("Authorization", `Bearer ${token}`)
                .send({
                    senderAccountId: accountId,
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
                .set("Authorization", `Bearer ${token}`)
                .set("x-idempotency-key", key)
                .send({
                    senderAccountId: accountId,
                    receiverAccountId,
                    amount: 100,
                });

            const second = await request(app)
                .post("/api/transaction/transfer")
                .set("Authorization", `Bearer ${token}`)
                .set("x-idempotency-key", key)
                .send({
                    senderAccountId: accountId,
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
                .set("Authorization", `Bearer ${token}`)
                .set("x-idempotency-key", crypto.randomUUID())
                .send({
                    senderAccountId: accountId,
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
                .set("Authorization", `Bearer ${token}`)
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
                .set("Authorization", `Bearer ${token}`)
                .set("x-idempotency-key", crypto.randomUUID())
                .send({
                    senderAccountId: accountId,
                    receiverAccountId: "684000000000000000000000",
                    amount: 100,
                });

            expect(response.status).toBe(404);
        });
    });
});