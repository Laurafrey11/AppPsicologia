import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById } from "@/lib/repositories/patient.repository"
import {
  findSessionsWithoutSummary,
  countSessionsWithoutSummary,
  updateSessionAiSummary,
} from "@/lib/repositories/session.repository"
import { generateBatchSessionSummaries } from "@/lib/services/openai.service"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export const maxDuration = 10

/**
 * POST /api/patients/[id]/fill-summaries
 *
 * Processes up to 3 sessions without ai_summary per call:
 * generates individual clinical summaries and stores them in the DB.
 *
 * The frontend calls this endpoint in a loop until `remaining === 0`.
 *
 * Returns: { processed: number, remaining: number }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id

    const patient = await findPatientById(patientId, user.id)
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    // Fetch next batch of sessions without ai_summary (max 3 to stay within 10s timeout)
    const BATCH_SIZE = 3
    const pending = await findSessionsWithoutSummary(patientId, user.id, BATCH_SIZE)

    if (pending.length === 0) {
      return NextResponse.json({ processed: 0, remaining: 0 })
    }

    // Build input for batch summarization
    const input = pending.map((s) => ({
      fecha: s.session_date ?? s.created_at.slice(0, 10),
      texto: s.raw_text ?? "",
    }))

    // One OpenAI call for the whole batch
    const summaries = await generateBatchSessionSummaries(input)

    // Persist each summary
    let processed = 0
    for (let i = 0; i < pending.length; i++) {
      const summary = summaries[i]
      if (summary) {
        await updateSessionAiSummary(pending[i].id, user.id, JSON.stringify(summary))
        processed++
      } else {
        // No summary generated (e.g. insufficient text) — store empty marker to avoid reprocessing
        await updateSessionAiSummary(pending[i].id, user.id, JSON.stringify({ has_risk: false, tags: [] }))
      }
    }

    const remaining = await countSessionsWithoutSummary(patientId, user.id)

    logger.info("fill-summaries batch done", {
      patientId,
      psychologistId: user.id,
      processed,
      remaining,
    })

    return NextResponse.json({ processed, remaining })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/fill-summaries failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
