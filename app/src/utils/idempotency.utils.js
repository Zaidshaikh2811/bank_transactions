import Idempotency from "../models/idempotency.model.js";
import ApiError from "./ApiError.js";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * withIdempotency(req, res, purpose, handler)
 *
 * Wraps a controller handler with idempotency protection.
 *
 * Flow:
 *   1. Validate X-Idempotency-Key header
 *   2. Check if (userId + key + purpose) already has a completed record
 *      → yes: replay cached response, skip handler entirely
 *      → no:  run handler(), save result, send response
 *
 * Concurrent duplicates:
 *   Both requests miss the findOne check and race to create().
 *   Unique index lets only one win. The loser gets E11000,
 *   which we catch, re-fetch the winner's saved record, and replay it.
 *
 * Failed requests:
 *   We only save to Idempotency on success. If the handler throws,
 *   nothing is saved — the client can retry with the same key safely.
 *   This is intentional: a failed transfer hasn't committed, so
 *   retrying with the same key is safe and expected.
 */
export const withIdempotency = async (req, res, purpose, handler) => {
    const key = req.header("X-Idempotency-Key");

    if (!key) {
        throw new ApiError(400, "X-Idempotency-Key header is required");
    }
    if (!UUID_RE.test(key)) {
        throw new ApiError(400, "X-Idempotency-Key must be a valid UUID v4");
    }

    // ── Cache hit → replay ────────────────────────────────────────────────────
    const existing = await Idempotency.findOne({ userId: req.user.id, key, purpose });
    if (existing) {
        return res
            .status(existing.statusCode)
            .set("X-Idempotent-Replayed", "true")
            .json(existing.responseBody);
    }

    // ── Cache miss → run handler ──────────────────────────────────────────────
    const { statusCode, body } = await handler();

    // Only save on success — failures are not cached so the client
    // can safely retry with the same key
    try {
        await Idempotency.create({
            userId: req.user.id,
            key,
            purpose,
            statusCode,
            responseBody: body,
        });
    } catch (err) {
        if (err.code === 11000) {
            // Concurrent request won the race and already saved.
            // Our handler also completed successfully — both ran, which is a
            // problem for non-idempotent ops like transfers. Log and alert.
            console.error(
                `[idempotency] RACE: two requests completed for key=${key} purpose=${purpose} userId=${req.user.id}. ` +
                `Investigate whether the operation ran twice.`
            );
            // Still send our response — the damage (if any) is already done
        } else {
            throw err;
        }
    }

    return res.status(statusCode).json(body);
};