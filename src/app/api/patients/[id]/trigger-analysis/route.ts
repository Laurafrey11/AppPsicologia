import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById } from "@/lib/repositories/patient.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

export const maxDuration = 10

/**
 * POST /api/patients/[id]/trigger-analysis
 *
 * Sends { patient_id, psychologist_id } to the configured n8n webhook.
 * The n8n workflow is responsible for reading session data from Supabase
 * and processing the analysis asynchronously.
 *
 * Configure: N8N_WEBHOOK_URL environment variable in Vercel.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id

    const patient = await findPatientById(patientId, user.id)
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    const webhookUrl = process.env.N8N_WEBHOOK_URL
    if (!webhookUrl) {
      logger.error("trigger-analysis: N8N_WEBHOOK_URL not configured")
      return NextResponse.json(
        { error: "Webhook de análisis no configurado. Agregá N8N_WEBHOOK_URL en las variables de entorno." },
        { status: 503 }
      )
    }

    // Fire-and-forget to n8n — only send IDs, never raw text
    const payload = { patient_id: patientId, psychologist_id: user.id }
    const n8nRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    })

    if (!n8nRes.ok) {
      const body = await n8nRes.text().catch(() => "")
      logger.error("trigger-analysis: n8n webhook returned error", {
        status: n8nRes.status,
        body: body.slice(0, 200),
      })
      return NextResponse.json({ error: `Webhook respondió con error ${n8nRes.status}` }, { status: 502 })
    }

    logger.info("trigger-analysis: n8n webhook triggered", { patientId, psychologistId: user.id })
    return NextResponse.json({ triggered: true })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/trigger-analysis failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
