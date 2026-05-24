
import { Queue, Worker } from "bullmq";
import {
    sendWelcomeEmail,
    newAccountEmail,
    sendDeactivationEmail,
    sendReactivationEmail,
    sendActivationEmail,
    sendAccountActivatedEmail
} from "../utils/sendEmail.js";

const connection = { host: "localhost", port: 6379 };

export const emailQueue = new Queue("emails", { connection });

new Worker("emails", async (job) => {
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
        default:
            console.warn(`Unknown job type: ${job.name}`);
    }
}, { connection });