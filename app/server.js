import process from "node:process";
import "dotenv/config";

const PORT = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000;

const { default: app } = await import("./src/app.js");
const { connectDB, disconnectDB } = await import("./src/config/db.js");

await connectDB();

const server = app.listen(PORT, () => {
    console.log(
        `Worker ${process.pid} listening on port ${PORT} in ${process.env.NODE_ENV} mode`
    );
});

let isShuttingDown = false;

server.on("request", (req, res) => {
    if (isShuttingDown) {
        res.setHeader("Connection", "close");
    }
});

async function shutdown(signal) {
    if (isShuttingDown) return
    isShuttingDown = true;

    console.warn(`${signal} received. Starting graceful shutdown…`);

    const closeServer = new Promise((resolve) => {
        server.close(() => resolve());
    });

    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Shutdown timed out")), SHUTDOWN_TIMEOUT_MS)
    );

    try {
        await Promise.race([closeServer, timeout]);
        console.log("HTTP server closed — no requests left in flight.");
    } catch (err) {
        console.error(
            `Forcing shutdown after ${SHUTDOWN_TIMEOUT_MS}ms: ${err.message}`
        );
    }

    try {
        if (typeof disconnectDB === "function") {
            await disconnectDB();
            console.log("Database connection closed.");
        }
    } catch (err) {
        console.error("Error closing DB connection:", err);
    }

    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    shutdown("unhandledRejection");
});