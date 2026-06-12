# Banking Transaction Processing System

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white)
![License](https://img.shields.io/github/license/Zaidshaikh2811/bank_transactions)

A secure, scalable, and production-ready banking backend built with Node.js, Express, MongoDB, and Redis.

This project simulates real-world banking operations including account management, deposits, withdrawals, fund transfers, ledger accounting, authentication, transaction auditing, idempotency handling, background jobs, rate limiting, and CI/CD automation.

---

## Features

### Authentication & Authorization

* User Registration
* User Login
* JWT Access Tokens
* Refresh Token Rotation
* Token Reuse Detection
* Secure HTTP-Only Cookies
* Logout Support
* Role-Based Access Control (RBAC)
* Admin Account Management

### User Management

* Account Activation via Email
* Account Deactivation
* Account Reactivation
* Self Account Deactivation
* Admin Controls

### Bank Accounts

* Savings Account Creation
* Current Account Creation
* Fixed Deposit Account Creation
* Maximum Account Limit Enforcement
* One Savings Account Per User Rule
* Unique Account Number Generation
* Account Status Tracking

### Transaction Processing

* Deposit Funds
* Withdraw Funds
* Transfer Funds
* Balance Verification
* Transaction History
* Transaction Lookup

### Ledger System

Every financial operation generates immutable ledger entries.

**Capabilities:**

* Credit Entries
* Debit Entries
* Balance Before Tracking
* Balance After Tracking
* Transaction Linking
* Complete Audit Trail

### Reliability Features

#### Idempotency Support

Prevents duplicate financial operations.

```http
X-Idempotency-Key: unique-request-id
```

Supported for:

* Account Creation
* Deposits
* Withdrawals
* Transfers

#### Database Transactions

MongoDB Transactions ensure:

* Atomic Transfers
* Consistent Balances
* Reliable Ledger Creation
* Failure Recovery

### Background Jobs

Powered by BullMQ and Redis.

#### Email Events

* Welcome Email
* Account Creation Notification
* Deposit Notification
* Withdrawal Notification
* Transfer Notification

### Security

* JWT Authentication
* Refresh Token Rotation
* Token Reuse Detection
* Rate Limiting
* Helmet Security Headers
* CORS Protection
* Password Hashing (bcrypt)
* Secure Cookies
* Input Validation
* Protected Routes

### Scalability

Node.js Cluster Mode enabled.

**Features**

* Multi-Core CPU Utilization
* Automatic Worker Respawn
* Production-Ready Process Management

### Testing

Implemented using:

* Vitest
* Supertest

Coverage includes:

* Authentication Flows
* Business Logic
* Transactions
* API Endpoints

### CI/CD

GitHub Actions pipeline automatically:

* Installs Dependencies
* Starts MongoDB
* Starts Redis
* Runs Test Suite
* Uploads Coverage Reports

---

## System Architecture

```text
Client
   │
   ▼
Express API
   │
   ├── Authentication Layer
   ├── Rate Limiting
   ├── Authorization
   │
   ▼
Controllers
   │
   ▼
Services / Utilities
   │
   ▼
MongoDB Transactions
   │
   ├── Users
   ├── Accounts
   ├── Transactions
   ├── Ledger Entries
   └── Refresh Tokens
   │
   ▼
BullMQ + Redis
   │
   ▼
Email Notifications
```

---

## Project Structure

```text
src
│
├── config
│   ├── db.js
│   ├── env.js
│   └── mail.js
│
├── controllers
│   ├── auth.controller.js
│   ├── account.controller.js
│   └── transaction.controller.js
│
├── middleware
│   ├── auth.middleware.js
│   ├── admin.middleware.js
│   ├── error.middleware.js
│   └── rateLimit.js
│
├── models
│   ├── user.model.js
│   ├── account.model.js
│   ├── transaction.model.js
│   ├── ledger.model.js
│   └── refreshToken.model.js
│
├── queues
│   └── emailQueue.js
│
├── routes
│   ├── auth.route.js
│   ├── accounts.route.js
│   └── transaction.route.js
│
├── utils
│   ├── withTransaction.js
│   ├── ApiError.js
│   ├── ApiResponse.js
│   └── logger.js
│
└── app.js
```

---

## Tech Stack

### Backend

* Node.js
* Express.js

### Database

* MongoDB
* Mongoose

### Queue Processing

* BullMQ
* Redis

### Authentication

* JWT
* Refresh Tokens

### Security

* Helmet
* CORS
* bcrypt
* Express Rate Limit

### Testing

* Vitest
* Supertest

### DevOps

* GitHub Actions
* Node.js Cluster Mode

---

## API Endpoints

### Authentication

| Method | Endpoint                    |
| ------ | --------------------------- |
| POST   | `/api/auth/register`        |
| POST   | `/api/auth/login`           |
| POST   | `/api/auth/refresh-token`   |
| POST   | `/api/auth/logout`          |
| PATCH  | `/api/auth/activate/:token` |

### Accounts

| Method | Endpoint        |
| ------ | --------------- |
| POST   | `/api/accounts` |

### Transactions

| Method | Endpoint                                |
| ------ | --------------------------------------- |
| POST   | `/api/transactions/deposit/:accountId`  |
| POST   | `/api/transactions/withdraw/:accountId` |
| POST   | `/api/transactions/transfer`            |
| GET    | `/api/transactions/history/:accountId`  |
| GET    | `/api/transactions/ledger/:accountId`   |
| GET    | `/api/transactions/verify/:accountId`   |
| GET    | `/api/transactions/:transactionId`      |

---

## Environment Variables

```env
PORT=3000

MONGO_URI=

ACCESS_TOKEN_SECRET=
REFRESH_TOKEN_SECRET=

ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=604800000

MAIL_HOST=
MAIL_PORT=
MAIL_USER=
MAIL_PASS=

REDIS_HOST=
REDIS_PORT=

MAX_DEPOSIT_AMOUNT=1000000
MAX_WITHDRAWAL_AMOUNT=500000
MAX_TRANSFER_AMOUNT=200000
DAILY_TRANSFER_LIMIT=500000
```

---

## Getting Started

### Clone Repository

```bash
git clone https://github.com/Zaidshaikh2811/bank_transactions.git
cd bank_transactions
```

### Install Dependencies

```bash
npm install
```

### Configure Environment

```bash
cp .env.example .env
```

### Start Development Server

```bash
npm run dev
```

### Run Tests

```bash
npm test
```

---

## Backend Concepts Demonstrated

* JWT Authentication
* Refresh Token Rotation
* Token Reuse Detection
* MongoDB Transactions
* Idempotent APIs
* Queue-Based Processing
* Ledger Accounting
* RBAC Authorization
* Cluster-Based Scaling
* Rate Limiting
* CI/CD Automation
* Production Error Handling
* Audit Logging

---

## Author

**Zaid Shaikh**

Software Engineer

**Skills**

* Node.js
* Express.js
* MongoDB
* PostgreSQL
* Redis
* React
* Next.js
* Distributed Systems
* Backend Engineering

GitHub: https://github.com/Zaidshaikh2811

---

## Support

If you found this project useful, consider giving it a ⭐ on GitHub.