import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { checkRateLimit, importLimiter } from "@/lib/rate-limit"
import { findPatientById, updatePatient } from "@/lib/repositories/patient.repository"
import { bulkInsertSessions } from "@/lib/repositories/session.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"
import Papa from "papaparse"
import * as XLSX from "xlsx"

export const maxDuration = 10

const MAX_IMPORT_ROWS = 200

// ── Date helpers ─────────────────────────────────────────────────────────────

/** Parses DD/MM/YYYY, YYYY-MM-DD, or DD-MM-YYYY into ISO date. Returns null if invalid. */
function parseDate(dateStr: string): string | null {
  const s = dateStr.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return isNaN(new Date(s + "T12:00:00").getTime()) ? null : s
  }
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m1) {
    const year = m1[3].length === 2 ? `20${m1[3]}` : m1[3]
    const iso = `${year}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`
    return isNaN(new Date(iso + "T12:00:00").getTime()) ? null : iso
  }
  const m2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m2) {
    const iso = `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`
    return isNaN(new Date(iso + "T12:00:00").getTime()) ? null : iso
  }
  return null
}

// ── Deterministic session parser (no AI) ─────────────────────────────────────

/**
 * Splits free text into sessions using regex — no OpenAI involved.
 *
 * Strategy (in order):
 *   1. Look for short lines (≤50 chars) that contain a date → use as session boundaries
 *   2. Split by double newlines (paragraphs) → assign descending dates
 *   3. Fallback: the whole text is one session dated today
 */
function parseSessionsFromText(text: string): Array<{ fecha: string; texto: string }> {
  const lines = text.split("\n")

  // Pattern matches dates embedded anywhere in short lines
  const DATE_RE = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/

  const boundaries: Array<{ idx: number; fecha: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.length > 50) continue  // skip long paragraphs
    const m = line.match(DATE_RE)
    if (m) {
      const parsed = parseDate(m[1])
      if (parsed) boundaries.push({ idx: i, fecha: parsed })
    }
  }

  if (boundaries.length >= 1) {
    return boundaries
      .map((b, i) => {
        const start = b.idx + 1
        const end = i < boundaries.length - 1 ? boundaries[i + 1].idx : lines.length
        const texto = lines.slice(start, end).join("\n").trim()
        return { fecha: b.fecha, texto }
      })
      .filter((s) => s.texto.length > 0)
  }

  // No date headers found — try splitting by double newlines
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 5)
  if (paragraphs.length >= 2) {
    const today = new Date()
    return paragraphs.map((p, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() - (paragraphs.length - 1 - i))
      return { fecha: d.toISOString().slice(0, 10), texto: p }
    })
  }

  // Fallback: whole text as a single session dated today
  return [{ fecha: new Date().toISOString().slice(0, 10), texto: text.trim() }]
}

/** Case-insensitive column name lookup across a list of candidates. */
function findCol(fields: string[], candidates: string[]): string | null {
  const lower = candidates.map((c) => c.toLowerCase())
  return fields.find((f) => lower.includes(f.toLowerCase())) ?? null
}

// ── Route handler ─────────────────────────────────────────────────────────────

/** POST /api/patients/[id]/import — import historical sessions from TXT/CSV/XLSX (no AI summaries) */
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

    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    let rows: Array<{ fecha: string; texto: string }> = []
    const errors: string[] = []

    // ── TXT: deterministic RegEx parsing ─────────────────────────────────────
    if (ext === "txt") {
      const text = await file.text()
      if (!text.trim()) {
        return NextResponse.json({ error: "El archivo de texto está vacío" }, { status: 400 })
      }
      rows = parseSessionsFromText(text)
      if (rows.length === 0) {
        return NextResponse.json(
          { error: "No se pudieron detectar sesiones. Asegurate de incluir fechas (ej: 15/03/2024) o párrafos separados." },
          { status: 400 }
        )
      }

    // ── CSV ───────────────────────────────────────────────────────────────────
    } else if (ext === "csv") {
      const text = await file.text()
      const result = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
      const fields = result.meta.fields ?? []
      const fechaCol = findCol(fields, ["fecha", "date", "Fecha", "Date"])
      const textoCol = findCol(fields, ["texto", "text", "notas", "contenido", "notes", "Texto", "Notas", "Contenido"])
      if (!fechaCol || !textoCol) {
        return NextResponse.json(
          { error: "El CSV debe contener columnas de fecha (fecha/date) y texto (texto/notas/contenido)" },
          { status: 400 }
        )
      }
      rows = result.data.map((r) => ({ fecha: String(r[fechaCol] ?? ""), texto: String(r[textoCol] ?? "") }))

    // ── XLSX ──────────────────────────────────────────────────────────────────
    } else if (ext === "xlsx" || ext === "xls") {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false })
      if (data.length === 0) {
        return NextResponse.json({ error: "El XLSX está vacío" }, { status: 400 })
      }
      const keys = Object.keys(data[0])
      const fechaCol = findCol(keys, ["fecha", "date", "Fecha", "Date"])
      const textoCol = findCol(keys, ["texto", "text", "notas", "contenido", "notes", "Texto", "Notas", "Contenido"])
      if (!fechaCol || !textoCol) {
        return NextResponse.json(
          { error: "El XLSX debe contener columnas de fecha (fecha/date) y texto (texto/notas/contenido)" },
          { status: 400 }
        )
      }
      rows = data.map((r) => ({ fecha: String((r as Record<string, unknown>)[fechaCol] ?? ""), texto: String((r as Record<string, unknown>)[textoCol] ?? "") }))

    } else {
      return NextResponse.json(
        { error: "Formato no soportado. Usá TXT, CSV o XLSX." },
        { status: 400 }
      )
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "El archivo no contiene filas de datos" }, { status: 400 })
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      rows = rows.slice(0, MAX_IMPORT_ROWS)
      errors.push(`Se importaron solo las primeras ${MAX_IMPORT_ROWS} sesiones (límite máximo).`)
    }

    // ── Validate rows + normalize dates ───────────────────────────────────────
    const sessions: Array<{ patient_id: string; psychologist_id: string; raw_text: string; session_date: string | null }> = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!row.texto?.trim()) {
        errors.push(`Fila ${i + 2}: texto vacío`)
        continue
      }
      const fecha = row.fecha ? parseDate(row.fecha) : null
      sessions.push({
        patient_id:      patientId,
        psychologist_id: user.id,
        raw_text:        row.texto.trim(),
        session_date:    fecha,
      })
    }

    if (sessions.length === 0) {
      return NextResponse.json({ error: "No se encontraron sesiones válidas", errors }, { status: 400 })
    }

    // ── Direct bulk insert (bypasses process_import_initial RPC) ─────────────
    const imported = await bulkInsertSessions(sessions)

    // Mark import as done (fire and forget — non-blocking)
    if (imported > 0) {
      updatePatient(patientId, user.id, { historical_import_done: true }).catch((e) =>
        logger.error("Failed to set historical_import_done", { patientId, error: (e as Error).message })
      )
    }

    logger.info("Sessions imported (direct insert, no AI)", {
      patientId,
      ext,
      imported,
      parseErrors: errors.length,
    })

    return NextResponse.json({ imported, errors, remainingCount: 0, canContinue: false })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/import failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 })
  }
}
