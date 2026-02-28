"use client"

import { useState, useRef } from "react"
import { Text, ArrowDownWideNarrow, CheckCheck, Check, X, Edit3 } from "lucide-react"
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
type Tab = "estructura" | "notas"

interface SessionNotes {
  motivo_consulta: string
  hipotesis_clinica: string
  intervenciones: string
  evolucion: string
  plan_proximo: string
}

const NOTES_FIELDS: { key: keyof SessionNotes; label: string; placeholder: string }[] = [
  { key: "motivo_consulta", label: "Motivo de consulta", placeholder: "¿Por qué consulta el paciente hoy?" },
  { key: "hipotesis_clinica", label: "Hipótesis clínica", placeholder: "Hipótesis tentativas sobre la dinámica del caso..." },
  { key: "intervenciones", label: "Intervenciones realizadas", placeholder: "Técnicas, interpretaciones o intervenciones aplicadas..." },
  { key: "evolucion", label: "Evolución", placeholder: "Cómo evolucionó el paciente durante la sesión..." },
  { key: "plan_proximo", label: "Plan próximo encuentro", placeholder: "Objetivos o temas para la próxima sesión..." },
]

const AI_ACTIONS: { action: AiAction; label: string; Icon: typeof Text; color: string; borderColor: string; bgColor: string }[] = [
  {
    action: "summarize",
    label: "Resumir",
    Icon: Text,
    color: "text-orange-600 dark:text-orange-400",
    borderColor: "border-orange-400 dark:border-orange-600",
    bgColor: "bg-orange-50 dark:bg-orange-950/50",
  },
  {
    action: "condense",
    label: "Condensar",
    Icon: ArrowDownWideNarrow,
    color: "text-purple-600 dark:text-purple-400",
    borderColor: "border-purple-400 dark:border-purple-600",
    bgColor: "bg-purple-50 dark:bg-purple-950/50",
  },
  {
    action: "grammar",
    label: "Ortografía",
    Icon: CheckCheck,
    color: "text-emerald-600 dark:text-emerald-400",
    borderColor: "border-emerald-400 dark:border-emerald-600",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/50",
  },
]

