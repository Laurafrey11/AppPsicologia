"use client"

import { useState } from "react"
import { CheckCircle2, Clock, Loader2 } from "lucide-react"
import { TextScramble } from "@/components/ui/text-scramble"

interface SessionNotes {
  motivo_consulta?: string
  humor_paciente?: string
  hipotesis_clinica?: string
  intervenciones?: string
  evolucion?: string
  plan_proximo?: string
}

interface AiSummary {
  main_topic?: string
  dominant_emotions?: string[]
  conflicts?: string[]
  clinical_hypotheses?: string[]
  points_to_explore?: string[]
  sentimiento_predominante?: string
  pensamiento_predominante?: string
  mecanismo_defensa?: string
  tematica_predominante?: string
}

interface Session {
  id: string
  created_at: string
  session_date: string | null
  raw_text: string | null
  transcription: string | null
  ai_summary: string | null
  audio_duration: number | null
  session_notes: SessionNotes | null
  paid: boolean
  fee: number | null
}

function parseAiSummary(raw: string | null): AiSummary | null {
  if (!raw) return null
  try { return JSON.parse(raw) as AiSummary } catch { return null }
}

const NOTE_LABELS: { key: keyof SessionNotes; label: string }[] = [
  { key: "motivo_consulta", label: "Tema de hoy" },
  { key: "humor_paciente", label: "Humor del paciente" },
  { key: "hipotesis_clinica", label: "Hipótesis clínica" },
  { key: "intervenciones", label: "Intervenciones" },
  { key: "evolucion", label: "Evolución" },
  { key: "plan_proximo", label: "Plan próximo encuentro" },
]

interface Props {
  session: Session
  token: string
  onUpdate?: () => void
}

