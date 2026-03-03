import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById } from "@/lib/repositories/patient.repository"
import { findSessionSummariesByPatient } from "@/lib/repositories/session.repository"
import { checkAndAddCost, AI_COSTS } from "@/lib/repositories/limits.repository"
import { generateSupervisionReport } from "@/lib/services/openai.service"
import type { AiSummary } from "@/lib/repositories/session.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export const maxDuration = 10

/**
 * POST /api/patients/[id]/supervise
 *
 * Generates a clinical supervision report for a patient using all available
 * AI session summaries. Designed to be triggered every 5 sessions from the UI.
 *
 * Cost: ~1 CASE_SUMMARY token (reuses same estimate).
 * Returns: { report: string, sessionCount: number }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id

    const patient = await findPatientById(patientId, user.id)
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    // Fetch all sessions with AI summaries
    const rows = await findSessionSummariesByPatient(patientId, user.id)
    const summaries = rows
      .map((r) => {
        if (!r.ai_summary) return null
        try { return JSON.parse(r.ai_summary) as AiSummary } catch { return null }
      })
      .filter((s): s is AiSummary => s !== null)

    if (summaries.length === 0) {
      return NextResponse.json(
        { error: "No hay análisis IA disponibles para generar el informe. Las sesiones necesitan resumen de IA." },
        { status: 400 }
      )
    }

    // Check + charge cost before calling OpenAI
    const cost = AI_COSTS.CASE_SUMMARY
    const allowed = await checkAndAddCost(user.id, new Date().toISOString().slice(0, 7), cost)
    if (!allowed) {
      return NextResponse.json(
        { error: "Límite mensual de gasto AI alcanzado.", code: "COST_CAP_EXCEEDED" },
        { status: 429 }
      )
    }

    const report = await generateSupervisionReport(summaries)

    logger.info("Supervision report generated", {
      patientId,
      psychologistId: user.id,
      sessionCount: rows.length,
      summaryCount: summaries.length,
    })

    return NextResponse.json({ report, sessionCount: rows.length })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/supervise failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
