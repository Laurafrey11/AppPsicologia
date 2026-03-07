import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById, updatePatient } from "@/lib/repositories/patient.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export const maxDuration = 10

/**
 * PATCH /api/patients/[id]/monthly-rate
 *
 * Sets or clears a monthly flat rate stored inside patients.case_summary JSON.
 * Body: { year: number, month: number (0-based), mode: "flat" | "per_session", amount?: number }
 *
 * monthly_rates key format: "${year}-${month}"  (e.g. "2026-2" for March 2026)
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id

    const body = await req.json() as {
      year: number
      month: number
      mode: "flat" | "per_session"
      amount?: number
    }
    const { year, month, mode, amount } = body

    if (!year || month === undefined || !mode) {
      return NextResponse.json({ error: "Faltan campos requeridos: year, month, mode" }, { status: 400 })
    }
    if (mode === "flat" && (amount == null || amount < 0)) {
      return NextResponse.json({ error: "amount requerido y debe ser >= 0 para modo flat" }, { status: 400 })
    }

    const patient = await findPatientById(patientId, user.id)
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    // Parse existing case_summary, preserving all other fields (clinical summary, etc.)
    let caseSummaryObj: Record<string, unknown> = {}
    if (patient.case_summary) {
      try { caseSummaryObj = JSON.parse(patient.case_summary) as Record<string, unknown> } catch { /* start fresh */ }
    }

    const monthlyRates = (caseSummaryObj.monthly_rates as Record<string, unknown>) ?? {}
    const rateKey = `${year}-${month}`

    if (mode === "per_session") {
      delete monthlyRates[rateKey]
    } else {
      monthlyRates[rateKey] = { mode: "flat", amount }
    }

    caseSummaryObj.monthly_rates = monthlyRates

    await updatePatient(patientId, user.id, {
      case_summary: JSON.stringify(caseSummaryObj),
    })

    logger.info("monthly-rate updated", { patientId, rateKey, mode, amount })
    return NextResponse.json({ ok: true })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("PATCH /api/patients/[id]/monthly-rate failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
