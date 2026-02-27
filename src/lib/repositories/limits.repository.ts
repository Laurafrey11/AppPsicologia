import { supabaseAdmin } from "@/lib/supabase-admin"

export type SubscriptionLimits = {
  id: string
  psychologist_id: string
  max_patients: number
  max_sessions_per_month: number
  max_audio_minutes: number
  created_at: string
}

export type UsageTracking = {
  id: string
  psychologist_id: string
  month: string         // 'YYYY-MM'
  sessions_count: number
  audio_minutes: number
}

const PLAN_DEFAULTS = {
  max_patients: 30,
  max_sessions_per_month: 120,
  max_audio_minutes: 600,
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
 * Gets usage for the current month. Creates a zeroed row if none exists.
 * Uses YYYY-MM format as the month key.
 */
export async function getOrCreateMonthlyUsage(
  psychologistId: string
): Promise<UsageTracking> {
  const month = new Date().toISOString().slice(0, 7) // 'YYYY-MM'

  const { data: existing } = await supabaseAdmin
    .from("usage_tracking")
    .select("*")
    .eq("psychologist_id", psychologistId)
    .eq("month", month)
    .single()

  if (existing) return existing

  const { data: created, error } = await supabaseAdmin
    .from("usage_tracking")
    .insert({ psychologist_id: psychologistId, month, sessions_count: 0, audio_minutes: 0 })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return created
}

/**
 * Atomically increments sessions_count and audio_minutes for the current month.
 * Both are incremented in a single UPDATE to minimize race condition windows.
 */
export async function incrementUsage(
  psychologistId: string,
  sessionsDelta: number,
  audioMinutesDelta: number
): Promise<void> {
  const month = new Date().toISOString().slice(0, 7)

  const { error } = await supabaseAdmin.rpc("increment_usage", {
    p_psychologist_id: psychologistId,
    p_month: month,
    p_sessions_delta: sessionsDelta,
    p_audio_minutes_delta: audioMinutesDelta,
  })

  if (error) throw new Error(error.message)
}
