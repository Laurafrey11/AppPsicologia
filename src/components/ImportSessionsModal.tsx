"use client"

import { useState, useRef } from "react"
import Papa from "papaparse"
import * as XLSX from "xlsx"

interface ImportRow {
  fecha: string
  texto: string
}

interface Props {
  patientId: string
  token: string
  onClose: () => void
  onImported: () => void
}

/**
 * Detects whether dates in a TXT file run oldest→newest or newest→oldest.
 * Compares the first date found in the text with the last date found.
 * Returns "unknown" when fewer than 2 dates are detected or they're equal.
 */
function detectDateOrder(text: string): "oldest-first" | "newest-first" | "unknown" {
  const DATE_RE = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}-\d{1,2}-\d{4})\b/g
  const matches = [...text.matchAll(DATE_RE)]
  if (matches.length < 2) return "unknown"

  function toTs(s: string): number | null {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s + "T12:00:00")
      return isNaN(d.getTime()) ? null : d.getTime()
    }
    const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m1) {
      const d = new Date(`${m1[3]}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}T12:00:00`)
      return isNaN(d.getTime()) ? null : d.getTime()
    }
    const m2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
    if (m2) {
      const d = new Date(`${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}T12:00:00`)
      return isNaN(d.getTime()) ? null : d.getTime()
    }
    return null
  }

  const firstTs = toTs(matches[0][0])
  const lastTs  = toTs(matches[matches.length - 1][0])
  if (firstTs === null || lastTs === null) return "unknown"
  if (firstTs < lastTs) return "oldest-first"
  if (firstTs > lastTs) return "newest-first"
  return "unknown"
}

/**
 * Truncates text to TXT_TRIM_CHARS keeping the OLDEST content,
 * respecting paragraph boundaries (\n\n then \n, then hard cut).
 *
 * oldest-first / unknown → keep head (slice from start)
 * newest-first           → keep tail (slice from end)
 */
function truncateToOldest(
  raw: string,
  maxChars: number,
  trimTarget: number
): string {
  if (raw.length <= maxChars) return raw
  const order = detectDateOrder(raw)
  if (order === "newest-first") {
    // Oldest sessions are at the bottom — keep the tail.
    const searchFrom = Math.max(0, raw.length - trimTarget)
    let cutAt = raw.indexOf("\n\n", searchFrom)
    if (cutAt === -1) cutAt = raw.indexOf("\n", searchFrom)
    return (cutAt !== -1 ? raw.slice(cutAt) : raw.slice(searchFrom)).trimStart()
  }
  // oldest-first or unknown — keep the head.
  let cutAt = raw.lastIndexOf("\n\n", trimTarget)
  if (cutAt === -1) cutAt = raw.lastIndexOf("\n", trimTarget)
  if (cutAt === -1) cutAt = trimTarget
  return raw.slice(0, cutAt).trimEnd()
}

