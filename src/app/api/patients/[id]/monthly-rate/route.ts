import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById, updatePatient } from "@/lib/repositories/patient.repository"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export const maxDuration = 10

/**
 * PATCH /api/patients/[id]/monthly-rate
 *
 * Sets or clears the patient's monthly flat rate.
 * Body: { year: number, month: number (0-based), mode: "flat" | "per_session", amount?: number }
 *
 * Writes to TWO places:
 *   1. patients.monthly_rate (direct column) — used by getPracticeStats for income calc
 *   2. patients.case_summary.monthly_rates (JSON) — used by the month-header UI display
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

    // 1. Update case_summary.monthly_rates for the month-header UI
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

    // 2. Persist to patients.monthly_rate (numeric column)
    const newMonthlyRate = mode === "flat" ? Number(amount) : null

    await updatePatient(patientId, user.id, {
      case_summary: JSON.stringify(caseSummaryObj),
      monthly_rate: newMonthlyRate,
    })

    // 3. Cascade: update fee on all sessions belonging to this month for this patient
    //    This ensures Dashboard SUM(fee WHERE paid) reflects the rate immediately
    if (mode === "flat" && amount != null) {
      const monthStart = new Date(year, month, 1).toISOString()
      const monthEnd = new Date(year, month + 1, 1).toISOString()

      // Sessions with explicit session_date in the month
      await supabaseAdmin
        .from("sessions")
        .update({ fee: Number(amount) })
        .eq("patient_id", patientId)
        .eq("psychologist_id", user.id)
        .gte("session_date", monthStart.slice(0, 10))
        .lt("session_date", monthEnd.slice(0, 10))

      // Sessions without session_date — use created_at
      await supabaseAdmin
        .from("sessions")
        .update({ fee: Number(amount) })
        .eq("patient_id", patientId)
        .eq("psychologist_id", user.id)
        .is("session_date", null)
        .gte("created_at", monthStart)
        .lt("created_at", monthEnd)
    }

    logger.info("monthly-rate updated", { patientId, rateKey, mode, amount: newMonthlyRate })
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
