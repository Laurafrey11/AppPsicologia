import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { updatePatientSchema } from "@/lib/validators/patient.schema"
import { getPatient, editPatient, listPatients } from "@/lib/services/patient.service"
import { listSessions } from "@/lib/services/session.service"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

/** GET /api/patients/[id] — get patient + their sessions */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const [patient, sessions] = await Promise.all([
      getPatient(params.id, user.id),
      listSessions(params.id, user.id),
    ])
    return NextResponse.json({ patient, sessions })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("GET /api/patients/[id] failed", { error: err.message, id: params.id })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

/** PATCH /api/patients/[id] — update patient fields or deactivate */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const body = await req.json()
    const parsed = updatePatientSchema.parse(body)
    const patient = await editPatient(params.id, user.id, parsed)
    return NextResponse.json(patient)
  } catch (error: unknown) {
    const err = error as Error
    logger.error("PATCH /api/patients/[id] failed", { error: err.message, id: params.id })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    if ((error as any)?.name === "ZodError") {
      return NextResponse.json({ error: "Datos inválidos", details: (error as any).errors }, { status: 400 })
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
