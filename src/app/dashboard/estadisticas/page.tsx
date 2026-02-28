"use client"

export const dynamic = "force-dynamic"

import { useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

interface OverdueSession {
  patient_id: string
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
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
      <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color ?? "text-gray-900 dark:text-slate-100"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
}

export default function EstadisticasPage() {
  const supabase = createSupabaseBrowserClient()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        <StatCard
          label="Horas trabajadas"
          value={`${stats.audio_hours_this_month.toFixed(1)}h`}
          sub="Audio transcripto este mes"
          color="text-blue-600 dark:text-blue-400"
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
            {stats.unpaid_overdue.map((s, i) => (
              <div key={i} className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl px-4 py-3">
                <span className="text-amber-500 mt-0.5">⚠</span>
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    Sesión sin pagar hace {daysSince(s.created_at)} días
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                    {new Date(s.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "long" })}
                    {s.fee ? ` · $${s.fee.toLocaleString("es-AR")}` : ""}
                  </p>
                </div>
              </div>
            ))}

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
