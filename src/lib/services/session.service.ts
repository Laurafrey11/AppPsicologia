import {
  insertSessionWithinLimit,
  findSessionsByPatient,
  findSessionSummariesByPatient,
  type Session,
  type AiSummary,
  type SessionNotes,
} from "@/lib/repositories/session.repository"
import { findPatientById, updatePatient } from "@/lib/repositories/patient.repository"
import { checkSessionLimit, recordSessionUsage } from "@/lib/services/limits.service"
import { generateSessionSummary, generateCaseSummary } from "@/lib/services/openai.service"
import { DomainError } from "@/lib/errors/DomainError"
import { logger } from "@/lib/logger/logger"
import type { CreateSessionInput } from "@/lib/validators/session.schema"

export type CreateSessionResult = {
  session: Session
  caseSummaryUpdated: boolean
}

export async function createSession(
  input: CreateSessionInput,
  psychologistId: string
): Promise<CreateSessionResult> {
  logger.info("Creating session", { patientId: input.patient_id, psychologistId })

  const patient = await findPatientById(input.patient_id, psychologistId)
  if (!patient) {
    throw new DomainError("Paciente no encontrado o no pertenece a este psicólogo")
  }

  await checkSessionLimit(psychologistId)

  // Build source text for AI — includes structured notes + free notes
  const notesText = input.session_notes
    ? [
        input.session_notes.motivo_consulta && `Motivo de consulta: ${input.session_notes.motivo_consulta}`,
        input.session_notes.humor_paciente && `Humor del paciente: ${input.session_notes.humor_paciente}`,
        input.session_notes.hipotesis_clinica && `Hipótesis clínica: ${input.session_notes.hipotesis_clinica}`,
        input.session_notes.intervenciones && `Intervenciones: ${input.session_notes.intervenciones}`,
        input.session_notes.evolucion && `Evolución: ${input.session_notes.evolucion}`,
        input.session_notes.plan_proximo && `Plan próximo encuentro: ${input.session_notes.plan_proximo}`,
      ].filter(Boolean).join("\n")
    : ""

  const sourceText = [notesText, input.raw_text].filter(Boolean).join("\n\n")

  let aiSummaryObj: AiSummary | null = null
  if (sourceText.trim().length > 10) {
    aiSummaryObj = await generateSessionSummary(sourceText)
  }
  const aiSummaryJson = aiSummaryObj ? JSON.stringify(aiSummaryObj) : null

  const sessionNotes: SessionNotes | null = input.session_notes
    ? {
        motivo_consulta: input.session_notes.motivo_consulta ?? "",
        humor_paciente: input.session_notes.humor_paciente ?? "",
        hipotesis_clinica: input.session_notes.hipotesis_clinica ?? "",
        intervenciones: input.session_notes.intervenciones ?? "",
        evolucion: input.session_notes.evolucion ?? "",
        plan_proximo: input.session_notes.plan_proximo ?? "",
      }
    : null

  // insertSessionWithinLimit is the authoritative enforcement: it acquires
  // a row-level lock on subscription_limits inside the DB, making the
  // count → check → insert sequence atomic and race-free.
  // checkSessionLimit above is a fast non-authoritative guard that lets us
  // fail before expensive audio/transcription/AI calls when the limit is
  // clearly exhausted.
  const session = await insertSessionWithinLimit({
    patient_id: input.patient_id,
    psychologist_id: psychologistId,
    raw_text: input.raw_text ?? "",
    transcription: null,
    ai_summary: aiSummaryJson,
    audio_duration: null,
    session_notes: sessionNotes,
    fee: input.fee ?? null,
    session_date: input.session_date ?? null,
  })

  await recordSessionUsage(psychologistId, 0)
  logger.info("Session created", { sessionId: session.id })

  let caseSummaryUpdated = false
  try {
    const allSummaries = await findSessionSummariesByPatient(input.patient_id, psychologistId)
    const parsedSummaries = allSummaries
      .map(s => {
        if (!s.ai_summary) return null
        try { return JSON.parse(s.ai_summary) as AiSummary } catch { return null }
      })
      .filter((s): s is AiSummary => s !== null)

    if (parsedSummaries.length > 0) {
      const caseSummary = await generateCaseSummary(parsedSummaries)
      await updatePatient(input.patient_id, psychologistId, { case_summary: caseSummary })
      caseSummaryUpdated = true
      logger.info("Case summary updated", { patientId: input.patient_id })
    }
  } catch (err: unknown) {
    logger.error("Failed to update case_summary", {
      patientId: input.patient_id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return { session, caseSummaryUpdated }
}

export async function listSessions(patientId: string, psychologistId: string): Promise<Session[]> {
  const patient = await findPatientById(patientId, psychologistId)
  if (!patient) {
    throw new DomainError("Paciente no encontrado")
  }
  return findSessionsByPatient(patientId, psychologistId)
}
