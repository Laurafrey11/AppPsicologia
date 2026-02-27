import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { createPatientSchema } from "@/lib/validators/patient.schema"
import { createPatient, listPatients } from "@/lib/services/patient.service"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

/** GET /api/patients — list all active patients for the authenticated psychologist */
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req)
    const patients = await listPatients(user.id)
    return NextResponse.json(patients)
  } catch (error: unknown) {
    const err = error as Error
    logger.error("GET /api/patients failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

/** POST /api/patients — create a new patient (subject to max_patients limit) */
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req)
    const body = await req.json()
    const parsed = createPatientSchema.parse(body)
    const patient = await createPatient(parsed, user.id)
    return NextResponse.json(patient, { status: 201 })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    if ((error as any)?.name === "ZodError") {
      return NextResponse.json({ error: "Datos inválidos", details: (error as any).errors }, { status: 400 })
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
