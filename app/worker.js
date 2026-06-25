import "dotenv/config";

import { startEmailWorker } from "./src/jobs/email.worker.js";


startEmailWorker();

console.log(
    `[EmailWorker] PID=${process.pid} started`
);