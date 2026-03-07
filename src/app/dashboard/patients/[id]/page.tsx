"use client"

export const dynamic = "force-dynamic"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { SessionCard } from "@/components/SessionCard"
import { NewSessionModal } from "@/components/NewSessionModal"
import { ImportSessionsModal } from "@/components/ImportSessionsModal"
import { PatientDocuments } from "@/components/PatientDocuments"
import { PixelCanvas } from "@/components/ui/pixel-canvas"
import { PatientMetrics } from "@/components/PatientMetrics"
import { PatientEvolutionChart } from "@/components/PatientEvolutionChart"
import { WaveText } from "@/components/ui/wave-text"
import { Search, ChevronRight } from "lucide-react"

interface Patient {
  id: string
  name: string
  age: number
  reason: string
  case_summary: string | null
  is_active: boolean
  historical_import_done: boolean
  recording_consent_at: string | null
  created_at: string
  monthly_rate: number | null
  // n8n analysis fields
  sentiment_score: number | null
  anxiety_level: number | null
  presumptive_diagnosis: string | null
  therapeutic_recommendations: string | null
  main_defense_mechanisms: string | null
  primary_theme: string | null
}

interface SessionNotes {
  motivo_consulta?: string
  humor_paciente?: string
  hipotesis_clinica?: string
  intervenciones?: string
  evolucion?: string
  plan_proximo?: string
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

type MonthlyRateConfig = { mode: "flat"; amount: number } | { mode: "per_session" }
type MonthlyRates = Record<string, MonthlyRateConfig> // key: "${year}-${month}" (0-based)

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

function filterSessions(sessions: Session[], query: string): Session[] {
  if (!query.trim()) return sessions
  const q = query.toLowerCase()
  return sessions.filter((s) => {
    const dateStr = s.session_date ?? s.created_at
    const dateFormatted = new Date(dateStr.includes("T") ? dateStr : dateStr + "T12:00:00")
      .toLocaleDateString("es-AR", { year: "numeric", month: "long", day: "numeric" })
      .toLowerCase()
    const notes = s.session_notes
      ? Object.values(s.session_notes).join(" ").toLowerCase()
      : ""
    const aiText = s.ai_summary?.toLowerCase() ?? ""
    const rawText = (s.raw_text ?? "").toLowerCase()
    const transcription = (s.transcription ?? "").toLowerCase()
    return (
      dateFormatted.includes(q) ||
      (s.session_date ?? "").includes(q) ||
      notes.includes(q) ||
      aiText.includes(q) ||
      rawText.includes(q) ||
      transcription.includes(q)
    )
  })
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
  const [searchQuery, setSearchQuery] = useState("")
  const [showImport, setShowImport] = useState(false)
  const [schedulingLink, setSchedulingLink] = useState<string | null>(null)
  const [supervisionReport, setSupervisionReport] = useState<string | null>(null)
  const [generatingSupervision, setGeneratingSupervision] = useState(false)
  const [supervisionError, setSupervisionError] = useState<string | null>(null)
  const [editingReason, setEditingReason] = useState(false)
  const [reasonDraft, setReasonDraft] = useState("")
  const [savingReason, setSavingReason] = useState(false)
  const [consultationLimitReached, setConsultationLimitReached] = useState(false)
  const [markingAllPaid, setMarkingAllPaid] = useState(false)
  const [analyzingMonth, setAnalyzingMonth] = useState<string | null>(null) // "year-month"
  const [analysisTriggered, setAnalysisTriggered] = useState(false)
  const [triggeringAnalysis, setTriggeringAnalysis] = useState(false)
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => {
    const now = new Date()
    return new Set([`m-${now.getFullYear()}-${now.getMonth()}`])
  })
  const [editingMonthRate, setEditingMonthRate] = useState<string | null>(null) // "year-month"
  const [monthRateInput, setMonthRateInput] = useState("")
  const [savingMonthRate, setSavingMonthRate] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const tok = data.session?.access_token ?? null
      setToken(tok)
      if (tok) {
        fetch("/api/profile", { headers: { Authorization: `Bearer ${tok}` } })
          .then((r) => r.json())
          .then((d) => setSchedulingLink(d.scheduling_link ?? null))
          .catch(() => {})
        fetch("/api/supervision-status", { headers: { Authorization: `Bearer ${tok}` } })
          .then((r) => r.json())
          .then((d) => setConsultationLimitReached(d.used === true))
          .catch(() => {})
      }
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

