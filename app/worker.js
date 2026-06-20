import "dotenv/config";

import { startEmailWorker } from "./src/queues/emailWorker.js";


startEmailWorker();

console.log(
    `[EmailWorker] PID=${process.pid} started`
);