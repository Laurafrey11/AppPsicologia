import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById, updatePatient } from "@/lib/repositories/patient.repository"
import {
  insertSession,
  findSessionSummariesByPatient,
  countSessionsThisMonth,
  countSessionsByPatient,
} from "@/lib/repositories/session.repository"
import { generateCaseSummary, extractSessionsFromText, generateBatchSessionSummaries } from "@/lib/services/openai.service"
import { getOrCreateLimits } from "@/lib/repositories/limits.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"
import Papa from "papaparse"
import * as XLSX from "xlsx"
import type { AiSummary } from "@/lib/repositories/session.repository"

// ── Serverless budget (Vercel Hobby: 10s timeout) ────────────────────────────
// Worst-case OpenAI calls:
//   TXT  → 1 (extract) + 1 (batch summaries ≤ 10) + 1 (case summary) = 3 calls
//   CSV/XLSX → 0 + 1 (batch summaries ≤ 10) + 1 (case summary) = 2 calls
const MAX_IMPORT_ROWS = 100          // hard cap (was 200)
const MAX_TXT_CHARS   = 50_000
const SUMMARY_THRESHOLD    = 30     // if rows > this, only the last N get summaries
const LAST_N_WITH_SUMMARY  = 10     // how many sessions receive an AI summary

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
    const d = new Date(iso + "T12:00:00")
    return isNaN(d.getTime()) ? null : iso
  }
  const m2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m2) {
    const iso = `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`
    const d = new Date(iso + "T12:00:00")
    return isNaN(d.getTime()) ? null : iso
  }
  return null
}

