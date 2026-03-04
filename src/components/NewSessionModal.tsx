"use client"

import { useState, useRef, useEffect } from "react"
import { Text, ArrowDownWideNarrow, CheckCheck, Check, X, Edit3, Mic, Square } from "lucide-react"
import { PixelCanvas } from "@/components/ui/pixel-canvas"
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
  { action: "summarize", label: "Resumir",     Icon: Text },
  { action: "condense",  label: "Condensar",   Icon: ArrowDownWideNarrow },
  { action: "grammar",   label: "Ortografía",  Icon: CheckCheck },
]

const MAX_RECORDING_SECONDS = 120  // 2 min hard stop
const WARN_AT_SECONDS       = 110  // red warning for last 10 s
const BARS_COUNT            = 14   // compact waveform bar count

function formatTime(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`
}

export function NewSessionModal({ patientId, token, onClose, onCreated }: Props) {
  const today = new Date().toISOString().split("T")[0]
  const [sessionDate, setSessionDate]     = useState(today)
  const [rawText, setRawText]             = useState("")
  const [fee, setFee]                     = useState<string>("")
  const [sessionNotes, setSessionNotes]   = useState<SessionNotes>({
    motivo_consulta: "", humor_paciente: "", hipotesis_clinica: "",
    intervenciones: "", evolucion: "", plan_proximo: "",
  })
  const [audioDurationMin, setAudioDurationMin] = useState(0)
  const [transcribed, setTranscribed]     = useState(false)
  const [transcribing, setTranscribing]   = useState(false)
  const [hitLimit, setHitLimit]           = useState(false)
  const [state, setState]                 = useState<UploadState>("idle")
  const [error, setError]                 = useState<string | null>(null)
  const [aiLoading, setAiLoading]         = useState<AiAction | null>(null)
  const [aiSuggestion, setAiSuggestion]   = useState<string>("")
  const [showAiSuggestion, setShowAiSuggestion] = useState(false)

  // ── Inline recording state ───────────────────────────────────────────────────
  const [recording, setRecording]         = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [recordingBars, setRecordingBars] = useState<number[]>([])

  const mediaRecorderRef  = useRef<MediaRecorder | null>(null)
  const chunksRef         = useRef<Blob[]>([])
  const streamRef         = useRef<MediaStream | null>(null)
  const animFrameRef      = useRef<number | null>(null)
  const audioCtxRef       = useRef<AudioContext | null>(null)
  const hitLimitRef       = useRef(false)
  const recordingTimeRef  = useRef(0)

  const suggestionRef = useRef<HTMLDivElement>(null)
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({ minHeight: 100, maxHeight: 220 })

  // Timer + auto-stop at 2 min
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => {
      setRecordingTime((t) => {
        const next = t + 1
        recordingTimeRef.current = next
        if (next >= MAX_RECORDING_SECONDS) {
          hitLimitRef.current = true
          stopRecording()
        }
        return next
      })
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording])

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
    if (!rawText.trim()) { setError("Escribí alguna nota primero para usar la asistencia IA."); return }
    setError(null); setAiLoading(action); setShowAiSuggestion(false)
    try {
      const res = await fetch("/api/sessions/ai-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ text: rawText, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setAiSuggestion(data.result); setShowAiSuggestion(true)
      setTimeout(() => suggestionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50)
    } catch (err: unknown) {
      setError((err as Error).message)
    } finally {
      setAiLoading(null)
    }
  }

  // ── Recording functions ──────────────────────────────────────────────────────

  async function startRecording() {
    try {
      hitLimitRef.current = false
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm"
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob     = new Blob(chunksRef.current, { type: mimeType })
        const wasLimit = hitLimitRef.current
        hitLimitRef.current = false
        setRecording(false)
        setRecordingTime(0)
        setRecordingBars([])
        streamRef.current?.getTracks().forEach((t) => t.stop())
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
        audioCtxRef.current?.close()
        handleVoiceRecorded(recordingTimeRef.current, blob, wasLimit)
      }

      // Waveform analyser
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source   = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      source.connect(analyser)
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const animate = () => {
        analyser.getByteFrequencyData(dataArray)
        const step = Math.floor(dataArray.length / BARS_COUNT)
        setRecordingBars(Array.from({ length: BARS_COUNT }, (_, i) => {
          const val = dataArray[i * step] ?? 0
          return Math.max(3, (val / 255) * 18)
        }))
        animFrameRef.current = requestAnimationFrame(animate)
      }
      animate()

      recorder.start(250)
      setRecording(true)
      setRecordingTime(0)
      recordingTimeRef.current = 0
    } catch {
      setError("No se pudo acceder al micrófono. Verificá los permisos del navegador.")
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current?.stop()
    }
  }

  function handleVoiceRecorded(duration: number, blob: Blob, wasLimit: boolean) {
    setTranscribed(false)
    setHitLimit(wasLimit)
    setAudioDurationMin(Math.round(duration / 60))
    transcribeBlob(blob)
  }

  async function transcribeBlob(blob: Blob) {
    setError(null); setTranscribing(true)
    try {
      const fd = new FormData()
      fd.append("audio", blob, "recording.webm")
      const res = await fetch("/api/sessions/transcribe", {
        method: "POST", headers: authHeaders(), body: fd,
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

  function resetAudio() {
    setTranscribed(false); setHitLimit(false); setAudioDurationMin(0); setRawText("")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    const hasNotes = Object.values(sessionNotes).some((v) => v.trim().length > 0)
    if (!rawText.trim() && !hasNotes) {
      setError("Completá al menos un campo para crear la sesión."); return
    }
    setState("creating")
    try {
      const feeNum = fee.trim() !== "" ? parseFloat(fee.replace(",", ".")) : undefined
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          patient_id:   patientId,
          raw_text:     rawText.trim(),
          session_date: sessionDate || today,
          ...(hasNotes       ? { session_notes: sessionNotes } : {}),
          ...(feeNum != null && !isNaN(feeNum) ? { fee: feeNum } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setState("done"); onCreated(); onClose()
    } catch (err: unknown) {
      setError((err as Error).message); setState("error")
    }
  }

  const isCreating  = state === "creating"
  const isWarning   = recording && recordingTime >= WARN_AT_SECONDS
  const submitLabel = { idle: "Guardar sesión", creating: "Guardando...", done: "Listo", error: "Guardar sesión" }[state]

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
            type="button" onClick={onClose} disabled={isCreating}
            className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 text-xl leading-none disabled:opacity-40"
          >&times;</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

          {/* Date + Fee row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Fecha de la sesión</label>
              <input
                type="date" value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                disabled={isCreating} max={today}
                className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Honorario (opcional)</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 dark:text-slate-500">$</span>
                <input
                  type="number" min="0" step="0.01" value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  disabled={isCreating} placeholder="0"
                  className="w-full pl-6 pr-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:border-blue-400 dark:focus:border-blue-500 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* AI suggestion panel */}
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
                  onClick={() => { setRawText(aiSuggestion); setShowAiSuggestion(false); setTimeout(() => adjustHeight(), 0) }}
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

          {/* ── Notas libres — integrated textarea with toolbar + mic ────────── */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">
              Notas libres
            </label>

            <div className="relative rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 focus-within:border-blue-400 dark:focus-within:border-blue-600 transition-colors overflow-hidden">

              {/* TOP TOOLBAR — AI actions */}
              <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-1 border-b border-gray-100 dark:border-slate-700/60">
                {AI_ACTIONS.map(({ action, label, Icon }) => (
                  <button
                    key={action}
                    type="button"
                    disabled={isCreating || aiLoading !== null}
                    onClick={() => handleAiAction(action)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors disabled:opacity-40 ${
                      aiLoading === action
                        ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 font-medium"
                        : "text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {aiLoading === action ? "Procesando..." : label}
                  </button>
                ))}
              </div>

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                maxLength={20000}
                value={rawText}
                onChange={(e) => { setRawText(e.target.value); adjustHeight() }}
                disabled={isCreating}
                className="w-full bg-transparent text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-3 pt-2.5 pb-10 text-sm resize-none focus:outline-none leading-relaxed"
                style={{ minHeight: "100px" }}
                placeholder="Escribí tus notas sobre la sesión..."
              />

              {/* BOTTOM-RIGHT — Mic / Recording controls */}
              <div className="absolute bottom-2 right-2.5 flex items-center gap-2">

                {/* Transcribing state */}
                {transcribing && (
                  <span className="text-xs text-blue-500 dark:text-blue-400 animate-pulse flex items-center gap-1">
                    <Mic className="w-3 h-3" />
                    {hitLimit ? "Límite alcanzado · transcribiendo..." : "Transcribiendo..."}
                  </span>
                )}

                {/* Transcribed confirmation */}
                {!transcribing && transcribed && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                    Transcripto{audioDurationMin > 0 ? ` · ${audioDurationMin} min` : ""}
                    <button
                      type="button" onClick={resetAudio} disabled={isCreating}
                      className="ml-0.5 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors leading-none"
                      title="Quitar transcripción"
                    >×</button>
                  </span>
                )}

                {/* Recording active: waveform + timer + stop button */}
                {recording && (
                  <>
                    {/* Mini waveform */}
                    <div className="flex items-end gap-px h-4">
                      {recordingBars.map((h, i) => (
                        <div
                          key={i}
                          className={`w-0.5 rounded-full transition-all duration-75 ${
                            isWarning ? "bg-red-500 dark:bg-red-400" : "bg-blue-500 dark:bg-blue-400"
                          }`}
                          style={{ height: `${Math.min(h, 16)}px` }}
                        />
                      ))}
                    </div>
                    {/* Timer */}
                    <span className={`text-xs font-mono tabular-nums ${
                      isWarning ? "text-red-600 dark:text-red-400 font-bold" : "text-blue-600 dark:text-blue-400"
                    }`}>
                      {formatTime(recordingTime)}
                    </span>
                  </>
                )}

                {/* Stop button (recording) or Mic button (idle) */}
                {!transcribing && (
                  recording ? (
                    <button
                      type="button" onClick={stopRecording}
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-white flex-shrink-0 transition-colors ${
                        isWarning
                          ? "bg-red-600 hover:bg-red-700 shadow-sm shadow-red-600/30"
                          : "bg-red-500 hover:bg-red-600 shadow-sm shadow-red-500/20"
                      }`}
                      aria-label="Detener grabación"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                    </button>
                  ) : !transcribed ? (
                    <button
                      type="button" onClick={startRecording} disabled={isCreating}
                      className="w-7 h-7 rounded-full bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 flex items-center justify-center text-gray-500 dark:text-slate-400 transition-colors disabled:opacity-40 flex-shrink-0"
                      aria-label="Grabar audio"
                      title="Grabar nota de voz"
                    >
                      <Mic className="w-3.5 h-3.5" />
                    </button>
                  ) : null
                )}
              </div>
            </div>

            {/* Privacy note */}
            <p className="flex items-center gap-1 mt-1.5 text-xs text-gray-400 dark:text-slate-500">
              <span className="text-gray-400 dark:text-slate-600 text-xs leading-none select-none">ℹ</span>
              La grabación se detiene automáticamente a los 2 min · la IA transcribe al terminar
            </p>
          </div>

          {/* ── Structured clinical notes ────────────────────────────────────── */}
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

          {isCreating && (
            <p className="text-xs text-blue-600 dark:text-blue-400 text-center animate-pulse">
              Guardando sesión...
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
            type="button" onClick={onClose} disabled={isCreating}
            className="flex-1 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit" disabled={isCreating}
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
