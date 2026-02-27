import {
  insertSession,
  findSessionsByPatient,
  findSessionSummariesByPatient,
  type Session,
  type AiSummary,
} from "@/lib/repositories/session.repository"
import { findPatientById, updatePatient } from "@/lib/repositories/patient.repository"
import { checkSessionLimit, checkAudioLimit, recordSessionUsage } from "@/lib/services/limits.service"
import { transcribeAudio, generateSessionSummary, generateCaseSummary } from "@/lib/services/openai.service"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { DomainError } from "@/lib/errors/DomainError"
import { logger } from "@/lib/logger/logger"
import type { CreateSessionInput } from "@/lib/validators/session.schema"

export type CreateSessionResult = {
  session: Session
  caseSummaryUpdated: boolean
}

/**
 * Creates a new clinical session with optional audio transcription.
 *
 * Flow:
 *  1. Verify the patient belongs to this psychologist
 *  2. Check session limit (monthly cap)
 *  3. If audio_path: download from Storage, check audio limit, transcribe
 *  4. Generate structured AI summary from raw_text + transcription
 *  5. Insert session row
 *  6. Record usage atomically
 *  7. Recalculate and persist patient.case_summary from all sessions
 *
 * Ownership: patient_id from input is verified against psychologistId from
 * the auth token. A psychologist can never create sessions for another
 * psychologist's patients.
 */
export async function createSession(
  input: CreateSessionInput,
  psychologistId: string
): Promise<CreateSessionResult> {
  logger.info("Creating session", { patientId: input.patient_id, psychologistId })

  // ── 1. Verify patient ownership ─────────────────────────────────────────
  const patient = await findPatientById(input.patient_id, psychologistId)
  if (!patient) {
    throw new DomainError("Paciente no encontrado o no pertenece a este psicólogo")
  }

  // ── 2. Check session limit ──────────────────────────────────────────────
  await checkSessionLimit(psychologistId)

  // ── 3. Handle audio ─────────────────────────────────────────────────────
  let transcription: string | null = null
  let audioDurationMinutes = 0

  if (input.audio_path) {
    // Download audio from private Storage bucket (uses service role key)
    const { data: audioBlob, error: downloadError } = await supabaseAdmin
      .storage
      .from("session-audio")
      .download(input.audio_path)

    if (downloadError || !audioBlob) {
      throw new DomainError("No se pudo descargar el audio del storage")
    }

    // Check audio limit BEFORE transcribing (estimated: read file size / ~1MB per minute for compressed audio)
    // We use a rough pre-check; the real duration is obtained after transcription.
    // After transcription, if over limit, we still save without incrementing (session is already created).
    // For strict enforcement, use the RPC-based approach described in ARCHITECTURE_RULES.md.
    await checkAudioLimit(psychologistId, 1) // conservative pre-check of at least 1 minute

    const fileName = input.audio_path.split("/").pop() ?? "audio.webm"
    const result = await transcribeAudio(audioBlob, fileName)
    transcription = result.transcription
    audioDurationMinutes = result.durationMinutes

    // Final check with real duration
    await checkAudioLimit(psychologistId, audioDurationMinutes)

    logger.info("Audio transcribed", {
      patientId: input.patient_id,
      durationMinutes: audioDurationMinutes,
    })
  }

  // ── 4. Generate AI summary ───────────────────────────────────────────────
  // Combine manual notes + transcription as source text
  const sourceText = [input.raw_text, transcription].filter(Boolean).join("\n\n")
  let aiSummaryObj: AiSummary | null = null

  if (sourceText.trim().length > 10) {
    aiSummaryObj = await generateSessionSummary(sourceText)
  }

  const aiSummaryJson = aiSummaryObj ? JSON.stringify(aiSummaryObj) : null

  // ── 5. Insert session ────────────────────────────────────────────────────
  const session = await insertSession({
    patient_id: input.patient_id,
    psychologist_id: psychologistId,
    raw_text: input.raw_text ?? "",
    transcription,
    ai_summary: aiSummaryJson,
    audio_duration: audioDurationMinutes > 0 ? Math.round(audioDurationMinutes) : null,
  })

  // ── 6. Record usage (atomic via DB RPC) ─────────────────────────────────
  await recordSessionUsage(psychologistId, Math.round(audioDurationMinutes))
  logger.info("Session created", { sessionId: session.id })

  // ── 7. Recalculate case_summary ──────────────────────────────────────────
  // This runs after the session is committed. If it fails, the session is
  // still saved — the case_summary will be refreshed on the next session.
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
    // Non-fatal: session is already saved. Log and continue.
    logger.error("Failed to update case_summary", {
      patientId: input.patient_id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return { session, caseSummaryUpdated }
}

/**
 * Returns all sessions for a patient, newest first.
 * Verifies psychologist ownership before returning data.
 */
export async function listSessions(
  patientId: string,
  psychologistId: string
): Promise<Session[]> {
  const patient = await findPatientById(patientId, psychologistId)
  if (!patient) {
    throw new DomainError("Paciente no encontrado")
  }
  return findSessionsByPatient(patientId, psychologistId)
}
