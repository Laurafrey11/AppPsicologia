import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { checkRateLimit, importLimiter } from "@/lib/rate-limit"
import { findPatientById } from "@/lib/repositories/patient.repository"
import { extractSessionsFromText } from "@/lib/services/openai.service"
import {
  getImportProgressCount,
  processImportInitial,
  type ImportProgressSession,
} from "@/lib/repositories/import-progress.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"
import Papa from "papaparse"
import * as XLSX from "xlsx"

// Vercel route segment config — caps execution to 10s on Hobby plan.
export const maxDuration = 10

const MAX_IMPORT_ROWS       = 100    // hard cap on rows per file
const MAX_TXT_EXTRACT_CHARS = 15_000 // max chars for TXT import

/** Parses a date string in YYYY-MM-DD, DD/MM/YYYY, or DD-MM-YYYY format. Returns ISO date or null. */
function parseDate(dateStr: string): string | null {
  const s = dateStr.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T12:00:00")
    return isNaN(d.getTime()) ? null : s
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

/** POST /api/patients/[id]/import — import historical sessions from CSV/XLSX/TXT (no AI summaries) */
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

    const formData = await req.formData()
    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 })
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    let rows: Array<{ fecha: string; texto: string }> = []

    // ── TXT path: AI extraction only (no summaries) ──────────────────────────
    if (ext === "txt") {
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

      const text = await file.text()
      if (text.length > MAX_TXT_EXTRACT_CHARS) {
        return NextResponse.json(
          { error: `El archivo supera el límite de ${(MAX_TXT_EXTRACT_CHARS / 1000).toLocaleString("es-AR")} 000 caracteres.` },
          { status: 400 }
        )
      }
      if (!text.trim()) {
        return NextResponse.json({ error: "El archivo de texto está vacío" }, { status: 400 })
      }

      try {
        rows = await extractSessionsFromText(text)
      } catch (err: unknown) {
        const name = (err as Error).name
        if (name === "AbortError" || name === "TimeoutError") {
          return NextResponse.json(
            {
              error: "La extracción de sesiones tardó demasiado. Reducí el texto a menos de 10 000 caracteres e intentá de nuevo.",
              code: "EXTRACTION_TIMEOUT",
            },
            { status: 504 }
          )
        }
        throw err
      }

      if (rows.length === 0) {
        return NextResponse.json(
          { error: "No se pudieron detectar sesiones en el archivo. Asegurate de que el texto incluya fechas identificables." },
          { status: 400 }
        )
      }
      if (rows.length > MAX_IMPORT_ROWS) {
        return NextResponse.json(
          { error: `Máximo ${MAX_IMPORT_ROWS} sesiones por importación. Se detectaron ${rows.length}.` },
          { status: 400 }
        )
      }

    // ── CSV path ─────────────────────────────────────────────────────────────
    } else if (ext === "csv") {
      const text = await file.text()
      const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
      const fields = result.meta.fields ?? []
      if (!fields.includes("fecha") || !fields.includes("texto")) {
        return NextResponse.json({ error: "El CSV debe contener columnas: fecha, texto" }, { status: 400 })
      }
      rows = result.data.map((r) => ({ fecha: String(r.fecha ?? ""), texto: String(r.texto ?? "") }))

    // ── XLSX path ─────────────────────────────────────────────────────────────
    } else if (ext === "xlsx" || ext === "xls") {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false })
      if (data.length === 0 || !("fecha" in data[0]) || !("texto" in data[0])) {
        return NextResponse.json({ error: "El XLSX debe contener columnas: fecha, texto" }, { status: 400 })
      }
      rows = data.map((r) => ({ fecha: String(r.fecha ?? ""), texto: String(r.texto ?? "") }))

    } else {
      return NextResponse.json(
        { error: "Formato no soportado. Usá TXT (texto libre), CSV o XLSX." },
        { status: 400 }
      )
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "El archivo no contiene filas de datos" }, { status: 400 })
    }

    if (ext !== "txt" && rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        { error: `Máximo ${MAX_IMPORT_ROWS} sesiones por importación. El archivo tiene ${rows.length} filas.` },
        { status: 400 }
      )
    }

    // ── Validate rows + build sessions array (no AI summaries) ───────────────
    const allSessions: ImportProgressSession[] = []
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row.fecha?.trim() || !row.texto?.trim()) {
        errors.push(`Fila ${i + 2}: campos vacíos`)
        continue
      }
      const parsedDate = parseDate(row.fecha)
      if (!parsedDate) {
        errors.push(`Fila ${i + 2}: fecha inválida "${row.fecha}" (usá YYYY-MM-DD o DD/MM/YYYY)`)
        continue
      }
      allSessions.push({ fecha: parsedDate, texto: row.texto, ai_summary: null })
    }

    // ── Atomic bulk insert ────────────────────────────────────────────────────
    let importResult: Awaited<ReturnType<typeof processImportInitial>>
    try {
      importResult = await processImportInitial(user.id, patientId, allSessions, file.name, ext)
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
      logger.error("processImportInitial returned null unexpectedly", { patientId })
      return NextResponse.json({ error: "Error interno al procesar la importación. Intentá de nuevo." }, { status: 500 })
    }

    logger.info("Sessions imported (no AI summaries)", {
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
    logger.error("POST /api/patients/[id]/import failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
