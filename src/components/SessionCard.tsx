"use client"

import { useState } from "react"

interface AiSummary {
  main_topic: string
  dominant_emotions: string[]
  conflicts: string[]
  clinical_hypotheses: string[]
  points_to_explore: string[]
}

interface Session {
  id: string
  created_at: string
  raw_text: string
  transcription: string | null
  ai_summary: string | null
  audio_duration: number | null
}

function parseAiSummary(raw: string | null): AiSummary | null {
  if (!raw) return null
  try { return JSON.parse(raw) as AiSummary } catch { return null }
}

export function SessionCard({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false)
  const summary = parseAiSummary(session.ai_summary)

  const date = new Date(session.created_at).toLocaleDateString("es-AR", {
    year: "numeric", month: "long", day: "numeric",
  })

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{date}</span>
          {session.audio_duration && (
            <span className="text-xs text-gray-400 dark:text-slate-500 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
              {Math.round(session.audio_duration)} min
            </span>
          )}
          {session.transcription && (
            <span className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-full">
              Transcripto
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 dark:text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-slate-800 px-5 py-4 space-y-4">
          {session.raw_text && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                Notas
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
              <h4 className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                Resumen IA
              </h4>
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-0.5">Tema principal</p>
                <p className="text-sm text-gray-800 dark:text-slate-200">{summary.main_topic}</p>
              </div>
              {summary.dominant_emotions?.length > 0 && (
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
              {summary.conflicts?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Conflictos</p>
                  <ul className="space-y-0.5">
                    {summary.conflicts.map((c, i) => (
                      <li key={i} className="text-sm text-gray-700 dark:text-slate-300 flex gap-2">
                        <span className="text-gray-400 dark:text-slate-500 flex-shrink-0">·</span>{c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {summary.clinical_hypotheses?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Hipótesis clínicas</p>
                  <ul className="space-y-0.5">
                    {summary.clinical_hypotheses.map((h, i) => (
                      <li key={i} className="text-sm text-gray-700 dark:text-slate-300 flex gap-2">
                        <span className="text-gray-400 dark:text-slate-500 flex-shrink-0">·</span>{h}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {summary.points_to_explore?.length > 0 && (
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
