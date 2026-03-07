"use client"

import { useMemo, useState } from "react"
import { parseCaseSummary } from "@/lib/utils/case-summary-parser"

interface AiSummary {
  sentimiento_predominante?: string
  mecanismo_defensa?: string
}

interface Session {
  ai_summary: string | null
  created_at: string
  session_date: string | null
}

interface GlobalScore {
  fecha: string
  animo: number
  ansiedad: number
}

// Map sentimiento_predominante → ánimo score (1–10, higher = better mood)
const ANIMO_MAP: Record<string, number> = {
  Alegría: 9,
  Ambivalencia: 5,
  Tristeza: 2,
  Culpa: 3,
  Miedo: 3,
  Vergüenza: 3,
  Ansiedad: 4,
  Enojo: 4,
}

// Map sentimiento_predominante → ansiedad score (1–10, higher = more anxious)
const ANSIEDAD_MAP: Record<string, number> = {
  Ansiedad: 9,
  Miedo: 7,
  Vergüenza: 6,
  Culpa: 6,
  Tristeza: 5,
  Enojo: 5,
  Ambivalencia: 4,
  Alegría: 2,
}

function adherenciaScore(daysSincePrev: number | null): number {
  if (daysSincePrev === null) return 8 // first session baseline
  if (daysSincePrev <= 7)  return 10
  if (daysSincePrev <= 14) return 8
  if (daysSincePrev <= 21) return 6
  if (daysSincePrev <= 30) return 4
  if (daysSincePrev <= 60) return 2
  return 1
}

function parseAiSummary(raw: string | null): AiSummary | null {
  if (!raw) return null
  try { return JSON.parse(raw) as AiSummary } catch { return null }
}

interface DataPoint {
  label: string   // date label for x-axis
  animo: number | null
  ansiedad: number | null
  adherencia: number
}

// SVG chart config
const W = 560
const H = 180
const PAD = { top: 16, right: 20, bottom: 32, left: 28 }
const CW = W - PAD.left - PAD.right
const CH = H - PAD.top - PAD.bottom

function toX(i: number, total: number): number {
  if (total <= 1) return PAD.left + CW / 2
  return PAD.left + (i / (total - 1)) * CW
}

function toY(value: number): number {
  // value 1–10 → y coordinate (1 = bottom, 10 = top)
  return PAD.top + ((10 - value) / 9) * CH
}

function buildPath(points: (number | null)[], total: number): string {
  const segments: string[] = []
  let penUp = true
  for (let i = 0; i < points.length; i++) {
    const v = points[i]
    if (v === null) { penUp = true; continue }
    const x = toX(i, total).toFixed(1)
    const y = toY(v).toFixed(1)
    if (penUp) { segments.push(`M ${x} ${y}`); penUp = false }
    else        { segments.push(`L ${x} ${y}`) }
  }
  return segments.join(" ")
}

const SERIES = [
  { key: "animo"      as const, label: "Ánimo",      color: "#f97316" },  // orange
  { key: "ansiedad"   as const, label: "Ansiedad",   color: "#8b5cf6" },  // purple
  { key: "adherencia" as const, label: "Adherencia", color: "#10b981" },  // emerald
]

