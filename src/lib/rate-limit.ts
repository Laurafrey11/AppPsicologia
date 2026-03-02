import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"

// ── Redis client ──────────────────────────────────────────────────────────────
//
// Fail-closed in production: if env vars are absent, throws at module load
// time so the process never serves requests without rate limiting active.
//
// Fail-open in development: returns null and logs a console warning.
// All limiters become null and checkRateLimit becomes a no-op.
//
function buildRedis(): Redis | null {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[rate-limit] UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in production. " +
        "Rate limiting is required. Add them to your Vercel environment variables."
      )
    }
    // Development / test: warn and continue without Redis.
    console.warn(
      "[rate-limit] Upstash env vars not set — rate limiting is DISABLED. " +
      "This is only acceptable in local development."
    )
    return null
  }

  return new Redis({ url, token })
}

// Throws at module initialization if NODE_ENV === "production" and vars missing.
const redis = buildRedis()

// ── Limiter instances ─────────────────────────────────────────────────────────

/** 10 requests per minute (sliding window) — POST /api/sessions/ai-assist */
export const aiAssistLimiter: Ratelimit | null = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      prefix: "rl:ai-assist",
    })
  : null

/** 10 requests per minute (sliding window) — GET /api/sessions/transcribe */
export const transcribeLimiter: Ratelimit | null = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      prefix: "rl:transcribe",
    })
  : null

/** 3 requests per hour (sliding window) — POST /api/patients/[id]/import */
export const importLimiter: Ratelimit | null = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, "1 h"),
      prefix: "rl:import",
    })
  : null

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Checks a rate limit for the given userId.
 *
 * Returns a 429 NextResponse with RFC-standard headers if the limit is
 * exceeded, or null if the request may proceed.
 *
 * Production guarantees:
 * - limiter is never null (buildRedis threw at module init if vars missing)
 * - If somehow called with null in production, throws immediately (belt-and-suspenders)
 *
 * Development behavior:
 * - limiter = null (env vars not set): always returns null (fail-open)
 * - Redis unreachable: catch → returns null (fail-open; DB plan quotas remain active)
 */
export async function checkRateLimit(
  limiter: Ratelimit | null,
  userId: string
): Promise<NextResponse | null> {
  if (!limiter) {
    if (process.env.NODE_ENV === "production") {
      // Should be unreachable: buildRedis() would have thrown at module init.
      // Belt-and-suspenders: never fail-open in production.
      throw new Error("[rate-limit] Limiter is null in production — this should never happen.")
    }
    // Development: fail-open.
    return null
  }

  try {
    const { success, limit, remaining, reset } = await limiter.limit(userId)

    if (!success) {
      const retryAfterSeconds = Math.ceil((reset - Date.now()) / 1000)
      return NextResponse.json(
        {
          error: "Demasiadas solicitudes. Intentá de nuevo en unos minutos.",
          code: "RATE_LIMIT_EXCEEDED",
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit":     String(limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset":     String(reset),
            "Retry-After":           String(Math.max(1, retryAfterSeconds)),
          },
        }
      )
    }

    return null
  } catch {
    if (process.env.NODE_ENV === "production") {
      // Redis unreachable in production: fail-closed.
      // Better to return 503 than to skip rate limiting.
      return NextResponse.json(
        { error: "Servicio temporalmente no disponible.", code: "RATE_LIMIT_UNAVAILABLE" },
        { status: 503 }
      )
    }
    // Development: Redis unreachable → fail-open.
    return null
  }
}
