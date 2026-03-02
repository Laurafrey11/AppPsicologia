import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { transcribeAudio } from "@/lib/services/openai.service"
import { checkAudioLimit } from "@/lib/services/limits.service"
import { checkRateLimit, transcribeLimiter } from "@/lib/rate-limit"
import { checkAndAddCost, AI_COSTS, MONTHLY_COST_CAP } from "@/lib/repositories/limits.repository"
import { logAuditEvent, AUDIT_ACTIONS } from "@/lib/repositories/audit.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

/**
 * GET /api/sessions/transcribe?path=<storage_path>
 *
 * Downloads audio from Supabase Storage and transcribes it with Whisper.
 * Called from NewSessionModal after the user records and uploads audio,
 * so the transcribed text can be shown and edited before saving.
 *
 * Security:
 * - Verifies that the storage path belongs to the authenticated psychologist.
 * - Checks audio minute limits before and after transcription.
 *
 * Returns: { transcription: string, duration_minutes: number }
 */
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req)

    const rateLimitResponse = await checkRateLimit(transcribeLimiter, user.id)
    if (rateLimitResponse) return rateLimitResponse

    const { searchParams } = new URL(req.url)
    const path = searchParams.get("path")
    if (!path) {
      return NextResponse.json({ error: "path is required" }, { status: 400 })
    }

    // ── Hard cost cap ─────────────────────────────────────────────────────────
    const costAllowed = await checkAndAddCost(
      user.id,
      new Date().toISOString().slice(0, 7),
      AI_COSTS.TRANSCRIPTION
    )
    if (!costAllowed) {
      logAuditEvent(user.id, AUDIT_ACTIONS.AI_COST_CAP_EXCEEDED, {
        feature: "transcribe",
        cost_delta: AI_COSTS.TRANSCRIPTION,
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

    // Ownership check: storage paths are scoped as "<psychologist_id>/filename"
    // Prevents a user from transcribing audio uploaded by another psychologist.
    if (!path.startsWith(`${user.id}/`)) {
      logger.warn("Unauthorized transcribe attempt", { userId: user.id, path })
      return NextResponse.json({ error: "Acceso no autorizado al archivo de audio" }, { status: 403 })
    }

    // Pre-check: ensure at least some audio quota remains before calling OpenAI
    await checkAudioLimit(user.id, 1)

    const { data: audioBlob, error: downloadError } = await supabaseAdmin
      .storage
      .from("session-audio")
      .download(path)

    if (downloadError || !audioBlob) {
      throw new Error(downloadError?.message ?? "No se pudo descargar el audio")
    }

    const ext = path.split(".").pop() ?? "webm"
    const { transcription, durationMinutes } = await transcribeAudio(audioBlob, `audio.${ext}`)

    // Post-check: verify the actual duration fits within remaining quota
    await checkAudioLimit(user.id, durationMinutes)

    logger.info("Audio transcribed via modal", { path, durationMinutes })

    return NextResponse.json({ transcription, duration_minutes: durationMinutes })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("GET /api/sessions/transcribe failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
