import { supabaseAdmin } from "@/lib/supabase-admin"
import { logger } from "@/lib/logger/logger"

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
  estimated_cost: number
}

// ── AI cost estimates (USD) ───────────────────────────────────────────────────
// Conservative overestimates to protect against runaway spend.
// Whisper: $0.006/min — assuming ~50-min session average.
// GPT-4o-mini: $0.15/1M input + $0.60/1M output — rounded up per call.
export const AI_COSTS = {
  TRANSCRIPTION:             0.30,   // ~50-min audio × $0.006/min
  SESSION_SUMMARY:           0.001,  // ~800-token GPT-4o-mini call
  CASE_SUMMARY:              0.002,  // ~2000-token GPT-4o-mini call
  AI_ASSIST:                 0.001,  // ~800-token GPT-4o-mini call
  BATCH_SUMMARY_PER_SESSION: 0.001,  // per session in batch import
} as const

/** Monthly hard cap on estimated OpenAI spend (USD). */
export const MONTHLY_COST_CAP = 10.0

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
      { psychologist_id: psychologistId, month, sessions_count: 0, audio_minutes: 0, ai_assist_count: 0, estimated_cost: 0 },
      { onConflict: "psychologist_id,month", ignoreDuplicates: true }
    )
  if (insertError) throw new Error(insertError.message)

  // Read the current state (guaranteed to exist now).
  const { data, error } = await supabaseAdmin
    .from("usage_tracking")
    .select("psychologist_id, month, sessions_count, audio_minutes, ai_assist_count, estimated_cost")
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
  if (error) {
    // Fail-open: counter not incremented but don't crash the response.
    logger.error("incrementAiAssistCount DB error — counter not incremented", {
      error: error.message,
      psychologistId,
      month,
    })
    return 0
  }
  return data as number
}

/**
 * Atomically checks the monthly AI cost cap and, if within budget, adds the
 * cost delta in a single DB transaction (SELECT ... FOR UPDATE on usage_tracking).
 *
 * Returns true  → request is within budget, cost has been charged.
 * Returns false → monthly cap reached, caller must block the AI feature.
 *
 * Calls the `check_and_add_cost` SQL function.
 */
/**
 * Atomically checks the monthly AI cost cap and, if within budget, adds the
 * cost delta in a single DB transaction.
 *
 * Returns true  → request is within budget, cost has been charged.
 * Returns false → monthly cap reached, caller must block the AI feature.
 *
 * On DB errors (function missing, connection issue, etc.) logs the incident
 * and returns true (fail-open) so a technical misconfiguration never blocks
 * the psychologist from using the app. The DB-level function must be installed
 * by running supabase/functions.sql in the Supabase SQL Editor.
 */
export async function checkAndAddCost(
  psychologistId: string,
  month: string,
  costDelta: number
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("check_and_add_cost", {
    p_psychologist_id: psychologistId,
    p_month:           month,
    p_cost_delta:      costDelta,
  })
  if (error) {
    // Technical error (function not installed, connection issue, etc.).
    // Fail-open: allow the request and log the incident for investigation.
    // Cost protection degrades gracefully; MONTHLY_COST_CAP is still a last
    // resort when the function is healthy.
    logger.error("checkAndAddCost DB error — allowing request (fail-open)", {
      error: error.message,
      psychologistId,
      month,
      costDelta,
    })
    return true
  }
  return data as boolean
}
