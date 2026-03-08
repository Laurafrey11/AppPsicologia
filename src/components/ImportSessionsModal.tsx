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
    day: "numeric", month: "short", year: "numeric",
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
  a.href = url; a.download = "plantilla_sesiones.csv"; a.click()
  URL.revokeObjectURL(url)
}

/** Keeps the last `maxChars` characters, respecting paragraph boundaries. */
function keepTail(raw: string, maxChars: number): string {
  if (raw.length <= maxChars) return raw
  const from = raw.length - maxChars
  // Try to start at a clean paragraph boundary (\n\n or \n)
  const pBreak = raw.indexOf("\n\n", from)
  const lBreak = raw.indexOf("\n", from)
  const cut = pBreak !== -1 ? pBreak : lBreak !== -1 ? lBreak : from
  return raw.slice(cut).trimStart()
}

const MAX_CHARS = 15_000

export function ImportSessionsModal({ patientId, token, onClose, onImported }: Props) {
  const [activeTab, setActiveTab] = useState<"csv" | "paste">("paste")

  // CSV tab state
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Paste tab state
  const [pasteText, setPasteText] = useState("")

  // Shared
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null)

  function switchTab(tab: "csv" | "paste") {
    setActiveTab(tab); setParseError(null); setResult(null)
  }

  function handleFileSelect(f: File) {
    setFile(f); setParseError(null); setRows([]); setResult(null)
    const ext = f.name.split(".").pop()?.toLowerCase() ?? ""

    if (ext === "csv") {
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
        const fields = parsed.meta.fields ?? []
        if (!fields.includes("fecha") || !fields.includes("texto")) {
          setParseError("El CSV debe contener columnas: fecha, texto"); return
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
          setParseError("El XLSX debe contener columnas: fecha, texto"); return
        }
        setRows(data.map((r) => ({ fecha: String(r.fecha ?? ""), texto: String(r.texto ?? "") })))
      }
      reader.readAsArrayBuffer(f)
    } else {
      setParseError("Formato no soportado. Usá CSV o XLSX.")
    }
  }

  async function handleImport() {
    setImporting(true); setParseError(null)
    try {
      let fd: FormData
      let endpoint: string

      if (activeTab === "paste") {
        const raw = pasteText.trim()
        if (!raw) { setParseError("El área de texto está vacía"); setImporting(false); return }
        // Always keep the TAIL (most recent sessions) when truncating
        const trimmed = keepTail(raw, MAX_CHARS)
        const uploadFile = new File([trimmed], "historial-pegado.txt", { type: "text/plain" })
        fd = new FormData(); fd.append("file", uploadFile)
        endpoint = `/api/patients/${patientId}/import`
      } else {
        if (!file || rows.length === 0) { setImporting(false); return }
        fd = new FormData(); fd.append("file", file)
        const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
        endpoint = ext === "csv"
          ? `/api/patients/${patientId}/import-csv`
          : `/api/patients/${patientId}/import`
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) { setParseError(data.error ?? `Error HTTP ${res.status}`); return }
      setResult(data)
      if (data.imported > 0) { onImported(); onClose() }
    } catch (err) {
      const msg = (err as Error).message ?? ""
      if (
        msg.toLowerCase().includes("timeout") ||
        msg.toLowerCase().includes("failed to fetch") ||
        msg.toLowerCase().includes("aborted") ||
        msg.toLowerCase().includes("networkerror")
      ) {
        setParseError("Error de red. Verificá tu conexión e intentá de nuevo.")
      } else {
        setParseError(msg)
      }
    } finally {
      setImporting(false)
    }
  }

  const pasteOverLimit = pasteText.length > MAX_CHARS
  const canImportCsv  = rows.length > 0 && !parseError
  const canImportPaste = pasteText.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-slate-800 p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">
            Importar sesiones históricas
          </h3>
          <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 transition-colors text-xl leading-none">×</button>
        </div>

        {/* Tabs */}
        {!result && (
          <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => switchTab("paste")}
              className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${activeTab === "paste" ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 shadow-sm" : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"}`}
            >
              ✨ Pegar texto
            </button>
            <button
              onClick={() => switchTab("csv")}
              className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${activeTab === "csv" ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 shadow-sm" : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"}`}
            >
              CSV / XLSX
            </button>
          </div>
        )}

        {/* ── Result ───────────────────────────────────────────────── */}
        {result ? (
          <div className="space-y-3">
            <div className={`rounded-xl px-4 py-4 border ${result.imported > 0 ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900" : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900"}`}>
              <p className={`text-sm font-semibold ${result.imported > 0 ? "text-emerald-800 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"}`}>
                {result.imported > 0
                  ? `✓ Se han importado ${result.imported} sesión${result.imported !== 1 ? "es" : ""} exitosamente. Ya podés verlas en la cronología del paciente.`
                  : "No se importaron sesiones."}
              </p>
            </div>

            {result.errors.length > 0 && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1.5">Errores ({result.errors.length})</p>
                <ul className="space-y-0.5">
                  {result.errors.map((e, i) => <li key={i} className="text-xs text-red-600 dark:text-red-400">{e}</li>)}
                </ul>
              </div>
            )}

            <button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg transition-colors">
              Cerrar
            </button>
          </div>

        ) : activeTab === "paste" ? (
          /* ── Paste tab ─────────────────────────────────────────── */
          <>
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-2">
              <p className="text-xs text-blue-800 dark:text-blue-300">
                <span className="font-semibold">Pegado automático</span> — pegá el historial en texto libre. Detectamos sesiones por fechas (15/03/2024) o párrafos separados. Si no hay fechas, se guarda como una sesión. El análisis clínico lo podés ejecutar después.
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-500 dark:text-slate-400">Historial de sesiones</label>
                <span className={`text-xs tabular-nums ${pasteOverLimit ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-gray-400 dark:text-slate-500"}`}>
                  {pasteText.length.toLocaleString("es-AR")} / {MAX_CHARS.toLocaleString("es-AR")}
                </span>
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setParseError(null) }}
                rows={10}
                placeholder={`Ejemplo:\n\n15/01/2024\nEl paciente llegó angustiado. Refirió conflictos con su pareja...\n\n01/02/2024\nSesión productiva. Se trabajó sobre regulación emocional...`}
                className="text-sm border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2.5 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors resize-y font-mono"
              />
            </div>

            {pasteOverLimit && (
              <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5">
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Texto extenso — se procesarán todas las sesiones detectadas. Podés dividirlo en varias importaciones si preferís.
                </p>
              </div>
            )}

            {parseError && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3">
                <p className="text-sm text-red-700 dark:text-red-400">{parseError}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 text-sm py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={!canImportPaste || importing}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {importing ? "Importando..." : "Importar sesiones"}
              </button>
            </div>
          </>

        ) : (
          /* ── CSV tab ───────────────────────────────────────────── */
          <>
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-2 flex items-start justify-between gap-3">
              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                <span className="font-semibold">Sin IA, sin timeout.</span> Columnas requeridas:{" "}
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

            {/* Drop zone */}
            <div
              className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30" : "border-gray-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700"}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f) }}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
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
                  <p className="text-sm text-gray-500 dark:text-slate-400">Arrastrá un archivo o hacé clic para seleccionar</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">CSV · XLSX</p>
                </div>
              )}
            </div>

            {parseError && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3">
                <p className="text-sm text-red-700 dark:text-red-400">{parseError}</p>
              </div>
            )}

            {/* Preview table */}
            {rows.length > 0 && !parseError && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400">
                  Vista previa · {rows.length} sesión{rows.length !== 1 ? "es" : ""} encontrada{rows.length !== 1 ? "s" : ""}
                </p>
                <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-slate-800">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-slate-400 whitespace-nowrap">Fecha</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-500 dark:text-slate-400">Texto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      {rows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="bg-white dark:bg-slate-900">
                          <td className="px-3 py-2 text-gray-600 dark:text-slate-300 whitespace-nowrap">{formatPreviewDate(row.fecha)}</td>
                          <td className="px-3 py-2 text-gray-600 dark:text-slate-300 max-w-xs"><span className="block truncate">{row.texto}</span></td>
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

            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 text-sm py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleImport}
                disabled={!canImportCsv || importing}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {importing ? "Importando..." : rows.length > 0 ? `Confirmar (${rows.length} sesión${rows.length !== 1 ? "es" : ""})` : "Confirmar importación"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
