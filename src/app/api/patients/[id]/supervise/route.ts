import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById } from "@/lib/repositories/patient.repository"
import { findSessionsByPatient } from "@/lib/repositories/session.repository"
import { getOrCreateMonthUsage, incrementAiAssistCount } from "@/lib/repositories/limits.repository"
import { generateInterConsultaReport } from "@/lib/services/openai.service"
import type { AiSummary } from "@/lib/repositories/session.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export const maxDuration = 10

/**
 * POST /api/patients/[id]/supervise
 *
 * Generates an interconsulta clínica for a patient.
 * Works with sessions that may or may not have individual AI summaries —
 * uses raw_text directly when no summary is available.
 *
 * Monetization: limited to 1 Interconsulta per psychologist per month
 * via the ai_assist_count field in usage_tracking.
 *
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

    // ── Monetization: 1 Interconsulta IA per month ────────────────────────────
    const month = new Date().toISOString().slice(0, 7)
    const usage = await getOrCreateMonthUsage(user.id, month)
    if (usage.ai_assist_count >= 1) {
      return NextResponse.json(
        {
          error: "Límite mensual alcanzado. Contactar a soporte para Plan Pro.",
          code: "CONSULTATION_LIMIT_REACHED",
        },
        { status: 429 }
      )
    }

    // ── Fetch all sessions (with raw_text) ────────────────────────────────────
    const rows = await findSessionsByPatient(patientId, user.id)

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No hay sesiones disponibles para generar la interconsulta." },
        { status: 400 }
      )
    }

    // Build context: use ai_summary when available, otherwise raw_text
    const sessions = rows.map((s) => {
      let parsedSummary: AiSummary | null = null
      if (s.ai_summary) {
        try { parsedSummary = JSON.parse(s.ai_summary) as AiSummary } catch { /* skip */ }
      }
      const date = s.session_date
        ? s.session_date
        : s.created_at.slice(0, 10)
      return { date, raw_text: s.raw_text, ai_summary: parsedSummary }
    })

    const report = await generateInterConsultaReport(sessions)

    // ── Increment counter after successful generation ─────────────────────────
    await incrementAiAssistCount(user.id, month)

    logger.info("Interconsulta report generated", {
      patientId,
      psychologistId: user.id,
      sessionCount: rows.length,
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
