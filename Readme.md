#  Bank Transactions API

A production-grade banking and financial transaction backend built with **Node.js**, **Express**, **MongoDB**, and **Redis**. Implements secure double-entry bookkeeping, idempotent transfers, distributed locking, async email notifications, and a full JWT-based auth system with token versioning and refresh token family tracking.

---

##  Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Architecture Overview](#-architecture-overview)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [API Reference](#-api-reference)
- [Authentication & Security](#-authentication--security)
- [Transaction Engine](#-transaction-engine)
- [Double-Entry Ledger](#-double-entry-ledger)
- [Email Queue](#-email-queue)
- [CI/CD](#-cicd)
- [Database Indexes](#-database-indexes)
- [Testing](#-testing)
- [Error Handling](#-error-handling)

---

##  Features

- **JWT Authentication** — Access + refresh tokens, token versioning, per-device session invalidation
- **Refresh Token Family Tracking** — Reuse detection invalidates entire compromised session chain
- **Atomic Transfers** — MongoDB transactions with Mongoose optimistic concurrency locking
- **Distributed Locking** — Redis-based per-account locks to prevent race conditions under concurrent load
- **Idempotent Operations** — Idempotency keys on transfers prevent double-processing on retry
- **Double-Entry Ledger** — Every financial movement recorded as immutable `LedgerEntry` pairs
- **Integer Cent Arithmetic** — All monetary values stored and processed as integer cents; `fromCents()` only at output boundaries
- **Async Email Notifications** — BullMQ + Redis queue with a consolidated worker for all email job types
- **Cluster Mode** — Node.js `cluster` module for multi-core utilization
- **Security Hardening** — CORS allowlist, scoped rate limiters, gzip compression, request timeouts
- **Balance Verification** — On-demand ledger reconciliation controller

---

##  Tech Stack
| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express |
| Database | MongoDB Atlas + Mongoose |
| Cache / Locks | Redis |
| Job Queue | BullMQ |
| Auth | JWT (access + refresh), bcrypt |
| Email | Nodemailer |
| Testing | Vitest + Supertest |
| CI/CD | GitHub Actions + Docker + Railway |

---

##  Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Client (HTTP)                     │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│              Express App  (cluster)                  │
│  ┌─────────────┐  ┌───────────────┐  ┌───────────┐  │
│  │ Rate Limiter│  │  Auth Middleware│  │   CORS    │  │
│  └─────────────┘  └───────────────┘  └───────────┘  │
└───────────────────────┬─────────────────────────────┘
                        │
          ┌─────────────┴──────────────┐
          │                            │
┌─────────▼─────────┐       ┌──────────▼──────────┐
│  Auth Routes       │       │  Transaction Routes  │
│  /auth/*           │       │  /accounts/*         │
│                    │       │  /transactions/*      │
└─────────┬─────────┘       └──────────┬──────────┘
          │                            │
┌─────────▼────────────────────────────▼───────────┐
│                  Controllers                       │
│  authController  │  depositController             │
│  tokenController │  withdrawController             │
│                  │  transferController             │
│                  │  verifyBalanceController        │
└─────────┬────────────────────────────┬───────────┘
          │                            │
┌─────────▼──────────┐    ┌────────────▼────────────┐
│   MongoDB Atlas     │    │         Redis            │
│  ┌──────────────┐  │    │  ┌────────────────────┐  │
│  │    User      │  │    │  │  Distributed Locks  │  │
│  │   Account    │  │    │  │  BullMQ Queues      │  │
│  │ Transaction  │  │    │  └────────────────────┘  │
│  │ LedgerEntry  │  │    └─────────────────────────┘
│  │ RefreshToken │  │
│  └──────────────┘  │
└────────────────────┘
          │
┌─────────▼──────────────────────────────────────────┐
│               BullMQ Email Worker                   │
│   welcome_email | otp_email | transaction_email     │
│                  Nodemailer (SMTP)                   │
└─────────────────────────────────────────────────────┘
```

---

##  Project Structure

```
bank_transactions/
├── src/
│   ├── config/
│   │   ├── db.js                  # MongoDB Atlas connection
│   │   └── redis.js               # Redis client setup
│   ├── controllers/
│   │   ├── auth.controller.js     # Register, login, logout, refresh
│   │   ├── deposit.controller.js
│   │   ├── withdrawal.controller.js
│   │   ├── transfer.controller.js # Atomic transfer with Redis lock
│   │   └── verifyBalance.controller.js
│   ├── middleware/
│   │   ├── auth.middleware.js     # JWT verification + DB validation
│   │   └── rateLimiter.js        # Scoped rate limiters per route group
│   ├── models/
│   │   ├── User.js
│   │   ├── Account.js             # optimisticConcurrency: true
│   │   ├── Transaction.js
│   │   ├── LedgerEntry.js         # Immutable double-entry records
│   │   └── RefreshToken.js        # family + tokenVersion fields
│   ├── queues/
│   │   ├── emailQueue.js          # BullMQ queue definition
│   │   └── emailWorker.js         # Single consolidated worker
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── account.routes.js
│   │   └── transaction.routes.js
│   ├── utils/
│   │   ├── money.js               # toCents() / fromCents() helpers
│   │   ├── generateTokens.js
│   │   └── redisLock.js
│   ├── migrations/
│   │   └── indexes.js             # Idempotency key + query indexes
│   └── app.js                     # Express setup, cluster, compression
├── tests/
│   └── auth.test.js               # Vitest + Supertest auth suite
├── .github/
│   └── workflows/
│       └── ci.yml                 # GitHub Actions pipeline
├── .env.example
├── Dockerfile
└── package.json
```

---

##  Getting Started

### Prerequisites

- Node.js ≥ 18
- MongoDB Atlas cluster (or local MongoDB with replica set for transactions)
- Redis instance

### Installation

```bash
git clone https://github.com/Zaidshaikh2811/bank_transactions.git
cd bank_transactions
git checkout features
npm install
```

### Run Migrations (indexes)

```bash
node src/migrations/indexes.js
```

### Start Development Server

```bash
npm run dev
```

### Start Production (cluster mode)

```bash
npm start
```

---

##  Environment Variables

Create a `.env` file in the project root. Reference `.env.example`:

```env
# Server
PORT=5000
NODE_ENV=development

# MongoDB
MONGO_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/bank_transactions

# Redis
REDIS_URL=redis://localhost:6379

# JWT
ACCESS_TOKEN_SECRET=your_access_token_secret
REFRESH_TOKEN_SECRET=your_refresh_token_secret
ACCESS_TOKEN_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d

# Email (SMTP)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=your_smtp_password
EMAIL_FROM=no-reply@bankapp.com

# CORS
ALLOWED_ORIGINS=http://localhost:3000,https://yourfrontend.com
```

---

##  API Reference

### Auth Routes — `/api/auth`

| Method | Endpoint | Auth Required | Description |
|--------|----------|:---:|---|
| `POST` | `/register` | ❌ | Register new user; enqueues welcome email |
| `POST` | `/login` | ❌ | Login; returns access + refresh tokens |
| `POST` | `/logout` | ✅ | Revokes current refresh token |
| `POST` | `/refresh` | ❌ | Rotates refresh token; detects family reuse |
| `POST` | `/logout-all` | ✅ | Revokes all sessions (increments tokenVersion) |
| `POST` | `/verify-otp` | ❌ | Verifies email OTP; activates account |
| `POST` | `/resend-otp` | ❌ | Resends OTP email via queue |

### Account Routes — `/api/accounts`

| Method | Endpoint | Auth Required | Description |
|--------|----------|:---:|---|
| `POST` | `/` | ✅ | Create a new bank account |
| `GET` | `/` | ✅ | List all accounts for authenticated user |
| `GET` | `/:accountId` | ✅ | Get account details + current balance |
| `GET` | `/:accountId/verify-balance` | ✅ | Reconcile balance against ledger entries |

### Transaction Routes — `/api/transactions`

| Method | Endpoint | Auth Required | Description |
|--------|----------|:---:|---|
| `POST` | `/deposit` | ✅ | Deposit funds into an account |
| `POST` | `/withdraw` | ✅ | Withdraw funds from an account |
| `POST` | `/transfer` | ✅ | Atomic transfer between two accounts |
| `GET` | `/history/:accountId` | ✅ | Paginated transaction history |

### Request / Response Examples

#### Transfer

```http
POST /api/transactions/transfer
Authorization: Bearer <access_token>
Content-Type: application/json
Idempotency-Key: <uuid>

{
  "fromAccountId": "64a1...",
  "toAccountId": "64b2...",
  "amount": 150.00,
  "description": "Rent payment"
}
```

```json
{
  "success": true,
  "message": "Transfer successful",
  "data": {
    "transactionId": "64c3...",
    "fromBalance": "850.00",
    "toBalance": "1150.00",
    "amount": "150.00",
    "timestamp": "2025-06-21T10:00:00.000Z"
  }
}
```

---

##  Authentication & Security

### Token Flow

```
Login ──► Access Token (15m)  ──► API requests (Authorization: Bearer)
     └──► Refresh Token (7d)  ──► POST /auth/refresh ──► New token pair
```

- Access tokens are **never stored** in the database. They are verified purely by JWT signature + expiry.
- Refresh tokens are stored in the `RefreshToken` collection with:
  - `family` — UUID grouping all tokens in a session chain
  - `isRevoked` — flipped to `true` on rotation or logout
  - `tokenVersion` — matched against `User.tokenVersion` for mass invalidation

### Refresh Token Family Tracking

On reuse detection (a token that has already been rotated is presented again):
1. The entire token family is invalidated with a single `updateMany`
2. The user is forced to log in again on all devices
3. This scopes the blast radius to the compromised session only, not all user sessions

### Auth Middleware

Every protected route verifies:
1. `Authorization: Bearer <token>` header presence
2. JWT signature and expiry
3. User exists in DB (`isActive: true`, `isVerified: true`)
4. `tokenVersion` matches (catches `logout-all` invalidations)

---

##  Transaction Engine

### Money Handling

All monetary values are stored and processed as **integer cents** throughout the system. Floating-point is never used for arithmetic.

```js
// utils/money.js
const toCents   = (amount) => Math.round(amount * 100);   // input boundary
const fromCents = (cents)  => (cents / 100).toFixed(2);   // output boundary only
```

### Atomic Transfer with Distributed Locking

The transfer controller:

1. Acquires **Redis locks** on both accounts (sorted by ID to prevent deadlocks)
2. Opens a **MongoDB session** and calls `withTransaction`
3. Validates both accounts: `isActive === "active"`, ownership, sufficient balance
4. Updates both `Account` documents with Mongoose **optimistic concurrency** (`optimisticConcurrency: true`)
5. Creates `Transaction` records and paired `LedgerEntry` documents within the same session
6. Releases locks in `finally` block

If any step fails, the MongoDB transaction aborts and locks are released — no partial state is possible.

### Idempotency

Transfer requests include an `Idempotency-Key` header. The key is stored in the `Transaction` collection and checked before processing, ensuring retried requests return the original result without re-executing.

---

##  Double-Entry Ledger

Every monetary movement creates **two immutable `LedgerEntry` documents**:

| Field | Description |
|---|---|
| `accountId` | The account affected |
| `transactionId` | Links to the parent `Transaction` |
| `type` | `"debit"` or `"credit"` |
| `amountCents` | Integer cents |
| `balanceAfterCents` | Running balance snapshot |
| `description` | Human-readable memo |
| `createdAt` | Immutable timestamp |

The `verifyBalance` controller reconciles the account's current balance against the sum of all ledger entries to detect any discrepancy.

---

##  Email Queue

Email delivery is fully decoupled from request handling via **BullMQ + Redis**.

### Job Types (single consolidated worker)

| Job Type | Trigger |
|---|---|
| `welcome_email` | User registration |
| `otp_email` | OTP send / resend |
| `transaction_email` | Deposit, withdrawal, transfer |

### Adding a Job

```js
import { emailQueue } from '../queues/emailQueue.js';

await emailQueue.add('otp_email', {
  to: user.email,
  otp: generatedOtp,
  name: user.name,
});
```

The worker processes all job types in `emailWorker.js` using a `switch` on `job.name`, with retry and backoff configured at the queue level.

---

##  CI/CD

GitHub Actions pipeline (`.github/workflows/ci.yml`):

```
Push to features / PR to main
        │
        ▼
   Install deps
        │
        ▼
   Run test suite (Vitest)
        │
        ▼
   Docker build & push
        │
        ▼
   Deploy to Railway
```

The Docker image is built from the repo root `Dockerfile`. Railway picks up the image and applies environment variables from the project dashboard.

---

##  Database Indexes

Run `node src/migrations/indexes.js` to apply all indexes idempotently:

| Collection | Index | Purpose |
|---|---|---|
| `transactions` | `{ idempotencyKey: 1 }` unique | Prevent duplicate transfers |
| `transactions` | `{ accountId: 1, createdAt: -1 }` | Fast paginated history |
| `refreshtokens` | `{ token: 1 }` unique | Token lookup |
| `refreshtokens` | `{ family: 1 }` | Family-wide revocation |
| `refreshtokens` | `{ userId: 1 }` | User session listing |
| `ledgerentries` | `{ accountId: 1, createdAt: 1 }` | Balance reconciliation |
| `users` | `{ email: 1 }` unique | Login / registration |

---

##  Testing

Tests use **Vitest** and **Supertest** against a real Express app instance.

```bash
npm test
```

The auth test suite (`tests/auth.test.js`) covers:

- Successful registration and login
- Duplicate email rejection
- Invalid credential handling
- Token refresh and rotation
- Refresh token reuse detection
- Logout (single session + all sessions)
- OTP verification flows
- Protected route access with valid/invalid/expired tokens

---

##  Error Handling

All controllers use a consistent error response shape:

```json
{
  "success": false,
  "message": "Human-readable error description",
  "code": "INSUFFICIENT_FUNDS"
}
```

Common error codes:

| Code | HTTP Status | Meaning |
|---|---|---|
| `ACCOUNT_NOT_FOUND` | 404 | Account does not exist |
| `ACCOUNT_SUSPENDED` | 403 | Account status is not `"active"` |
| `INSUFFICIENT_FUNDS` | 422 | Balance too low for withdrawal/transfer |
| `INVALID_TOKEN` | 401 | JWT invalid or expired |
| `TOKEN_REUSE_DETECTED` | 401 | Refresh token family compromised |
| `IDEMPOTENCY_CONFLICT` | 409 | Duplicate transfer request |
| `LOCK_TIMEOUT` | 503 | Could not acquire Redis account lock |

---

##  License

MIT

---

##  Author

**Mohammad Zaid**
[GitHub @Zaidshaikh2811](https://github.com/Zaidshaikh2811)