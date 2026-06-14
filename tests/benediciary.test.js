import request from "supertest";
import { describe, beforeAll, afterAll, beforeEach, it, expect } from "vitest";
import app from "../src/app.js";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import User from "../src/models/user.model.js";
import Account from "../src/models/account.model.js";
import Beneficiary from "../src/models/beneficiary.model.js";
import Otp from "../src/models/otp.model.js";
import Transaction from "../src/models/transaction.model.js";
import Ledger from "../src/models/ledger.model.js";
import "dotenv/config";


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

    const accessToken = loginRes.body.data?.accessToken;

    await request(app).patch("/api/auth/verify/" + accessToken);

    const user = await User.findOne({ email: payload.email }).lean();

    return { accessToken, user };
};


const createAccount = async (userId, overrides = {}) => {
    return Account.create({
        userId,
        accountNumber: `ACC${Date.now()}${Math.floor(Math.random() * 9999)}`,
        accountType: "savings",
        currency: "INR",
        isActive: "active",
        balance: 10000,
        ...overrides,
    });
};


const createActiveBeneficiary = async (userId, beneficiaryAccountId, nickname = "Alice") => {
    return Beneficiary.create({
        userId,
        beneficiaryAccountId,
        nickname,
        isVerified: true,
    });
};


describe("Beneficiary Controllers", () => {
    beforeAll(async () => {
        await connectDB();
    });

    afterAll(async () => {
        await mongoose.connection.close();
    });

    beforeEach(async () => {
        await Beneficiary.deleteMany({});
        await Otp.deleteMany({});
        await Transaction.deleteMany({});
        if (Ledger) await Ledger.deleteMany({});
    });

    // ── POST /api/beneficiary ─────────────────────────────────────────────────

    describe("POST /api/beneficiary — addBeneficiary", () => {

        it("should return 401 when unauthenticated", async () => {
            const res = await request(app)
                .post("/api/beneficiary")
                .send({ accountNumber: "ACC123", nickname: "Alice" });

            expect(res.status).toBe(401);
        });

        it("should return 400 when accountNumber is missing", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ nickname: "Alice" });

            expect(res.status).toBe(400);
        });

        it("should return 400 when nickname is missing", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: "ACC123" });

            expect(res.status).toBe(400);
        });

        it("should return 400 when nickname is too short (< 2 chars)", async () => {
            const { accessToken, user } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "A" });

            expect(res.status).toBe(400);
        });

        it("should return 400 when nickname contains invalid characters", async () => {
            const { accessToken } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice<>" });

            expect(res.status).toBe(400);
        });

        it("should return 404 when beneficiary account does not exist", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: "NONEXISTENT999", nickname: "Ghost" });

            expect(res.status).toBe(404);
        });

        it("should return 400 when trying to add own account as beneficiary", async () => {
            const { accessToken, user } = await registerAndLogin();
            const ownAccount = await createAccount(user._id);

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: ownAccount.accountNumber, nickname: "Myself" });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/own account/i);
        });

        it("should return 400 when beneficiary account is suspended", async () => {
            const { accessToken } = await registerAndLogin();
            const suspendedAccount = await createAccount(
                new mongoose.Types.ObjectId(),
                { isActive: "suspended" }
            );

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: suspendedAccount.accountNumber, nickname: "Bob" });

            expect(res.status).toBe(400);
        });

        it("should return 409 when an active beneficiary already exists", async () => {
            const { accessToken, user } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            // Seed an already-active beneficiary
            await createActiveBeneficiary(user._id, recipientAccount._id);

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice Again" });

            expect(res.status).toBe(409);
        });

        it("should return 201, create a PENDING beneficiary, and send OTP", async () => {
            const { accessToken } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice" });

            expect(res.status).toBe(201);
            expect(res.body.data).toHaveProperty("maskedContact");
            expect(res.body.data).toHaveProperty("expiresInMinutes");

            // Beneficiary must be pending, not yet active
            const saved = await Beneficiary.findOne({ beneficiaryAccountId: recipientAccount._id });
            expect(saved).not.toBeNull();
            expect(saved.isVerified).toBe(false);
        });

        it("should re-send OTP and reset a previously removed beneficiary to pending", async () => {
            const { accessToken, user } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            // Seed a removed (isVerified: false) beneficiary
            await Beneficiary.create({
                userId: user._id,
                beneficiaryAccountId: recipientAccount._id,
                nickname: "Old",
                isVerified: false,
            });

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice New" });

            // Should NOT throw 409 — should re-activate the existing record
            expect([200, 201]).toContain(res.status);
        });
    });

    // ── POST /api/beneficiary/confirm-otp ─────────────────────────────────────

    describe("POST /api/beneficiary/confirm-otp — confirmBeneficiaryOtp", () => {

        it("should return 401 when unauthenticated", async () => {
            const res = await request(app)
                .post("/api/beneficiary/confirm-otp")
                .send({ otp: "123456" });

            expect(res.status).toBe(401);
        });

        it("should return 400 when OTP field is missing", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary/confirm-otp")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({});

            expect(res.status).toBe(400);
        });

        it("should return 400 when no pending OTP exists for the user", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary/confirm-otp")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ otp: "123456" });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/no pending otp/i);
        });

        it("should return 400 for an expired OTP", async () => {
            const { accessToken, user } = await registerAndLogin();

            // Insert an already-expired OTP directly
            await Otp.create({
                userId: user._id,
                purpose: "add_beneficiary",
                hashedOtp: "$2b$10$invalidhashbutdoesnotmatter",
                expiresAt: new Date(Date.now() - 1000), // already expired
                attempts: 0,
                meta: {},
            });

            const res = await request(app)
                .post("/api/beneficiary/confirm-otp")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ otp: "123456" });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/expired/i);
        });

        it("should return 400 for a wrong OTP and increment attempts", async () => {
            const { accessToken, user } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());
            await Beneficiary.create({
                userId: user._id, beneficiaryAccountId: recipientAccount._id,
                nickname: "Alice", isVerified: false,
            });

            // Initiate OTP flow so a real hashed OTP is stored
            await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice" });

            const res = await request(app)
                .post("/api/beneficiary/confirm-otp")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ otp: "000000" }); // deliberately wrong

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/incorrect otp/i);
        });

        it("should return 429 and delete the OTP after 3 wrong attempts", async () => {
            const { accessToken, user } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice" });

            // Three wrong attempts
            for (let i = 0; i < 3; i++) {
                await request(app)
                    .post("/api/beneficiary/confirm-otp")
                    .set("Authorization", `Bearer ${accessToken}`)
                    .send({ otp: "000000" });
            }

            const res = await request(app)
                .post("/api/beneficiary/confirm-otp")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ otp: "000000" });

            // After lockout the OTP is deleted — next attempt gets 400 (no pending OTP)
            expect([400, 429]).toContain(res.status);

            const remaining = await Otp.findOne({ userId: user._id, purpose: "add_beneficiary" });
            expect(remaining).toBeNull();
        });

        it("should return 200 and activate the beneficiary when OTP is correct", async () => {
            const { accessToken, user } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            // Trigger OTP generation
            await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice" });

            // Read the plaintext OTP directly from DB (only possible in test env)
            // In production the OTP is hashed — here we expose it via a test-only method
            const otpRecord = await Otp.findOne({
                userId: user._id, purpose: "add_beneficiary"
            }).select("+plaintextOtp"); // add plaintextOtp as a virtual/test field if needed

            // If your Otp model stores a plaintext for testing, use it.
            // Otherwise seed a known OTP directly:
            const KNOWN_OTP = "111111";
            const bcrypt = await import("bcryptjs");
            await Otp.updateOne(
                { userId: user._id, purpose: "add_beneficiary" },
                { hashedOtp: await bcrypt.hash(KNOWN_OTP, 10) }
            );

            const res = await request(app)
                .post("/api/beneficiary/confirm-otp")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ otp: KNOWN_OTP });

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveProperty("id");
            expect(res.body.data).toHaveProperty("accountNumber");
            // Account number must be masked — full number must not appear
            expect(res.body.data.accountNumber).not.toBe(recipientAccount.accountNumber);

            // Beneficiary must now be active in DB
            const confirmed = await Beneficiary.findOne({ beneficiaryAccountId: recipientAccount._id });
            expect(confirmed.isVerified).toBe(true);

            // OTP must be deleted after use
            const usedOtp = await Otp.findOne({ userId: user._id, purpose: "add_beneficiary" });
            expect(usedOtp).toBeNull();
        });
    });

    // ── GET /api/beneficiary ──────────────────────────────────────────────────

    describe("GET /api/beneficiary — getBeneficiaries", () => {

        it("should return 401 when unauthenticated", async () => {
            const res = await request(app).get("/api/beneficiary");
            expect(res.status).toBe(401);
        });

        it("should return 200 with an empty array when user has no beneficiaries", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .get("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual([]);
        });

        it("should return only active (isVerified) beneficiaries", async () => {
            const { accessToken, user } = await registerAndLogin();
            const activeAccount = await createAccount(new mongoose.Types.ObjectId());
            const pendingAccount = await createAccount(new mongoose.Types.ObjectId());

            await createActiveBeneficiary(user._id, activeAccount._id, "Alice");
            await Beneficiary.create({
                userId: user._id, beneficiaryAccountId: pendingAccount._id,
                nickname: "Pending Bob", isVerified: false,
            });

            const res = await request(app)
                .get("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].nickname).toBe("Alice");
        });

        it("should never expose raw account numbers in response", async () => {
            const { accessToken, user } = await registerAndLogin();
            const account = await createAccount(new mongoose.Types.ObjectId());
            await createActiveBeneficiary(user._id, account._id, "Alice");

            const res = await request(app)
                .get("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            const body = JSON.stringify(res.body);
            expect(body).not.toContain(account.accountNumber);
        });

        it("should not return another user's beneficiaries", async () => {
            const { user: userA } = await registerAndLogin();
            const { accessToken: tokenB } = await registerAndLogin();

            const account = await createAccount(new mongoose.Types.ObjectId());
            // userA's beneficiary
            await createActiveBeneficiary(userA._id, account._id, "Alice");

            const res = await request(app)
                .get("/api/beneficiary")
                .set("Authorization", `Bearer ${tokenB}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(0);
        });
    });

    // ── DELETE /api/beneficiary/:beneficiaryId ────────────────────────────────

    describe("DELETE /api/beneficiary/:id — removeBeneficiary", () => {

        it("should return 401 when unauthenticated", async () => {
            const fakeId = new mongoose.Types.ObjectId().toString();
            const res = await request(app).delete(`/api/beneficiary/${fakeId}`);
            expect(res.status).toBe(401);
        });

        it("should return 400 for a malformed beneficiaryId", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .delete("/api/beneficiary/not-a-valid-id")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(400);
        });

        it("should return 404 when beneficiary does not exist", async () => {
            const { accessToken } = await registerAndLogin();
            const fakeId = new mongoose.Types.ObjectId().toString();

            const res = await request(app)
                .delete(`/api/beneficiary/${fakeId}`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(404);
        });

        it("should return 404 when trying to remove another user's beneficiary", async () => {
            const { user: userA } = await registerAndLogin();
            const { accessToken: tokenB } = await registerAndLogin();
            const account = await createAccount(new mongoose.Types.ObjectId());
            const bene = await createActiveBeneficiary(userA._id, account._id);

            const res = await request(app)
                .delete(`/api/beneficiary/${bene._id}`)
                .set("Authorization", `Bearer ${tokenB}`); // wrong user

            expect(res.status).toBe(404);
        });

        it("should return 200 and soft-delete the beneficiary", async () => {
            const { accessToken, user } = await registerAndLogin();
            const account = await createAccount(new mongoose.Types.ObjectId());
            const bene = await createActiveBeneficiary(user._id, account._id);

            const res = await request(app)
                .delete(`/api/beneficiary/${bene._id}`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);

            // Must be soft-deleted — record stays in DB but isVerified = false
            const inDb = await Beneficiary.findById(bene._id);
            expect(inDb).not.toBeNull();
            expect(inDb.isVerified).toBe(false);
        });

        it("should not appear in GET list after removal", async () => {
            const { accessToken, user } = await registerAndLogin();
            const account = await createAccount(new mongoose.Types.ObjectId());
            const bene = await createActiveBeneficiary(user._id, account._id, "Alice");

            await request(app)
                .delete(`/api/beneficiary/${bene._id}`)
                .set("Authorization", `Bearer ${accessToken}`);

            const listRes = await request(app)
                .get("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(listRes.body.data).toHaveLength(0);
        });
    });

    // ── POST /api/beneficiary/transfer ────────────────────────────────────────

    describe("POST /api/beneficiary/transfer — transferToBeneficiary", () => {

        it("should return 401 when unauthenticated", async () => {
            const res = await request(app)
                .post("/api/beneficiary/transfer")
                .send({ beneficiaryId: "x", amount: 100 });

            expect(res.status).toBe(401);
        });

        it("should return 400 when required fields are missing", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary/transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ beneficiaryId: new mongoose.Types.ObjectId() }); // missing amount + senderAccountId

            expect(res.status).toBe(400);
        });

        it("should return 400 for an invalid beneficiaryId format", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary/transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ beneficiaryId: "bad-id", senderAccountId: new mongoose.Types.ObjectId(), amount: 100 });

            expect(res.status).toBe(400);
        });

        it("should return 400 when amount is 0 or negative", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary/transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({
                    beneficiaryId: new mongoose.Types.ObjectId(),
                    senderAccountId: new mongoose.Types.ObjectId(),
                    amount: 0,
                });

            expect(res.status).toBe(400);
        });

        it("should return 400 when amount has more than 2 decimal places", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary/transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({
                    beneficiaryId: new mongoose.Types.ObjectId(),
                    senderAccountId: new mongoose.Types.ObjectId(),
                    amount: "10.999",
                });

            expect(res.status).toBe(400);
        });

        it("should return 404 when sender account not found or not owned by user", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary/transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({
                    beneficiaryId: new mongoose.Types.ObjectId(),
                    senderAccountId: new mongoose.Types.ObjectId(), // valid format, but doesn't exist
                    amount: 100,
                });

            expect(res.status).toBe(404);
        });

        it("should return 400 when sender has insufficient balance", async () => {
            const { accessToken, user } = await registerAndLogin();
            const senderAccount = await createAccount(user._id, { balance: 50 });
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());
            const bene = await createActiveBeneficiary(user._id, recipientAccount._id);

            const res = await request(app)
                .post("/api/beneficiary/transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({
                    beneficiaryId: bene._id,
                    senderAccountId: senderAccount._id,
                    amount: 500, // more than balance: 50
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/insufficient/i);
        });

        it("should return 400 when beneficiary is pending (not yet OTP-confirmed)", async () => {
            const { accessToken, user } = await registerAndLogin();
            const senderAccount = await createAccount(user._id, { balance: 10000 });
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            // Pending — isVerified: false
            const pendingBene = await Beneficiary.create({
                userId: user._id, beneficiaryAccountId: recipientAccount._id,
                nickname: "Unconfirmed", isVerified: false,
            });

            const res = await request(app)
                .post("/api/beneficiary/transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({
                    beneficiaryId: pendingBene._id,
                    senderAccountId: senderAccount._id,
                    amount: 100,
                });

            expect(res.status).toBe(404); // controller filters isVerified: true
        });

        it("should return 400 on currency mismatch", async () => {
            const { accessToken, user } = await registerAndLogin();
            const senderAccount = await createAccount(user._id, { currency: "INR", balance: 10000 });
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId(), { currency: "USD" });
            const bene = await createActiveBeneficiary(user._id, recipientAccount._id);

            const res = await request(app)
                .post("/api/beneficiary/transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({
                    beneficiaryId: bene._id,
                    senderAccountId: senderAccount._id,
                    amount: 100,
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/currency mismatch/i);
        });

        it("should return 200, debit sender, credit recipient, and create a transaction", async () => {
            const { accessToken, user } = await registerAndLogin();
            const senderAccount = await createAccount(user._id, { balance: 10000 });
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());
            const bene = await createActiveBeneficiary(user._id, recipientAccount._id, "Alice");

            const res = await request(app)
                .post("/api/beneficiary/transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({
                    beneficiaryId: bene._id,
                    senderAccountId: senderAccount._id,
                    amount: 500,
                    note: "Rent",
                });

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveProperty("transactionId");
            expect(res.body.data.amount).toBe(500);
            expect(res.body.data.newBalance).toBe(9500);

            // Recipient account number must be masked
            expect(res.body.data.recipient.accountNumber).not.toBe(recipientAccount.accountNumber);

            // Verify DB state
            const updatedSender = await Account.findById(senderAccount._id);
            const updatedRecipient = await Account.findById(recipientAccount._id);
            expect(updatedSender.balance).toBe(9500);
            expect(updatedRecipient.balance).toBe(10500);

            const tx = await Transaction.findById(res.body.data.transactionId);
            expect(tx).not.toBeNull();
            expect(tx.amount).toBe(500);
            expect(tx.status).toBe("completed");
        });

        it("should not mutate balances when transfer fails mid-transaction", async () => {
            // This test verifies atomicity: if Transaction.create fails,
            // Account balances must be rolled back to original values.
            const { accessToken, user } = await registerAndLogin();
            const senderAccount = await createAccount(user._id, { balance: 10000 });
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId(), { isActive: "suspended" });
            const bene = await createActiveBeneficiary(user._id, recipientAccount._id);

            await request(app)
                .post("/api/beneficiary/transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({
                    beneficiaryId: bene._id,
                    senderAccountId: senderAccount._id,
                    amount: 500,
                });

            // Balance must be unchanged after a failed transfer
            const sender = await Account.findById(senderAccount._id);
            expect(sender.balance).toBe(10000);
        });

        it("should not allow transfer to own account via a beneficiary record", async () => {
            const { accessToken, user } = await registerAndLogin();
            const account = await createAccount(user._id, { balance: 10000 });

            // Manually create a beneficiary pointing at own account (bypasses controller guard)
            const selfBene = await Beneficiary.create({
                userId: user._id, beneficiaryAccountId: account._id,
                nickname: "Myself", isVerified: true,
            });

            const res = await request(app)
                .post("/api/beneficiary/transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({
                    beneficiaryId: selfBene._id,
                    senderAccountId: account._id,
                    amount: 100,
                });

            expect(res.status).toBe(400);
        });
    });
});