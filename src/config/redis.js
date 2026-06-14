import redis from "ioredis";


const redisClient = new redis({
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,


    retryStrategy(times) {
        if (times > 10) {
            console.error("[Redis] Max reconnection attempts reached. Giving up.");
            return null;
        }
        const delay = Math.min(times * 200, 10_000);
        console.warn(`[Redis] Reconnecting in ${delay}ms... (attempt ${times})`);
        return delay;
    },


    enableOfflineQueue: false,
    maxRetriesPerRequest: 3,
    connectTimeout: 10_000,
    lazyConnect: false,
});

redis.on("connect", () => console.log("[Redis] Connected"));
redis.on("ready", () => console.log("[Redis] Ready"));
redis.on("error", (err) => console.error("[Redis] Error:", err.message));
redis.on("close", () => console.warn("[Redis] Connection closed"));
redis.on("reconnecting", () => console.warn("[Redis] Reconnecting..."));

export default redis;