import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { getOrCreateMonthUsage } from "@/lib/repositories/limits.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

/**
 * GET /api/supervision-status
 *
 * Returns the current month's interconsulta usage for the authenticated psychologist.
 * { used: boolean, count: number }
 *
 * used = true when ai_assist_count >= 1 (free plan limit).
 */
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req)
    const month = new Date().toISOString().slice(0, 7)
    const usage = await getOrCreateMonthUsage(user.id, month)
    return NextResponse.json({ used: usage.ai_assist_count >= 1, count: usage.ai_assist_count })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("GET /api/supervision-status failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
