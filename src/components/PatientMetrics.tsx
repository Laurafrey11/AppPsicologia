"use client"

import { GlowCard } from "@/components/ui/spotlight-card"
import { Spotlight } from "@/components/ui/spotlight"
import { TextScramble } from "@/components/ui/text-scramble"
import { parseCaseSummary } from "@/lib/utils/case-summary-parser"

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

// Cleans n8n fields that may arrive as JSON array strings like ["Texto"] → "Texto"
function cleanField(value: string | null | undefined): string | null {
  const v = value?.trim()
  if (!v) return null
  if (v.startsWith("[")) {
    try {
      const arr = JSON.parse(v) as unknown[]
      if (Array.isArray(arr)) {
        const joined = arr.filter(Boolean).join(", ")
        return joined || null
      }
    } catch { /* fall through */ }
  }
  return v
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

  // For avgDays: use session_date (actual therapy date) to compute real intervals
  const therapyDates = sessions
    .map(s => new Date(s.session_date ? s.session_date + "T12:00:00" : s.created_at))
    .sort((a, b) => a.getTime() - b.getTime())

  // For daysSinceLast: use created_at (when the record was added) so imported historical
  // sessions with old session_dates don't distort "last contact" metric
  const lastCreated = sessions
    .map(s => new Date(s.created_at))
    .reduce((latest, d) => d > latest ? d : latest, new Date(0))
  const daysSinceLast = Math.floor((Date.now() - lastCreated.getTime()) / (1000 * 60 * 60 * 24))

  let avgDays: number | null = null
  if (therapyDates.length >= 2) {
    const gaps: number[] = []
    for (let i = 1; i < therapyDates.length; i++) {
      gaps.push((therapyDates[i].getTime() - therapyDates[i - 1].getTime()) / (1000 * 60 * 60 * 24))
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
  const borderColor = {
    blue: "border-blue-100 dark:border-blue-900/50",
    purple: "border-purple-100 dark:border-purple-900/50",
    green: "border-emerald-100 dark:border-emerald-900/50",
    orange: "border-orange-100 dark:border-orange-900/50",
  }[glowColor]
  return (
    <div className={`relative w-full rounded-xl border ${borderColor} bg-white dark:bg-slate-800 p-3 flex flex-col gap-2`}>
      <span className="text-lg">{emoji}</span>
      <div>
        <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
        <p className="text-sm font-bold text-gray-900 dark:text-slate-100 leading-snug break-words hyphens-auto">
          {value ?? (
            <span className={`text-xs font-normal italic ${isProcessing ? "text-violet-500 dark:text-violet-400 animate-pulse" : "text-gray-400 dark:text-slate-500"}`}>
              {pendingLabel ?? "Pendiente de análisis"}
            </span>
          )}
        </p>
      </div>
    </div>
  )
}

type MonthlyRateConfig = { mode: "flat"; amount: number } | { mode: "per_session" }
type MonthlyRates = Record<string, MonthlyRateConfig>

function calcFinancials(sessions: Session[], monthlyRates: MonthlyRates = {}) {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`

  // Use session_date when available, fallback to created_at (same as getPracticeStats)
  const thisMonth = sessions.filter((s) => {
    const d = new Date(s.session_date ? s.session_date + "T12:00:00" : s.created_at)
    return d >= startOfMonth
  })
  const paidThisMonth = thisMonth.filter((s) => s.paid)

  const flatConfig = monthlyRates[currentMonthKey]
  const income = flatConfig?.mode === "flat"
    ? (Number(flatConfig.amount) || 0) * paidThisMonth.length  // tarifa fija × sesiones pagas
    : paidThisMonth.reduce((sum, s) => sum + (Number(s.fee ?? 0) || 0), 0)

  const hoursWorked = thisMonth.reduce(
    (sum, s) => sum + (s.audio_duration != null ? s.audio_duration : 45),
    0
  ) / 60
  return { sessionsThisMonth: thisMonth.length, income, isFlat: flatConfig?.mode === "flat", hoursWorked }
}

interface PatientData {
  sentiment_score?: number | null
  anxiety_level?: number | null
  presumptive_diagnosis?: string | null
  therapeutic_recommendations?: string | null
  main_defense_mechanisms?: string | null
  primary_theme?: string | null
}

export function PatientMetrics({
  sessions,
  caseSummary,
  analysisTriggered,
  monthlyRates = {},
  patientData = {},
}: {
  sessions: Session[]
  caseSummary?: string | null
  analysisTriggered?: boolean
  monthlyRates?: MonthlyRates
  patientData?: PatientData
}) {
  const summaries = sessions.map(s => parseAiSummary(s.ai_summary)).filter((s): s is AiSummary => s !== null)
  const adherence = calcAdherence(sessions)
  const financials = calcFinancials(sessions, monthlyRates)

  if (sessions.length === 0) return null

  // Parse caseSummary — handles both JSON (app-generated) and plain Markdown (n8n-generated)
  const parsedCase = parseCaseSummary(caseSummary ?? null)

  // Fallback values from aggregated ai_summary when DB fields are absent
  const sentimientos = summaries.map(s => s.sentimiento_predominante ?? "").filter(Boolean)
  const pensamientos = summaries.map(s => s.pensamiento_predominante ?? "").filter(Boolean)
  const mecanismos = summaries.map(s => s.mecanismo_defensa ?? "").filter(Boolean)
  const tematicas = summaries.map(s => s.tematica_predominante ?? "").filter(Boolean)

  const allHypotheses = summaries.flatMap(s => s.clinical_hypotheses ?? [])
  const allPoints = summaries.flatMap(s => s.points_to_explore ?? [])
  const topHypotheses = topN(allHypotheses, 4)
  const topPoints = topN(allPoints, 4)

  const pendingLabel = analysisTriggered ? "Procesando en n8n..." : "Pendiente de análisis"

  // DB fields take priority; fall back to ai_summary aggregation
  const sentimientoValue = patientData.sentiment_score != null
    ? `${patientData.sentiment_score}/10`
    : mostFrequentWithPct(sentimientos)
  const ansiedadValue = patientData.anxiety_level != null
    ? `${patientData.anxiety_level}/10`
    : mostFrequentWithPct(pensamientos)
  const mecanismoValue = cleanField(patientData.main_defense_mechanisms) || mostFrequentWithPct(mecanismos)
  const tematicaValue = cleanField(patientData.primary_theme) || mostFrequentWithPct(tematicas)

  const metrics: MetricCardProps[] = [
    { label: "Sentimiento", value: sentimientoValue, glowColor: "orange", emoji: "💛" },
    { label: "Ansiedad", value: ansiedadValue, glowColor: "purple", emoji: "🧠" },
    { label: "Mecanismo de defensa", value: mecanismoValue, glowColor: "blue", emoji: "🛡️" },
    { label: "Temática principal", value: tematicaValue, glowColor: "green", emoji: "🗂️" },
  ]

  return (
    <section className="mb-6 space-y-4">
      <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
        Métricas clínicas · {sessions.length} sesión{sessions.length !== 1 ? "es" : ""}
      </h2>

      {/* Case summary from n8n */}
      {parsedCase && (
        <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 rounded-xl p-4">
          <TextScramble
            as="h3"
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-2"
            duration={0.7}
            speed={0.025}
          >
            Resumen clínico — IA
          </TextScramble>
          <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{parsedCase.summary}</p>
        </div>
      )}

      {/* 4 metric cards — DB fields first, ai_summary fallback */}
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

      {/* Diagnóstico Presuntivo — from DB */}
      {cleanField(patientData.presumptive_diagnosis) && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl p-4">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-2">
            Diagnóstico Presuntivo
          </p>
          <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">
            {cleanField(patientData.presumptive_diagnosis)}
          </p>
        </div>
      )}

      {/* Recomendaciones Terapéuticas — from DB */}
      {cleanField(patientData.therapeutic_recommendations) && (
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-xl p-4">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-2">
            Recomendaciones Terapéuticas
          </p>
          <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">
            {cleanField(patientData.therapeutic_recommendations)}
          </p>
        </div>
      )}

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