  // Parse monthly rates stored in patient.case_summary JSON
  const monthlyRates = useMemo<MonthlyRates>(() => {
    if (!patient?.case_summary) return {}
    try {
      const obj = JSON.parse(patient.case_summary) as Record<string, unknown>
      return (obj.monthly_rates as MonthlyRates) ?? {}
    } catch { return {} }
  }, [patient?.case_summary])

  async function handleSetMonthlyRate(
    year: number,
    month: number,
    mode: "flat" | "per_session",
    amount?: number
  ) {
    if (!token) return
    const rateKey = `${year}-${month}`
    setSavingMonthRate(rateKey)
    try {
      await apiFetch(`/api/patients/${id}/monthly-rate`, token, {
        method: "PATCH",
        body: JSON.stringify({ year, month, mode, amount }),
      })
      await load()
    } catch (err) {
      console.error("Error al guardar tarifa mensual:", err)
    } finally {
      setSavingMonthRate(null)
      setEditingMonthRate(null)
    }
  }

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

  async function handleSaveReason() {
    if (!token || !patient) return
    setSavingReason(true)
    try {
      const updated = await apiFetch<Patient>(`/api/patients/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ reason: reasonDraft }),
      })
      setPatient(updated)
      setEditingReason(false)
    } catch (err: unknown) {
      setError((err as Error).message)
    } finally {
      setSavingReason(false)
    }
  }

  async function handleGenerateSupervision() {
    if (!token) return
    setGeneratingSupervision(true)
    setSupervisionError(null)
    try {
      const data = await apiFetch<{ report: string; sessionCount: number }>(
        `/api/patients/${id}/supervise`,
        token,
        { method: "POST" }
      )
      setSupervisionReport(data.report)
      setConsultationLimitReached(true)
    } catch (err: unknown) {
      const msg = (err as Error).message
      if (msg.includes("CONSULTATION_LIMIT_REACHED") || msg.includes("Límite mensual")) {
        setConsultationLimitReached(true)
      }
      setSupervisionError(msg)
    } finally {
      setGeneratingSupervision(false)
    }
  }

  async function handleAnalyzeMonth(year: number, month: number, monthSessions: Session[]) {
    if (!token) return
    const key = `${year}-${month}`
    setAnalyzingMonth(key)
    try {
      const sessionIds = monthSessions.map((s) => s.id)
      await apiFetch<{ triggered: boolean }>(
        `/api/patients/${id}/trigger-analysis`,
        token,
        { method: "POST", body: JSON.stringify({ session_ids: sessionIds }) }
      )
      // n8n is async — poll for results
      setTimeout(() => load(), 5_000)
      setTimeout(() => load(), 15_000)
      setTimeout(() => load(), 30_000)
    } catch {
      // silently fail
    } finally {
      setAnalyzingMonth(null)
    }
  }

  async function handleTriggerAnalysis() {
    if (!token) return
    setTriggeringAnalysis(true)
    setTriggerMessage(null)
    try {
      await apiFetch<{ triggered: boolean }>(`/api/patients/${id}/trigger-analysis`, token, { method: "POST" })
      setAnalysisTriggered(true)
      setTriggerMessage("Análisis iniciado. Actualizando datos automáticamente…")
      // n8n procesa de forma asíncrona — recargamos a 5s, 15s y 30s para capturar el resultado
      setTimeout(() => load(), 5_000)
      setTimeout(() => load(), 15_000)
      setTimeout(() => { load(); setAnalysisTriggered(false) }, 30_000)
    } catch (err: unknown) {
      setTriggerMessage(`Error: ${(err as Error).message}`)
    } finally {
      setTriggeringAnalysis(false)
    }
  }

  async function handleMarkAllPaid() {
    if (!token) return
    setMarkingAllPaid(true)
    try {
      await apiFetch<{ updated: number }>(`/api/patients/${id}/mark-all-paid`, token, { method: "PATCH" })
      await load()
    } catch (err: unknown) {
      setError((err as Error).message)
    } finally {
      setMarkingAllPaid(false)
    }
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

  const filteredSessions = filterSessions(sessions, searchQuery)

  // Detect risk from the most recent session that has an ai_summary
  const hasRisk = sessions.some((s) => {
    if (!s.ai_summary) return false
    try { return (JSON.parse(s.ai_summary) as { has_risk?: boolean }).has_risk === true } catch { return false }
  })

  return (
    <div className="max-w-3xl mx-auto py-8 px-6">
      {/* Risk banner */}
      {hasRisk && (
        <div className="mb-4 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 flex items-center gap-2 animate-pulse">
          <span className="text-red-500 text-lg flex-shrink-0">⚠</span>
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            Atención: Patrones de riesgo detectados en la última sesión
          </p>
        </div>
      )}

      {/* Patient Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              <WaveText text={patient.name} />
            </h1>
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

        <div className="flex items-center gap-2 flex-shrink-0">
          {schedulingLink && (
            <a
              href={schedulingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium px-4 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
            >
              📅 Agendar
            </a>
          )}
          <button
            onClick={() => setShowNewSession(true)}
            className="group relative overflow-hidden bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <PixelCanvas gap={6} speed={70} colors={["#ffffff", "#bfdbfe", "#93c5fd"]} noFocus />
            <span className="relative z-10">+ Nueva sesión</span>
          </button>
        </div>
      </div>


      {/* Patient Metrics — clinical overview above reason */}
      <PatientMetrics
        sessions={sessions}
        caseSummary={patient.case_summary}
        analysisTriggered={analysisTriggered}
        monthlyRates={monthlyRates}
        patientData={{
          sentiment_score: patient.sentiment_score,
          anxiety_level: patient.anxiety_level,
          presumptive_diagnosis: patient.presumptive_diagnosis,
          therapeutic_recommendations: patient.therapeutic_recommendations,
          main_defense_mechanisms: patient.main_defense_mechanisms,
          primary_theme: patient.primary_theme,
        }}
      />

      {/* Evolution Chart */}
      <PatientEvolutionChart
        sessions={sessions}
        caseSummary={patient.case_summary}
        sentimentScore={patient.sentiment_score}
        anxietyLevel={patient.anxiety_level}
      />

      {/* Supervision */}
      {sessions.length >= 5 && (
        <section className="mb-6 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
                Interconsulta IA
              </h2>
              {sessions.length % 5 === 0 && !supervisionReport && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  ● Revisión recomendada — {sessions.length} sesiones completadas
                </p>
              )}
            </div>
            {consultationLimitReached ? (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                Límite mensual alcanzado · Plan Pro
              </span>
            ) : (
              <button
                onClick={handleGenerateSupervision}
                disabled={generatingSupervision}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
              >
                {generatingSupervision ? "Consultando..." : supervisionReport ? "Nueva interconsulta" : "Consultar colega IA"}
              </button>
            )}
          </div>

          {supervisionError && (
            <p className="text-sm text-red-600 dark:text-red-400 mb-2">{supervisionError}</p>
          )}

          {supervisionReport ? (
            <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
              {supervisionReport}
            </p>
          ) : !generatingSupervision && (
            <p className="text-xs text-gray-400 dark:text-slate-500">
              La IA analizará todos los resúmenes de sesiones y generará un informe con patrones, evolución y recomendaciones clínicas.
            </p>
          )}

          {generatingSupervision && (
            <p className="text-xs text-gray-400 dark:text-slate-500 animate-pulse">
              Analizando {sessions.length} sesiones...
            </p>
          )}
        </section>
      )}

      {/* Reason */}
      <section className="mb-6 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
            Motivo de consulta
          </h2>
          {!editingReason && (
            <button
              onClick={() => { setReasonDraft(patient.reason); setEditingReason(true) }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Editar
            </button>
          )}
        </div>
        {editingReason ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={reasonDraft}
              onChange={(e) => setReasonDraft(e.target.value)}
              rows={4}
              className="text-sm border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors resize-y w-full"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditingReason(false)}
                className="text-xs text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 px-3 py-1.5 border border-gray-200 dark:border-slate-700 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveReason}
                disabled={savingReason || reasonDraft.trim().length < 5}
                className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                {savingReason ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        ) : (
          <p
            className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap cursor-pointer hover:text-gray-900 dark:hover:text-slate-100 transition-colors"
            onClick={() => { setReasonDraft(patient.reason); setEditingReason(true) }}
          >
            {patient.reason}
          </p>
        )}
      </section>


      {/* Sessions */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
            Sesiones ({sessions.length})
          </h2>
          <div className="flex items-center gap-3">
            {sessions.some((s) => !s.paid) && (
              <button
                onClick={handleMarkAllPaid}
                disabled={markingAllPaid}
                className="text-xs text-emerald-600 dark:text-emerald-400 font-medium hover:underline disabled:opacity-50"
              >
                {markingAllPaid ? "Marcando..." : "Marcar todas como pagas"}
              </button>
            )}
            {/* Analizar todo — dispara n8n para procesar historial y llenar case_summary */}
            <button
              onClick={handleTriggerAnalysis}
              disabled={triggeringAnalysis}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border flex-shrink-0 transition-colors ${
                triggeringAnalysis
                  ? "border-violet-300 dark:border-violet-700 text-violet-500 dark:text-violet-400 animate-pulse cursor-default"
                  : "border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
              }`}
            >
              {triggeringAnalysis ? (
                <><svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Enviando a IA...</>
              ) : "✨ Analizar todo"}
            </button>
            {triggerMessage && (
              <p className={`text-xs ${triggerMessage.startsWith("Error") ? "text-red-500 dark:text-red-400" : "text-violet-600 dark:text-violet-400"}`}>
                {triggerMessage}
              </p>
            )}
            {patient.historical_import_done ? (
              <span className="text-xs text-gray-400 dark:text-slate-500 italic">
                Historial ya importado
              </span>
            ) : (
              <button
                onClick={() => setShowImport(true)}
                className="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline"
              >
                Importar históricas
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        {sessions.length > 2 && (
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por fecha, tema, notas..."
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors"
            />
          </div>
        )}

        {sessions.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-slate-500 text-sm">
            No hay sesiones aún. Creá la primera sesión con el botón de arriba.
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-slate-500 text-sm">
            No se encontraron sesiones con esa búsqueda.
          </div>
        ) : searchQuery.trim() ? (
          // Flat list while searching
          <div className="space-y-3">
            {filteredSessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                token={token!}
                patientId={id}
                onUpdate={load}
                onDelete={(sessionId) => setSessions((prev) => prev.filter((x) => x.id !== sessionId))}
              />
            ))}
          </div>
        ) : (
          // Flat accordion: each Month-Year group at top level
          (() => {
            function toggleKey(key: string) {
              setExpandedKeys((prev) => {
                const next = new Set(prev)
                if (next.has(key)) next.delete(key); else next.add(key)
                return next
              })
            }

            // Build flat month-year groups
            type MonthGroup = { year: number; month: number; sessions: Session[] }
            const groupMap = new Map<string, MonthGroup>()
            for (const s of sessions) {
              const d = new Date(s.session_date ? s.session_date + "T12:00:00" : s.created_at)
              const y = d.getFullYear(), m = d.getMonth()
              const key = `${y}-${m}`
              if (!groupMap.has(key)) groupMap.set(key, { year: y, month: m, sessions: [] })
              groupMap.get(key)!.sessions.push(s)
            }
            const groups = Array.from(groupMap.values())
              .sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month)
            // Sort sessions within each group descending
            for (const g of groups)
              g.sessions.sort((a, b) =>
                new Date(b.session_date ? b.session_date + "T12:00:00" : b.created_at).getTime() -
                new Date(a.session_date ? a.session_date + "T12:00:00" : a.created_at).getTime()
              )

            return (
              <div className="space-y-2">
                {groups.map(({ year, month, sessions: ss }) => {
                  const monthKey = `m-${year}-${month}`
                  const isOpen = expandedKeys.has(monthKey)
                  const monthName = new Date(year, month, 1)
                    .toLocaleDateString("es-AR", { month: "long" })
                  const pendingInMonth = ss.filter((s) => !s.ai_summary && s.raw_text?.trim()).length
                  const isAnalyzing = analyzingMonth === `${year}-${month}`
                  const allAnalyzed = pendingInMonth === 0
                  const rateKey = `${year}-${month}`
                  const flatConfig = monthlyRates[rateKey] as ({ mode: "flat"; amount: number } | { mode: "per_session" }) | undefined
                  const isFlat = flatConfig?.mode === "flat"
                  const monthFeeTotal = isFlat
                    ? (flatConfig as { mode: "flat"; amount: number }).amount
                    : ss.reduce((sum, s) => sum + (s.fee ?? 0), 0)
                  const hasFees = isFlat || ss.some((s) => s.fee != null)
                  const isEditingRate = editingMonthRate === rateKey
                  const isSavingRate = savingMonthRate === rateKey

                  return (
                    <div key={monthKey} className="rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden">
                      {/* Month header row */}
                      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-slate-800/60">
                        <button
                          onClick={() => toggleKey(monthKey)}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        >
                          <ChevronRight className={`w-4 h-4 text-gray-400 dark:text-slate-500 transition-transform flex-shrink-0 ${isOpen ? "rotate-90" : ""}`} />
                          <span className="text-sm font-semibold text-gray-700 dark:text-slate-200 capitalize">
                            {monthName} {year}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-slate-500 whitespace-nowrap">
                            · {ss.length} {ss.length === 1 ? "sesión" : "sesiones"}
                          </span>
                          {pendingInMonth > 0 && (
                            <span className="text-xs text-violet-500 dark:text-violet-400 whitespace-nowrap">
                              · {pendingInMonth} sin analizar
                            </span>
                          )}
                        </button>

                        {/* ── Precio del mes ── */}
                        {isEditingRate ? (
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-xs text-gray-500 dark:text-slate-400">$</span>
                            <input
                              type="number"
                              min="0"
                              value={monthRateInput}
                              onChange={(e) => setMonthRateInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSetMonthlyRate(year, month, "flat", Number(monthRateInput))
                                if (e.key === "Escape") setEditingMonthRate(null)
                              }}
                              autoFocus
                              placeholder="monto"
                              className="w-24 text-xs border border-emerald-300 dark:border-emerald-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                            />
                            <button
                              onClick={() => handleSetMonthlyRate(year, month, "flat", Number(monthRateInput))}
                              disabled={isSavingRate}
                              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 disabled:opacity-50 px-1"
                            >
                              {isSavingRate ? "..." : "✓"}
                            </button>
                            <button
                              onClick={() => setEditingMonthRate(null)}
                              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 px-0.5"
                            >✕</button>
                          </div>
                        ) : isFlat ? (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 rounded-lg">
                              📌 ${(flatConfig as { mode: "flat"; amount: number }).amount.toLocaleString("es-AR")} fija
                            </span>
                            <button
                              onClick={() => { setMonthRateInput(String((flatConfig as { mode: "flat"; amount: number }).amount)); setEditingMonthRate(rateKey) }}
                              className="text-xs text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors px-0.5"
                              title="Editar tarifa fija"
                            >✎</button>
                            <button
                              onClick={() => handleSetMonthlyRate(year, month, "per_session")}
                              disabled={isSavingRate}
                              className="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50 transition-colors px-0.5"
                              title="Quitar tarifa fija"
                            >✕</button>
                          </div>
                        ) : hasFees ? (
                          <button
                            onClick={() => { setMonthRateInput(String(monthFeeTotal)); setEditingMonthRate(rateKey) }}
                            className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors flex-shrink-0 border border-gray-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700 px-2.5 py-1 rounded-lg"
                            title="Fijar como tarifa mensual plana"
                          >
                            <span className="font-semibold">${monthFeeTotal.toLocaleString("es-AR")}</span>
                            <span className="text-gray-300 dark:text-slate-600">·</span>
                            <span>fijar</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => { setMonthRateInput(""); setEditingMonthRate(rateKey) }}
                            className="text-xs text-gray-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors flex-shrink-0 border border-dashed border-gray-200 dark:border-slate-700 hover:border-emerald-300 px-2.5 py-1 rounded-lg"
                            title="Agregar precio del mes"
                          >
                            + precio
                          </button>
                        )}

                        {/* Analizar mes button — always enabled for re-analysis */}
                        <button
                          onClick={() => handleAnalyzeMonth(year, month, ss)}
                          disabled={!!analyzingMonth}
                          className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border flex-shrink-0 transition-colors ${
                            isAnalyzing
                              ? "border-violet-300 dark:border-violet-700 text-violet-500 dark:text-violet-400 animate-pulse cursor-default"
                              : "border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                          }`}
                        >
                          {isAnalyzing ? "Enviando..." : allAnalyzed ? "✨ Re-analizar mes" : "✨ Analizar mes"}
                        </button>
                      </div>

                      {/* Sessions list */}
                      {isOpen && (
                        <div className="divide-y divide-gray-100 dark:divide-slate-800">
                          {ss.map((s) => (
                            <SessionCard
                              key={s.id}
                              session={s}
                              token={token!}
                              patientId={id}
                              onUpdate={load}
                              disableFeeEdit={isFlat}
                              onDelete={(sessionId) => setSessions((prev) => prev.filter((x) => x.id !== sessionId))}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()
        )}
      </section>

      {/* Documents */}
      {token && <PatientDocuments patientId={id} token={token} />}

      {/* Privacy & Data Management */}
      <section className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 space-y-4">
        <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
          Privacidad y gestión de datos
        </h2>

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
          token={token}
          onClose={() => setShowNewSession(false)}
          onCreated={load}
        />
      )}

      {showImport && token && (
        <ImportSessionsModal
          patientId={id}
          token={token}
          onClose={() => setShowImport(false)}
          onImported={load}
        />
      )}
    </div>
  )
}
