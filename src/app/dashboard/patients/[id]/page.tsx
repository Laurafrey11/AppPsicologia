"use client"

export const dynamic = "force-dynamic"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { SessionCard } from "@/components/SessionCard"
import { NewSessionModal } from "@/components/NewSessionModal"
import { PixelCanvas } from "@/components/ui/pixel-canvas"
import { PatientMetrics } from "@/components/PatientMetrics"

interface Patient {
  id: string
  name: string
  age: number
  reason: string
  case_summary: string | null
  is_active: boolean
  recording_consent_at: string | null
  created_at: string
}

interface SessionNotes {
  motivo_consulta: string
  hipotesis_clinica: string
  intervenciones: string
  evolucion: string
  plan_proximo: string
}

interface Session {
  id: string
  created_at: string
  raw_text: string
  transcription: string | null
  ai_summary: string | null
  audio_duration: number | null
  session_notes: SessionNotes | null
  paid: boolean
  fee: number | null
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
  const router = useRouter()

  const [patient, setPatient] = useState<Patient | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewSession, setShowNewSession] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")

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

  useEffect(() => { load() }, [load])

  async function handleExport() {
    if (!token) return
    const res = await fetch(`/api/patients/${id}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `expediente-${patient?.name.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleDelete() {
    if (!token || deleteConfirmText !== patient?.name) return
    setDeleting(true)
    try {
      await apiFetch(`/api/patients/${id}`, token, { method: "DELETE" })
      router.push("/dashboard")
      router.refresh()
    } catch (err: unknown) {
      setError((err as Error).message)
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  async function handleToggleActive() {
    if (!token || !patient) return
    const updated = await apiFetch<Patient>(`/api/patients/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !patient.is_active }),
    })
    setPatient(updated)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400 dark:text-slate-500">Cargando...</p>
    </div>
  )

  if (error || !patient) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-red-500">{error ?? "Paciente no encontrado."}</p>
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto py-8 px-6">
      {/* Patient Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{patient.name}</h1>
            {!patient.is_active && (
              <span className="text-xs bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-2 py-0.5 rounded-full border border-gray-200 dark:border-slate-700">
                Inactivo
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            {patient.age} años &middot; {new Date(patient.created_at).toLocaleDateString("es-AR", { year: "numeric", month: "long" })}
          </p>
        </div>

        <button
          onClick={() => setShowNewSession(true)}
          className="group relative overflow-hidden bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex-shrink-0"
        >
          <PixelCanvas gap={6} speed={70} colors={["#ffffff", "#bfdbfe", "#93c5fd"]} noFocus />
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

      {/* Patient Metrics */}
      <PatientMetrics sessions={sessions} />

      {/* Sessions */}
      <section className="mb-8">
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
              <SessionCard key={s.id} session={s} token={token!} onUpdate={load} />
            ))}
          </div>
        )}
      </section>

      {/* Privacy & Data Management */}
      <section className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 space-y-4">
        <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
          Privacidad y gestión de datos
        </h2>

        {/* Consent status */}
        <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-slate-800">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">Consentimiento para grabación</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
              {patient.recording_consent_at
                ? `Otorgado el ${new Date(patient.recording_consent_at).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}`
                : "No registrado · Se solicitará al grabar"}
            </p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
            patient.recording_consent_at
              ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
              : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400"
          }`}>
            {patient.recording_consent_at ? "✓ Dado" : "Pendiente"}
          </span>
        </div>

        {/* Export */}
        <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-slate-800">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">Exportar expediente completo</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
              Descarga todas las sesiones, notas y análisis en formato HTML imprimible (PDF)
            </p>
          </div>
          <button
            onClick={handleExport}
            className="text-sm text-blue-600 dark:text-blue-400 font-medium hover:underline flex-shrink-0 ml-4"
          >
            Exportar
          </button>
        </div>

        {/* Toggle active */}
        <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-slate-800">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
              {patient.is_active ? "Dar de baja al paciente" : "Reactivar paciente"}
            </p>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
              {patient.is_active ? "Lo marca como inactivo pero conserva todos sus datos" : "Vuelve a marcarlo como activo"}
            </p>
          </div>
          <button
            onClick={handleToggleActive}
            className={`text-sm font-medium hover:underline flex-shrink-0 ml-4 ${
              patient.is_active ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {patient.is_active ? "Dar de baja" : "Reactivar"}
          </button>
        </div>

        {/* Delete */}
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium text-red-600 dark:text-red-400">Eliminar todos los datos</p>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
              Elimina permanentemente al paciente y todas sus sesiones · Ley 25.326 art. 6°
            </p>
          </div>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="text-sm text-red-600 dark:text-red-400 font-medium hover:underline flex-shrink-0 ml-4"
          >
            Eliminar
          </button>
        </div>
      </section>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md border border-red-200 dark:border-red-900 p-6">
            <h3 className="text-base font-semibold text-red-700 dark:text-red-400 mb-2">
              Eliminar datos de {patient.name}
            </h3>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
              Esta acción es <strong>irreversible</strong>. Se eliminarán el paciente y todas sus sesiones, notas y análisis de forma permanente.
            </p>
            <p className="text-sm text-gray-700 dark:text-slate-300 mb-2">
              Para confirmar, escribí el nombre exacto del paciente:
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={patient.name}
              className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm mb-4 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:border-red-400"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText("") }}
                className="flex-1 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 text-sm py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirmText !== patient.name || deleting}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {deleting ? "Eliminando..." : "Eliminar definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewSession && token && (
        <NewSessionModal
          patientId={id}
          patientName={patient.name}
          recordingConsentAt={patient.recording_consent_at}
          token={token}
          onClose={() => setShowNewSession(false)}
          onCreated={load}
        />
      )}
    </div>
  )
}
