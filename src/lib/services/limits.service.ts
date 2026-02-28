import { getOrCreateLimits } from "@/lib/repositories/limits.repository"
import { countActivePatients } from "@/lib/repositories/patient.repository"
import { countSessionsThisMonth, sumAudioMinutesThisMonth } from "@/lib/repositories/session.repository"
import { LimitExceededError } from "@/lib/errors/LimitExceededError"
import { logger } from "@/lib/logger/logger"

/**
 * Validates that creating a new patient won't exceed the psychologist's
 * max_patients limit. Throws LimitExceededError if the limit is reached.
 */
export async function checkPatientLimit(psychologistId: string): Promise<void> {
  const [limits, activeCount] = await Promise.all([
    getOrCreateLimits(psychologistId),
    countActivePatients(psychologistId),
  ])

  logger.info("Checking patient limit", { psychologistId, activeCount, max: limits.max_patients })

  if (activeCount >= limits.max_patients) {
    throw new LimitExceededError(
      `Límite de pacientes alcanzado (${limits.max_patients} activos). Desactivá pacientes inactivos para agregar nuevos.`
    )
  }
}

/**
 * Validates that creating a new session won't exceed the monthly session limit.
 * Counts sessions directly from the sessions table for the current calendar month.
 */
export async function checkSessionLimit(psychologistId: string): Promise<void> {
  const [limits, sessionCount] = await Promise.all([
    getOrCreateLimits(psychologistId),
    countSessionsThisMonth(psychologistId),
  ])

  logger.info("Checking session limit", {
    psychologistId,
    sessionsThisMonth: sessionCount,
    max: limits.max_sessions_per_month,
  })

  if (sessionCount >= limits.max_sessions_per_month) {
    throw new LimitExceededError(
      `Límite de sesiones mensuales alcanzado (${limits.max_sessions_per_month}/mes). Se renueva el 1° del mes.`
    )
  }
}

/**
 * Validates that uploading audio won't exceed the monthly audio minutes limit.
 * Sums audio_duration from this month's sessions directly.
 */
export async function checkAudioLimit(
  psychologistId: string,
  audioMinutesToAdd: number
): Promise<void> {
  const [limits, usedMinutes] = await Promise.all([
    getOrCreateLimits(psychologistId),
    sumAudioMinutesThisMonth(psychologistId),
  ])

  logger.info("Checking audio limit", {
    psychologistId,
    audioMinutesUsed: usedMinutes,
    audioMinutesToAdd,
    max: limits.max_audio_minutes,
  })

  if (usedMinutes + audioMinutesToAdd > limits.max_audio_minutes) {
    const remaining = limits.max_audio_minutes - usedMinutes
    throw new LimitExceededError(
      `Límite de minutos de audio alcanzado. Restante este mes: ${Math.max(0, remaining)} minutos.`
    )
  }
}

/**
 * No-op — usage is counted directly from the sessions table on every check.
 * Kept for backwards compatibility with session.service.ts call sites.
 */
export async function recordSessionUsage(
  _psychologistId: string,
  _audioMinutes: number
): Promise<void> {
  // Usage is derived live from sessions table; no separate tracking needed.
}
