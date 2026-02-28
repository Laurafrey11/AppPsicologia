import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { getSupervisionData } from "@/lib/repositories/session.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req)
    const data = await getSupervisionData(user.id)
    return NextResponse.json(data)
  } catch (error: unknown) {
    const err = error as Error
    logger.error("GET /api/supervision failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
