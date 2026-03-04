import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { checkRateLimit, importLimiter } from "@/lib/rate-limit"
import { findPatientById, updatePatient } from "@/lib/repositories/patient.repository"
import { bulkInsertSessions } from "@/lib/repositories/session.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"
import Papa from "papaparse"

export const maxDuration = 10

/** Case-insensitive column name lookup. */
function findCol(fields: string[], candidates: string[]): string | null {
  const lower = candidates.map((c) => c.toLowerCase())
  return fields.find((f) => lower.includes(f.toLowerCase())) ?? null
}

/** Parses DD/MM/YYYY, YYYY-MM-DD, or DD-MM-YYYY into ISO date. Returns null if invalid. */
function parseDate(s: string): string | null {
  const t = s.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return isNaN(new Date(t + "T12:00:00").getTime()) ? null : t
  }
  const m1 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m1) {
    const year = m1[3].length === 2 ? `20${m1[3]}` : m1[3]
    const iso = `${year}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`
    return isNaN(new Date(iso + "T12:00:00").getTime()) ? null : iso
  }
  const m2 = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m2) {
    const iso = `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`
    return isNaN(new Date(iso + "T12:00:00").getTime()) ? null : iso
  }
  return null
}

/**
 * POST /api/patients/[id]/import-csv
 *
 * Direct CSV import: parse → validate → bulk insert.
 * No RPC, no AI — guaranteed to finish well within the 10s Vercel timeout.
 *
 * Accepts flexible column names:
 *   fecha/date/Fecha/Date → session_date
 *   texto/notas/contenido/text/Texto/Notas → raw_text
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id

    const rateLimitResponse = await checkRateLimit(importLimiter, user.id)
    if (rateLimitResponse) return rateLimitResponse

    const patient = await findPatientById(patientId, user.id)
    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    if (patient.historical_import_done) {
      return NextResponse.json(
        { error: "La importación histórica ya fue realizada para este paciente." },
        { status: 409 }
      )
    }

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 })
    }

    const text = await file.text()
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
    })

    const fields = parsed.meta.fields ?? []
    const fechaCol = findCol(fields, ["fecha", "date", "Fecha", "Date"])
    const textoCol = findCol(fields, ["texto", "text", "notas", "contenido", "notes", "Texto", "Notas", "Contenido"])

    if (!fechaCol || !textoCol) {
      return NextResponse.json(
        { error: "El CSV debe contener columnas de fecha (fecha/date) y texto (texto/notas/contenido)" },
        { status: 400 }
      )
    }

    if (parsed.data.length === 0) {
      return NextResponse.json({ error: "El CSV no contiene filas de datos" }, { status: 400 })
    }

    const sessions: Array<{ patient_id: string; psychologist_id: string; raw_text: string; session_date: string | null }> = []
    const errors: string[] = []

    for (let i = 0; i < parsed.data.length; i++) {
      const row = parsed.data[i]
      const rowNum = i + 2
      const texto = String(row[textoCol] ?? "").trim()
      const fechaRaw = String(row[fechaCol] ?? "").trim()

      if (!texto) {
        errors.push(`Fila ${rowNum}: texto vacío`)
        continue
      }

      const session_date = fechaRaw ? parseDate(fechaRaw) : null
      if (fechaRaw && !session_date) {
        errors.push(`Fila ${rowNum}: fecha inválida "${fechaRaw}" — usá YYYY-MM-DD o DD/MM/YYYY`)
        continue
      }

      sessions.push({ patient_id: patientId, psychologist_id: user.id, raw_text: texto, session_date })
    }

    if (sessions.length === 0) {
      return NextResponse.json({ error: "No se encontraron sesiones válidas en el CSV", errors }, { status: 400 })
    }

    // ── Direct bulk insert (bypasses process_import_initial RPC) ─────────────
    const imported = await bulkInsertSessions(sessions)

    if (imported > 0) {
      updatePatient(patientId, user.id, { historical_import_done: true }).catch((e) =>
        logger.error("Failed to set historical_import_done", { patientId, error: (e as Error).message })
      )
    }

    logger.info("CSV imported (direct insert, no AI)", {
      patientId,
      imported,
      parseErrors: errors.length,
    })

    return NextResponse.json({ imported, errors, remainingCount: 0, canContinue: false })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/import-csv failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
