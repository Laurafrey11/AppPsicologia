import { supabaseAdmin } from "@/lib/supabase-admin"

export type SubscriptionLimits = {
  id: string
  psychologist_id: string
  max_patients: number
  max_sessions_per_month: number
  max_audio_minutes: number
  max_ai_assist_per_month: number
  created_at: string
}

export type MonthlyUsage = {
  psychologist_id: string
  month: string
  sessions_count: number
  audio_minutes: number
  ai_assist_count: number
}

const PLAN_DEFAULTS = {
  max_patients: 30,
  max_sessions_per_month: 120,
  max_audio_minutes: 600,
  max_ai_assist_per_month: 20,
} as const

/**
 * Gets the subscription limits for a psychologist.
 * If no row exists (new user), creates one with the Plan Base defaults.
 */
export async function getOrCreateLimits(
  psychologistId: string
): Promise<SubscriptionLimits> {
  const { data: existing } = await supabaseAdmin
    .from("subscription_limits")
    .select("*")
    .eq("psychologist_id", psychologistId)
    .single()

  if (existing) return existing

  const { data: created, error } = await supabaseAdmin
    .from("subscription_limits")
    .insert({ psychologist_id: psychologistId, ...PLAN_DEFAULTS })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return created
}

/**
 * Returns the current monthly usage row for a psychologist, creating it
 * if it doesn't exist yet (first action of the month).
 *
 * Uses INSERT ... ON CONFLICT DO NOTHING so existing counts are never
 * overwritten by the ensure-row-exists step.
 */
export async function getOrCreateMonthUsage(
  psychologistId: string,
  month: string
): Promise<MonthlyUsage> {
  // Ensure the row exists without touching existing counters.
  const { error: insertError } = await supabaseAdmin
    .from("usage_tracking")
    .upsert(
      { psychologist_id: psychologistId, month, sessions_count: 0, audio_minutes: 0, ai_assist_count: 0 },
      { onConflict: "psychologist_id,month", ignoreDuplicates: true }
    )
  if (insertError) throw new Error(insertError.message)

  // Read the current state (guaranteed to exist now).
  const { data, error } = await supabaseAdmin
    .from("usage_tracking")
    .select("psychologist_id, month, sessions_count, audio_minutes, ai_assist_count")
    .eq("psychologist_id", psychologistId)
    .eq("month", month)
    .single()

  if (error || !data) throw new Error(error?.message ?? "Failed to read usage_tracking")
  return data as MonthlyUsage
}

/**
 * Atomically increments ai_assist_count by 1 via a DB expression
 * (never reads the current value into JS and writes it back).
 *
 * Calls the `increment_ai_assist` SQL function which executes:
 *   UPDATE usage_tracking SET ai_assist_count = ai_assist_count + 1 ... RETURNING
 *
 * Returns the new count after the increment.
 */
export async function incrementAiAssistCount(
  psychologistId: string,
  month: string
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("increment_ai_assist", {
    p_psychologist_id: psychologistId,
    p_month: month,
  })
  if (error) throw new Error(error.message)
  return data as number
}
