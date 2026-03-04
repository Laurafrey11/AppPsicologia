import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById } from "@/lib/repositories/patient.repository"
import { findSessionsByPatient, updateSessionAiSummary } from "@/lib/repositories/session.repository"
import { generateBatchSessionSummaries } from "@/lib/services/openai.service"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export const maxDuration = 10

/**
 * POST /api/patients/[id]/analyze-month
 *
 * Body: { year: number, month: number }  (month is 0-based, like JS Date)
 *
 * Finds all sessions in the given month that have raw_text but no ai_summary,
 * runs generateBatchSessionSummaries on them (typically 4-8 sessions = safe),
 * and persists each result.
 *
 * Returns: { analyzed: number }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id
    const body = await req.json() as { year: number; month: number }

    const patient = await findPatientById(patientId, user.id)
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    const allSessions = await findSessionsByPatient(patientId, user.id)

    // Filter: in the target month, has text, not yet analyzed
    const monthSessions = allSessions.filter((s) => {
      if (!s.raw_text?.trim()) return false
      if (s.ai_summary) return false
      const d = new Date(s.session_date ? s.session_date + "T12:00:00" : s.created_at)
      return d.getFullYear() === body.year && d.getMonth() === body.month
    })

    if (monthSessions.length === 0) {
      return NextResponse.json({ analyzed: 0 })
    }

    const inputs = monthSessions.map((s) => ({
      fecha: s.session_date ?? s.created_at.slice(0, 10),
      texto: s.raw_text ?? "",
    }))

    const summaries = await generateBatchSessionSummaries(inputs)

    let analyzed = 0
    for (let i = 0; i < monthSessions.length; i++) {
      const summary = summaries[i]
      if (summary) {
        await updateSessionAiSummary(monthSessions[i].id, user.id, JSON.stringify(summary))
        analyzed++
      }
    }

    logger.info("analyze-month complete", {
      patientId,
      year: body.year,
      month: body.month,
      analyzed,
    })

    return NextResponse.json({ analyzed })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/analyze-month failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
