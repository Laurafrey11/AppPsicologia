import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import {
  updateSessionPaid,
  findSessionById,
  updateSession,
} from "@/lib/repositories/session.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"
import { z } from "zod"

const patchSchema = z.object({
  paid: z.boolean(),
})

const putSchema = z.object({
  text: z.string().min(1, "El texto no puede estar vacío"),
  session_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
    .nullable()
    .optional(),
  fee: z.number().nonnegative("El honorario debe ser positivo").nullable().optional(),
  paid: z.boolean().optional(),
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

/**
 * PUT /api/sessions/[id]
 *
 * Edits a session's text, date, fee, and paid status.
 * Ownership verified via psychologist_id from JWT.
 * Does NOT call OpenAI, regenerate summaries, or affect usage limits.
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)

    const existing = await findSessionById(params.id, user.id)
    if (!existing) {
      return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 })
    }

    const body = await req.json()
    const parsed = putSchema.parse(body)

    const session = await updateSession(params.id, user.id, {
      raw_text: parsed.text,
      session_date: parsed.session_date,
      fee: parsed.fee,
      paid: parsed.paid,
    })

    logger.info("Session updated", { sessionId: params.id, psychologistId: user.id })
    return NextResponse.json(session)
  } catch (error: unknown) {
    const err = error as Error
    logger.error("PUT /api/sessions/[id] failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    if ((error as any)?.name === "ZodError") {
      return NextResponse.json(
        { error: (error as z.ZodError).errors[0]?.message ?? "Datos inválidos" },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
