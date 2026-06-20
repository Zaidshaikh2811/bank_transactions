
import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import process from "node:process";
import "dotenv/config";

const NUM_WORKERS = Number(process.env.WEB_CONCURRENCY) || availableParallelism();

if (cluster.isPrimary) {
    console.log(`Primary ${process.pid} started — forking ${NUM_WORKERS} workers`);



    for (let i = 0; i < NUM_WORKERS; i++) {
        cluster.fork();
    }

    cluster.on("exit", (worker, code, signal) => {
        console.warn(
            `Worker ${worker.process.pid} exited (code=${code}, signal=${signal}). Respawning…`
        );
        cluster.fork();
    });
} else {
    const { default: app } = await import("./src/app.js");
    const { connectDB } = await import("./src/config/db.js");
    await connectDB();

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Worker ${process.pid} listening on port : ${PORT} In ${process.env.NODE_ENV} mode`);
    });
}