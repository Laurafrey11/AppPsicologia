import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import { NextResponse } from "next/server"

// ── Redis client ──────────────────────────────────────────────────────────────
//
// Fail-closed in production at request time: if env vars are absent when the
// first request arrives, checkRateLimit returns 503 (never skips rate limiting).
//
// We intentionally do NOT throw at module load time so that the Next.js build
// can succeed even when Upstash env vars are not available in the build
// environment (build-time NODE_ENV === "production" but env vars may be absent).
//
// Fail-open in development: returns null and logs a console warning.
// All limiters become null and checkRateLimit becomes a no-op.
//
function buildRedis(): Redis | null {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    if (process.env.NODE_ENV !== "production") {
      // Development / test: warn and continue without Redis.
      console.warn(
        "[rate-limit] Upstash env vars not set — rate limiting is DISABLED. " +
        "This is only acceptable in local development."
      )
    }
    // Production: limiter will be null; checkRateLimit will return 503.
    return null
  }

  return new Redis({ url, token })
}

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

/** 10 requests per minute (sliding window) — POST /api/sessions/transcribe */
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
 * - If Upstash env vars are missing, returns 503 (fail-closed — never skips rate limiting)
 * - Does NOT throw at module load time, so the Next.js build always succeeds
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
      // Env vars were not available at module init (e.g. missing in Vercel settings).
      // Fail-closed: refuse the request rather than skip rate limiting.
      return NextResponse.json(
        {
          error: "Servicio temporalmente no disponible. Configuración de rate limiting incompleta.",
          code: "RATE_LIMIT_UNAVAILABLE",
        },
        { status: 503 }
      )
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
