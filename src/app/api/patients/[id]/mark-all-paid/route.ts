import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById } from "@/lib/repositories/patient.repository"
import { markAllSessionsPaid } from "@/lib/repositories/session.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

/**
 * PATCH /api/patients/[id]/mark-all-paid
 *
 * Marks all unpaid sessions for a patient as paid.
 * Returns { updated: number } — count of sessions updated.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id

    const patient = await findPatientById(patientId, user.id)
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    const updated = await markAllSessionsPaid(patientId, user.id)

    logger.info("All sessions marked as paid", {
      patientId,
      psychologistId: user.id,
      updated,
    })

    return NextResponse.json({ updated })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("PATCH /api/patients/[id]/mark-all-paid failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
