"use client"

export const dynamic = "force-dynamic"

import { useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { GlowCard } from "@/components/ui/spotlight-card"
import { Spotlight } from "@/components/ui/spotlight"

interface OverdueSession {
  patient_id: string
  session_date: string | null
  created_at: string
  fee: number | null
}

interface LowFreqPatient {
  patient_id: string
  last_session: string
}

interface Stats {
  active_patients: number
  inactive_patients: number
  total_sessions: number
  sessions_this_month: number
  income_this_month: number
  unpaid_overdue: OverdueSession[]
  audio_hours_this_month: number
  avg_treatment_days: number
  low_frequency_patients: LowFreqPatient[]
}

function StatCard({ label, value, sub, color }: {
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  return (
    <GlowCard customSize glowColor="blue" className="w-full p-5 bg-white/90 dark:bg-slate-800/90 min-h-[90px]">
      <Spotlight
        className="from-white via-blue-50 to-blue-100 dark:from-blue-900 dark:via-blue-700 dark:to-blue-900"
        size={130}
      />
      <div className="relative z-10 flex flex-col gap-1">
        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">{label}</p>
        <p className={`text-2xl font-bold ${color ?? "text-gray-900 dark:text-slate-100"}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </GlowCard>
  )
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
}

const SESSION_DURATION_KEY = "psy_session_duration_min"
const DEFAULT_DURATION = 50

export default function EstadisticasPage() {
  const supabase = createSupabaseBrowserClient()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionDuration, setSessionDuration] = useState<number>(DEFAULT_DURATION)
  const [editingDuration, setEditingDuration] = useState(false)
  const [durationInput, setDurationInput] = useState("")

  useEffect(() => {
    const stored = localStorage.getItem(SESSION_DURATION_KEY)
    if (stored) setSessionDuration(parseInt(stored, 10) || DEFAULT_DURATION)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token
      if (!token) { setError("Sin sesión activa"); setLoading(false); return }
      try {
        const res = await fetch("/api/stats", { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setStats(await res.json())
      } catch (e: unknown) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    })
  }, [supabase])

  const now = new Date()
  const monthName = now.toLocaleDateString("es-AR", { month: "long", year: "numeric" })

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400 dark:text-slate-500">Cargando estadísticas...</p>
    </div>
  )

  if (error || !stats) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-red-500">{error ?? "Error al cargar estadísticas."}</p>
    </div>
  )

  const totalPatients = stats.active_patients + stats.inactive_patients
  const cancelRate = totalPatients > 0
    ? Math.round((stats.inactive_patients / totalPatients) * 100)
    : 0

  const workedHours = (stats.sessions_this_month * sessionDuration) / 60

  function saveDuration() {
    const val = parseInt(durationInput, 10)
    if (!isNaN(val) && val > 0 && val <= 240) {
      setSessionDuration(val)
      localStorage.setItem(SESSION_DURATION_KEY, String(val))
    }
    setEditingDuration(false)
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Dashboard de consultorio</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 capitalize">{monthName}</p>
      </div>

      {/* Main stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Ingreso mensual real"
          value={`$${stats.income_this_month.toLocaleString("es-AR")}`}
          sub="Sesiones pagadas este mes"
          color="text-emerald-600 dark:text-emerald-400"
        />
        <StatCard
          label="Sesiones este mes"
          value={stats.sessions_this_month}
          sub="Sesiones realizadas"
        />
        <GlowCard customSize glowColor="blue" className="w-full p-5 bg-white/90 dark:bg-slate-800/90 min-h-[90px]">
          <Spotlight className="from-white via-blue-50 to-blue-100 dark:from-blue-900 dark:via-blue-700 dark:to-blue-900" size={130} />
          <div className="relative z-10">
          <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1">Horas trabajadas</p>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{workedHours.toFixed(1)}h</p>
          <div className="flex items-center gap-1 mt-0.5">
            {editingDuration ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={durationInput}
                  onChange={(e) => setDurationInput(e.target.value)}
                  onBlur={saveDuration}
                  onKeyDown={(e) => e.key === "Enter" && saveDuration()}
                  autoFocus
                  min={1} max={240}
                  className="w-14 text-xs border border-blue-300 dark:border-blue-700 rounded px-1 py-0.5 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none"
                />
                <span className="text-xs text-gray-400 dark:text-slate-500">min/sesión</span>
              </div>
            ) : (
              <button
                onClick={() => { setDurationInput(String(sessionDuration)); setEditingDuration(true) }}
                className="text-xs text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                {sessionDuration} min/sesión · editar
              </button>
            )}
          </div>
          </div>
        </GlowCard>
        <StatCard
          label="Sesiones totales"
          value={stats.total_sessions}
          sub="Todas las sesiones registradas"
          color="text-indigo-600 dark:text-indigo-400"
        />
        <StatCard
          label="Pacientes activos"
          value={stats.active_patients}
          sub={`${stats.inactive_patients} inactivos`}
          color="text-blue-600 dark:text-blue-400"
        />
        <StatCard
          label="Tasa de inactividad"
          value={`${cancelRate}%`}
          sub="Pacientes inactivos vs total"
          color={cancelRate > 30 ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-slate-100"}
        />
        <StatCard
          label="Duración prom. tratamiento"
          value={stats.avg_treatment_days < 1 ? "—" : `${Math.round(stats.avg_treatment_days)}d`}
          sub="Desde primera a última sesión"
        />
      </div>

      {/* Alerts section */}
      {(stats.unpaid_overdue.length > 0 || stats.low_frequency_patients.length > 0) && (
        <section className="mb-8">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-3">
            Alertas
          </h2>
          <div className="space-y-2">

            {/* Payment reminders */}
            {stats.unpaid_overdue.map((s, i) => {
              const refDate = s.session_date ?? s.created_at
              return (
                <div key={i} className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl px-4 py-3">
                  <span className="text-amber-500 mt-0.5">⚠</span>
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Sesión sin pagar hace {daysSince(refDate)} días
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                      {new Date(s.session_date ? s.session_date + "T12:00:00" : s.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "long" })}
                      {s.fee ? ` · $${s.fee.toLocaleString("es-AR")}` : ""}
                    </p>
                  </div>
                </div>
              )
            })}

            {/* Low frequency patients */}
            {stats.low_frequency_patients.map((p, i) => (
              <div key={i} className="flex items-start gap-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-xl px-4 py-3">
                <span className="text-blue-500 mt-0.5">📉</span>
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                    Paciente sin sesión hace {daysSince(p.last_session)} días
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-500 mt-0.5">
                    Última sesión: {new Date(p.last_session).toLocaleDateString("es-AR", { day: "numeric", month: "long" })}
                  </p>
                </div>
              </div>
            ))}

          </div>
        </section>
      )}

      {stats.unpaid_overdue.length === 0 && stats.low_frequency_patients.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-400 dark:text-slate-500">
          Sin alertas activas. Todo en orden.
        </div>
      )}
    </div>
  )
}
