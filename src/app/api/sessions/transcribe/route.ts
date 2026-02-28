import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { transcribeAudio } from "@/lib/services/openai.service"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

/**
 * GET /api/sessions/transcribe?path=<storage_path>
 *
 * Downloads audio from Supabase Storage and transcribes it with Whisper.
 * Called from NewSessionModal after the user records and uploads audio,
 * so the transcribed text can be shown and edited before saving.
 *
 * Returns: { transcription: string, duration_minutes: number }
 */
export async function GET(req: Request) {
  try {
    await getAuthUser(req)

    const { searchParams } = new URL(req.url)
    const path = searchParams.get("path")
    if (!path) {
      return NextResponse.json({ error: "path is required" }, { status: 400 })
    }

    const { data: audioBlob, error: downloadError } = await supabaseAdmin
      .storage
      .from("session-audio")
      .download(path)

    if (downloadError || !audioBlob) {
      throw new Error(downloadError?.message ?? "No se pudo descargar el audio")
    }

    const ext = path.split(".").pop() ?? "webm"
    const { transcription, durationMinutes } = await transcribeAudio(audioBlob, `audio.${ext}`)

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
