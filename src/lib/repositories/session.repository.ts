import { supabaseAdmin } from "@/lib/supabase-admin"

export type Session = {
  id: string
  patient_id: string
  psychologist_id: string
  raw_text: string | null
  transcription: string | null
  ai_summary: string | null
  audio_duration: number | null
  created_at: string
}

export type AiSummary = {
  main_topic: string
  dominant_emotions: string[]
  conflicts: string[]
  clinical_hypotheses: string[]
  points_to_explore: string[]
}

export type InsertSessionData = {
  patient_id: string
  psychologist_id: string
  raw_text: string
  transcription: string | null
  ai_summary: string | null
  audio_duration: number | null
}

export async function insertSession(data: InsertSessionData): Promise<Session> {
  const { data: session, error } = await supabaseAdmin
    .from("sessions")
    .insert(data)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return session
}

/** Returns all sessions for a patient ordered newest-first. */
export async function findSessionsByPatient(
  patientId: string,
  psychologistId: string
): Promise<Session[]> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("*")
    .eq("patient_id", patientId)
    .eq("psychologist_id", psychologistId)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Returns only the ai_summary field for all sessions of a patient.
 * Used to compute the cumulative case_summary without loading full session data.
 */
export async function findSessionSummariesByPatient(
  patientId: string,
  psychologistId: string
): Promise<Array<{ created_at: string; ai_summary: string | null }>> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("created_at, ai_summary")
    .eq("patient_id", patientId)
    .eq("psychologist_id", psychologistId)
    .order("created_at", { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}

/** Counts sessions created in the current calendar month for a psychologist. */
export async function countSessionsThisMonth(psychologistId: string): Promise<number> {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { count, error } = await supabaseAdmin
    .from("sessions")
    .select("*", { count: "exact", head: true })
    .eq("psychologist_id", psychologistId)
    .gte("created_at", startOfMonth.toISOString())

  if (error) throw new Error(error.message)
  return count ?? 0
}
