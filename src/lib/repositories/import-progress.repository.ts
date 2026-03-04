import { supabaseAdmin } from "@/lib/supabase-admin"

export type ImportProgressSession = {
  fecha: string       // ISO date string (YYYY-MM-DD), already parsed
  texto: string       // session text
  ai_summary: string | null // JSON string of AiSummary, or null
}

export type ImportProgress = {
  id: string
  psychologist_id: string
  patient_id: string
  file_name: string
  file_ext: string
  remaining_sessions_json: ImportProgressSession[]
  created_at: string
  updated_at: string
}

/**
 * Returns the number of sessions still pending in the import progress for a
 * patient, or null if no progress record exists.
 */
export async function getImportProgressCount(
  psychologistId: string,
  patientId: string
): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("import_progress")
    .select("remaining_sessions_json")
    .eq("psychologist_id", psychologistId)
    .eq("patient_id", patientId)
    .single()

  if (error || !data) return null
  return (data.remaining_sessions_json as ImportProgressSession[]).length
}

/**
 * Atomically processes the initial import for a patient.
 * Delegates all DB work to the `process_import_initial` SQL function, which:
 *   - Acquires SELECT … FOR UPDATE on import_progress (prevents concurrent initials)
 *   - Acquires SELECT … FOR UPDATE on subscription_limits (prevents TOCTOU)
 *   - Counts sessions this month inside the lock
 *   - Inserts up to the remaining quota with ON CONFLICT DO NOTHING
 *   - Updates usage_tracking.sessions_count
 *   - Upserts or deletes import_progress atomically — no JS-level saveImportProgress
 *
 * Returns:
 *   imported_count  — sessions actually inserted (0 when quota was exhausted)
 *   remaining_count — sessions queued in import_progress (0 when all fit)
 *   can_continue    — true when remaining_count > 0
 */
export async function processImportInitial(
  psychologistId: string,
  patientId: string,
  sessions: ImportProgressSession[],
  fileName: string,
  fileExt: string
): Promise<{ imported_count: number; remaining_count: number; can_continue: boolean }> {
  const { data, error } = await supabaseAdmin.rpc("process_import_initial", {
    p_psychologist_id: psychologistId,
    p_patient_id:      patientId,
    p_sessions:        sessions,
    p_file_name:       fileName,
    p_file_ext:        fileExt,
  })
  if (error) throw new Error(error.message)
  // Supabase can return data as an array or as null — normalize either case
  const result = Array.isArray(data) ? data[0] : data
  if (!result) throw new Error("process_import_initial returned no data — the DB function may have failed silently")
  return result as { imported_count: number; remaining_count: number; can_continue: boolean }
}

/**
 * Atomically processes one continue batch for a patient's partial import.
 * Delegates all DB work to the `process_import_continue` SQL function, which:
 *   - Acquires SELECT … FOR UPDATE on import_progress (prevents concurrent continues)
 *   - Acquires SELECT … FOR UPDATE on subscription_limits (prevents TOCTOU)
 *   - Inserts sessions with ON CONFLICT (psychologist_id, patient_id, session_date) DO NOTHING
 *   - Updates or deletes import_progress — all in one transaction
 *
 * Throws 'IMPORT_NOT_FOUND'       if no import_progress row exists.
 * Throws 'SESSION_LIMIT_EXCEEDED' if the monthly quota is already exhausted.
 */
export async function processImportContinue(
  psychologistId: string,
  patientId: string
): Promise<{ imported: number; remaining: number; file_ext: string }> {
  const { data, error } = await supabaseAdmin.rpc("process_import_continue", {
    p_psychologist_id: psychologistId,
    p_patient_id:      patientId,
  })
  if (error) throw new Error(error.message)
  return data as { imported: number; remaining: number; file_ext: string }
}
