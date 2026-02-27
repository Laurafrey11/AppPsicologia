"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { SessionCard } from "@/components/SessionCard"
import { NewSessionModal } from "@/components/NewSessionModal"
import { PixelCanvas } from "@/components/ui/pixel-canvas"

interface Patient {
  id: string
  name: string
  age: number
  reason: string
  case_summary: string | null
  is_active: boolean
  created_at: string
}

interface Session {
  id: string
  created_at: string
  raw_text: string
  transcription: string | null
  ai_summary: string | null
  audio_duration: number | null
}

async function apiFetch<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = createSupabaseBrowserClient()

  const [patient, setPatient] = useState<Patient | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewSession, setShowNewSession] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null)
    })
  }, [supabase])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch<{ patient: Patient; sessions: Session[] }>(
        `/api/patients/${id}`,
        token
      )
      setPatient(data.patient)
      setSessions(data.sessions)
    } catch (err: unknown) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id, token])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-gray-400 dark:text-slate-500">Cargando...</p>
      </div>
    )
  }

  if (error || !patient) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-red-500">{error ?? "Paciente no encontrado."}</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-6">
      {/* Patient Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{patient.name}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            {patient.age} años &middot; {new Date(patient.created_at).toLocaleDateString("es-AR", { year: "numeric", month: "long" })}
          </p>
        </div>

        {/* CTA — pixel shimmer */}
        <button
          onClick={() => setShowNewSession(true)}
          className="group relative overflow-hidden bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <PixelCanvas
            gap={6}
            speed={70}
            colors={["#ffffff", "#bfdbfe", "#93c5fd"]}
            noFocus
          />
          <span className="relative z-10">+ Nueva sesión</span>
        </button>
      </div>

      {/* Reason */}
      <section className="mb-6 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
        <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">
          Motivo de consulta
        </h2>
        <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{patient.reason}</p>
      </section>

      {/* Case summary */}
      {patient.case_summary && (
        <section className="mb-6 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 rounded-xl p-5">
          <h2 className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-2">
            Resumen clínico acumulado
          </h2>
          <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{patient.case_summary}</p>
        </section>
      )}

      {/* Sessions */}
      <section>
        <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-3">
          Sesiones ({sessions.length})
        </h2>
        {sessions.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-slate-500 text-sm">
            No hay sesiones aún. Creá la primera sesión con el botón de arriba.
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        )}
      </section>

      {showNewSession && token && (
        <NewSessionModal
          patientId={id}
          token={token}
          onClose={() => setShowNewSession(false)}
          onCreated={load}
        />
      )}
    </div>
  )
}
