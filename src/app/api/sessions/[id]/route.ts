import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { updateSessionPaid } from "@/lib/repositories/session.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"
import { z } from "zod"

const patchSchema = z.object({
  paid: z.boolean(),
})

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const body = await req.json()
    const { paid } = patchSchema.parse(body)

    const session = await updateSessionPaid(params.id, user.id, paid)
    return NextResponse.json(session)
  } catch (error: unknown) {
    const err = error as Error
    logger.error("PATCH /api/sessions/[id] failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    if ((error as any)?.name === "ZodError") {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