export function PatientEvolutionChart({
  sessions,
  caseSummary,
}: {
  sessions: Session[]
  caseSummary?: string | null
}) {
  const [hovered, setHovered] = useState<{ idx: number; x: number; y: number } | null>(null)

  // Parse case_summary — handles JSON (structured scores) and Markdown (n8n plain text)
  const globalScores = useMemo((): GlobalScore[] | null => {
    const parsed = parseCaseSummary(caseSummary ?? null)
    if (!parsed) return null
    // If structured JSON scores exist, use them directly
    if (Array.isArray(parsed.scores) && parsed.scores.length > 0) return parsed.scores
    return null
  }, [caseSummary])

  const points = useMemo((): DataPoint[] => {
    const sorted = [...sessions].sort((a, b) => {
      const da = new Date(a.session_date ? a.session_date + "T12:00:00" : a.created_at)
      const db = new Date(b.session_date ? b.session_date + "T12:00:00" : b.created_at)
      return da.getTime() - db.getTime()
    })

    // If global scores available, use them (matched by date or by index)
    if (globalScores && globalScores.length >= 2) {
      const sortedScores = [...globalScores].sort((a, b) => a.fecha.localeCompare(b.fecha))
      return sortedScores.map((gs, i) => {
        const date = new Date(gs.fecha + "T12:00:00")
        let daysSincePrev: number | null = null
        if (i > 0) {
          const prevDate = new Date(sortedScores[i - 1].fecha + "T12:00:00")
          daysSincePrev = Math.round((date.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
        }
        return {
          label: date.toLocaleDateString("es-AR", { day: "numeric", month: "short" }),
          animo: gs.animo,
          ansiedad: gs.ansiedad,
          adherencia: adherenciaScore(daysSincePrev),
        }
      })
    }

    // Fallback: read from individual session ai_summary
    return sorted.map((s, i) => {
      const summary = parseAiSummary(s.ai_summary)
      const sent = summary?.sentimiento_predominante ?? ""
      const date = new Date(s.session_date ? s.session_date + "T12:00:00" : s.created_at)

      let daysSincePrev: number | null = null
      if (i > 0) {
        const prev = sorted[i - 1]
        const prevDate = new Date(prev.session_date ? prev.session_date + "T12:00:00" : prev.created_at)
        daysSincePrev = Math.round((date.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24))
      }

      return {
        label: date.toLocaleDateString("es-AR", { day: "numeric", month: "short" }),
        animo:     sent ? (ANIMO_MAP[sent] ?? 5) : null,
        ansiedad:  sent ? (ANSIEDAD_MAP[sent] ?? 5) : null,
        adherencia: adherenciaScore(daysSincePrev),
      }
    })
  }, [sessions, globalScores])

  // Only render with at least 2 sessions
  if (points.length < 2) return null

  const n = points.length

  // Y-axis grid lines at 2, 4, 6, 8, 10
  const gridLines = [2, 4, 6, 8, 10]

  const hoveredPoint = hovered !== null ? points[hovered.idx] : null

  return (
    <section className="mb-6 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
          Evolución clínica
        </h2>
        {/* Legend */}
        <div className="flex gap-4">
          {SERIES.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded-full inline-block" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-gray-500 dark:text-slate-400">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: "180px" }}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Grid lines */}
          {gridLines.map((v) => {
            const y = toY(v)
            return (
              <g key={v}>
                <line
                  x1={PAD.left} y1={y} x2={PAD.left + CW} y2={y}
                  stroke="currentColor"
                  className="text-gray-100 dark:text-slate-800"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 4} y={y + 3.5}
                  textAnchor="end"
                  fontSize={9}
                  className="fill-gray-300 dark:fill-slate-600"
                >
                  {v}
                </text>
              </g>
            )
          })}

          {/* X-axis labels (show max 6 evenly spaced) */}
          {points.map((p, i) => {
            const step = Math.max(1, Math.floor(n / 6))
            if (i % step !== 0 && i !== n - 1) return null
            const x = toX(i, n)
            return (
              <text
                key={i}
                x={x} y={H - 6}
                textAnchor="middle"
                fontSize={8.5}
                className="fill-gray-400 dark:fill-slate-500"
              >
                {p.label}
              </text>
            )
          })}

          {/* Series lines */}
          {SERIES.map((s) => (
            <path
              key={s.key}
              d={buildPath(points.map((p) => p[s.key]), n)}
              fill="none"
              stroke={s.color}
              strokeWidth={1.8}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.85}
            />
          ))}

          {/* Hover dots */}
          {SERIES.map((s) =>
            points.map((p, i) => {
              const v = p[s.key]
              if (v === null) return null
              return (
                <circle
                  key={`${s.key}-${i}`}
                  cx={toX(i, n)}
                  cy={toY(v)}
                  r={hovered?.idx === i ? 4 : 2.5}
                  fill={s.color}
                  opacity={hovered?.idx === i ? 1 : 0.7}
                  onMouseEnter={() => setHovered({ idx: i, x: toX(i, n), y: toY(v) })}
                  style={{ cursor: "pointer" }}
                />
              )
            })
          )}
        </svg>

        {/* Tooltip */}
        {hoveredPoint && hovered && (
          <div
            className="absolute pointer-events-none z-10 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg px-3 py-2 text-xs"
            style={{
              left: `${(hovered.x / W) * 100}%`,
              top: "8px",
              transform: hovered.x > W * 0.6 ? "translateX(-110%)" : "translateX(10px)",
              minWidth: "130px",
            }}
          >
            <p className="font-semibold text-gray-700 dark:text-slate-200 mb-1">{hoveredPoint.label}</p>
            {hoveredPoint.animo !== null && (
              <p style={{ color: "#f97316" }}>Ánimo: {hoveredPoint.animo}/10</p>
            )}
            {hoveredPoint.ansiedad !== null && (
              <p style={{ color: "#8b5cf6" }}>Ansiedad: {hoveredPoint.ansiedad}/10</p>
            )}
            <p style={{ color: "#10b981" }}>Adherencia: {hoveredPoint.adherencia}/10</p>
          </div>
        )}
      </div>
    </section>
  )
}
