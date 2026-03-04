import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findSessionById, updateSessionAiSummary } from "@/lib/repositories/session.repository"
import { generateSessionSummary } from "@/lib/services/openai.service"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export const maxDuration = 10

/**
 * POST /api/sessions/[id]/analyze
 *
 * Analyzes a single session with AI and persists the result.
 * Safe for Vercel 10s limit (one session = one OpenAI call ~2-3s).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const session = await findSessionById(params.id, user.id)

    if (!session) {
      return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 })
    }
    if (!session.raw_text?.trim()) {
      return NextResponse.json({ error: "La sesión no tiene texto para analizar" }, { status: 400 })
    }

    const summary = await generateSessionSummary(session.raw_text)
    const aiSummaryStr = JSON.stringify(summary)
    await updateSessionAiSummary(params.id, user.id, aiSummaryStr)

    logger.info("Single session analyzed", { sessionId: params.id, psychologistId: user.id })
    return NextResponse.json({ ai_summary: aiSummaryStr })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/sessions/[id]/analyze failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
