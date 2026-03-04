import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById, updatePatient } from "@/lib/repositories/patient.repository"
import { findSessionsByPatient } from "@/lib/repositories/session.repository"
import { generateCaseAnalysis } from "@/lib/services/openai.service"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export const maxDuration = 10

/**
 * POST /api/patients/[id]/process-history
 *
 * On-demand transversal case analysis using the master clinical supervisor prompt.
 * Reads all sessions for the patient (raw_text, no individual summaries required)
 * and generates a holistic JSON analysis: { summary, has_risk, tags, clinical_advice }.
 *
 * Stateless: the analysis is returned to the frontend and not stored in the DB
 * (the user can regenerate at any time).
 *
 * Returns: { analysis: CaseAnalysis, sessionCount: number }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id

    const patient = await findPatientById(patientId, user.id)
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    const rows = await findSessionsByPatient(patientId, user.id)

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No hay sesiones registradas para este paciente." },
        { status: 400 }
      )
    }

    // Build input: prefer session_date as the label; fall back to created_at date
    const sessions = rows
      .map((s) => ({
        fecha: s.session_date ?? s.created_at.slice(0, 10),
        texto: s.raw_text ?? "",
      }))
      .filter((s) => s.texto.trim().length > 0)

    if (sessions.length === 0) {
      return NextResponse.json(
        { error: "Las sesiones no tienen contenido de texto para analizar." },
        { status: 400 }
      )
    }

    const analysis = await generateCaseAnalysis(sessions)

    // Persist analysis in patients.case_summary so the evolution chart can read scores
    await updatePatient(patientId, user.id, { case_summary: JSON.stringify(analysis) }).catch((e) =>
      logger.error("process-history: failed to persist case_summary", { error: (e as Error).message })
    )

    logger.info("Case analysis generated (process-history)", {
      patientId,
      psychologistId: user.id,
      sessionCount: sessions.length,
      hasRisk: analysis.has_risk,
      scoresCount: analysis.scores?.length ?? 0,
    })

    return NextResponse.json({ analysis, sessionCount: sessions.length })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/process-history failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
