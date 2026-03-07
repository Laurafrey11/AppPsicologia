"use client"

import { GlowCard } from "@/components/ui/spotlight-card"
import { Spotlight } from "@/components/ui/spotlight"
import { TextScramble } from "@/components/ui/text-scramble"

interface AiSummary {
  sentimiento_predominante?: string
  pensamiento_predominante?: string
  mecanismo_defensa?: string
  tematica_predominante?: string
  dominant_emotions?: string[]
  clinical_hypotheses?: string[]
  points_to_explore?: string[]
}

interface Session {
  ai_summary: string | null
  created_at: string
  session_date: string | null
  fee: number | null
  paid: boolean
  audio_duration: number | null
}

function parseAiSummary(raw: string | null): AiSummary | null {
  if (!raw) return null
  try { return JSON.parse(raw) as AiSummary } catch { return null }
}

function mostFrequentWithPct(values: string[]): string | null {
  if (values.length === 0) return null
  const freq: Record<string, number> = {}
  for (const v of values) { if (v) freq[v] = (freq[v] ?? 0) + 1 }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1])
  if (!sorted[0]) return null
  const [value, count] = sorted[0]
  const pct = Math.round((count / values.length) * 100)
  return values.length > 1 ? `${value} (${pct}%)` : value
}

function topN(values: string[], n: number): string[] {
  if (values.length === 0) return []
  const freq: Record<string, number> = {}
  for (const v of values) { if (v) freq[v] = (freq[v] ?? 0) + 1 }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([v]) => v)
}

function calcAdherence(sessions: Session[]): {
  label: string
  color: string
  avgDays: number | null
  daysSinceLast: number | null
  total: number
} {
  const total = sessions.length
  if (total === 0) return { label: "Sin sesiones", color: "text-gray-400 dark:text-slate-500", avgDays: null, daysSinceLast: null, total: 0 }

  const dates = sessions
    .map(s => new Date(s.session_date ? s.session_date + "T12:00:00" : s.created_at))
    .sort((a, b) => a.getTime() - b.getTime())

  const lastDate = dates[dates.length - 1]
  const daysSinceLast = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24))

  let avgDays: number | null = null
  if (dates.length >= 2) {
    const gaps: number[] = []
    for (let i = 1; i < dates.length; i++) {
      gaps.push((dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24))
    }
    avgDays = gaps.reduce((a, b) => a + b, 0) / gaps.length
  }

  let label: string
  let color: string
  if (daysSinceLast > 60 || (avgDays !== null && avgDays > 30)) {
    label = "Baja"
    color = "text-red-600 dark:text-red-400"
  } else if (daysSinceLast > 30 || (avgDays !== null && avgDays > 14)) {
    label = "Regular"
    color = "text-amber-600 dark:text-amber-400"
  } else {
    label = "Alta"
    color = "text-emerald-600 dark:text-emerald-400"
  }

  return { label, color, avgDays, daysSinceLast, total }
}

interface MetricCardProps {
  label: string
  value: string | null
  glowColor: "blue" | "purple" | "green" | "orange"
  emoji: string
  pendingLabel?: string
}

function MetricCard({ label, value, glowColor, emoji, pendingLabel }: MetricCardProps) {
  const isProcessing = !value && pendingLabel?.includes("n8n")
  return (
    <GlowCard customSize glowColor={glowColor} className="w-full h-28 bg-white/90 dark:bg-slate-800/90">
      <Spotlight
        className="from-white via-zinc-100 to-zinc-200 dark:from-blue-900 dark:via-blue-700 dark:to-blue-900"
        size={110}
      />
      <div className="relative z-10 flex flex-col justify-between h-full p-1">
        <span className="text-lg">{emoji}</span>
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
          <p className="text-sm font-bold text-gray-900 dark:text-slate-100 leading-snug">
            {value ?? (
              <span className={`text-xs font-normal italic ${isProcessing ? "text-violet-500 dark:text-violet-400 animate-pulse" : "text-gray-400 dark:text-slate-500"}`}>
                {pendingLabel ?? "Pendiente de análisis"}
              </span>
            )}
          </p>
        </div>
      </div>
    </GlowCard>
  )
}

