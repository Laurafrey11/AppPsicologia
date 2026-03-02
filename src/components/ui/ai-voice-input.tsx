"use client"

import { Mic, Square, AlertTriangle } from "lucide-react"
import { useState, useEffect, useRef } from "react"

// Vercel Free plan: 10s function timeout.
// Whisper processes ~1s per minute of audio + network overhead.
// 2 minutes is the safe maximum for the free tier.
const MAX_RECORDING_SECONDS = 2 * 60  // 120 s — hard auto-stop
const WARN_AT_SECONDS       = 110     // red countdown for the last 10 s

interface AIVoiceInputProps {
  onStart?: () => void
  /** Called when recording stops. `autoStopped` is true when the 2-min limit triggered the stop. */
  onStop?: (duration: number, blob?: Blob) => void
  /** Called (in addition to onStop) when the 2-min limit was the reason for stopping. */
  onLimitReached?: () => void
  visualizerBars?: number
  className?: string
}

export function AIVoiceInput({
  onStart,
  onStop,
  onLimitReached,
  visualizerBars = 40,
  className = "",
}: AIVoiceInputProps) {
  const [recording, setRecording] = useState(false)
  const [time, setTime]           = useState(0)
  const [isClient, setIsClient]   = useState(false)
  const [bars, setBars]           = useState<number[]>([])

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef        = useRef<Blob[]>([])
  const streamRef        = useRef<MediaStream | null>(null)
  const animFrameRef     = useRef<number | null>(null)
  const audioCtxRef      = useRef<AudioContext | null>(null)
  // Tracks whether the current stop was triggered by the time limit (not the user).
  const hitLimitRef      = useRef(false)

  useEffect(() => {
    setIsClient(true)
    setBars(Array.from({ length: visualizerBars }, () => 4))
  }, [visualizerBars])

  // Timer + auto-stop at MAX_RECORDING_SECONDS
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => {
      setTime((t) => {
        const next = t + 1
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

  function startVisualizer(stream: MediaStream) {
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 128
    source.connect(analyser)

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const animate = () => {
      analyser.getByteFrequencyData(dataArray)
      const step = Math.floor(dataArray.length / visualizerBars)
      const newBars = Array.from({ length: visualizerBars }, (_, i) => {
        const val = dataArray[i * step] ?? 0
        return Math.max(4, (val / 255) * 32)
      })
      setBars(newBars)
      animFrameRef.current = requestAnimationFrame(animate)
    }
    animate()
  }

  async function startRecording() {
    try {
      hitLimitRef.current = false   // reset on every new recording
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current  = stream
      chunksRef.current  = []       // clear any previous audio buffer

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm"

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob       = new Blob(chunksRef.current, { type: mimeType })
        const wasLimit   = hitLimitRef.current
        hitLimitRef.current = false
        onStop?.(time, blob)
        if (wasLimit) onLimitReached?.()
        streamRef.current?.getTracks().forEach((t) => t.stop())
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
        audioCtxRef.current?.close()
        setBars(Array.from({ length: visualizerBars }, () => 4))
      }

      recorder.start(250)
      startVisualizer(stream)
      setRecording(true)
      setTime(0)
      onStart?.()
    } catch {
      alert("No se pudo acceder al micrófono. Verificá los permisos del navegador.")
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current?.stop()
    }
    setRecording(false)
  }

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`

  const remaining  = MAX_RECORDING_SECONDS - time
  const isWarning  = recording && time >= WARN_AT_SECONDS   // last 10 s → red

  return (
    <div className={`flex flex-col items-center gap-3 py-2 ${className}`}>
      {/* Visualizer bars */}
      <div className="flex items-center justify-center gap-0.5 h-10 w-full">
        {isClient &&
          bars.map((h, i) => (
            <div
              key={i}
              className={`w-0.5 rounded-full transition-all duration-75 ${
                recording
                  ? isWarning
                    ? "bg-red-500 dark:bg-red-400"
                    : "bg-blue-500 dark:bg-blue-400"
                  : "bg-gray-200 dark:bg-slate-700"
              }`}
              style={{ height: `${h}px` }}
            />
          ))}
      </div>

      {/* Timer — MM:SS / 02:00 */}
      <div className="flex items-center gap-2">
        <span
          className={`font-mono text-sm tabular-nums transition-colors ${
            recording
              ? isWarning
                ? "text-red-600 dark:text-red-400 font-bold"
                : "text-blue-600 dark:text-blue-400"
              : "text-gray-400 dark:text-slate-500 opacity-60"
          }`}
        >
          {formatTime(time)}
        </span>
        {recording && (
          <span className="text-xs text-gray-400 dark:text-slate-500">
            / {formatTime(MAX_RECORDING_SECONDS)}
          </span>
        )}
      </div>

      {/* Red warning — last 10 s */}
      {isWarning && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-lg px-3 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Se detiene automáticamente en {formatTime(remaining)}
        </div>
      )}

      {/* Mic / Stop button */}
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        className={`flex items-center justify-center w-12 h-12 rounded-xl transition-all ${
          recording
            ? isWarning
              ? "bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/30"
              : "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30"
            : "bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-600 dark:text-slate-400"
        }`}
        aria-label={recording ? "Detener grabación" : "Iniciar grabación"}
      >
        {recording ? <Square className="w-4 h-4" /> : <Mic className="w-5 h-5" />}
      </button>

      <p className="text-xs text-gray-400 dark:text-slate-500 text-center">
        {recording ? "Grabando... click para detener" : "Click para grabar audio"}
      </p>
    </div>
  )
}
