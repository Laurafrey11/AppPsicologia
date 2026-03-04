import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { getPracticeStats } from "@/lib/repositories/session.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req)
    const stats = await getPracticeStats(user.id)
    return NextResponse.json(stats)
  } catch (error: unknown) {
    const err = error as Error
    logger.error("GET /api/stats failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
