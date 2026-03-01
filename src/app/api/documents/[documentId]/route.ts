import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findDocumentById, deleteDocument } from "@/lib/repositories/document.repository"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

/**
 * GET /api/documents/[documentId]
 *
 * Returns a signed download URL (60s expiry) for the document.
 * Validates that the document belongs to the authenticated psychologist.
 */
export async function GET(req: Request, { params }: { params: { documentId: string } }) {
  try {
    const user = await getAuthUser(req)

    const doc = await findDocumentById(params.documentId, user.id)
    if (!doc) {
      return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
    }

    const { data, error } = await supabaseAdmin.storage
      .from("patient-documents")
      .createSignedUrl(doc.file_path, 60) // 60 seconds expiry

    if (error || !data) {
      throw new Error(error?.message ?? "No se pudo generar la URL de descarga")
    }

    logger.info("Document download URL generated", { documentId: doc.id })
    return NextResponse.json({ download_url: data.signedUrl })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("GET /api/documents/[documentId] failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * DELETE /api/documents/[documentId]
 *
 * Deletes the storage file and the DB record.
 * Validates that the document belongs to the authenticated psychologist.
 */
export async function DELETE(req: Request, { params }: { params: { documentId: string } }) {
  try {
    const user = await getAuthUser(req)

    const doc = await findDocumentById(params.documentId, user.id)
    if (!doc) {
      return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 })
    }

    // Delete from storage first
    const { error: storageError } = await supabaseAdmin.storage
      .from("patient-documents")
      .remove([doc.file_path])

    if (storageError) {
      logger.warn("Storage delete failed, continuing with DB delete", {
        documentId: doc.id,
        error: storageError.message,
      })
    }

    // Delete the DB record
    await deleteDocument(doc.id, user.id)

    logger.info("Document deleted", { documentId: doc.id })
    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("DELETE /api/documents/[documentId] failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
