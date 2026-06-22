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

import { Worker } from "bullmq";


const JOB_HANDLERS = {
    "welcome": (d) => sendWelcomeEmail(d.email),
    "account-created": (d) => newAccountEmail(d.email, d.accountType),
    "account-deactivated": (d) => sendDeactivationEmail(d.email, d.reason),
    "account-reactivated": (d) => sendReactivationEmail(d.email),
    "activation": (d) => sendActivationEmail(d.email, d.verificationToken),
    "account-activated": (d) => sendAccountActivatedEmail(d.email),
    "transaction-notification": (d) => sendTransactionNotificationEmail(d.email, d.transactionDetails),
    "deposit": (d) => sendDepositEmail(d.email, d.amount, d.balance),
    "withdraw": (d) => sendWithdrawEmail(d.email, d.amount, d.balance),
    "otp-confirmation": (d) => sendOtpEmail(d.email, d.otp, d.expiresInMinutes),
};

// const worker = new Worker("emails", async (job) => {

//     switch (job.name) {
//         case "welcome":
//             await sendWelcomeEmail(job.data.email);
//             break;
//         case "account-created":
//             await newAccountEmail(job.data.email, job.data.accountType);
//             break;
//         case "account-deactivated":
//             await sendDeactivationEmail(job.data.email, job.data.reason);
//             break;
//         case "account-reactivated":
//             await sendReactivationEmail(job.data.email);
//             break;
//         case "activation":
//             await sendActivationEmail(job.data.email, job.data.verificationToken);
//             break;
//         case "account-activated":
//             await sendAccountActivatedEmail(job.data.email);
//             break;
//         case "transaction-notification":
//             await sendTransactionNotificationEmail(job.data.email, job.data.transactionDetails);
//             break;
//         case "deposit":
//             await sendDepositEmail(job.data.email, job.data.amount, job.data.balance);
//             break;
//         case "withdraw":
//             await sendWithdrawEmail(job.data.email, job.data.amount, job.data.balance);
//             break;
//         case "otp-confirmation":
//             await sendOtpEmail(job.data.email, job.data.otp, job.data.expiresInMinutes);
//             break;
//         default:
//             console.warn(`Unknown job type: ${job.name}`);
//     }
// }, { connection });

export function startEmailWorker() {
    const worker = new Worker(
        "emails",
        async (job) => {
            const handler = JOB_HANDLERS[job.name];
            if (!handler) {
                console.warn(`[EmailWorker] Unknown job type: "${job.name}" — skipping`);
                return;
            }
            await handler(job.data);
        },
        {
            connection: process.env.REDIS_HOST ? { url: process.env.REDIS_HOST } : { host: "redis", port: 6379 },
            concurrency: 5,
        },
    );

    worker.on("completed", (job) => {
        console.log(`[EmailWorker] ✅ Job ${job.id} (${job.name}) completed`);
    });

    worker.on("failed", (job, err) => {
        console.error(`[EmailWorker] ❌ Job ${job?.id} (${job?.name}) failed:`, err.message);
    });

    worker.on("error", (err) => {
        console.error("[EmailWorker] 🚨 Worker error:", err.message);
    });

    worker.on("stalled", (jobId) => {
        console.warn(`[EmailWorker] ⚠️  Job ${jobId} stalled`);
    });

    console.log("[EmailWorker] Started (concurrency=5)");
    return worker;
}
