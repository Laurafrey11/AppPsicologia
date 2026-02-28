"use client"

import { GlowCard } from "@/components/ui/spotlight-card"
import { Spotlight } from "@/components/ui/spotlight"

interface AiSummary {
  sentimiento_predominante?: string
  pensamiento_predominante?: string
  mecanismo_defensa?: string
  tematica_predominante?: string
  dominant_emotions?: string[]
}

interface Session {
  ai_summary: string | null
}

function parseAiSummary(raw: string | null): AiSummary | null {
  if (!raw) return null
  try { return JSON.parse(raw) as AiSummary } catch { return null }
}

function mostFrequent(values: string[]): string | null {
  if (values.length === 0) return null
  const freq: Record<string, number> = {}
  for (const v of values) {
    if (v) freq[v] = (freq[v] ?? 0) + 1
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

interface MetricCardProps {
  label: string
  value: string | null
  glowColor: "blue" | "purple" | "green" | "orange"
  emoji: string
}

function MetricCard({ label, value, glowColor, emoji }: MetricCardProps) {
  return (
    <>
      {/* Light mode: GlowCard */}
      <div className="block dark:hidden">
        <GlowCard
          customSize
          glowColor={glowColor}
          className="w-full h-28 flex flex-col justify-between bg-white/80"
        >
          <div className="relative z-10 flex flex-col justify-between h-full p-1">
            <span className="text-lg">{emoji}</span>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">{label}</p>
              <p className="text-sm font-bold text-gray-900 leading-snug">
                {value ?? <span className="text-gray-400 font-normal">Sin datos</span>}
              </p>
            </div>
          </div>
        </GlowCard>
      </div>

      {/* Dark mode: card with Spotlight */}
      <div className="hidden dark:block">
        <div className="relative w-full h-28 rounded-2xl border border-slate-700 bg-slate-800 p-4 flex flex-col justify-between overflow-hidden">
          <Spotlight
            className="from-blue-500 via-blue-400 to-blue-300 dark:from-blue-800 dark:via-blue-600 dark:to-blue-900"
            size={120}
          />
          <span className="text-lg relative z-10">{emoji}</span>
          <div className="relative z-10">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
            <p className="text-sm font-bold text-slate-100 leading-snug">
              {value ?? <span className="text-slate-500 font-normal">Sin datos</span>}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

export function PatientMetrics({ sessions }: { sessions: Session[] }) {
  const summaries = sessions.map(s => parseAiSummary(s.ai_summary)).filter((s): s is AiSummary => s !== null)

  if (summaries.length === 0) return null

  const sentimientos = summaries.map(s => s.sentimiento_predominante ?? "").filter(Boolean)
  const pensamientos = summaries.map(s => s.pensamiento_predominante ?? "").filter(Boolean)
  const mecanismos = summaries.map(s => s.mecanismo_defensa ?? "").filter(Boolean)
  const tematicas = summaries.map(s => s.tematica_predominante ?? "").filter(Boolean)

  const metrics: MetricCardProps[] = [
    { label: "Sentimiento predominante", value: mostFrequent(sentimientos), glowColor: "orange", emoji: "💛" },
    { label: "Pensamiento predominante", value: mostFrequent(pensamientos), glowColor: "purple", emoji: "🧠" },
    { label: "Mecanismo de defensa", value: mostFrequent(mecanismos), glowColor: "blue", emoji: "🛡️" },
    { label: "Temática predominante", value: mostFrequent(tematicas), glowColor: "green", emoji: "🗂️" },
  ]

  return (
    <section className="mb-6">
      <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-3">
        Métricas clínicas ({summaries.length} sesión{summaries.length !== 1 ? "es" : ""} analizadas)
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} />
        ))}
      </div>
    </section>
  )
}
