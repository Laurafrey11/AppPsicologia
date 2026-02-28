import { supabaseAdmin } from "@/lib/supabase-admin"

export type SubscriptionLimits = {
  id: string
  psychologist_id: string
  max_patients: number
  max_sessions_per_month: number
  max_audio_minutes: number
  created_at: string
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
