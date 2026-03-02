import { supabaseAdmin } from "@/lib/supabase-admin"

export const AUDIT_ACTIONS = {
  AUDIO_PATH_UNAUTHORIZED:          "AUDIO_PATH_UNAUTHORIZED",
  MONTHLY_SESSION_LIMIT_EXCEEDED:   "MONTHLY_SESSION_LIMIT_EXCEEDED",
  MONTHLY_AI_ASSIST_LIMIT_EXCEEDED: "MONTHLY_AI_ASSIST_LIMIT_EXCEEDED",
  IMPORT_CONSECUTIVE_ERRORS:        "IMPORT_CONSECUTIVE_ERRORS",
  AI_COST_CAP_EXCEEDED:             "AI_COST_CAP_EXCEEDED",
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

/**
 * Fire-and-forget audit event writer.
 *
 * Inserts a row into audit_logs via the service role (supabaseAdmin).
 * Never throws — a logging failure must not interrupt the main request flow.
 * Errors are written to stdout for Vercel log capture.
 *
 * Not async-awaited by callers by design.
 */
export function logAuditEvent(
  userId: string,
  action: AuditAction,
  metadata: Record<string, unknown> = {}
): void {
  supabaseAdmin
    .from("audit_logs")
    .insert({ user_id: userId, action, metadata })
    .then(({ error }) => {
      if (error) {
        console.error("[audit] Failed to write audit log", { action, error: error.message })
      }
    })
}