export function NewSessionModal({ patientId, token, onClose, onCreated }: Props) {
  const [tab, setTab] = useState<Tab>("estructura")
  const [rawText, setRawText] = useState("")
  const [fee, setFee] = useState<string>("")
  const [sessionNotes, setSessionNotes] = useState<SessionNotes>({
    motivo_consulta: "",
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

  // AI assist state
  const [aiLoading, setAiLoading] = useState<AiAction | null>(null)
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null)
  const [aiSuggestionEditable, setAiSuggestionEditable] = useState("")
  const [showAiSuggestion, setShowAiSuggestion] = useState(false)

  const { textareaRef, adjustHeight } = useAutoResizeTextarea({ minHeight: 120, maxHeight: 300 })

  function authHeaders() {
    return { Authorization: `Bearer ${token}` }
  }

  function updateNote(key: keyof SessionNotes, value: string) {
    setSessionNotes((prev) => ({ ...prev, [key]: value }))
  }

  // ── AI assist ─────────────────────────────────────────────────────────────
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
      setAiSuggestionEditable(data.result)
      setShowAiSuggestion(true)
    } catch (err: unknown) {
      setError((err as Error).message)
    } finally {
      setAiLoading(null)
    }
  }

  function acceptSuggestion() {
    setRawText(aiSuggestionEditable)
    setShowAiSuggestion(false)
    setAiSuggestion(null)
    setTimeout(() => adjustHeight(), 0)
  }

  function dismissSuggestion() {
    setShowAiSuggestion(false)
    setAiSuggestion(null)
  }

  // ── Audio ─────────────────────────────────────────────────────────────────
  function handleVoiceRecorded(duration: number, blob?: Blob) {
    if (blob) {
      setAudioBlob(blob)
      setAudioDuration(duration)
    }
  }

  async function uploadAudio(blob: Blob): Promise<string> {
    setState("requesting-url")
    const urlRes = await fetch("/api/sessions/upload-url?ext=webm", {
      headers: authHeaders(),
    })
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

  // ── Submit ────────────────────────────────────────────────────────────────
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
      if (audioBlob) {
        audioPath = await uploadAudio(audioBlob)
      }

      setState("creating")

      // Only include session_notes if at least one field is non-empty
      const sessionNotesPayload = hasNotes ? sessionNotes : undefined

      const feeNum = fee.trim() !== "" ? parseFloat(fee.replace(",", ".")) : undefined

      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          patient_id: patientId,
          raw_text: rawText.trim(),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/70 overflow-y-auto py-6">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 border border-gray-200 dark:border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Nueva sesión</h2>
          <button
            onClick={onClose}
            disabled={isUploading}
            className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 text-xl leading-none disabled:opacity-40"
          >
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-slate-800 px-6">
          <button
            type="button"
            onClick={() => setTab("estructura")}
            className={`py-3 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${
              tab === "estructura"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"
            }`}
          >
            Estructura clínica
          </button>
          <button
            type="button"
            onClick={() => setTab("notas")}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              tab === "notas"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300"
            }`}
          >
            Notas &amp; Audio
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* ── Tab: Estructura clínica ── */}
          {tab === "estructura" && (
            <div className="space-y-4">
              <p className="text-xs text-gray-400 dark:text-slate-500">
                Completá los campos que correspondan. Toda la información ingresada será analizada por IA.
              </p>

              {/* Fee */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Honorario <span className="text-gray-400 dark:text-slate-500 font-normal text-xs">(opcional)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 dark:text-slate-500">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={fee}
                    onChange={(e) => setFee(e.target.value)}
                    disabled={isUploading}
                    placeholder="0"
                    className="w-full pl-7 pr-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 text-sm focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors"
                  />
                </div>
              </div>
              {NOTES_FIELDS.map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                    {label}
                  </label>
                  <textarea
                    value={sessionNotes[key]}
                    onChange={(e) => updateNote(key, e.target.value)}
                    disabled={isUploading}
                    maxLength={2000}
                    rows={3}
                    placeholder={placeholder}
                    className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-4 py-3 text-sm resize-none focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors leading-relaxed"
                  />
                </div>
              ))}
            </div>
          )}

          {/* ── Tab: Notas & Audio ── */}
          {tab === "notas" && (
            <>
              {/* Notes + AI actions */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-slate-300">
                    Notas libres
                  </label>
                  <span className="text-xs text-gray-400 dark:text-slate-500">opcional</span>
                </div>

                <div className="relative rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 focus-within:border-blue-400 dark:focus-within:border-blue-600 transition-colors">
                  <textarea
                    ref={textareaRef}
                    maxLength={20000}
                    value={rawText}
                    onChange={(e) => {
                      setRawText(e.target.value)
                      adjustHeight()
                    }}
                    disabled={isUploading}
                    className="w-full bg-transparent text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-4 pt-3 pb-12 text-sm resize-none focus:outline-none leading-relaxed"
                    style={{ minHeight: "120px" }}
                    placeholder="Escribí tus notas sobre la sesión..."
                  />

                  {/* AI action pills — bottom of textarea */}
                  <div className="absolute bottom-2 left-3 flex gap-1.5 flex-wrap">
                    {AI_ACTIONS.map(({ action, label, Icon, color }) => (
                      <button
                        key={action}
                        type="button"
                        disabled={isUploading || aiLoading !== null}
                        onClick={() => handleAiAction(action)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border transition-colors disabled:opacity-40 ${
                          aiLoading === action
                            ? "border-blue-400 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400"
                            : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:border-gray-300 dark:hover:border-slate-600"
                        }`}
                      >
                        <Icon className={`w-3 h-3 ${aiLoading === action ? "text-blue-500" : color}`} />
                        {aiLoading === action ? "Procesando..." : label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* AI suggestion */}
              {showAiSuggestion && aiSuggestion !== null && (
                <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-blue-200 dark:border-blue-800">
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                      Sugerencia IA
                    </span>
                    <span className="text-xs text-blue-500 dark:text-blue-500 flex items-center gap-1">
                      <Edit3 className="w-3 h-3" />
                      podés editarla antes de aceptar
                    </span>
                  </div>
                  <textarea
                    value={aiSuggestionEditable}
                    onChange={(e) => setAiSuggestionEditable(e.target.value)}
                    className="w-full bg-transparent text-sm text-gray-800 dark:text-slate-200 px-4 py-3 resize-none focus:outline-none leading-relaxed"
                    rows={5}
                  />
                  <div className="flex gap-2 px-4 pb-3">
                    <button
                      type="button"
                      onClick={acceptSuggestion}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Aceptar y reemplazar notas
                    </button>
                    <button
                      type="button"
                      onClick={dismissSuggestion}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-slate-400 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      Descartar
                    </button>
                  </div>
                </div>
              )}

              {/* Voice recording */}
              <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Grabación de audio</span>
                  <span className="text-xs text-gray-400 dark:text-slate-500">opcional · máx. 4 min</span>
                </div>
                <p className="text-xs text-gray-400 dark:text-slate-500 mb-3">
                  Grabá notas de voz cortas. La IA las transcribe y resume automáticamente.
                  Para sesiones largas, preferí escribir las notas en el campo de arriba.
                </p>

                {audioBlob ? (
                  <div className="flex items-center justify-between bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-sm text-gray-700 dark:text-slate-300">
                        Audio grabado ({audioDuration}s)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setAudioBlob(null); setAudioDuration(0) }}
                      className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      disabled={isUploading}
                    >
                      Quitar
                    </button>
                  </div>
                ) : (
                  <AIVoiceInput onStop={handleVoiceRecorded} visualizerBars={40} />
                )}
              </div>
            </>
          )}

          {/* Upload progress */}
          {state === "uploading" && (
            <div>
              <div className="h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1 text-right">{progress}%</p>
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

          {/* Actions */}
          <div className="flex gap-3">
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
    </div>
  )
}
