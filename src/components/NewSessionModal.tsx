"use client"

import { useState, useRef } from "react"
import { Text, ArrowDownWideNarrow, CheckCheck, Check, X, Edit3, Mic } from "lucide-react"
import { PixelCanvas } from "@/components/ui/pixel-canvas"
import { AIVoiceInput } from "@/components/ui/ai-voice-input"
import { useAutoResizeTextarea } from "@/components/hooks/use-auto-resize-textarea"

interface Props {
  patientId: string
  token: string
  onClose: () => void
  onCreated: () => void
}

type UploadState = "idle" | "requesting-url" | "uploading" | "creating" | "done" | "error"
type AiAction = "summarize" | "condense" | "grammar"

interface SessionNotes {
  motivo_consulta: string
  humor_paciente: string
  hipotesis_clinica: string
  intervenciones: string
  evolucion: string
  plan_proximo: string
}

// humor_paciente: all append (no replace) so multiple emotions can be combined
const CHIPS: Partial<Record<keyof SessionNotes, { label: string }[]>> = {
  motivo_consulta: [
    { label: "Seguimiento" }, { label: "Ansiedad" }, { label: "Duelo" },
    { label: "Crisis" }, { label: "Vínculos" }, { label: "Trabajo" }, { label: "Familia" },
  ],
  humor_paciente: [
    { label: "Ansioso/a" }, { label: "Triste" }, { label: "Estable" },
    { label: "Enojado/a" }, { label: "Eufórico/a" }, { label: "Reflexivo/a" },
    { label: "Bloqueado/a" }, { label: "Disociado/a" }, { label: "Ambivalente" },
    { label: "Angustiado/a" }, { label: "Esperanzado/a" },
  ],
  intervenciones: [
    { label: "Escucha activa" }, { label: "Psicoeducación" },
    { label: "Reestructuración cognitiva" }, { label: "Confrontación" },
    { label: "Silencio terapéutico" }, { label: "Señalamiento" },
  ],
  evolucion: [
    { label: "Sin cambios" }, { label: "Mejoría leve" },
    { label: "Mejoría" }, { label: "Recaída" }, { label: "Crisis aguda" },
  ],
}

const NOTES_FIELDS: { key: keyof SessionNotes; label: string; placeholder: string; replaceOnChip?: boolean }[] = [
  { key: "motivo_consulta", label: "Tema de hoy", placeholder: "¿Por qué consulta el paciente hoy?" },
  { key: "humor_paciente", label: "Humor del paciente", placeholder: "Ej: Ansioso/a, Triste — podés elegir varios" },
  { key: "intervenciones", label: "Intervenciones", placeholder: "Técnicas o intervenciones aplicadas..." },
  { key: "evolucion", label: "Evolución", placeholder: "¿Cómo evolucionó durante la sesión?", replaceOnChip: true },
  { key: "hipotesis_clinica", label: "Hipótesis clínica", placeholder: "Hipótesis tentativas sobre la dinámica..." },
  { key: "plan_proximo", label: "Plan próximo encuentro", placeholder: "Objetivos para la próxima sesión..." },
]

const AI_ACTIONS: { action: AiAction; label: string; Icon: typeof Text }[] = [
  { action: "summarize", label: "Resumir", Icon: Text },
  { action: "condense", label: "Condensar", Icon: ArrowDownWideNarrow },
  { action: "grammar", label: "Ortografía", Icon: CheckCheck },
]

