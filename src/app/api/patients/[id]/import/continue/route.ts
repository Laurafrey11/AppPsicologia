import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { checkRateLimit, importLimiter } from "@/lib/rate-limit"
import { findPatientById, updatePatient } from "@/lib/repositories/patient.repository"
import { checkAndAddCost, AI_COSTS, MONTHLY_COST_CAP } from "@/lib/repositories/limits.repository"
import { logAuditEvent, AUDIT_ACTIONS } from "@/lib/repositories/audit.repository"
import { findSessionSummariesByPatient } from "@/lib/repositories/session.repository"
import { generateCaseSummary } from "@/lib/services/openai.service"
import { processImportContinue } from "@/lib/repositories/import-progress.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"
import type { AiSummary } from "@/lib/repositories/session.repository"

// Vercel route segment config — caps execution to 10s on Hobby plan.
// No OpenAI calls for session summaries (pre-stored); only case_summary at the end.
export const maxDuration = 10

/**
 * POST /api/patients/[id]/import/continue
 *
 * Continues a partial historical import by processing the next batch of
 * sessions stored in import_progress.
 *
 * Security:
 * - Same rate limiter as initial import (3 req/hour per user).
 * - Patient ownership verified before proceeding.
 * - DB work is atomic: import_progress + session inserts in one transaction
 *   (SELECT … FOR UPDATE, ON CONFLICT DO NOTHING — via process_import_continue).
 * - Case summary generation is best-effort (try/catch), gated by cost cap.
 *
 * Returns: { importedCount, remainingCount, canContinue }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id

    // Same rate limiter as initial import.
    const rateLimitResponse = await checkRateLimit(importLimiter, user.id)
    if (rateLimitResponse) return rateLimitResponse

    // Verify patient ownership.
    const patient = await findPatientById(patientId, user.id)
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    // ── Atomic DB operation: lock → check limit → insert → update progress ──────
    let result: { imported: number; remaining: number; file_ext: string }
    try {
      result = await processImportContinue(user.id, patientId)
    } catch (err: unknown) {
      const msg = (err as Error).message
      if (msg.includes("IMPORT_NOT_FOUND")) {
        return NextResponse.json(
          { error: "No hay importación en progreso para este paciente." },
          { status: 404 }
        )
      }
      if (msg.includes("SESSION_LIMIT_EXCEEDED")) {
        return NextResponse.json(
          {
            error: "Límite de sesiones mensuales alcanzado. No podés importar más sesiones este mes.",
            code: "SESSION_LIMIT_EXCEEDED",
          },
          { status: 429 }
        )
      }
      throw err
    }

    const canContinue = result.remaining > 0
    const month = new Date().toISOString().slice(0, 7)

    // ── Post-continue: case summary (best-effort, gated by cost cap) ─────────────
    if (result.imported > 0) {
      try {
        const costAllowed = await checkAndAddCost(user.id, month, AI_COSTS.CASE_SUMMARY)
        if (!costAllowed) {
          logAuditEvent(user.id, AUDIT_ACTIONS.AI_COST_CAP_EXCEEDED, {
            patientId,
            feature: "import-continue",
            cost_delta: AI_COSTS.CASE_SUMMARY,
            cap: MONTHLY_COST_CAP,
          })
          logger.warn("Cost cap reached — skipping case_summary after continue", { patientId, month })
        } else {
          const allSummaries = await findSessionSummariesByPatient(patientId, user.id)
          const parsedSummaries = allSummaries
            .map((s) => {
              if (!s.ai_summary) return null
              try { return JSON.parse(s.ai_summary) as AiSummary } catch { return null }
            })
            .filter((s): s is AiSummary => s !== null)
          if (parsedSummaries.length > 0) {
            const caseSummary = await generateCaseSummary(parsedSummaries)
            await updatePatient(patientId, user.id, { case_summary: caseSummary })
          }
        }
      } catch (err) {
        logger.error("Failed to update case_summary after import continue", {
          patientId,
          error: (err as Error).message,
        })
      }

      // Mark historical_import_done when all TXT sessions are imported.
      if (!canContinue && result.file_ext === "txt") {
        try {
          await updatePatient(patientId, user.id, { historical_import_done: true })
        } catch (err) {
          logger.error("Failed to mark historical_import_done after continue", {
            patientId,
            error: (err as Error).message,
          })
        }
      }
    }

    logger.info("Import continue completed", {
      patientId,
      imported: result.imported,
      remaining: result.remaining,
    })

    return NextResponse.json({
      importedCount:  result.imported,
      remainingCount: result.remaining,
      canContinue,
    })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/import/continue failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