export function SessionCard({ session, token, onUpdate }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [paid, setPaid] = useState(session.paid)
  const [togglingPaid, setTogglingPaid] = useState(false)
  const summary = parseAiSummary(session.ai_summary)
  const hasNotes = session.session_notes && NOTE_LABELS.some(({ key }) => session.session_notes?.[key])

  async function handleTogglePaid(e: React.MouseEvent) {
    e.stopPropagation()
    setTogglingPaid(true)
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paid: !paid }),
      })
      if (res.ok) { setPaid(!paid); onUpdate?.() }
    } catch { /* silently fail */ } finally { setTogglingPaid(false) }
  }

  // Use session_date if available, fallback to created_at
  const displayDate = session.session_date
    ? new Date(session.session_date + "T12:00:00").toLocaleDateString("es-AR", {
        year: "numeric", month: "long", day: "numeric",
      })
    : new Date(session.created_at).toLocaleDateString("es-AR", {
        year: "numeric", month: "long", day: "numeric",
      })

  const aiPills = [
    summary?.sentimiento_predominante && { label: summary.sentimiento_predominante, color: "bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-900" },
    summary?.mecanismo_defensa && { label: summary.mecanismo_defensa, color: "bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-900" },
    summary?.tematica_predominante && { label: summary.tematica_predominante, color: "bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900" },
  ].filter(Boolean) as { label: string; color: string }[]

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden transition-all hover:border-blue-200 hover:shadow-[0_0_20px_-6px_rgba(59,130,246,0.35)] dark:hover:border-slate-700">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{displayDate}</span>
            {session.audio_duration && (
              <span className="text-xs text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                {Math.round(session.audio_duration)} min audio
              </span>
            )}
            {session.transcription && (
              <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-full">
                Transcripto
              </span>
            )}
          </div>
          {aiPills.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {aiPills.map((p, i) => (
                <span key={i} className={`text-xs border px-2 py-0.5 rounded-full ${p.color}`}>
                  {p.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <button
            onClick={handleTogglePaid}
            disabled={togglingPaid}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all disabled:opacity-50 ${
              paid
                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/70"
                : "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/70"
            }`}
            title={paid ? "Click para marcar como no pagado" : "Click para marcar como pagado"}
          >
            {togglingPaid ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : paid ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <Clock className="w-3.5 h-3.5" />
            )}
            {!togglingPaid && (paid ? "Pagado" : "Sin pagar")}
          </button>
          <svg
            className={`w-4 h-4 text-gray-400 dark:text-slate-500 transition-transform mt-0.5 ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-slate-800 px-5 py-4 space-y-4">
          {session.fee != null && session.fee > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Honorario:</span>
              <span className="text-sm font-medium text-gray-800 dark:text-slate-200">${session.fee.toLocaleString("es-AR")}</span>
              {!paid && <span className="text-xs text-amber-600 dark:text-amber-400">(pendiente de pago)</span>}
            </div>
          )}

          {hasNotes && (
            <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-4 space-y-3">
              <h4 className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                Estructura clínica
              </h4>
              {NOTE_LABELS.map(({ key, label }) => {
                const value = session.session_notes?.[key]
                if (!value) return null
                return (
                  <div key={key}>
                    <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-0.5">{label}</p>
                    <p className="text-sm text-gray-800 dark:text-slate-200 whitespace-pre-wrap">{value}</p>
                  </div>
                )
              })}
            </div>
          )}

          {session.raw_text && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                Notas libres
              </h4>
              <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{session.raw_text}</p>
            </div>
          )}

          {session.transcription && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                Transcripción
              </h4>
              <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                {session.transcription}
              </p>
            </div>
          )}

          {summary && (
            <div className="bg-blue-50 dark:bg-blue-950/40 rounded-lg p-4 space-y-3">
              <TextScramble
                as="h4"
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider"
                duration={0.6}
                speed={0.03}
              >
                Análisis IA
              </TextScramble>

              <div className="grid grid-cols-2 gap-2">
                {summary.sentimiento_predominante && (
                  <div className="bg-white dark:bg-slate-800 rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-400 dark:text-slate-500 mb-0.5">Sentimiento</p>
                    <p className="text-sm font-medium text-orange-600 dark:text-orange-400">{summary.sentimiento_predominante}</p>
                  </div>
                )}
                {summary.pensamiento_predominante && (
                  <div className="bg-white dark:bg-slate-800 rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-400 dark:text-slate-500 mb-0.5">Pensamiento</p>
                    <p className="text-sm font-medium text-purple-600 dark:text-purple-400">{summary.pensamiento_predominante}</p>
                  </div>
                )}
                {summary.mecanismo_defensa && (
                  <div className="bg-white dark:bg-slate-800 rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-400 dark:text-slate-500 mb-0.5">Mecanismo de defensa</p>
                    <p className="text-sm font-medium text-blue-600 dark:text-blue-400">{summary.mecanismo_defensa}</p>
                  </div>
                )}
                {summary.tematica_predominante && (
                  <div className="bg-white dark:bg-slate-800 rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-400 dark:text-slate-500 mb-0.5">Temática</p>
                    <p className="text-sm font-medium text-green-600 dark:text-green-400">{summary.tematica_predominante}</p>
                  </div>
                )}
              </div>

              {summary.main_topic && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-0.5">Tema principal</p>
                  <p className="text-sm text-gray-800 dark:text-slate-200">{summary.main_topic}</p>
                </div>
              )}
              {summary.dominant_emotions && summary.dominant_emotions.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Emociones dominantes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.dominant_emotions.map((e, i) => (
                      <span key={i} className="text-xs bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-900 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-full">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {summary.conflicts && summary.conflicts.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Conflictos</p>
                  <ul className="space-y-0.5">
                    {summary.conflicts.map((c, i) => (
                      <li key={i} className="text-sm text-gray-700 dark:text-slate-300 flex gap-2">
                        <span className="text-gray-400 flex-shrink-0">·</span>{c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {summary.clinical_hypotheses && summary.clinical_hypotheses.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Hipótesis clínicas</p>
                  <ul className="space-y-0.5">
                    {summary.clinical_hypotheses.map((h, i) => (
                      <li key={i} className="text-sm text-gray-700 dark:text-slate-300 flex gap-2">
                        <span className="text-gray-400 flex-shrink-0">·</span>{h}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {summary.points_to_explore && summary.points_to_explore.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Puntos a explorar</p>
                  <ul className="space-y-0.5">
                    {summary.points_to_explore.map((p, i) => (
                      <li key={i} className="text-sm text-gray-700 dark:text-slate-300 flex gap-2">
                        <span className="text-blue-400 flex-shrink-0">→</span>{p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
