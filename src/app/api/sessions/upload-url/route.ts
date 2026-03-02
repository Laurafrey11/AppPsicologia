import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { checkAudioLimit } from "@/lib/services/limits.service"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

const ALLOWED_EXTENSIONS = ["webm", "mp3", "mp4", "m4a", "ogg", "wav"]
const MAX_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB

/**
 * GET /api/sessions/upload-url?ext=webm
 *
 * Returns a short-lived signed upload URL for Supabase Storage.
 * The client uploads audio directly to Storage using this URL (PUT),
 * bypassing our API route to avoid Vercel's body size limit.
 *
 * Returns: { upload_url, storage_path }
 * - upload_url: signed URL for direct PUT upload
 * - storage_path: the path to include in POST /api/sessions
 */
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req)
    const { searchParams } = new URL(req.url)
    const ext = searchParams.get("ext")?.toLowerCase() ?? "webm"

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: `Extensión no permitida. Permitidas: ${ALLOWED_EXTENSIONS.join(", ")}` },
        { status: 400 }
      )
    }

    // Pre-check: ensure audio quota remains before allowing an upload
    await checkAudioLimit(user.id, 1)

    // Path: psychologistId/timestamp-random.ext — scoped by psychologist
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    const storagePath = `${user.id}/${timestamp}-${random}.${ext}`

    const { data, error } = await supabaseAdmin.storage
      .from("session-audio")
      .createSignedUploadUrl(storagePath)

    if (error || !data) {
      // Most common cause: the "session-audio" Storage bucket was not created in
      // the Supabase dashboard (Storage → New bucket, name: "session-audio",
      // private, 100 MB limit). See DEPLOYMENT.md step 1.4.
      logger.error("createSignedUploadUrl failed — bucket may not exist", {
        supabaseError: error?.message,
        storagePath,
      })
      throw new Error(
        error?.message?.includes("Bucket not found") || error?.message?.includes("not found")
          ? "El bucket 'session-audio' no existe. Crealo en Supabase Dashboard → Storage → New bucket (ver DEPLOYMENT.md paso 1.4)."
          : (error?.message ?? "No se pudo generar la URL de subida")
      )
    }

    logger.info("Upload URL generated", { psychologistId: user.id, storagePath })

    return NextResponse.json({
      upload_url: data.signedUrl,
      storage_path: storagePath,
    })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("GET /api/sessions/upload-url failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
