
import ApiError from "./ApiError.js";

export const toCents = (v) => Math.round(Number(v) * 100);
export const fromCents = (v) => +(v / 100).toFixed(2);

export const validateAmount = (amount, max) => {
    if (!amount || isNaN(amount)) {
        throw new ApiError(400, "Valid amount is required");
    }
    if (amount < process.env.MIN_AMOUNT) {
        throw new ApiError(400, `Minimum amount is ${process.env.MIN_AMOUNT}`);
    }
    if (amount > max) {
        throw new ApiError(400, `Maximum amount is ${max}`);
    }
    if (!/^\d+(\.\d{1,2})?$/.test(String(amount))) {
        throw new ApiError(400, "Amount can have at most 2 decimal places");
    }
};


export const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const LOCK_TTL_MS = 30_000;       // 30 s Redis lock
export const CACHE_TTL_SECONDS = 86_400; // 24 h idempotency replay cache

/**
 * Atomically releases a Redis lock only if the token still matches.
 * Uses the same Lua script pattern as the transfer controller.
 */
export const LOCK_RELEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;


/**
 * Validates and parses common idempotency inputs shared across all mutating
 * controllers. Returns { amountCents, idempotencyKey } or throws ApiError.
 */
export function parseAndValidateIdempotency(rawAmount, idempotencyKeyHeader, maxEnvKey, defaultMaxCents) {
    const amountCents = toCents(rawAmount);

    // Check integer FIRST — toCents may return NaN / float on bad input
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
        throw new ApiError(400, "Invalid amount — must be a positive number with at most 2 decimal places");
    }

    const maxCents = toCents(defaultMaxCents);
    validateAmount(amountCents, maxCents);

    const idempotencyKey = idempotencyKeyHeader;
    if (!idempotencyKey) throw new ApiError(400, "Idempotency key is required");
    if (!UUID_RE.test(idempotencyKey)) {
        throw new ApiError(400, "X-Idempotency-Key must be a valid UUID v4");
    }

    return { amountCents, idempotencyKey };
}

/**
 * Checks the Redis idempotency cache.
 * Returns the parsed { statusCode, body } if a cache hit exists, else null.
 */
export async function checkRedisCache(cacheKey, label) {
    try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
    } catch (err) {
        console.error(`[${label}] Redis GET failed, falling through to DB:`, err.message);
    }
    return null;
}

/**
 * Acquires a Redis NX lock. Returns { lockAcquired, lockToken }.
 * Throws 503 if Redis itself is unavailable.
 */
export async function acquireRedisLock(lockKey, label) {
    const lockToken = crypto.randomUUID();
    try {
        const result = await redis.set(lockKey, lockToken, "NX", "PX", LOCK_TTL_MS);
        return { lockAcquired: result === "OK", lockToken };
    } catch (err) {
        console.error(`[${label}] Redis lock unavailable:`, err.message);
        throw new ApiError(503, "Service temporarily unavailable. Please try again shortly.");
    }
}

/**
 * Atomically releases the Redis lock via Lua script.
 * Safe to call even if the lock has already expired.
 */
export async function releaseLock(lockKey, lockToken, label) {
    try {
        await redis.eval(LOCK_RELEASE_SCRIPT, 1, lockKey, lockToken);
    } catch (err) {
        console.error(`[${label}] Lock release failed:`, err.message);
    }
}
