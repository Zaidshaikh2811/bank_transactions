import express from 'express';
import { adminMiddleware } from '../middleware/admin.middleware.js';
import { emailQueue } from '../queues/emailQueue.js';




const router = express.Router();

router.get("/users", adminMiddleware, (req, res) => {
    // This is a placeholder route. In a real application, you would fetch and return user data from the database.
    res.json({ message: "This route is protected by admin middleware. Only admins can access this." });
});

router.get("/transactions", adminMiddleware, (req, res) => {
    // This is a placeholder route. In a real application, you would fetch and return transaction data from the database.
    res.json({ message: "This route is protected by admin middleware. Only admins can access this." });
});

router.get("/audit-logs", adminMiddleware, (req, res) => {
    // This is a placeholder route. In a real application, you would generate and return reports based on your data.
    res.json({ message: "This route is protected by admin middleware. Only admins can access this." });
});

router.get("/failed-emails", async (req, res) => {
    const failedJobs = await emailQueue.getFailed();

    res.json(
        failedJobs.map((job) => ({
            id: job.id,
            name: job.name,
            data: job.data,
            failedReason: job.failedReason,
        }))
    );
});



export default router;