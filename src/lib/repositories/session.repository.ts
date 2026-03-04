import { supabaseAdmin } from "@/lib/supabase-admin"
import { LimitExceededError } from "@/lib/errors/LimitExceededError"

export type SessionNotes = {
  motivo_consulta: string
  humor_paciente: string
  hipotesis_clinica: string
  intervenciones: string
  evolucion: string
  plan_proximo: string
}

export type AiSummary = {
  main_topic: string
  dominant_emotions: string[]
  conflicts: string[]
  clinical_hypotheses: string[]
  points_to_explore: string[]
  sentimiento_predominante: string
  pensamiento_predominante: string
  mecanismo_defensa: string
  tematica_predominante: string
  has_risk?: boolean
  tags?: string[]
  resumen_narrativo?: string
}

export type Session = {
  id: string
  patient_id: string
  psychologist_id: string
  raw_text: string | null
  transcription: string | null
  ai_summary: string | null
  audio_duration: number | null
  session_notes: SessionNotes | null
  paid: boolean
  paid_at: string | null
  fee: number | null
  session_date: string | null
  created_at: string
}

export type InsertSessionData = {
  patient_id: string
  psychologist_id: string
  raw_text: string
  transcription: string | null
  ai_summary: string | null
  audio_duration: number | null
  session_notes: SessionNotes | null
  fee?: number | null
  session_date?: string | null
}

export async function insertSession(data: InsertSessionData): Promise<Session> {
  const { session_date, ...coreData } = data
  const payload = session_date != null ? { ...coreData, session_date } : coreData

  const { data: session, error } = await supabaseAdmin
    .from("sessions")
    .insert(payload)
    .select()
    .single()

  if (error) {
    // Fallback: if session_date column doesn't exist yet, retry without it
    if (session_date != null && error.message.toLowerCase().includes("session_date")) {
      const { data: session2, error: error2 } = await supabaseAdmin
        .from("sessions")
        .insert(coreData)
        .select()
        .single()
      if (error2) throw new Error(error2.message)
      return { ...session2, session_date: null }
    }
    throw new Error(error.message)
  }
  return session
}

/**
 * Atomically checks the monthly session limit and inserts the session.
 * Delegates enforcement to the DB function `insert_session_within_limit`,
 * which uses SELECT ... FOR UPDATE on subscription_limits to serialize
 * concurrent calls and eliminate the TOCTOU race condition.
 *
 * Throws LimitExceededError when the monthly cap is reached.
 */
export async function insertSessionWithinLimit(data: InsertSessionData): Promise<Session> {
  const { data: session, error } = await supabaseAdmin
    .rpc("insert_session_within_limit", {
      p_patient_id:      data.patient_id,
      p_psychologist_id: data.psychologist_id,
      p_raw_text:        data.raw_text,
      p_transcription:   data.transcription ?? null,
      p_ai_summary:      data.ai_summary ?? null,
      p_audio_duration:  data.audio_duration ?? null,
      p_session_notes:   (data.session_notes as unknown) ?? null,
      p_fee:             data.fee ?? null,
      p_session_date:    data.session_date ?? null,
    })

  if (error) {
    if (error.message.includes("SESSION_LIMIT_EXCEEDED")) {
      throw new LimitExceededError("Límite mensual de sesiones alcanzado")
    }
    throw new Error(error.message)
  }

  return session as Session
}

export async function findSessionsByPatient(patientId: string, psychologistId: string): Promise<Session[]> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("*")
    .eq("patient_id", patientId)
    .eq("psychologist_id", psychologistId)
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

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

export async function sumAudioMinutesThisMonth(psychologistId: string): Promise<number> {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("audio_duration")
    .eq("psychologist_id", psychologistId)
    .gte("created_at", startOfMonth.toISOString())
  if (error) return 0
  return (data ?? []).reduce((sum, s) => sum + (s.audio_duration ?? 0), 0)
}