export function NewSessionModal({ patientId, token, onClose, onCreated }: Props) {
  const today = new Date().toISOString().split("T")[0]
  const [sessionDate, setSessionDate] = useState(today)
  const [rawText, setRawText] = useState("")
  const [fee, setFee] = useState<string>("")
  const [sessionNotes, setSessionNotes] = useState<SessionNotes>({
    motivo_consulta: "",
    humor_paciente: "",
    hipotesis_clinica: "",
    intervenciones: "",
    evolucion: "",
    plan_proximo: "",
  })
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioDuration, setAudioDuration] = useState(0)
  const [state, setState] = useState<UploadState>("idle")
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState<AiAction | null>(null)
  const [aiSuggestion, setAiSuggestion] = useState<string>("")
  const [showAiSuggestion, setShowAiSuggestion] = useState(false)

  const suggestionRef = useRef<HTMLDivElement>(null)
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({ minHeight: 80, maxHeight: 200 })

  function authHeaders() {
    return { Authorization: `Bearer ${token}` }
  }

  function updateNote(key: keyof SessionNotes, value: string) {
    setSessionNotes((prev) => ({ ...prev, [key]: value }))
  }

  function applyChip(key: keyof SessionNotes, label: string, replace: boolean) {
    setSessionNotes((prev) => {
      const current = prev[key]
      if (replace || !current.trim()) return { ...prev, [key]: label }
      return { ...prev, [key]: `${current}, ${label}` }
    })
  }

  async function handleAiAction(action: AiAction) {
    if (!rawText.trim()) {
      setError("Escribí alguna nota primero para usar la asistencia IA.")
      return
    }
    setError(null)
    setAiLoading(action)
    setShowAiSuggestion(false)
    try {
      const res = await fetch("/api/sessions/ai-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ text: rawText, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setAiSuggestion(data.result)
      setShowAiSuggestion(true)
      // Scroll suggestion into view
      setTimeout(() => suggestionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50)
    } catch (err: unknown) {
      setError((err as Error).message)
    } finally {
      setAiLoading(null)
    }
  }

  function handleVoiceRecorded(duration: number, blob?: Blob) {
    if (blob) {
      setAudioBlob(blob)
      setAudioDuration(duration)
    }
  }

  async function uploadAudio(blob: Blob): Promise<string> {
    setState("requesting-url")
    const urlRes = await fetch("/api/sessions/upload-url?ext=webm", { headers: authHeaders() })
    if (!urlRes.ok) {
      const b = await urlRes.json().catch(() => ({}))
      throw new Error(b.error ?? "No se pudo obtener la URL de subida")
    }
    const { upload_url, storage_path } = await urlRes.json()
    setState("uploading")
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
      })
      xhr.addEventListener("load", () => xhr.status < 300 ? resolve() : reject(new Error(`Error ${xhr.status}`)))
      xhr.addEventListener("error", () => reject(new Error("Error de red")))
      xhr.open("PUT", upload_url)
      xhr.setRequestHeader("Content-Type", "audio/webm")
      xhr.send(blob)
    })
    return storage_path
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setProgress(0)

    const hasNotes = Object.values(sessionNotes).some((v) => v.trim().length > 0)
    if (!rawText.trim() && !audioBlob && !hasNotes) {
      setError("Completá al menos un campo para crear la sesión.")
      return
    }

    try {
      let audioPath: string | undefined
      if (audioBlob) audioPath = await uploadAudio(audioBlob)

      setState("creating")

      const sessionNotesPayload = hasNotes ? sessionNotes : undefined
      const feeNum = fee.trim() !== "" ? parseFloat(fee.replace(",", ".")) : undefined

      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          patient_id: patientId,
          raw_text: rawText.trim(),
          session_date: sessionDate || today,
          ...(audioPath ? { audio_path: audioPath } : {}),
          ...(sessionNotesPayload ? { session_notes: sessionNotesPayload } : {}),
          ...(feeNum != null && !isNaN(feeNum) ? { fee: feeNum } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      setState("done")
      onCreated()
      onClose()
    } catch (err: unknown) {
      setError((err as Error).message)
      setState("error")
    }
  }

  const isUploading = ["requesting-url", "uploading", "creating"].includes(state)
  const submitLabel = {
    idle: "Guardar sesión",
    "requesting-url": "Preparando...",
    uploading: `Subiendo ${progress}%`,
    creating: "Procesando con IA...",
    done: "Listo",
    error: "Guardar sesión",
  }[state]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 dark:bg-black/70">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-lg border border-gray-200 dark:border-slate-800 flex flex-col max-h-[92vh] sm:max-h-[88vh]"
      >
        {/* Fixed header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">Nueva sesión</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 text-xl leading-none disabled:opacity-40"
          >
            &times;
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Date + Fee row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Fecha de la sesión</label>
              <input
                type="date"
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                disabled={isUploading}
                max={today}
                className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Honorario (opcional)</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 dark:text-slate-500">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  disabled={isUploading}
                  placeholder="0"
                  className="w-full pl-6 pr-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* AI suggestion panel — shown above textarea so it's immediately visible */}
          {showAiSuggestion && (
            <div ref={suggestionRef} className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-blue-200 dark:border-blue-800">
                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Sugerencia IA</span>
                <span className="text-xs text-blue-500 dark:text-blue-500 flex items-center gap-1">
                  <Edit3 className="w-3 h-3" />editá antes de aceptar
                </span>
              </div>
              <textarea
                value={aiSuggestion}
                onChange={(e) => setAiSuggestion(e.target.value)}
                className="w-full bg-transparent text-sm text-gray-800 dark:text-slate-200 px-3 py-3 resize-none focus:outline-none leading-relaxed"
                rows={5}
              />
              <div className="flex gap-2 px-3 pb-3">
                <button
                  type="button"
                  onClick={() => {
                    setRawText(aiSuggestion)
                    setShowAiSuggestion(false)
                    setTimeout(() => adjustHeight(), 0)
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <Check className="w-3 h-3" />Aceptar y reemplazar notas
                </button>
                <button
                  type="button"
                  onClick={() => setShowAiSuggestion(false)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-400 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="w-3 h-3" />Descartar
                </button>
              </div>
            </div>
          )}

          {/* Free notes + AI assist */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-500 dark:text-slate-400">Notas libres</label>
              <span className="text-xs text-gray-400 dark:text-slate-500">opcional · usá IA para mejorarlas</span>
            </div>
            <div className="relative rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 focus-within:border-blue-400 dark:focus-within:border-blue-600 transition-colors">
              <textarea
                ref={textareaRef}
                maxLength={20000}
                value={rawText}
                onChange={(e) => { setRawText(e.target.value); adjustHeight() }}
                disabled={isUploading}
                className="w-full bg-transparent text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-3 pt-3 pb-10 text-sm resize-none focus:outline-none leading-relaxed"
                style={{ minHeight: "80px" }}
                placeholder="Escribí tus notas sobre la sesión..."
              />
              <div className="absolute bottom-2 left-2 flex gap-1.5 flex-wrap">
                {AI_ACTIONS.map(({ action, label, Icon }) => (
                  <button
                    key={action}
                    type="button"
                    disabled={isUploading || aiLoading !== null}
                    onClick={() => handleAiAction(action)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors disabled:opacity-40 ${
                      aiLoading === action
                        ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400"
                        : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:border-blue-300 hover:text-blue-600 dark:hover:text-blue-400"
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {aiLoading === action ? "Procesando..." : label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Voice recording — psychologist's own voice notes */}
          <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Mic className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">Grabación de voz</span>
              <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">máx. 4 min</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-slate-500 mb-2">
              Grabá tus propias notas de voz. La IA transcribe automáticamente.
            </p>
            {audioBlob ? (
              <div className="flex items-center justify-between bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-sm text-gray-700 dark:text-slate-300">Audio grabado ({audioDuration}s)</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setAudioBlob(null); setAudioDuration(0) }}
                  className="text-xs text-red-500 hover:text-red-700 dark:text-red-400"
                  disabled={isUploading}
                >
                  Quitar
                </button>
              </div>
            ) : (
              <AIVoiceInput onStop={handleVoiceRecorded} visualizerBars={32} />
            )}
          </div>

          {/* Structured clinical notes */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
              Estructura clínica (opcional)
            </p>
            {NOTES_FIELDS.map(({ key, label, placeholder, replaceOnChip }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">{label}</label>
                <textarea
                  value={sessionNotes[key]}
                  onChange={(e) => updateNote(key, e.target.value)}
                  disabled={isUploading}
                  maxLength={2000}
                  rows={2}
                  placeholder={placeholder}
                  className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors leading-relaxed"
                />
                {CHIPS[key] && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {CHIPS[key]!.map(({ label: chipLabel }) => {
                      const isSelected = sessionNotes[key].includes(chipLabel)
                      return (
                        <button
                          key={chipLabel}
                          type="button"
                          onClick={() => applyChip(key, chipLabel, replaceOnChip ?? false)}
                          disabled={isUploading}
                          className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors ${
                            isSelected
                              ? "border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400"
                              : "border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:border-blue-300 hover:text-blue-600 dark:hover:border-blue-700 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                          }`}
                        >
                          {chipLabel}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Progress */}
          {state === "uploading" && (
            <div>
              <div className="h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 text-right mt-0.5">{progress}%</p>
            </div>
          )}
          {state === "creating" && (
            <p className="text-xs text-blue-600 dark:text-blue-400 text-center animate-pulse">
              Transcribiendo y analizando con IA...
            </p>
          )}
          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Fixed footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-slate-800 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="flex-1 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isUploading}
            className="group relative flex-1 overflow-hidden bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium py-2 rounded-lg transition-colors"
          >
            <PixelCanvas gap={6} speed={80} colors={["#ffffff", "#bfdbfe", "#93c5fd"]} noFocus />
            <span className="relative z-10">{submitLabel}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