type MonthlyRateConfig = { mode: "flat"; amount: number } | { mode: "per_session" }
type MonthlyRates = Record<string, MonthlyRateConfig>

function calcFinancials(sessions: Session[], monthlyRates: MonthlyRates = {}) {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`

  const thisMonth = sessions.filter((s) => new Date(s.created_at) >= startOfMonth)

  const flatConfig = monthlyRates[currentMonthKey]
  const income = flatConfig?.mode === "flat"
    ? flatConfig.amount
    : thisMonth.filter((s) => s.paid).reduce((sum, s) => sum + (s.fee ?? 0), 0)

  const hoursWorked = thisMonth.reduce(
    (sum, s) => sum + (s.audio_duration != null ? s.audio_duration : 45),
    0
  ) / 60
  return { sessionsThisMonth: thisMonth.length, income, isFlat: flatConfig?.mode === "flat", hoursWorked }
}

export function PatientMetrics({
  sessions,
  caseSummary,
  analysisTriggered,
  monthlyRates = {},
}: {
  sessions: Session[]
  caseSummary?: string | null
  analysisTriggered?: boolean
  monthlyRates?: MonthlyRates
}) {
  const summaries = sessions.map(s => parseAiSummary(s.ai_summary)).filter((s): s is AiSummary => s !== null)
  const adherence = calcAdherence(sessions)
  const financials = calcFinancials(sessions, monthlyRates)

  if (sessions.length === 0) return null

  // Parse caseSummary JSON safely (may be a CaseAnalysis or a _processing state)
  const parsedCase = (() => {
    if (!caseSummary) return null
    try {
      const obj = JSON.parse(caseSummary) as Record<string, unknown>
      if (obj._processing) return null // mid-processing state, don't display
      return typeof obj.summary === "string" ? obj as { summary: string } : null
    } catch { return null }
  })()

  const sentimientos = summaries.map(s => s.sentimiento_predominante ?? "").filter(Boolean)
  const pensamientos = summaries.map(s => s.pensamiento_predominante ?? "").filter(Boolean)
  const mecanismos = summaries.map(s => s.mecanismo_defensa ?? "").filter(Boolean)
  const tematicas = summaries.map(s => s.tematica_predominante ?? "").filter(Boolean)

  const allHypotheses = summaries.flatMap(s => s.clinical_hypotheses ?? [])
  const allPoints = summaries.flatMap(s => s.points_to_explore ?? [])
  const topHypotheses = topN(allHypotheses, 4)
  const topPoints = topN(allPoints, 4)

  // If n8n analysis was triggered but data isn't ready yet, show processing state
  const pendingLabel = analysisTriggered
    ? "Procesando en n8n..."
    : "Pendiente de análisis"

  const metrics: MetricCardProps[] = [
    { label: "Sentimiento", value: mostFrequentWithPct(sentimientos), glowColor: "orange", emoji: "💛" },
    { label: "Pensamiento", value: mostFrequentWithPct(pensamientos), glowColor: "purple", emoji: "🧠" },
    { label: "Mecanismo de defensa", value: mostFrequentWithPct(mecanismos), glowColor: "blue", emoji: "🛡️" },
    { label: "Temática", value: mostFrequentWithPct(tematicas), glowColor: "green", emoji: "🗂️" },
  ]
  void pendingLabel // used below in MetricCard render

  return (
    <section className="mb-6 space-y-4">
      <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
        Métricas clínicas · {sessions.length} sesión{sessions.length !== 1 ? "es" : ""}
      </h2>

      {/* Case summary — only shows when properly analyzed (not _processing) */}
      {parsedCase && (
        <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 rounded-xl p-4">
          <TextScramble
            as="h3"
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-2"
            duration={0.7}
            speed={0.025}
          >
            Resumen clínico acumulado
          </TextScramble>
          <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{parsedCase.summary}</p>
        </div>
      )}

      {/* 4 metric chips — always visible */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((m) => (
          <MetricCard
            key={m.label}
            {...m}
            value={m.value ?? null}
            pendingLabel={m.value == null ? pendingLabel : undefined}
          />
        ))}
      </div>

      {/* Monthly operational stats */}
      {sessions.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
            <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1">Sesiones este mes</p>
            <p className="text-lg font-bold text-gray-900 dark:text-slate-100">{financials.sessionsThisMonth}</p>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
            <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1">
              {financials.isFlat ? "Tarifa mensual fija" : "Ingresos cobrados"}
            </p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {financials.income > 0 ? `$${financials.income.toLocaleString("es-AR")}` : "—"}
            </p>
            {financials.isFlat && (
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">📌 Plana</p>
            )}
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
            <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1">Horas trabajadas</p>
            <p className="text-lg font-bold text-gray-900 dark:text-slate-100">
              {financials.sessionsThisMonth > 0 ? `${financials.hoursWorked.toFixed(1)}h` : "—"}
            </p>
          </div>
        </div>
      )}

      {/* Adherence */}
      {sessions.length > 0 && (
        <GlowCard customSize glowColor="green" className="w-full p-4 bg-white/90 dark:bg-slate-800/90">
          <Spotlight className="from-white via-emerald-50 to-emerald-100 dark:from-emerald-900 dark:via-emerald-700 dark:to-emerald-900" size={140} />
          <div className="relative z-10">
            <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Adherencia a terapia</p>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className={`text-lg font-bold ${adherence.color}`}>{adherence.label}</p>
              <div className="flex gap-5">
                {adherence.avgDays !== null && (
                  <div className="text-right">
                    <p className="text-xs text-gray-400 dark:text-slate-500">Promedio entre sesiones</p>
                    <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">{Math.round(adherence.avgDays)} días</p>
                  </div>
                )}
                {adherence.daysSinceLast !== null && (
                  <div className="text-right">
                    <p className="text-xs text-gray-400 dark:text-slate-500">Última sesión</p>
                    <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">hace {adherence.daysSinceLast} días</p>
                  </div>
                )}
                <div className="text-right">
                  <p className="text-xs text-gray-400 dark:text-slate-500">Total sesiones</p>
                  <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">{adherence.total}</p>
                </div>
              </div>
            </div>
          </div>
        </GlowCard>
      )}

      {/* Hypotheses and recommendations */}
      {(topHypotheses.length > 0 || topPoints.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {topHypotheses.length > 0 && (
            <GlowCard customSize glowColor="purple" className="w-full p-4 bg-white/90 dark:bg-slate-800/90">
              <Spotlight className="from-white via-purple-50 to-purple-100 dark:from-purple-900 dark:via-purple-700 dark:to-purple-900" size={110} />
              <div className="relative z-10">
                <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Hipótesis clínicas</p>
                <ul className="space-y-1.5">
                  {topHypotheses.map((h, i) => (
                    <li key={i} className="text-sm text-gray-700 dark:text-slate-300 flex gap-2">
                      <span className="text-gray-400 dark:text-slate-500 flex-shrink-0">·</span>{h}
                    </li>
                  ))}
                </ul>
              </div>
            </GlowCard>
          )}
          {topPoints.length > 0 && (
            <GlowCard customSize glowColor="blue" className="w-full p-4 bg-white/90 dark:bg-slate-800/90">
              <Spotlight className="from-white via-blue-50 to-blue-100 dark:from-blue-900 dark:via-blue-700 dark:to-blue-900" size={110} />
              <div className="relative z-10">
                <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Puntos a explorar</p>
                <ul className="space-y-1.5">
                  {topPoints.map((p, i) => (
                    <li key={i} className="text-sm text-gray-700 dark:text-slate-300 flex gap-2">
                      <span className="text-blue-400 flex-shrink-0">→</span>{p}
                    </li>
                  ))}
                </ul>
              </div>
            </GlowCard>
          )}
        </div>
      )}
    </section>
  )
}