export async function countSessionsByPatient(
  patientId: string,
  psychologistId: string
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("sessions")
    .select("*", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .eq("psychologist_id", psychologistId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function findSessionById(
  id: string,
  psychologistId: string
): Promise<Session | null> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("*")
    .eq("id", id)
    .eq("psychologist_id", psychologistId)
    .single()
  if (error) return null
  return data
}

export type UpdateSessionData = {
  raw_text: string
  session_date?: string | null
  fee?: number | null
  paid?: boolean
  ai_summary?: string | null
  session_notes?: SessionNotes | null
}

export async function updateSession(
  id: string,
  psychologistId: string,
  data: UpdateSessionData
): Promise<Session> {
  const { paid, ai_summary, session_notes, ...rest } = data
  const payload: Record<string, unknown> = { ...rest }
  if (paid !== undefined) {
    payload.paid = paid
    payload.paid_at = paid ? new Date().toISOString() : null
  }
  if (ai_summary !== undefined) payload.ai_summary = ai_summary
  if (session_notes !== undefined) payload.session_notes = session_notes
  const { data: session, error } = await supabaseAdmin
    .from("sessions")
    .update(payload)
    .eq("id", id)
    .eq("psychologist_id", psychologistId)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return session
}

/**
 * Directly inserts multiple sessions without going through the RPC.
 * Used by import routes to bypass process_import_initial and avoid
 * "no data" errors from the Supabase RPC wrapper.
 *
 * Returns the number of successfully inserted sessions.
 */
export async function bulkInsertSessions(
  sessions: Array<{
    patient_id: string
    psychologist_id: string
    raw_text: string
    session_date: string | null
  }>
): Promise<number> {
  if (sessions.length === 0) return 0
  const payload = sessions.map((s) => ({
    patient_id:      s.patient_id,
    psychologist_id: s.psychologist_id,
    raw_text:        s.raw_text,
    transcription:   null,
    ai_summary:      null,
    audio_duration:  null,
    session_notes:   null,
    paid:            false,
    fee:             null,
    session_date:    s.session_date,
  }))
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .insert(payload)
    .select("id")
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

export async function deleteSession(id: string, psychologistId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("sessions")
    .delete()
    .eq("id", id)
    .eq("psychologist_id", psychologistId)
  if (error) throw new Error(error.message)
}

export async function updateSessionPaid(
  id: string,
  psychologistId: string,
  paid: boolean
): Promise<Session> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .update({ paid, paid_at: paid ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("psychologist_id", psychologistId)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export type PracticeStats = {
  active_patients: number
  inactive_patients: number
  total_sessions: number
  sessions_this_month: number
  income_this_month: number
  unpaid_overdue: Array<{ patient_id: string; session_date: string | null; created_at: string; fee: number | null }>
  audio_hours_this_month: number
  avg_treatment_days: number
  low_frequency_patients: Array<{ patient_id: string; last_session: string }>
}

export async function getPracticeStats(psychologistId: string): Promise<PracticeStats> {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000)
  const twentyOneDaysAgo = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000)

  // All sessions for this psychologist
  const { data: allSessions } = await supabaseAdmin
    .from("sessions")
    .select("id, patient_id, created_at, session_date, paid, fee, audio_duration")
    .eq("psychologist_id", psychologistId)
    .order("created_at", { ascending: true })

  const sessions = allSessions ?? []

  // Patient counts
  const { count: activeCount } = await supabaseAdmin
    .from("patients")
    .select("*", { count: "exact", head: true })
    .eq("psychologist_id", psychologistId)
    .eq("is_active", true)

  const { count: inactiveCount } = await supabaseAdmin
    .from("patients")
    .select("*", { count: "exact", head: true })
    .eq("psychologist_id", psychologistId)
    .eq("is_active", false)

  // This month stats — prefer session_date when set (historical imports use it)
  const thisMonthSessions = sessions.filter((s) => {
    const d = s.session_date
      ? new Date(s.session_date + "T12:00:00")
      : new Date(s.created_at)
    return d >= startOfMonth
  })
  const income_this_month = thisMonthSessions
    .filter((s) => s.paid)
    .reduce((sum, s) => sum + (s.fee ?? 0), 0)

  // Estimate hours worked: audio_duration if recorded, otherwise assume 50 min per session
  const audio_hours_this_month =
    thisMonthSessions.reduce((sum, s) => sum + (s.audio_duration != null ? s.audio_duration : 50), 0) / 60

  // Unpaid overdue (not paid, session_date or created_at >4 days ago)
  const unpaid_overdue = sessions.filter(
    (s) => !s.paid && new Date(s.session_date ?? s.created_at) < fourDaysAgo
  ).map((s) => ({ patient_id: s.patient_id, session_date: s.session_date ?? null, created_at: s.created_at, fee: s.fee }))

  // Average treatment duration: for each patient, diff between first and last session
  const patientDurations: Record<string, { first: Date; last: Date }> = {}
  for (const s of sessions) {
    const d = new Date(s.created_at)
    if (!patientDurations[s.patient_id]) {
      patientDurations[s.patient_id] = { first: d, last: d }
    } else {
      if (d < patientDurations[s.patient_id].first) patientDurations[s.patient_id].first = d
      if (d > patientDurations[s.patient_id].last) patientDurations[s.patient_id].last = d
    }
  }
  const durations = Object.values(patientDurations).map(
    ({ first, last }) => (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24)
  )
  const avg_treatment_days =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0

  // Low frequency: patients whose last session was >21 days ago
  const lastSessionByPatient: Record<string, Date> = {}
  for (const s of sessions) {
    const d = new Date(s.created_at)
    if (!lastSessionByPatient[s.patient_id] || d > lastSessionByPatient[s.patient_id]) {
      lastSessionByPatient[s.patient_id] = d
    }
  }
  const low_frequency_patients = Object.entries(lastSessionByPatient)
    .filter(([, last]) => last < twentyOneDaysAgo)
    .map(([patient_id, last]) => ({ patient_id, last_session: last.toISOString() }))

  return {
    active_patients: activeCount ?? 0,
    inactive_patients: inactiveCount ?? 0,
    total_sessions: sessions.length,
    sessions_this_month: thisMonthSessions.length,
    income_this_month,
    unpaid_overdue,
    audio_hours_this_month,
    avg_treatment_days,
    low_frequency_patients,
  }
}

export type SupervisionData = {
  total_sessions: number
  recurring_themes: Array<{ value: string; count: number }>
  dominant_sentimientos: Array<{ value: string; count: number }>
  common_mecanismos: Array<{ value: string; count: number }>
  common_pensamientos: Array<{ value: string; count: number }>
  patient_count: number
}

export async function getSupervisionData(psychologistId: string): Promise<SupervisionData> {
  const { data: sessions } = await supabaseAdmin
    .from("sessions")
    .select("patient_id, ai_summary")
    .eq("psychologist_id", psychologistId)
    .not("ai_summary", "is", null)

  const rows = sessions ?? []
  const patientIds = new Set(rows.map((r) => r.patient_id))

  const themes: Record<string, number> = {}
  const sentimientos: Record<string, number> = {}
  const mecanismos: Record<string, number> = {}
  const pensamientos: Record<string, number> = {}

  for (const row of rows) {
    try {
      const summary = JSON.parse(row.ai_summary)
      if (summary.tematica_predominante) {
        themes[summary.tematica_predominante] = (themes[summary.tematica_predominante] ?? 0) + 1
      }
      if (summary.sentimiento_predominante) {
        sentimientos[summary.sentimiento_predominante] = (sentimientos[summary.sentimiento_predominante] ?? 0) + 1
      }
      if (summary.mecanismo_defensa) {
        mecanismos[summary.mecanismo_defensa] = (mecanismos[summary.mecanismo_defensa] ?? 0) + 1
      }
      if (summary.pensamiento_predominante) {
        pensamientos[summary.pensamiento_predominante] = (pensamientos[summary.pensamiento_predominante] ?? 0) + 1
      }
    } catch {
      // skip malformed
    }
  }

  const toRanked = (map: Record<string, number>) =>
    Object.entries(map)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

  return {
    total_sessions: rows.length,
    patient_count: patientIds.size,
    recurring_themes: toRanked(themes),
    dominant_sentimientos: toRanked(sentimientos),
    common_mecanismos: toRanked(mecanismos),
    common_pensamientos: toRanked(pensamientos),
  }
}
