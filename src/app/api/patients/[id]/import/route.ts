import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById, updatePatient } from "@/lib/repositories/patient.repository"
import {
  insertSession,
  findSessionSummariesByPatient,
  countSessionsThisMonth,
} from "@/lib/repositories/session.repository"
import { generateSessionSummary, generateCaseSummary } from "@/lib/services/openai.service"
import { getOrCreateLimits } from "@/lib/repositories/limits.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"
import Papa from "papaparse"
import * as XLSX from "xlsx"
import type { AiSummary } from "@/lib/repositories/session.repository"

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

    if (ext === "csv" || ext === "txt") {
      const text = await file.text()
      const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
      })
      const fields = result.meta.fields ?? []
      if (!fields.includes("fecha") || !fields.includes("texto")) {
        return NextResponse.json(
          { error: "El archivo debe contener columnas: fecha, texto" },
          { status: 400 }
        )
      }
      rows = result.data.map((r) => ({ fecha: String(r.fecha ?? ""), texto: String(r.texto ?? "") }))
    } else if (ext === "xlsx" || ext === "xls") {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false })
      if (data.length === 0 || !("fecha" in data[0]) || !("texto" in data[0])) {
        return NextResponse.json(
          { error: "El archivo debe contener columnas: fecha, texto" },
          { status: 400 }
        )
      }
      rows = data.map((r) => ({ fecha: String(r.fecha ?? ""), texto: String(r.texto ?? "") }))
    } else {
      return NextResponse.json(
        { error: "Formato no soportado. Usá CSV, XLSX o TXT." },
        { status: 400 }
      )
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "El archivo no contiene filas de datos" }, { status: 400 })
    }

    // Hard cap: prevent mass import abuse regardless of plan limits
    const MAX_IMPORT_ROWS = 200
    if (rows.length > MAX_IMPORT_ROWS) {
      return NextResponse.json(
        { error: `Máximo ${MAX_IMPORT_ROWS} sesiones por importación. El archivo tiene ${rows.length} filas.` },
        { status: 400 }
      )
    }

    // Check session limit before importing
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

        let aiSummaryJson: string | null = null
        try {
          if (row.texto.trim().length > 10) {
            const aiSummary = await generateSessionSummary(row.texto)
            aiSummaryJson = JSON.stringify(aiSummary)
          }
        } catch (aiErr) {
          logger.error("Failed to generate AI summary for imported session", {
            row: i + 2,
            error: (aiErr as Error).message,
          })
        }

        await insertSession({
          patient_id: patientId,
          psychologist_id: user.id,
          raw_text: row.texto,
          transcription: null,
          ai_summary: aiSummaryJson,
          audio_duration: null,
          session_notes: null,
          session_date: sessionDate,
        })

        imported++
      } catch (err) {
        errors.push(`Fila ${i + 2}: ${(err as Error).message}`)
      }
    }

    // Regenerate case summary after import
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
          const caseSummary = await generateCaseSummary(parsedSummaries)
          await updatePatient(patientId, user.id, { case_summary: caseSummary })
        }
      } catch (err) {
        logger.error("Failed to update case_summary after import", {
          patientId,
          error: (err as Error).message,
        })
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
