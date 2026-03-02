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

type UploadState = "idle" | "creating" | "done" | "error"
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
  const [audioDurationMin, setAudioDurationMin] = useState(0)
  const [transcribed, setTranscribed] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [hitLimit, setHitLimit] = useState(false)
  const [state, setState] = useState<UploadState>("idle")
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
      setTranscribed(false)
      setHitLimit(false)   // reset; onLimitReached will set it back if the limit was hit
      setAudioDurationMin(Math.round(duration / 60))
      transcribeBlob(blob)
    }
  }

  async function transcribeBlob(blob: Blob) {
    setError(null)
    setTranscribing(true)
    try {
      const fd = new FormData()
      fd.append("audio", blob, "recording.webm")
      const res = await fetch("/api/sessions/transcribe", {
        method: "POST",
        headers: authHeaders(),
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setRawText(data.transcription)
      setAudioDurationMin(Math.round(data.duration_minutes))
      setTranscribed(true)
      setTimeout(() => adjustHeight(), 0)
    } catch (err: unknown) {
      setError((err as Error).message)
    } finally {
      setTranscribing(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const hasNotes = Object.values(sessionNotes).some((v) => v.trim().length > 0)
    if (!rawText.trim() && !hasNotes) {
      setError("Completá al menos un campo para crear la sesión.")
      return
    }

    setState("creating")
    try {
      const sessionNotesPayload = hasNotes ? sessionNotes : undefined
      const feeNum = fee.trim() !== "" ? parseFloat(fee.replace(",", ".")) : undefined

      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          patient_id: patientId,
          raw_text: rawText.trim(),
          session_date: sessionDate || today,
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

  const isCreating = state === "creating"
  const submitLabel = {
    idle: "Guardar sesión",
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
            disabled={isCreating}
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
                disabled={isCreating}
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
                  disabled={isCreating}
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
                disabled={isCreating}
                className="w-full bg-transparent text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-3 pt-3 pb-10 text-sm resize-none focus:outline-none leading-relaxed"
                style={{ minHeight: "80px" }}
                placeholder="Escribí tus notas sobre la sesión..."
              />
              <div className="absolute bottom-2 left-2 flex gap-1.5 flex-wrap">
                {AI_ACTIONS.map(({ action, label, Icon }) => (
                  <button
                    key={action}
                    type="button"
                    disabled={isCreating || aiLoading !== null}
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

          {/* Voice recording — transcribes to text for editing */}
          <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Mic className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400">Grabación de voz</span>
              <span className="text-xs text-gray-400 dark:text-slate-500 ml-auto">límite 2 min</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-slate-500 mb-2">
              Al terminar de grabar, la IA transcribe automáticamente al campo de notas.
              La grabación se detiene sola a los 2 minutos.
            </p>
            {transcribing ? (
              <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border ${
                hitLimit
                  ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
                  : "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
              }`}>
                <Mic className={`w-4 h-4 animate-pulse flex-shrink-0 ${
                  hitLimit ? "text-amber-500" : "text-blue-500"
                }`} />
                <span className={`text-sm flex-1 ${
                  hitLimit
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-blue-700 dark:text-blue-400"
                }`}>
                  {hitLimit
                    ? "Límite de 2 minutos alcanzado. Transcribiendo nota..."
                    : "Transcribiendo con IA..."}
                </span>
              </div>
            ) : transcribed ? (
              <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="text-sm text-emerald-700 dark:text-emerald-400 flex-1">
                  Transcripto · {audioDurationMin > 0 ? `${audioDurationMin} min` : "listo"}
                </span>
                <button
                  type="button"
                  onClick={() => { setTranscribed(false); setHitLimit(false); setAudioDurationMin(0); setRawText("") }}
                  className="text-xs text-gray-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400"
                  disabled={isCreating}
                >
                  Quitar
                </button>
              </div>
            ) : (
              <AIVoiceInput
                onStop={handleVoiceRecorded}
                onLimitReached={() => setHitLimit(true)}
                visualizerBars={32}
              />
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
                  disabled={isCreating}
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
                          disabled={isCreating}
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

          {state === "creating" && (
            <p className="text-xs text-blue-600 dark:text-blue-400 text-center animate-pulse">
              Analizando con IA...
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
            disabled={isCreating}
            className="flex-1 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isCreating}
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
