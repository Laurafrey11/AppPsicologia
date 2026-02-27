"use client"

import { Mic, Square, AlertTriangle } from "lucide-react"
import { useState, useEffect, useRef } from "react"

// Vercel free plan: 10s function timeout.
// Whisper needs ~1s per minute of audio + overhead.
// Max safe duration for free tier = 4 minutes.
const MAX_RECORDING_SECONDS = 4 * 60 // 4 minutes
const WARN_AT_SECONDS = 3 * 60        // warn at 3 minutes

interface AIVoiceInputProps {
  onStart?: () => void
  onStop?: (duration: number, blob?: Blob) => void
  visualizerBars?: number
  className?: string
}

export function AIVoiceInput({
  onStart,
  onStop,
  visualizerBars = 40,
  className = "",
}: AIVoiceInputProps) {
  const [recording, setRecording] = useState(false)
  const [time, setTime] = useState(0)
  const [isClient, setIsClient] = useState(false)
  const [bars, setBars] = useState<number[]>([])

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm"

      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        onStop?.(time, blob)
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

  const remaining = MAX_RECORDING_SECONDS - time
  const isWarning = recording && time >= WARN_AT_SECONDS

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
                    ? "bg-orange-500 dark:bg-orange-400"
                    : "bg-blue-500 dark:bg-blue-400"
                  : "bg-gray-200 dark:bg-slate-700"
              }`}
              style={{ height: `${h}px` }}
            />
          ))}
      </div>

      {/* Timer */}
      <div className="flex items-center gap-2">
        <span
          className={`font-mono text-sm tabular-nums transition-opacity ${
            recording
              ? isWarning
                ? "text-orange-600 dark:text-orange-400 font-bold"
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

      {/* Warning near limit */}
      {isWarning && (
        <div className="flex items-center gap-1.5 text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/50 border border-orange-200 dark:border-orange-800 rounded-lg px-3 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Se detiene automáticamente en {formatTime(remaining)}
        </div>
      )}

      {/* Mic button */}
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        className={`flex items-center justify-center w-12 h-12 rounded-xl transition-all ${
          recording
            ? "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30"
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
