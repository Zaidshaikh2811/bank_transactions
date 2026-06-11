// import { describe, it, expect, beforeEach, vi } from "vitest";
// import { register, login, logout } from "../src/controller/auth.controller.js";
// import User from "../src/models/user.model.js";
// import RefreshToken from "../src/models/refreshToken.model.js";
// import { emailQueue } from "../src/queues/emailQueue.js";

// vi.mock("../src/models/user.model.js");
// vi.mock("../src/models/refreshToken.model.js");

// vi.mock("../src/queues/emailQueue.js", () => ({
//     emailQueue: {
//         add: vi.fn()
//     }
// }));

// const mockRes = () => {
//     const res = {};

//     res.cookie = vi.fn();
//     res.clearCookie = vi.fn();
//     res.status = vi.fn().mockReturnThis();
//     res.json = vi.fn().mockReturnThis();

//     return res;
// };

// describe("Auth Controller", () => {

//     beforeEach(() => {
//         vi.clearAllMocks();
//     });

//     describe("register", () => {

//         it("should register a new user", async () => {

//             const req = {
//                 body: {
//                     name: "Zaid",
//                     email: "zaid@test.com",
//                     password: "Password123",
//                     phone: "9876543210"
//                 }
//             };

//             const res = mockRes();

//             User.findOne.mockResolvedValue(null);

//             User.create.mockResolvedValue({
//                 _id: "user123",
//                 name: "Zaid",
//                 email: "zaid@test.com",
//                 phone: "9876543210",
//                 balance: 0
//             });

//             await register(req, res);

//             expect(User.findOne).toHaveBeenCalledWith({
//                 email: "zaid@test.com"
//             });

//             expect(User.create).toHaveBeenCalled();

//             expect(emailQueue.add).toHaveBeenCalledWith(
//                 "welcome",
//                 { email: "zaid@test.com" },
//                 expect.any(Object)
//             );
//         });

//         it("should throw if email already exists", async () => {

//             const req = {
//                 body: {
//                     name: "Zaid",
//                     email: "zaid@test.com",
//                     password: "Password123",
//                     phone: "9876543210"
//                 }
//             };

//             User.findOne.mockResolvedValue({
//                 _id: "existing-user"
//             });

//             await expect(register(req, mockRes()))
//                 .rejects
//                 .toThrow("Email already in use");
//         });
//     });

//     describe("login", () => {

//         it("should login successfully", async () => {

//             const req = {
//                 body: {
//                     email: "zaid@test.com",
//                     password: "Password123"
//                 }
//             };

//             const res = mockRes();

//             const mockUser = {
//                 _id: "user123",
//                 name: "Zaid",
//                 email: "zaid@test.com",
//                 balance: 1000,
//                 comparePassword: vi.fn().mockResolvedValue(true),
//                 generateAccessToken: vi.fn().mockReturnValue("access-token"),
//                 generateRefreshToken: vi.fn().mockReturnValue("refresh-token")
//             };

//             User.findOne.mockReturnValue({
//                 select: vi.fn().mockResolvedValue(mockUser)
//             });

//             RefreshToken.create.mockResolvedValue({});

//             await login(req, res);

//             expect(mockUser.comparePassword).toHaveBeenCalledWith(
//                 "Password123"
//             );

//             expect(RefreshToken.create).toHaveBeenCalled();

//             expect(res.cookie).toHaveBeenCalled();
//         });

//         it("should reject invalid password", async () => {

//             const req = {
//                 body: {
//                     email: "zaid@test.com",
//                     password: "wrong-password"
//                 }
//             };

//             const mockUser = {
//                 comparePassword: vi.fn().mockResolvedValue(false)
//             };

//             User.findOne.mockReturnValue({
//                 select: vi.fn().mockResolvedValue(mockUser)
//             });

//             await expect(login(req, mockRes()))
//                 .rejects
//                 .toThrow("Invalid credentials");
//         });
//     });

//     describe("logout", () => {

//         it("should revoke refresh token and clear cookie", async () => {

//             const req = {
//                 headers: {
//                     cookie: "refreshToken=test-token"
//                 }
//             };

//             const res = mockRes();

//             RefreshToken.findOneAndUpdate.mockResolvedValue({});

//             await logout(req, res);

//             expect(
//                 RefreshToken.findOneAndUpdate
//             ).toHaveBeenCalledWith(
//                 { token: "test-token" },
//                 { isRevoked: true }
//             );

//             expect(res.clearCookie).toHaveBeenCalled();
//         });
//     });
// });