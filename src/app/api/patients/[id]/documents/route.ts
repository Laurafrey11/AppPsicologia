import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById } from "@/lib/repositories/patient.repository"
import {
  findDocumentsByPatient,
  insertDocument,
} from "@/lib/repositories/document.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

/** GET /api/patients/[id]/documents — list documents for a patient */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id

    const patient = await findPatientById(patientId, user.id)
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    const documents = await findDocumentsByPatient(patientId, user.id)
    return NextResponse.json({ documents })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("GET /api/patients/[id]/documents failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * POST /api/patients/[id]/documents — save document record after direct upload
 *
 * Body: { file_path: string, document_type: string, file_name: string, file_size: number }
 *
 * Security: validates that file_path starts with the authenticated psychologist's user.id
 * to prevent saving records pointing to other users' storage files.
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
    const { file_path, document_type, file_name, file_size } = body as {
      file_path: string
      document_type: string
      file_name: string
      file_size: number
    }

    if (!file_path?.trim()) {
      return NextResponse.json({ error: "file_path es requerido" }, { status: 400 })
    }

    // Ownership check: storage path must be scoped to this psychologist
    if (!file_path.startsWith(`${user.id}/`)) {
      logger.warn("Unauthorized document path on POST", { userId: user.id, file_path })
      return NextResponse.json({ error: "Ruta de archivo no autorizada" }, { status: 403 })
    }

    const document = await insertDocument({
      psychologist_id: user.id,
      patient_id: patientId,
      document_type: document_type ?? null,
      file_path,
      file_name: file_name ?? null,
      file_size: typeof file_size === "number" ? file_size : null,
    })

    logger.info("Document record saved", { documentId: document.id, patientId })
    return NextResponse.json({ document }, { status: 201 })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/documents failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
