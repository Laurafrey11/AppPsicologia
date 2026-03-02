import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { createSessionSchema } from "@/lib/validators/session.schema"
import { createSession } from "@/lib/services/session.service"
import { checkAndAddCost, AI_COSTS, MONTHLY_COST_CAP } from "@/lib/repositories/limits.repository"
import { logAuditEvent, AUDIT_ACTIONS } from "@/lib/repositories/audit.repository"
import { LimitExceededError } from "@/lib/errors/LimitExceededError"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

/**
 * POST /api/sessions
 *
 * Creates a new session. Accepts JSON with:
 *   - patient_id (required)
 *   - raw_text   (optional manual notes)
 *   - audio_path (optional Supabase Storage path — client uploads audio directly to Storage)
 *
 * Audio upload flow:
 *   1. Client calls GET /api/sessions/upload-url to get a signed Storage URL
 *   2. Client PUTs the audio file directly to Supabase Storage
 *   3. Client POSTs here with the storage path
 *   This keeps audio out of the API route body (no 4.5MB Vercel limit issues).
 */
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req)
    const body = await req.json()
    const parsed = createSessionSchema.parse(body)

    // ── Hard cost cap: atomically check + pre-charge estimated cost ───────────
    // Charges before the session is created so concurrent requests can't both
    // slip under the cap. check_and_add_cost uses SELECT FOR UPDATE internally.
    const sessionCost = parsed.audio_path
      ? AI_COSTS.TRANSCRIPTION + AI_COSTS.SESSION_SUMMARY + AI_COSTS.CASE_SUMMARY
      : AI_COSTS.SESSION_SUMMARY + AI_COSTS.CASE_SUMMARY
    const costAllowed = await checkAndAddCost(
      user.id,
      new Date().toISOString().slice(0, 7),
      sessionCost
    )
    if (!costAllowed) {
      logAuditEvent(user.id, AUDIT_ACTIONS.AI_COST_CAP_EXCEEDED, {
        patient_id: parsed.patient_id,
        cost_delta: sessionCost,
        cap: MONTHLY_COST_CAP,
      })
      return NextResponse.json(
        {
          error: `Límite mensual de gasto AI alcanzado ($${MONTHLY_COST_CAP} USD). Se renueva el 1° de cada mes.`,
          code: "COST_CAP_EXCEEDED",
        },
        { status: 429 }
      )
    }

    // ── Create session (may throw LimitExceededError if session cap reached) ──
    let result: Awaited<ReturnType<typeof createSession>>
    try {
      result = await createSession(parsed, user.id)
    } catch (err) {
      if (err instanceof LimitExceededError) {
        logAuditEvent(user.id, AUDIT_ACTIONS.MONTHLY_SESSION_LIMIT_EXCEEDED, {
          patient_id: parsed.patient_id,
        })
      }
      throw err
    }

    return NextResponse.json(result.session, { status: 201 })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/sessions failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    if ((error as any)?.name === "ZodError") {
      return NextResponse.json({ error: "Datos inválidos", details: (error as any).errors }, { status: 400 })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
