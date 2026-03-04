import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { checkRateLimit, importLimiter } from "@/lib/rate-limit"
import { findPatientById } from "@/lib/repositories/patient.repository"
import {
  getImportProgressCount,
  processImportInitial,
  type ImportProgressSession,
} from "@/lib/repositories/import-progress.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"
import Papa from "papaparse"

// Vercel route segment config — caps execution to 10s on Hobby plan.
export const maxDuration = 10

/**
 * POST /api/patients/[id]/import-csv
 *
 * Zero-AI CSV import: parse → validate → bulk insert via process_import_initial.
 * No OpenAI calls — guaranteed to finish well within the 10s Vercel timeout.
 *
 * Expected CSV columns: fecha (any common date format), texto (session content).
 * Returns: { imported, errors, remainingCount, canContinue }
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

    // Block if a previous partial import is still pending.
    const pendingCount = await getImportProgressCount(user.id, patientId)
    if (pendingCount !== null && pendingCount > 0) {
      return NextResponse.json(
        {
          error: "Hay una importación en progreso para este paciente. Completala primero.",
          remainingCount: pendingCount,
          canContinue: true,
        },
        { status: 409 }
      )
    }

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 })
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "Esta ruta solo acepta archivos CSV" }, { status: 400 })
    }

    const text = await file.text()
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
    })

    const fields = parsed.meta.fields ?? []
    if (!fields.includes("fecha") || !fields.includes("texto")) {
      return NextResponse.json(
        { error: "El CSV debe contener las columnas: fecha, texto" },
        { status: 400 }
      )
    }

    if (parsed.data.length === 0) {
      return NextResponse.json({ error: "El CSV no contiene filas de datos" }, { status: 400 })
    }

    if (parsed.data.length > 100) {
      return NextResponse.json(
        { error: `Máximo 100 sesiones por importación. El archivo tiene ${parsed.data.length} filas.` },
        { status: 400 }
      )
    }

    // ── Parse and validate each row ──────────────────────────────────────────
    const sessions: ImportProgressSession[] = []
    const errors: string[] = []

    for (let i = 0; i < parsed.data.length; i++) {
      const row = parsed.data[i]
      const rowNum = i + 2 // +2: 1-based + header row

      if (!row.fecha?.trim() || !row.texto?.trim()) {
        errors.push(`Fila ${rowNum}: campos vacíos`)
        continue
      }

      const parsedDate = parseDate(row.fecha.trim())
      if (!parsedDate) {
        errors.push(`Fila ${rowNum}: fecha inválida "${row.fecha}" — usá YYYY-MM-DD o DD/MM/YYYY`)
        continue
      }

      sessions.push({ fecha: parsedDate, texto: row.texto.trim(), ai_summary: null })
    }

    if (sessions.length === 0) {
      return NextResponse.json(
        { error: "No se encontraron filas válidas en el CSV", errors },
        { status: 400 }
      )
    }

    // ── Atomic bulk insert (single Postgres RPC, no AI) ───────────────────────
    let importResult: Awaited<ReturnType<typeof processImportInitial>>
    try {
      importResult = await processImportInitial(user.id, patientId, sessions, file.name, "csv")
    } catch (err: unknown) {
      const msg = (err as Error).message
      if (msg.includes("HISTORICAL_IMPORT_ALREADY_DONE")) {
        return NextResponse.json(
          { error: "La importación histórica ya fue realizada para este paciente." },
          { status: 409 }
        )
      }
      if (msg.includes("TOO_MANY_EXISTING_SESSIONS")) {
        return NextResponse.json(
          {
            error: "La importación histórica solo está disponible al inicio del seguimiento (máximo 2 sesiones registradas).",
            code: "TOO_MANY_EXISTING_SESSIONS",
          },
          { status: 409 }
        )
      }
      throw err
    }

    if (!importResult) {
      logger.error("processImportInitial returned null unexpectedly (CSV)", { patientId })
      return NextResponse.json({ error: "Error interno al procesar la importación. Intentá de nuevo." }, { status: 500 })
    }

    logger.info("CSV imported (no AI)", {
      patientId,
      imported: importResult.imported_count,
      remaining: importResult.remaining_count,
      parseErrors: errors.length,
    })

    return NextResponse.json({
      imported: importResult.imported_count,
      errors,
      remainingCount: importResult.remaining_count,
      canContinue: importResult.can_continue,
    })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/import-csv failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}

/** Parses dates in YYYY-MM-DD, DD/MM/YYYY, or DD-MM-YYYY. Returns ISO date or null. */
function parseDate(s: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return isNaN(new Date(s + "T12:00:00").getTime()) ? null : s
  }
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m1) {
    const iso = `${m1[3]}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`
    return isNaN(new Date(iso + "T12:00:00").getTime()) ? null : iso
  }
  const m2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m2) {
    const iso = `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`
    return isNaN(new Date(iso + "T12:00:00").getTime()) ? null : iso
  }
  return null
}
