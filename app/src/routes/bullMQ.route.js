
import { emailQueue } from "../jobs/email.queue.js";
import { adminMiddleware } from "../middleware/admin.middleware.js";
import express from "express";


const router = express.Router();

router.get("/queue-debug", adminMiddleware, async (req, res) => {
    const counts = await emailQueue.getJobCounts();

    const completed = await emailQueue.getCompleted(0, 10);
    const failed = await emailQueue.getFailed(0, 10);

    res.json({
        counts,
        completedCount: completed.length,
        failedCount: failed.length,
    });
});


export default router;
