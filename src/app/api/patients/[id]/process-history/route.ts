import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById, updatePatient } from "@/lib/repositories/patient.repository"
import { findSessionsByPatient } from "@/lib/repositories/session.repository"
import { generateBatchScores, synthesizeCaseAnalysis } from "@/lib/services/openai.service"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export const maxDuration = 10

const BATCH_SIZE = 5
const MAX_CHARS_PER_SESSION = 600

type ProcessingState = {
  _processing: true
  _offset: number
  _total: number
  _scores: Array<{ fecha: string; animo: number; ansiedad: number }>
  _has_risk: boolean
  _key_themes: string[]
}

/**
 * POST /api/patients/[id]/process-history
 *
 * Stateless incremental analysis: processes BATCH_SIZE sessions per call.
 * Stores intermediate progress in patients.case_summary (_processing flag).
 *
 * Body: { reset?: true }  — pass reset:true on first call to start fresh.
 *
 * Returns:
 *   { done: false, processed: number, total: number, label: string }
 *   { done: true, analysis: CaseAnalysis, sessionCount: number }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id

    const body = await req.json().catch(() => ({})) as { reset?: boolean }

    const patient = await findPatientById(patientId, user.id)
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    // Fetch all sessions and prepare
    const rows = await findSessionsByPatient(patientId, user.id)
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No hay sesiones registradas para este paciente." },
        { status: 400 }
      )
    }

    const sorted = [...rows].sort((a, b) =>
      (a.session_date ?? a.created_at.slice(0, 10)).localeCompare(
        b.session_date ?? b.created_at.slice(0, 10)
      )
    )

    const allSessions = sorted
      .map((s) => ({
        fecha: s.session_date ?? s.created_at.slice(0, 10),
        texto: (s.raw_text ?? "").slice(0, MAX_CHARS_PER_SESSION),
      }))
      .filter((s) => s.texto.trim().length > 0)

    const total = allSessions.length
    if (total === 0) {
      return NextResponse.json(
        { error: "Las sesiones no tienen contenido de texto para analizar." },
        { status: 400 }
      )
    }

    // Read or initialize processing state from DB
    let state: ProcessingState | null = null
    if (!body.reset && patient.case_summary) {
      try {
        const parsed = JSON.parse(patient.case_summary as string)
        if (parsed._processing === true) {
          state = parsed as ProcessingState
        }
      } catch {
        // corrupt state — start fresh
      }
    }

    if (!state) {
      state = {
        _processing: true,
        _offset: 0,
        _total: total,
        _scores: [],
        _has_risk: false,
        _key_themes: [],
      }
    }

    const offset = state._offset
    const batch = allSessions.slice(offset, offset + BATCH_SIZE)

    // Generate scores for this batch
    const batchResult = await generateBatchScores(batch)

    // Accumulate
    const newScores = [...state._scores, ...batchResult.scores]
    const newHasRisk = state._has_risk || batchResult.has_risk
    const newKeyThemes = [...new Set([...state._key_themes, ...batchResult.key_themes])].slice(0, 15)
    const newOffset = offset + batch.length
    const from = offset + 1
    const to = Math.min(newOffset, total)

    if (newOffset >= total) {
      // All batches processed — synthesize final analysis
      const analysis = await synthesizeCaseAnalysis(newScores, newKeyThemes, newHasRisk, total)

      await updatePatient(patientId, user.id, { case_summary: JSON.stringify(analysis) }).catch((e) =>
        logger.error("process-history: failed to persist final analysis", {
          error: (e as Error).message,
        })
      )

      logger.info("Case analysis complete (incremental)", {
        patientId,
        psychologistId: user.id,
        sessionCount: total,
        hasRisk: newHasRisk,
        scoresCount: newScores.length,
      })

      return NextResponse.json({ done: true, analysis, sessionCount: total })
    } else {
      // More batches to go — persist intermediate state
      const newState: ProcessingState = {
        _processing: true,
        _offset: newOffset,
        _total: total,
        _scores: newScores,
        _has_risk: newHasRisk,
        _key_themes: newKeyThemes,
      }

      await updatePatient(patientId, user.id, { case_summary: JSON.stringify(newState) }).catch((e) =>
        logger.error("process-history: failed to save intermediate state", {
          error: (e as Error).message,
        })
      )

      return NextResponse.json({
        done: false,
        processed: newOffset,
        total,
        label: `Procesando ${from}–${to} de ${total}...`,
      })
    }
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/process-history failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
