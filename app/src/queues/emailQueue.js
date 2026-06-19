
import { Queue, Worker } from "bullmq";
import {
    sendWelcomeEmail,
    newAccountEmail,
    sendDeactivationEmail,
    sendReactivationEmail,
    sendActivationEmail,
    sendAccountActivatedEmail,
    sendTransactionNotificationEmail,
    sendDepositEmail,
    sendOtpEmail,
    sendWithdrawEmail
} from "../utils/sendEmail.js";

const connection = { host: process.env.REDIS_HOST || "redis-cache", port: process.env.REDIS_PORT || 6379 };

export const emailQueue = new Queue("emails", {
    connection, defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 5000,
        },
        removeOnComplete: 100,
        // removeOnComplete: false,
        removeOnFail: false,
    },
});

const worker = new Worker("emails", async (job) => {

    switch (job.name) {
        case "welcome":
            await sendWelcomeEmail(job.data.email);
            break;
        case "account-created":
            await newAccountEmail(job.data.email, job.data.accountType);
            break;
        case "account-deactivated":
            await sendDeactivationEmail(job.data.email, job.data.reason);
            break;
        case "account-reactivated":
            await sendReactivationEmail(job.data.email);
            break;
        case "activation":
            await sendActivationEmail(job.data.email, job.data.verificationToken);
            break;
        case "account-activated":
            await sendAccountActivatedEmail(job.data.email);
            break;
        case "transaction-notification":
            await sendTransactionNotificationEmail(job.data.email, job.data.transactionDetails);
            break;
        case "deposit":
            await sendDepositEmail(job.data.email, job.data.amount, job.data.balance);
            break;
        case "withdraw":
            await sendWithdrawEmail(job.data.email, job.data.amount, job.data.balance);
            break;
        case "otp-confirmation":
            await sendOtpEmail(job.data.email, job.data.otp, job.data.expiresInMinutes);
            break;
        default:
            console.warn(`Unknown job type: ${job.name}`);
    }
}, { connection });

worker.on("completed", (job) => {
    console.log(`✅ Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
    console.error("🚨 Worker Error:", err);
});

worker.on("stalled", (jobId) => {
    console.warn(`⚠️ Job ${jobId} stalled`);
});