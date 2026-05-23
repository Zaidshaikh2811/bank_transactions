
import { Queue, Worker } from "bullmq";
import { sendWelcomeEmail, newAccountEmail } from "../utils/sendEmail.js";

export const emailQueue = new Queue("emails", {
    connection: { host: "localhost", port: 6379 }
});

new Worker("emails", async (job) => {
    if (job.name === "welcome") {
        await sendWelcomeEmail(job.data.email);
    }
}, { connection: { host: "localhost", port: 6379 } });

new Worker("Accounts", async (job) => {
    if (job.name === "welcome") {
        await newAccountEmail(job.data.email);
    }
}, { connection: { host: "localhost", port: 6379 } });