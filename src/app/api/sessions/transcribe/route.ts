import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { transcribeAudio } from "@/lib/services/openai.service"
import { checkAudioLimit } from "@/lib/services/limits.service"
import { checkRateLimit, transcribeLimiter } from "@/lib/rate-limit"
import { checkAndAddCost, AI_COSTS, MONTHLY_COST_CAP } from "@/lib/repositories/limits.repository"
import { logAuditEvent, AUDIT_ACTIONS } from "@/lib/repositories/audit.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

// Vercel route segment config — caps execution to 10s on Hobby plan.
export const maxDuration = 10

/**
 * POST /api/sessions/transcribe
 *
 * Receives an audio file via FormData ("audio" field) and transcribes it
 * ephemerally with Whisper-1. Audio is never stored in Supabase Storage.
 *
 * Vercel Hobby body limit: 4.5 MB. WebM/Opus at 4 min ≈ 1–3 MB — fits comfortably.
 *
 * Returns: { transcription: string, duration_minutes: number }
 */
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req)

    const rateLimitResponse = await checkRateLimit(transcribeLimiter, user.id)
    if (rateLimitResponse) return rateLimitResponse

    const formData = await req.formData()
    const file = formData.get("audio") as File | null
    if (!file) {
      return NextResponse.json({ error: "No se recibió ningún archivo de audio" }, { status: 400 })
    }

    // Size guard calibrated to the 2-min frontend limit.
    // WebM/Opus at 128 kbps (high end for voice) × 120 s ≈ 1.9 MB.
    // 3 MB gives generous headroom; Vercel Hobby body limit (4.5 MB) acts as
    // the outer gate before this code even runs.
    const MAX_AUDIO_BYTES = 3 * 1024 * 1024
    if (file.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        {
          error: "El archivo de audio es demasiado grande para el plan actual. Grabá notas de menos de 2 minutos.",
          code: "AUDIO_TOO_LARGE",
        },
        { status: 413 }
      )
    }

    // ── Hard cost cap ──────────────────────────────────────────────────────────
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

    // Pre-check: ensure audio quota remains before calling OpenAI
    await checkAudioLimit(user.id, 1)

    const audioBlob = new Blob([await file.arrayBuffer()], { type: file.type || "audio/webm" })
    const ext = file.name.split(".").pop() ?? "webm"
    const { transcription, durationMinutes } = await transcribeAudio(audioBlob, `audio.${ext}`)

    // Post-check: verify the actual duration fits within remaining quota
    await checkAudioLimit(user.id, durationMinutes)

    logger.info("Audio transcribed via direct upload", { psychologistId: user.id, durationMinutes })

    return NextResponse.json({ transcription, duration_minutes: durationMinutes })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/sessions/transcribe failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
