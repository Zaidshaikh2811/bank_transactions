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
import LedgerEntry from "../src/models/ledger.model.js";
import crypto from "crypto";
import "dotenv/config";

// ─── Helpers ────────────────────────────────────────────────────────────────

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

    // Verify the account so auth middleware passes
    await request(app).patch("/api/auth/verify").set("Authorization", `Bearer ${loginRes.body.data?.accessToken}`);

    const user = await User.findOne({ email: payload.email }).lean();

    return { accessToken, user };
};

/**
 * Note: Account.create() with an array returns an array.
 * We return the first element so callers get a plain document.
 */
const createAccount = async (userId, overrides = {}) => {
    const docs = await Account.create([{
        userId,
        accountNumber: `ACC${Date.now()}${Math.floor(Math.random() * 9999)}`,
        accountType: "savings",
        currency: "INR",
        isActive: "active",
        balance: 10000,
        idempotencyKey: crypto.randomUUID(),
        ...overrides,
    }]);
    return docs[0];
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
        await LedgerEntry.deleteMany({});
    });


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

            console.log("Response body:", res.body);

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
            const { accessToken } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .set("X-Idempotency-Key", crypto.randomUUID())
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "A" });
            console.log("Response body:", res.body);

            expect(res.body.statusCode).toBe(400);
        });

        it("should return 400 when nickname contains invalid characters", async () => {
            const { accessToken } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());
            console.log("Testing with nickname: Alice<>");
            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .set("X-Idempotency-Key", crypto.randomUUID()) // ensure this test is idempotent
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice<>" });

            console.log("Response body:", res.body);
            expect(res.body.statusCode).toBe(400);
        });

        it("should return 404 when beneficiary account does not exist", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .set("X-Idempotency-Key", crypto.randomUUID()) // ensure this test is idempotent
                .send({ accountNumber: "NONEXISTENT999", nickname: "Ghost" });

            expect(res.status).toBe(404);
        });

        it("should return 400 when trying to add own account as beneficiary", async () => {
            const { accessToken, user } = await registerAndLogin();
            const ownAccount = await createAccount(user._id);

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .set("X-Idempotency-Key", crypto.randomUUID()) // ensure this test is idempotent
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
                .set("X-Idempotency-Key", crypto.randomUUID()) // ensure this test is idempotent
                .send({ accountNumber: suspendedAccount.accountNumber, nickname: "Bob" });

            expect(res.status).toBe(400);
        });

        it("should return 409 when an active (isVerified) beneficiary already exists", async () => {
            const { accessToken, user } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            await createActiveBeneficiary(user._id, recipientAccount._id);

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .set("X-Idempotency-Key", crypto.randomUUID()) // ensure this test is idempotent
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice Again" });

            expect(res.status).toBe(409);
        });

        it("should return 201, create a PENDING beneficiary, and send OTP", async () => {
            const { accessToken } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .set("X-Idempotency-Key", crypto.randomUUID())
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice" });

            expect(res.status).toBe(201);
            expect(res.body.data).toHaveProperty("maskedContact");
            expect(res.body.data).toHaveProperty("expiresInMinutes");

            const saved = await Beneficiary.findOne({ beneficiaryAccountId: recipientAccount._id });
            expect(saved).not.toBeNull();
            expect(saved.isVerified).toBe(false);
        });

        it("should re-use and update a previously removed (isVerified=false) beneficiary", async () => {
            const { accessToken, user } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            // Seed a removed beneficiary
            await Beneficiary.create({
                userId: user._id,
                beneficiaryAccountId: recipientAccount._id,
                nickname: "Old",
                isVerified: false,
            });

            const res = await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .set("X-Idempotency-Key", `test-${Date.now()}`)
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice New" });

            // Should NOT 409 — re-activates the existing record
            expect([200, 201]).toContain(res.status);

            // Nickname must be updated
            const updated = await Beneficiary.findOne({ beneficiaryAccountId: recipientAccount._id });
            expect(updated.nickname).toBe("Alice New");
        });
    });


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

        it("should return 400 for a wrong OTP", async () => {
            const { accessToken, user } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            // Kick off the OTP flow so a real hashed OTP is stored
            await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice" });

            const res = await request(app)
                .post("/api/beneficiary/confirm-otp")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ otp: "000000" }); // wrong OTP
            ;
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/incorrect otp/i);

            // Attempts counter must have been incremented
            const record = await Otp.findOne({ userId: user._id, purpose: "add_beneficiary" });
            expect(record.attempts).toBe(1);
        });

        it("should return 429 and delete the OTP after 3 wrong attempts", async () => {
            const { accessToken, user } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice" });

            for (let i = 0; i < 3; i++) {
                await request(app)
                    .post("/api/beneficiary/confirm-otp")
                    .set("Authorization", `Bearer ${accessToken}`)
                    .send({ otp: "000000" });
            }

            // 4th attempt — OTP is deleted after 3 failures, so next call gets 400 (no pending OTP)
            const res = await request(app)
                .post("/api/beneficiary/confirm-otp")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ otp: "000000" });

            expect([400, 429]).toContain(res.status);

            const remaining = await Otp.findOne({ userId: user._id, purpose: "add_beneficiary" });
            expect(remaining).toBeNull();
        });

        it("should return 200, activate the beneficiary, and delete the OTP on correct code", async () => {
            const { accessToken, user } = await registerAndLogin();
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            // Trigger OTP generation
            await request(app)
                .post("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ accountNumber: recipientAccount.accountNumber, nickname: "Alice" });

            // Overwrite the stored hash with a known value so the test is deterministic
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

            // Account number must be masked — full number must NOT appear
            expect(res.body.data.accountNumber).not.toBe(recipientAccount.accountNumber);

            // Beneficiary must now be active in DB
            const confirmed = await Beneficiary.findOne({
                beneficiaryAccountId: recipientAccount._id,
            });
            expect(confirmed.isVerified).toBe(true);

            // OTP must be deleted after successful use
            const usedOtp = await Otp.findOne({ userId: user._id, purpose: "add_beneficiary" });
            expect(usedOtp).toBeNull();
        });
    });


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

        it("should return only active (isVerified=true) beneficiaries", async () => {
            const { accessToken, user } = await registerAndLogin();
            const activeAccount = await createAccount(new mongoose.Types.ObjectId());
            const pendingAccount = await createAccount(new mongoose.Types.ObjectId());

            await createActiveBeneficiary(user._id, activeAccount._id, "Alice");
            await Beneficiary.create({
                userId: user._id,
                beneficiaryAccountId: pendingAccount._id,
                nickname: "Pending Bob",
                isVerified: false,
            });

            const res = await request(app)
                .get("/api/beneficiary")
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].nickname).toBe("Alice");
        });

        it("should never expose raw account numbers in the response", async () => {
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
            await createActiveBeneficiary(userA._id, account._id, "Alice");

            const res = await request(app)
                .get("/api/beneficiary")
                .set("Authorization", `Bearer ${tokenB}`);

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(0);
        });
    });


    describe("DELETE /api/beneficiary/:beneficiaryId — removeBeneficiary", () => {

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

        it("should return 200 and soft-delete (isVerified → false) the beneficiary", async () => {
            const { accessToken, user } = await registerAndLogin();
            const account = await createAccount(new mongoose.Types.ObjectId());
            const bene = await createActiveBeneficiary(user._id, account._id);

            const res = await request(app)
                .delete(`/api/beneficiary/${bene._id}`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(200);

            // Record stays in DB but must be marked inactive
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

            expect(listRes.status).toBe(200);
            expect(listRes.body.data).toHaveLength(0);
        });

        it("should return 404 when trying to remove an already-removed beneficiary", async () => {
            const { accessToken, user } = await registerAndLogin();
            const account = await createAccount(new mongoose.Types.ObjectId());
            // isVerified: false — the controller filters on isVerified: true
            const bene = await Beneficiary.create({
                userId: user._id,
                beneficiaryAccountId: account._id,
                nickname: "Gone",
                isVerified: false,
            });

            const res = await request(app)
                .delete(`/api/beneficiary/${bene._id}`)
                .set("Authorization", `Bearer ${accessToken}`);

            expect(res.status).toBe(404);
        });
    });


    describe("POST /api/beneficiary/beneficiary-transfer — transferToBeneficiary", () => {

        it("should return 401 when unauthenticated", async () => {
            const res = await request(app)
                .post("/api/beneficiary/beneficiary-transfer").set("X-Idempotency-Key", crypto.randomUUID())
                .send({ beneficiaryId: "x", amount: 100 });

            expect(res.status).toBe(401);
        });

        it("should return 400 when required fields are missing", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary/beneficiary-transfer").set("X-Idempotency-Key", crypto.randomUUID())
                .set("Authorization", `Bearer ${accessToken}`)
                .send({ beneficiaryId: new mongoose.Types.ObjectId() }); // missing amount + senderAccountId

            expect(res.status).toBe(400);
        });

        it("should return 400 for an invalid beneficiaryId format", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary/beneficiary-transfer")
                .set("Authorization", `Bearer ${accessToken}`).set("X-Idempotency-Key", crypto.randomUUID())
                .send({
                    beneficiaryId: "bad-id",
                    senderAccountId: new mongoose.Types.ObjectId(),
                    amount: 100,
                });

            expect(res.status).toBe(400);
        });

        it("should return 400 for an invalid senderAccountId format", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary/beneficiary-transfer")
                .set("Authorization", `Bearer ${accessToken}`).set("X-Idempotency-Key", crypto.randomUUID())
                .send({
                    beneficiaryId: new mongoose.Types.ObjectId(),
                    senderAccountId: "bad-sender-id",
                    amount: 100,
                });

            expect(res.status).toBe(400);
        });

        it("should return 400 when amount is 0 or negative", async () => {
            const { accessToken } = await registerAndLogin();

            const res = await request(app)
                .post("/api/beneficiary/beneficiary-transfer")
                .set("Authorization", `Bearer ${accessToken}`).set("X-Idempotency-Key", crypto.randomUUID())
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
                .post("/api/beneficiary/beneficiary-transfer")
                .set("Authorization", `Bearer ${accessToken}`).set("X-Idempotency-Key", crypto.randomUUID())
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
                .post("/api/beneficiary/beneficiary-transfer")
                .set("Authorization", `Bearer ${accessToken}`).set("X-Idempotency-Key", crypto.randomUUID())
                .send({
                    beneficiaryId: new mongoose.Types.ObjectId(),
                    senderAccountId: new mongoose.Types.ObjectId(), // valid format, doesn't exist
                    amount: 100,
                });

            expect(res.status).toBe(404);
        });

        it("should return 404 when beneficiary not found or not verified", async () => {
            const { accessToken, user } = await registerAndLogin();
            const senderAccount = await createAccount(user._id, { balance: 10000 });

            const res = await request(app)
                .post("/api/beneficiary/beneficiary-transfer")
                .set("Authorization", `Bearer ${accessToken}`).set("X-Idempotency-Key", crypto.randomUUID())
                .send({
                    beneficiaryId: new mongoose.Types.ObjectId(), // doesn't exist
                    senderAccountId: senderAccount._id,
                    amount: 100,
                });

            expect(res.status).toBe(404);
        });

        it("should return 404 when beneficiary is pending (isVerified=false)", async () => {
            const { accessToken, user } = await registerAndLogin();
            const senderAccount = await createAccount(user._id, { balance: 10000 });
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            const pendingBene = await Beneficiary.create({
                userId: user._id,
                beneficiaryAccountId: recipientAccount._id,
                nickname: "Unconfirmed",
                isVerified: false,
            });

            const res = await request(app)
                .post("/api/beneficiary/beneficiary-transfer")
                .set("Authorization", `Bearer ${accessToken}`).set("X-Idempotency-Key", crypto.randomUUID())
                .send({
                    beneficiaryId: pendingBene._id,
                    senderAccountId: senderAccount._id,
                    amount: 100,
                });

            // Controller queries with isVerified: true — pending bene is not found → 404
            expect(res.status).toBe(404);
        });

        it.skip("should return 400 when sender has insufficient balance", async () => {
            const { accessToken, user } = await registerAndLogin();
            const senderAccount = await createAccount(user._id, { balance: 50 });
            const { user: recipientUser } = await registerAndLogin();
            const recipientAccount = await createAccount(recipientUser._id, { balance: 1000 });

            const bene = await createActiveBeneficiary(user._id, recipientAccount._id);

            const res = await request(app)
                .post("/api/beneficiary/beneficiary-transfer").set("X-Idempotency-Key", crypto.randomUUID())
                .set("Authorization", `Bearer ${accessToken}`)
                .send({
                    beneficiaryId: bene._id,
                    senderAccountId: senderAccount._id,
                    amount: 500, // exceeds balance: 50
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/insufficient/i);
        });

        it("should return 400 on currency mismatch", async () => {
            const { accessToken, user } = await registerAndLogin();
            const senderAccount = await createAccount(user._id, { currency: "INR", balance: 10000 });
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId(), { currency: "USD" });
            const bene = await createActiveBeneficiary(user._id, recipientAccount._id);

            const res = await request(app)
                .post("/api/beneficiary/beneficiary-transfer").set("X-Idempotency-Key", crypto.randomUUID())
                .set("Authorization", `Bearer ${accessToken}`)
                .send({
                    beneficiaryId: bene._id,
                    senderAccountId: senderAccount._id,
                    amount: 100,
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/currency mismatch/i);
        });

        it("should return 400 when trying to transfer to own account via a beneficiary record", async () => {
            const { accessToken, user } = await registerAndLogin();
            const account = await createAccount(user._id, { balance: 10000 });

            // Manually seed a self-referencing beneficiary (bypasses addBeneficiary guard)
            const selfBene = await Beneficiary.create({
                userId: user._id,
                beneficiaryAccountId: account._id,
                nickname: "Myself",
                isVerified: true,
            });

            const res = await request(app)
                .post("/api/beneficiary/beneficiary-transfer").set("X-Idempotency-Key", crypto.randomUUID())
                .set("Authorization", `Bearer ${accessToken}`)
                .send({
                    beneficiaryId: selfBene._id,
                    senderAccountId: account._id,
                    amount: 100,
                });

            expect(res.status).toBe(400);
        });

        it("should return 200, debit sender, credit recipient, and create a transaction", async () => {
            const { accessToken, user } = await registerAndLogin();
            const senderAccount = await createAccount(user._id, { balance: 10000 });
            const recipientAccount = await createAccount(new mongoose.Types.ObjectId());

            const bene = await createActiveBeneficiary(user._id, recipientAccount._id, "Alice");

            const res = await request(app)
                .post("/api/beneficiary/beneficiary-transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .set("X-Idempotency-Key", crypto.randomUUID())
                .send({
                    beneficiaryId: bene._id,
                    senderAccountId: senderAccount._id,
                    amount: 500,
                    note: "Rent",
                });
            console.log("Response body:", res.body);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toHaveProperty("transactionId");
            expect(res.body.data.amount).toBe(500);
            expect(res.body.data.newBalance).toBe(9500);

            expect(res.body.data.recipient.accountNumber).not.toBe(recipientAccount.accountNumber);

            const updatedSender = await Account.findById(senderAccount._id);
            const updatedRecipient = await Account.findById(recipientAccount._id);
            expect(updatedSender.balance).toBe(9500);
            expect(updatedRecipient.balance).toBe(10500);

            console.log("Transaction ID:", res.body.data);
            const tx = await Transaction.findById(res.body.data.transactionId);
            expect(tx).not.toBeNull();
            expect(tx.amount).toBe(500);
            // expect(tx.status).toBe("completed");
        });

        it("should not mutate balances when transfer fails (recipient suspended)", async () => {
            const { accessToken, user } = await registerAndLogin();
            const senderAccount = await createAccount(user._id, { balance: 10000 });
            const recipientAccount = await createAccount(
                new mongoose.Types.ObjectId(),
                { isActive: "suspended" }
            );
            const bene = await createActiveBeneficiary(user._id, recipientAccount._id);

            await request(app)
                .post("/api/beneficiary/beneficiary-transfer")
                .set("Authorization", `Bearer ${accessToken}`)
                .set("X-Idempotency-Key", crypto.randomUUID())
                .send({
                    beneficiaryId: bene._id,
                    senderAccountId: senderAccount._id,
                    amount: 500,
                });

            // Sender balance must be unchanged after a failed transfer
            const sender = await Account.findById(senderAccount._id);
            expect(sender.balance).toBe(10000);
        });
    });
});