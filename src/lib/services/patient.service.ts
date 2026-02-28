import {
  insertPatient,
  findActivePatients,
  findPatientById,
  updatePatient,
  deletePatient,
  type Patient,
} from "@/lib/repositories/patient.repository"
import { checkPatientLimit } from "@/lib/services/limits.service"
import { DomainError } from "@/lib/errors/DomainError"
import { logger } from "@/lib/logger/logger"
import type { CreatePatientInput, UpdatePatientInput } from "@/lib/validators/patient.schema"

/**
 * Creates a new patient after verifying the active patient limit.
 *
 * Business rules:
 *  - psychologistId comes from the verified auth token — never from input
 *  - Active patient count must be below max_patients before insert
 */
export async function createPatient(
  input: CreatePatientInput,
  psychologistId: string
): Promise<Patient> {
  logger.info("Creating patient", { psychologistId, name: input.name })

  await checkPatientLimit(psychologistId)

  const patient = await insertPatient(input, psychologistId)

  logger.info("Patient created", { patientId: patient.id, psychologistId })
  return patient
}

/**
 * Returns all active patients for a psychologist.
 * Inactive patients (discharged) are excluded from the list.
 */
export async function listPatients(psychologistId: string): Promise<Patient[]> {
  return findActivePatients(psychologistId)
}

/**
 * Returns a single patient by ID.
 * Throws DomainError if the patient doesn't exist or belongs to another psychologist.
 */
export async function getPatient(
  patientId: string,
  psychologistId: string
): Promise<Patient> {
  const patient = await findPatientById(patientId, psychologistId)
  if (!patient) {
    throw new DomainError("Paciente no encontrado")
  }
  return patient
}

/**
 * Permanently deletes a patient and all their sessions.
 * Irreversible — enforces ownership via psychologistId.
 */
export async function removePatient(
  patientId: string,
  psychologistId: string
): Promise<void> {
  logger.info("Deleting patient", { patientId, psychologistId })
  const existing = await findPatientById(patientId, psychologistId)
  if (!existing) throw new DomainError("Paciente no encontrado")
  await deletePatient(patientId, psychologistId)
  logger.info("Patient deleted", { patientId })
}

/**
 * Updates patient fields. Enforces ownership — the psychologistId from the
 * auth token is used to scope the update, so a psychologist can't modify
 * another psychologist's patients even with a crafted request.
 */
export async function editPatient(
  patientId: string,
  psychologistId: string,
  input: UpdatePatientInput
): Promise<Patient> {
  logger.info("Updating patient", { patientId, psychologistId })

  const existing = await findPatientById(patientId, psychologistId)
  if (!existing) {
    throw new DomainError("Paciente no encontrado")
  }

  const updated = await updatePatient(patientId, psychologistId, input)
  logger.info("Patient updated", { patientId })
  return updated
}
