import redis from "ioredis";


const redisClient = new redis({
    host: process.env.REDIS_CACHE_HOST || "localhost",
    port: process.env.REDIS_CACHE_PORT || 6380,
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

redisClient.on("connect", () => console.log("[Redis] Connected"));
redisClient.on("ready", () => console.log("[Redis] Ready"));
redisClient.on("error", (err) => console.error("[Redis] Error:", err.message));
redisClient.on("close", () => console.warn("[Redis] Connection closed"));
redisClient.on("reconnecting", () => console.warn("[Redis] Reconnecting..."));

export default redisClient;