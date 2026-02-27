import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { createSessionSchema } from "@/lib/validators/session.schema"
import { createSession } from "@/lib/services/session.service"
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

    const result = await createSession(parsed, user.id)

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
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
