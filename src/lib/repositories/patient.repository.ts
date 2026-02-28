import { supabaseAdmin } from "@/lib/supabase-admin"
import type { CreatePatientInput, UpdatePatientInput } from "@/lib/validators/patient.schema"

export type Patient = {
  id: string
  psychologist_id: string
  name: string
  age: number
  reason: string
  case_summary: string | null
  is_active: boolean
  recording_consent_at: string | null
  created_at: string
}

/**
 * Insert a new patient row. psychologist_id comes from the verified
 * auth token — never from the request body.
 */
export async function insertPatient(
  data: CreatePatientInput,
  psychologistId: string
): Promise<Patient> {
  const { data: patient, error } = await supabaseAdmin
    .from("patients")
    .insert({ ...data, psychologist_id: psychologistId })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return patient
}

/** Returns all active patients for a psychologist, newest first. */
export async function findActivePatients(psychologistId: string): Promise<Patient[]> {
  const { data, error } = await supabaseAdmin
    .from("patients")
    .select("*")
    .eq("psychologist_id", psychologistId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

/** Returns a single patient only if it belongs to the given psychologist. */
export async function findPatientById(
  id: string,
  psychologistId: string
): Promise<Patient | null> {
  const { data, error } = await supabaseAdmin
    .from("patients")
    .select("*")
    .eq("id", id)
    .eq("psychologist_id", psychologistId)
    .single()

  if (error) return null
  return data
}

/** Counts active patients for a psychologist (used for limit enforcement). */
export async function countActivePatients(psychologistId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("patients")
    .select("*", { count: "exact", head: true })
    .eq("psychologist_id", psychologistId)
    .eq("is_active", true)

  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function deletePatient(
  id: string,
  psychologistId: string
): Promise<void> {
  // Delete sessions first (in case FK cascade is not configured)
  await supabaseAdmin
    .from("sessions")
    .delete()
    .eq("patient_id", id)
    .eq("psychologist_id", psychologistId)

  const { error } = await supabaseAdmin
    .from("patients")
    .delete()
    .eq("id", id)
    .eq("psychologist_id", psychologistId)

  if (error) throw new Error(error.message)
}

export async function updatePatient(
  id: string,
  psychologistId: string,
  data: UpdatePatientInput & { case_summary?: string; recording_consent_at?: string | null }
): Promise<Patient> {
  const { data: patient, error } = await supabaseAdmin
    .from("patients")
    .update(data)
    .eq("id", id)
    .eq("psychologist_id", psychologistId)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return patient
}