/** POST /api/patients/[id]/import — import historical sessions from CSV/XLSX/TXT */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const patientId = params.id

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

    // ── TXT path: guards + AI extraction ───────────────────────────────────────
    if (ext === "txt") {
      // Gate 1: block historical import if patient already has sessions
      const existingCount = await countSessionsByPatient(patientId, user.id)
      if (existingCount > 5) {
        return NextResponse.json(
          {
            error:
              "La importación histórica solo está disponible al inicio del seguimiento (máximo 5 sesiones registradas).",
          },
          { status: 409 }
        )
      }

      // Gate 2: one-time import per patient
      if (patient.historical_import_done) {
        return NextResponse.json(
          { error: "La importación histórica ya fue realizada para este paciente." },
          { status: 409 }
        )
      }

      // Validate file content before calling OpenAI
      const text = await file.text()
      if (text.length > MAX_TXT_CHARS) {
        return NextResponse.json(
          { error: `El archivo supera el límite de ${MAX_TXT_CHARS.toLocaleString()} caracteres para importación libre.` },
          { status: 400 }
        )
      }
      if (!text.trim()) {
        return NextResponse.json({ error: "El archivo de texto está vacío" }, { status: 400 })
      }

      // Verify monthly limit BEFORE the first OpenAI call
      const [limits, currentCount] = await Promise.all([
        getOrCreateLimits(user.id),
        countSessionsThisMonth(user.id),
      ])
      const remaining = limits.max_sessions_per_month - currentCount
      if (remaining <= 0) {
        return NextResponse.json(
          { error: "Límite de sesiones mensuales agotado. No podés importar sesiones este mes." },
          { status: 429 }
        )
      }

      // OpenAI call 1 of 3: extract sessions from free-form text
      rows = await extractSessionsFromText(text)

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
      if (rows.length > remaining) {
        return NextResponse.json(
          {
            error: `Límite de sesiones mensuales insuficiente. Podés importar hasta ${remaining} sesión${remaining !== 1 ? "es" : ""} este mes, se detectaron ${rows.length}.`,
          },
          { status: 429 }
        )
      }

    // ── CSV path ────────────────────────────────────────────────────────────────
    } else if (ext === "csv") {
      const text = await file.text()
      const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
      })
      const fields = result.meta.fields ?? []
      if (!fields.includes("fecha") || !fields.includes("texto")) {
        return NextResponse.json(
          { error: "El CSV debe contener columnas: fecha, texto" },
          { status: 400 }
        )
      }
      rows = result.data.map((r) => ({ fecha: String(r.fecha ?? ""), texto: String(r.texto ?? "") }))

    // ── XLSX path ───────────────────────────────────────────────────────────────
    } else if (ext === "xlsx" || ext === "xls") {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false })
      if (data.length === 0 || !("fecha" in data[0]) || !("texto" in data[0])) {
        return NextResponse.json(
          { error: "El XLSX debe contener columnas: fecha, texto" },
          { status: 400 }
        )
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

    // ── CSV/XLSX: hard cap + monthly limit (TXT ran these checks above) ─────────
    if (ext !== "txt") {
      if (rows.length > MAX_IMPORT_ROWS) {
        return NextResponse.json(
          { error: `Máximo ${MAX_IMPORT_ROWS} sesiones por importación. El archivo tiene ${rows.length} filas.` },
          { status: 400 }
        )
      }
      const [limits, currentCount] = await Promise.all([
        getOrCreateLimits(user.id),
        countSessionsThisMonth(user.id),
      ])
      const remaining = limits.max_sessions_per_month - currentCount
      if (rows.length > remaining) {
        return NextResponse.json(
          {
            error: `Límite de sesiones mensuales insuficiente. Podés importar hasta ${Math.max(0, remaining)} sesión${remaining !== 1 ? "es" : ""} este mes.`,
          },
          { status: 429 }
        )
      }
    }

    // ── Pre-loop: batch-generate summaries (sequential, no parallel calls) ──────
    //
    // Strategy to stay within the 10s serverless budget:
    //   • rows > SUMMARY_THRESHOLD (30): only the LAST_N_WITH_SUMMARY (10) sessions
    //     get an AI summary — one batch call regardless of total row count.
    //   • rows ≤ SUMMARY_THRESHOLD: all sessions get summaries — ceil(N/20) calls.
    //
    // The same logic applies to TXT and CSV/XLSX (unified, no per-row individual calls).
    //
    // Worst-case OpenAI calls after this block:
    //   > 30 rows → 1 call   (10 sessions fit in a single chunk of 20)
    //   ≤ 30 rows → ceil(30/20) = 2 calls

    const summaryStartIndex = rows.length > SUMMARY_THRESHOLD
      ? rows.length - LAST_N_WITH_SUMMARY
      : 0

    const batchSummaries: Array<AiSummary | null> = Array.from({ length: rows.length }, () => null)

    const rowsToSummarize = rows.slice(summaryStartIndex)
    if (rowsToSummarize.length > 0) {
      try {
        // OpenAI call 2 of 3 (or 1 of 2 for CSV/XLSX)
        const generated = await generateBatchSessionSummaries(rowsToSummarize)
        for (let i = 0; i < generated.length; i++) {
          batchSummaries[summaryStartIndex + i] = generated[i]
        }
      } catch (err: unknown) {
        logger.error("generateBatchSessionSummaries failed — sessions will import without summaries", {
          patientId,
          summaryStartIndex,
          error: (err as Error).message,
        })
        // batchSummaries stays all-null — import continues without summaries
      }
    }

    logger.info("Summary generation plan", {
      patientId,
      totalRows: rows.length,
      rowsWithSummary: rowsToSummarize.length,
      rowsSkipped: summaryStartIndex,
    })

    // ── Insert loop ─────────────────────────────────────────────────────────────
    let imported = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        if (!row.fecha?.trim() || !row.texto?.trim()) {
          errors.push(`Fila ${i + 2}: campos vacíos`)
          continue
        }

        const sessionDate = parseDate(row.fecha)
        if (!sessionDate) {
          errors.push(`Fila ${i + 2}: fecha inválida "${row.fecha}" (usá YYYY-MM-DD o DD/MM/YYYY)`)
          continue
        }

        // Pre-generated batch summary (null for rows below summaryStartIndex)
        const batchSummary: AiSummary | null = batchSummaries[i] ?? null

        await insertSession({
          patient_id: patientId,
          psychologist_id: user.id,
          raw_text: row.texto,
          transcription: null,
          ai_summary: batchSummary !== null ? JSON.stringify(batchSummary) : null,
          audio_duration: null,
          session_notes: null,
          session_date: sessionDate,
        })

        imported++
      } catch (err: unknown) {
        errors.push(`Fila ${i + 2}: ${(err as Error).message}`)
      }
    }

    // ── Post-insert: case summary + historical flag ──────────────────────────────
    if (imported > 0) {
      try {
        const allSummaries = await findSessionSummariesByPatient(patientId, user.id)
        const parsedSummaries = allSummaries
          .map((s) => {
            if (!s.ai_summary) return null
            try { return JSON.parse(s.ai_summary) as AiSummary } catch { return null }
          })
          .filter((s): s is AiSummary => s !== null)
        if (parsedSummaries.length > 0) {
          // OpenAI call 3 of 3 (or 2 of 2 for CSV/XLSX)
          const caseSummary = await generateCaseSummary(parsedSummaries)
          await updatePatient(patientId, user.id, { case_summary: caseSummary })
        }
      } catch (err) {
        logger.error("Failed to update case_summary after import", {
          patientId,
          error: (err as Error).message,
        })
      }

      if (ext === "txt") {
        try {
          await updatePatient(patientId, user.id, { historical_import_done: true })
        } catch (err) {
          logger.error("Failed to mark historical_import_done", {
            patientId,
            error: (err as Error).message,
          })
        }
      }
    }

    logger.info("Sessions imported", { patientId, imported, errors: errors.length })
    return NextResponse.json({ imported, errors })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("POST /api/patients/[id]/import failed", { error: err.message })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
