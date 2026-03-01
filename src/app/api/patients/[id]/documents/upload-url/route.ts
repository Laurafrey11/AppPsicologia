import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById } from "@/lib/repositories/patient.repository"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"]
const ALLOWED_TYPES = ["consentimiento", "comprobante", "otro"]
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

/**
 * POST /api/patients/[id]/documents/upload-url
 *
 * Body: { ext: string, document_type: string, file_name: string, file_size: number }
 *
 * Validates ownership, file type, and size — then returns a short-lived signed
 * upload URL for direct client-to-Storage upload.
 *
 * Returns: { upload_url, storage_path }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id

    const patient = await findPatientById(patientId, user.id)
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    const body = await req.json()
    const { ext, document_type, file_name, file_size } = body as {
      ext: string
      document_type: string
      file_name: string
      file_size: number
    }

    const cleanExt = String(ext ?? "").toLowerCase().replace(/^\./, "")
    if (!ALLOWED_EXTENSIONS.includes(cleanExt)) {
      return NextResponse.json(
        { error: `Extensión no permitida. Permitidas: ${ALLOWED_EXTENSIONS.join(", ")}` },
        { status: 400 }
      )
    }

    if (typeof file_size === "number" && file_size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: "El archivo supera el límite de 10 MB" },
        { status: 400 }
      )
    }

    if (document_type && !ALLOWED_TYPES.includes(document_type)) {
      return NextResponse.json({ error: "Tipo de documento inválido" }, { status: 400 })
    }

    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    const storagePath = `${user.id}/patients/${patientId}/${timestamp}-${random}.${cleanExt}`

    const { data, error } = await supabaseAdmin.storage
      .from("patient-documents")
      .createSignedUploadUrl(storagePath)

    if (error || !data) {
      throw new Error(error?.message ?? "No se pudo generar la URL de subida")
    }

    logger.info("Document upload URL generated", {
      psychologistId: user.id,
      patientId,
      storagePath,
      document_type,
      file_name,
    })

    return NextResponse.json({ upload_url: data.signedUrl, storage_path: storagePath })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/documents/upload-url failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