function parseDate(dateStr: string): string | null {
  const s = dateStr.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m1) return `${m1[3]}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`
  const m2 = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`
  return null
}

function formatPreviewDate(dateStr: string): string {
  const iso = parseDate(dateStr)
  if (!iso) return dateStr
  return new Date(iso + "T12:00:00").toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

const CSV_TEMPLATE = `fecha,texto
15/01/2024,"Sesión inicial. El paciente refiere dificultades para conciliar el sueño y alta carga de estrés laboral. Se exploró contexto familiar y laboral."
01/02/2024,"Segunda sesión. Se trabajó sobre estrategias de regulación emocional. El paciente mostró mayor apertura al diálogo."
15/02/2024,"Tercera sesión. Relata mejoría en el descanso nocturno. Se introdujeron técnicas de mindfulness."
`

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement("a")
  a.href     = url
  a.download = "plantilla_sesiones.csv"
  a.click()
  URL.revokeObjectURL(url)
}

export function ImportSessionsModal({ patientId, token, onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [isFreeTxt, setIsFreeTxt] = useState(false)
  const [txtPreview, setTxtPreview] = useState<string>("")
  const [txtTruncated, setTxtTruncated] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const TXT_MAX_CHARS  = 15_000   // backend hard limit (calibrated to Vercel 10s timeout)
  const TXT_TRIM_CHARS = 13_000   // trim target when file exceeds max

  function handleFileSelect(f: File) {
    setFile(f)
    setParseError(null)
    setRows([])
    setIsFreeTxt(false)
    setTxtPreview("")
    setTxtTruncated(false)
    setResult(null)
    const ext = f.name.split(".").pop()?.toLowerCase() ?? ""

    if (ext === "txt") {
      const reader = new FileReader()
      reader.onload = (e) => {
        const raw = (e.target?.result as string) ?? ""
        if (!raw.trim()) {
          setParseError("El archivo de texto está vacío")
          return
        }

        const truncated = raw.length > TXT_MAX_CHARS
        // Compute the preview from the portion that WILL actually be imported,
        // so the preview reflects oldest-content-first regardless of file order.
        // Actual upload truncation is re-applied JIT in handleImport to avoid
        // React state timing issues.
        const previewText = truncateToOldest(raw, TXT_MAX_CHARS, TXT_TRIM_CHARS)

        setIsFreeTxt(true)
        setTxtPreview(previewText.slice(0, 500))
        setTxtTruncated(truncated)
      }
      reader.readAsText(f)
    } else if (ext === "csv") {
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
        const fields = parsed.meta.fields ?? []
        if (!fields.includes("fecha") || !fields.includes("texto")) {
          setParseError("El CSV debe contener columnas: fecha, texto")
          return
        }
        setRows(parsed.data.map((r) => ({ fecha: String(r.fecha ?? ""), texto: String(r.texto ?? "") })))
      }
      reader.readAsText(f)
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader()
      reader.onload = (e) => {
        const buffer = e.target?.result as ArrayBuffer
        const wb = XLSX.read(buffer)
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { raw: false })
        if (data.length === 0 || !("fecha" in data[0]) || !("texto" in data[0])) {
          setParseError("El XLSX debe contener columnas: fecha, texto")
          return
        }
        setRows(data.map((r) => ({ fecha: String(r.fecha ?? ""), texto: String(r.texto ?? "") })))
      }
      reader.readAsArrayBuffer(f)
    } else {
      setParseError("Formato no soportado. Usá TXT, CSV o XLSX.")
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFileSelect(f)
  }

  async function handleImport() {
    if (!file || (rows.length === 0 && !isFreeTxt)) return
    setImporting(true)
    setParseError(null)
    try {
      // JIT truncation: apply here, just before FormData, so we never depend
      // on React state having committed the trimmed File.
      // truncateToOldest detects date order and keeps the OLDEST content,
      // regardless of whether the file is oldest-first or newest-first.
      let uploadFile = file
      if (isFreeTxt) {
        const raw = await file.text()
        const trimmed = truncateToOldest(raw, TXT_MAX_CHARS, TXT_TRIM_CHARS)
        if (trimmed.length !== raw.length) {
          uploadFile = new File([trimmed], file.name, { type: "text/plain" })
        }
      }
      const fd = new FormData()
      fd.append("file", uploadFile)

      // CSV → zero-AI route (no timeout risk).
      // TXT / XLSX → AI-powered route.
      const ext = uploadFile.name.split(".").pop()?.toLowerCase() ?? ""
      const endpoint = ext === "csv"
        ? `/api/patients/${patientId}/import-csv`
        : `/api/patients/${patientId}/import`

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) {
        setParseError(data.error ?? `Error HTTP ${res.status}`)
        return
      }
      setResult(data)
      if (data.imported > 0) onImported()
    } catch (err) {
      setParseError((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-slate-800 p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">
            Importar sesiones históricas
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-2 flex items-start justify-between gap-3">
            <p className="text-xs text-emerald-800 dark:text-emerald-300">
              <span className="font-semibold">CSV (recomendado)</span> — inserción directa, sin IA, sin timeout.
              Columnas requeridas:{" "}
              <code className="bg-emerald-100 dark:bg-emerald-900 px-1 rounded">fecha</code> y{" "}
              <code className="bg-emerald-100 dark:bg-emerald-900 px-1 rounded">texto</code>.
            </p>
            <button
              type="button"
              onClick={downloadTemplate}
              className="flex-shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400 underline underline-offset-2 hover:text-emerald-900 dark:hover:text-emerald-200 whitespace-nowrap"
            >
              Descargar plantilla
            </button>
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500">
            <span className="font-medium text-gray-600 dark:text-slate-400">TXT</span>{" "}
            — OpenAI extrae las sesiones automáticamente (máx. 15 000 caracteres, puede ser lento).
          </p>
        </div>

        {/* Result view */}
        {result ? (
          <div className="space-y-3">
            <div
              className={`rounded-xl px-4 py-3 border ${
                result.imported > 0
                  ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900"
                  : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"
              }`}
            >
              <p
                className={`text-sm font-medium ${
                  result.imported > 0
                    ? "text-emerald-800 dark:text-emerald-300"
                    : "text-amber-800 dark:text-amber-300"
                }`}
              >
                {result.imported > 0
                  ? `✓ ${result.imported} sesión${result.imported !== 1 ? "es" : ""} importada${result.imported !== 1 ? "s" : ""} correctamente`
                  : "No se importaron sesiones"}
              </p>
            </div>

            {result.errors.length > 0 && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1.5">
                  Errores ({result.errors.length})
                </p>
                <ul className="space-y-0.5">
                  {result.errors.map((e, i) => (
                    <li key={i} className="text-xs text-red-600 dark:text-red-400">{e}</li>
                  ))}
                </ul>
              </div>
            )}

            <button
              onClick={onClose}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <>
            {/* Drop zone */}
            <div
              className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30"
                  : "border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls,.txt"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f) }}
              />
              {file ? (
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-slate-200">{file.name}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">Clic para cambiar archivo</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    Arrastrá un archivo o hacé clic para seleccionar
                  </p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">TXT · CSV · XLSX</p>
                </div>
              )}
            </div>

            {/* Parse error */}
            {parseError && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3">
                <p className="text-sm text-red-700 dark:text-red-400">{parseError}</p>
              </div>
            )}

            {/* Free TXT preview */}
            {isFreeTxt && txtPreview && !parseError && (
              <div className="space-y-2">
                {txtTruncated && (
                  <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-0.5">
                      Archivo grande detectado — límite de 15 000 caracteres
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Para garantizar que el procesamiento no falle por timeout, se importará
                      el primer tramo del archivo (hasta 15 000 caracteres).
                      Si el archivo va de más reciente a más antiguo, se conservará el tramo más antiguo.
                      Solo puede realizarse una importación histórica por paciente.
                    </p>
                  </div>
                )}
                <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-4 py-3">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1">
                    Texto libre detectado — OpenAI extraerá las sesiones automáticamente
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-300 font-mono whitespace-pre-wrap line-clamp-4 break-all">
                    {txtPreview}{txtPreview.length >= 500 ? "…" : ""}
                  </p>
                </div>
              </div>
            )}

            {/* Structured preview table (CSV/XLSX) */}
            {rows.length > 0 && !parseError && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">
                  Vista previa · {rows.length} sesión{rows.length !== 1 ? "es" : ""} encontrada{rows.length !== 1 ? "s" : ""}
                </p>
                <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-slate-800">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-slate-400 whitespace-nowrap">
                          Fecha
                        </th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-slate-400">
                          Texto
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      {rows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="bg-white dark:bg-slate-900">
                          <td className="px-3 py-2 text-gray-600 dark:text-slate-300 whitespace-nowrap">
                            {formatPreviewDate(row.fecha)}
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-slate-300 max-w-xs">
                            <span className="block truncate">{row.texto}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length > 5 && (
                    <div className="px-3 py-2 bg-gray-50 dark:bg-slate-800 text-xs text-gray-400 dark:text-slate-500 border-t border-gray-100 dark:border-slate-800">
                      y {rows.length - 5} sesión{rows.length - 5 !== 1 ? "es" : ""} más...
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 text-sm py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={(rows.length === 0 && !isFreeTxt) || importing || !!parseError}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {importing
                  ? "Importando..."
                  : isFreeTxt
                  ? "Importar con IA"
                  : rows.length > 0
                  ? `Confirmar (${rows.length} sesión${rows.length !== 1 ? "es" : ""})`
                  : "Confirmar importación"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
