
import { Queue } from "bullmq";


export const connection = { host: process.env.REDIS_HOST || "redis-cache", port: process.env.REDIS_PORT || 6379 };

export const emailQueue = new Queue("emails", {
    connection, defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: false,
    },
});

emailQueue.on("completed", (job) => {
    console.log(`✅ Job ${job.id} completed`);
});

emailQueue.on("failed", (job, err) => {
    console.error(`❌ Job ${job?.id} failed:`, err.message);
});

emailQueue.on("error", (err) => {
    console.error("🚨 Queue Error:", err);
});

emailQueue.on("stalled", (jobId) => {
    console.warn(`⚠️ Job ${jobId} stalled`);
});

