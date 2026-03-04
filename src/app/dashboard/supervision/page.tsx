"use client"

export const dynamic = "force-dynamic"

import { useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

interface RankedItem {
  value: string
  count: number
}

interface SupervisionData {
  total_sessions: number
  patient_count: number
  recurring_themes: RankedItem[]
  dominant_sentimientos: RankedItem[]
  common_mecanismos: RankedItem[]
  common_pensamientos: RankedItem[]
}

function BarChart({ items, color }: { items: RankedItem[]; color: string }) {
  if (items.length === 0) return <p className="text-xs text-gray-400 dark:text-slate-500 py-2">Sin datos suficientes.</p>
  const max = items[0].count
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.value} className="flex items-center gap-3">
          <span className="text-xs text-gray-600 dark:text-slate-300 w-40 flex-shrink-0 truncate" title={item.value}>
            {item.value}
          </span>
          <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${color}`}
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-400 dark:text-slate-500 w-8 text-right flex-shrink-0">{item.count}</span>
        </div>
      ))}
    </div>
  )
}

function Section({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
      <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
        <span>{emoji}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

export default function SupervisionPage() {
  const supabase = createSupabaseBrowserClient()
  const [data, setData] = useState<SupervisionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: sd }) => {
      const token = sd.session?.access_token
      if (!token) { setError("Sin sesión activa"); setLoading(false); return }
      try {
        const res = await fetch("/api/supervision", { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setData(await res.json())
      } catch (e: unknown) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    })
  }, [supabase])

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400 dark:text-slate-500">Cargando datos de interconsulta...</p>
    </div>
  )

  if (error || !data) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-red-500">{error ?? "Error al cargar supervisión."}</p>
    </div>
  )

  if (data.total_sessions < 5) return (
    <div className="max-w-3xl mx-auto py-8 px-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">Interconsulta IA</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400">
        {data.total_sessions > 0
          ? `Tu colega virtual está analizando el caso. Faltan ${5 - data.total_sessions} sesión${5 - data.total_sessions !== 1 ? "es" : ""} para tu primera interconsulta.`
          : "Tu colega virtual está analizando el caso. Faltan 5 sesiones para tu primera interconsulta."}
      </p>
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Interconsulta IA</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
          Patrones agregados de {data.total_sessions} sesión{data.total_sessions !== 1 ? "es" : ""} — {data.patient_count} paciente{data.patient_count !== 1 ? "s" : ""}
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
          Este análisis es orientativo para reflexión clínica. No reemplaza supervisión profesional ni constituye diagnóstico.
        </p>
      </div>

      <Section title="Temáticas recurrentes" emoji="🗂️">
        <BarChart items={data.recurring_themes} color="bg-emerald-500 dark:bg-emerald-600" />
      </Section>

      <Section title="Sentimientos predominantes" emoji="💛">
        <BarChart items={data.dominant_sentimientos} color="bg-orange-400 dark:bg-orange-500" />
      </Section>

      <Section title="Patrones de pensamiento" emoji="🧠">
        <BarChart items={data.common_pensamientos} color="bg-purple-500 dark:bg-purple-600" />
      </Section>

      <Section title="Mecanismos de defensa frecuentes" emoji="🛡️">
        <BarChart items={data.common_mecanismos} color="bg-blue-500 dark:bg-blue-600" />
      </Section>

      <p className="text-xs text-gray-400 dark:text-slate-500 text-center pb-4">
        Los conteos reflejan menciones totales en sesiones analizadas por IA.
        Cada sesión contribuye con un valor por categoría.
      </p>
    </div>
  )
}
