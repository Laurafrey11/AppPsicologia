import {
  getOrCreateLimits,
  getOrCreateMonthlyUsage,
  incrementUsage,
} from "@/lib/repositories/limits.repository"
import { countActivePatients } from "@/lib/repositories/patient.repository"
import { LimitExceededError } from "@/lib/errors/LimitExceededError"
import { logger } from "@/lib/logger/logger"

/**
 * Validates that creating a new patient won't exceed the psychologist's
 * max_patients limit. Throws LimitExceededError if the limit is reached.
 *
 * Call this BEFORE inserting the patient row.
 */
export async function checkPatientLimit(psychologistId: string): Promise<void> {
  const [limits, activeCount] = await Promise.all([
    getOrCreateLimits(psychologistId),
    countActivePatients(psychologistId),
  ])

  logger.info("Checking patient limit", {
    psychologistId,
    activeCount,
    max: limits.max_patients,
  })

  if (activeCount >= limits.max_patients) {
    throw new LimitExceededError(
      `Límite de pacientes alcanzado (${limits.max_patients} activos). Desactivá pacientes inactivos para agregar nuevos.`
    )
  }
}

/**
 * Validates that creating a new session won't exceed the monthly session limit.
 * Throws LimitExceededError if the limit is reached.
 *
 * Call this BEFORE inserting the session row.
 */
export async function checkSessionLimit(psychologistId: string): Promise<void> {
  const [limits, usage] = await Promise.all([
    getOrCreateLimits(psychologistId),
    getOrCreateMonthlyUsage(psychologistId),
  ])

  logger.info("Checking session limit", {
    psychologistId,
    sessionsThisMonth: usage.sessions_count,
    max: limits.max_sessions_per_month,
  })

  if (usage.sessions_count >= limits.max_sessions_per_month) {
    throw new LimitExceededError(
      `Límite de sesiones mensuales alcanzado (${limits.max_sessions_per_month}/mes). Se renueva el 1° del mes.`
    )
  }
}

/**
 * Validates that uploading audio won't exceed the monthly audio minutes limit.
 * Throws LimitExceededError if adding audioMinutesToAdd would exceed the limit.
 *
 * Call this BEFORE transcribing the audio.
 *
 * @param audioMinutesToAdd - Estimated duration of the new audio (in minutes)
 */
export async function checkAudioLimit(
  psychologistId: string,
  audioMinutesToAdd: number
): Promise<void> {
  const [limits, usage] = await Promise.all([
    getOrCreateLimits(psychologistId),
    getOrCreateMonthlyUsage(psychologistId),
  ])

  logger.info("Checking audio limit", {
    psychologistId,
    audioMinutesUsed: usage.audio_minutes,
    audioMinutesToAdd,
    max: limits.max_audio_minutes,
  })

  if (usage.audio_minutes + audioMinutesToAdd > limits.max_audio_minutes) {
    const remaining = limits.max_audio_minutes - usage.audio_minutes
    throw new LimitExceededError(
      `Límite de minutos de audio alcanzado. Restante este mes: ${remaining} minutos.`
    )
  }
}

/**
 * Records usage after a successful session creation.
 * Uses a Supabase RPC for atomic increment (avoids race conditions).
 */
export async function recordSessionUsage(
  psychologistId: string,
  audioMinutes: number
): Promise<void> {
  await incrementUsage(psychologistId, 1, audioMinutes)
  logger.info("Usage recorded", { psychologistId, audioMinutes })
}
