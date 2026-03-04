"use client"

import { useState } from "react"
import { Loader2, Trash2 } from "lucide-react"
import { TextScramble } from "@/components/ui/text-scramble"
import { TogglePaid } from "@/components/ui/animated-state-icons"

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
  has_risk?: boolean
  tags?: string[]
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
  onDelete?: (id: string) => void
}

export function SessionCard({ session, token, onUpdate, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [paid, setPaid] = useState(session.paid)
  const [togglingPaid, setTogglingPaid] = useState(false)

  // Edit mode state
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState(session.raw_text ?? "")
  const [editDate, setEditDate] = useState(session.session_date ?? "")
  const [editFee, setEditFee] = useState(session.fee != null ? String(session.fee) : "")
  const [editPaid, setEditPaid] = useState(session.paid)
  // AI summary editable fields
  const [editSentimiento, setEditSentimiento] = useState(parseAiSummary(session.ai_summary)?.sentimiento_predominante ?? "")
  const [editPensamiento, setEditPensamiento] = useState(parseAiSummary(session.ai_summary)?.pensamiento_predominante ?? "")
  const [editMecanismo, setEditMecanismo] = useState(parseAiSummary(session.ai_summary)?.mecanismo_defensa ?? "")
  const [editTematica, setEditTematica] = useState(parseAiSummary(session.ai_summary)?.tematica_predominante ?? "")
  const [editMainTopic, setEditMainTopic] = useState(parseAiSummary(session.ai_summary)?.main_topic ?? "")
  // Session notes editable fields
  const [editMotivo, setEditMotivo] = useState(session.session_notes?.motivo_consulta ?? "")
  const [editHumor, setEditHumor] = useState(session.session_notes?.humor_paciente ?? "")
  const [editHipotesis, setEditHipotesis] = useState(session.session_notes?.hipotesis_clinica ?? "")
  const [editIntervenciones, setEditIntervenciones] = useState(session.session_notes?.intervenciones ?? "")
  const [editEvolucion, setEditEvolucion] = useState(session.session_notes?.evolucion ?? "")
  const [editPlan, setEditPlan] = useState(session.session_notes?.plan_proximo ?? "")
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Delete state
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Local display overrides (updated on save without waiting for reload)
  const [localText, setLocalText] = useState(session.raw_text)
  const [localDate, setLocalDate] = useState(session.session_date)
  const [localFee, setLocalFee] = useState(session.fee)

  // Tags state
  const [localTags, setLocalTags] = useState<string[]>(parseAiSummary(session.ai_summary)?.tags ?? [])
  const [addingTag, setAddingTag] = useState(false)
  const [newTagInput, setNewTagInput] = useState("")

  const summary = parseAiSummary(session.ai_summary)
  const hasNotes = session.session_notes && NOTE_LABELS.some(({ key }) => session.session_notes?.[key])

  function openEdit() {
    setEditText(localText ?? "")
    setEditDate(localDate ?? "")
    setEditFee(localFee != null ? String(localFee) : "")
    setEditPaid(paid)
    const s = parseAiSummary(session.ai_summary)
    setEditSentimiento(s?.sentimiento_predominante ?? "")
    setEditPensamiento(s?.pensamiento_predominante ?? "")
    setEditMecanismo(s?.mecanismo_defensa ?? "")
    setEditTematica(s?.tematica_predominante ?? "")
    setEditMainTopic(s?.main_topic ?? "")
    setEditMotivo(session.session_notes?.motivo_consulta ?? "")
    setEditHumor(session.session_notes?.humor_paciente ?? "")
    setEditHipotesis(session.session_notes?.hipotesis_clinica ?? "")
    setEditIntervenciones(session.session_notes?.intervenciones ?? "")
    setEditEvolucion(session.session_notes?.evolucion ?? "")
    setEditPlan(session.session_notes?.plan_proximo ?? "")
    setSaveError(null)
    setEditing(true)
  }

  async function handleSave() {
    if (!editText.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      // Build updated ai_summary JSON (merge existing + edited fields)
      const existingSummary = parseAiSummary(session.ai_summary) ?? {}
      const updatedSummary = {
        ...existingSummary,
        ...(editSentimiento ? { sentimiento_predominante: editSentimiento } : {}),
        ...(editPensamiento ? { pensamiento_predominante: editPensamiento } : {}),
        ...(editMecanismo   ? { mecanismo_defensa: editMecanismo } : {}),
        ...(editTematica    ? { tematica_predominante: editTematica } : {}),
        ...(editMainTopic   ? { main_topic: editMainTopic } : {}),
        tags: localTags,
      }
      const aiSummaryPayload = Object.keys(updatedSummary).length > 0
        ? JSON.stringify(updatedSummary)
        : null

      // Build session_notes (only include non-empty fields)
      const notesPayload = {
        motivo_consulta: editMotivo.trim(),
        humor_paciente: editHumor.trim(),
        hipotesis_clinica: editHipotesis.trim(),
        intervenciones: editIntervenciones.trim(),
        evolucion: editEvolucion.trim(),
        plan_proximo: editPlan.trim(),
      }
      const hasNotes = Object.values(notesPayload).some(Boolean)

      const res = await fetch(`/api/sessions/${session.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          text: editText,
          session_date: editDate || null,
          fee: editFee !== "" ? Number(editFee) : null,
          paid: editPaid,
          ai_summary: aiSummaryPayload,
          session_notes: hasNotes ? notesPayload : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSaveError(data.error ?? "Error al guardar"); return }

      // Update local display state immediately
      setLocalText(data.raw_text ?? editText)
      setLocalDate((data.session_date ?? editDate) || null)
      setLocalFee(data.fee ?? null)
      setPaid(data.paid ?? editPaid)

      setSaveSuccess(true)
      setEditing(false)
      setTimeout(() => setSaveSuccess(false), 2000)
      onUpdate?.()
    } catch (err: unknown) {
      setSaveError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

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

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        onDelete?.(session.id)
      } else {
        const data = await res.json().catch(() => ({}))
        setSaveError(data.error ?? "Error al eliminar")
        setDeleteConfirm(false)
      }
    } catch {
      setSaveError("Error al eliminar")
      setDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  async function handleAddTag(tag: string) {
    const trimmed = tag.trim().replace(/^#/, "")
    if (!trimmed || localTags.includes(trimmed)) { setNewTagInput(""); setAddingTag(false); return }
    const newTags = [...localTags, trimmed]
    const existingSummary = parseAiSummary(session.ai_summary) ?? {}
    const updatedSummary = JSON.stringify({ ...existingSummary, tags: newTags })
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: session.raw_text ?? "", ai_summary: updatedSummary }),
      })
      if (res.ok) setLocalTags(newTags)
    } catch { /* silently fail */ }
    setNewTagInput("")
    setAddingTag(false)
  }

  async function handleRemoveTag(tag: string) {
    const newTags = localTags.filter((t) => t !== tag)
    const existingSummary = parseAiSummary(session.ai_summary) ?? {}
    const updatedSummary = JSON.stringify({ ...existingSummary, tags: newTags })
    try {
      const res = await fetch(`/api/sessions/${session.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: session.raw_text ?? "", ai_summary: updatedSummary }),
      })
      if (res.ok) setLocalTags(newTags)
    } catch { /* silently fail */ }
  }

  // Use local overrides so edits are reflected immediately
  const displayDate = localDate
    ? new Date(localDate + "T12:00:00").toLocaleDateString("es-AR", {
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
          {localTags.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {localTags.map((tag) => (
                <span key={tag} className="text-xs bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-1.5 py-0.5 rounded">
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {saveSuccess && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✓ Guardado</span>
          )}
          <button
            onClick={handleTogglePaid}
            disabled={togglingPaid}
            className="flex items-center gap-1 disabled:opacity-50 transition-opacity"
            title={paid ? "Click para marcar como no pagado" : "Click para marcar como pagado"}
          >
            {togglingPaid ? (
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            ) : (
              <TogglePaid checked={paid} size={34} />
            )}
            <span className={`text-xs font-semibold ${paid ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
              {paid ? "Pagado" : "Sin pagar"}
            </span>
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

          {/* ── Edit form ── */}
          {editing && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500 dark:text-slate-400">Fecha</label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="text-sm border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500 dark:text-slate-400">Honorario ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={editFee}
                    onChange={(e) => setEditFee(e.target.value)}
                    placeholder="0"
                    className="text-sm border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors w-32"
                  />
                </div>
                <div className="flex flex-col gap-1 justify-end">
                  <label className="text-xs font-medium text-gray-500 dark:text-slate-400">Pago</label>
                  <button
                    type="button"
                    onClick={() => setEditPaid((v) => !v)}
                    className={`text-xs font-semibold px-3 py-2 rounded-lg border transition-colors ${
                      editPaid
                        ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400"
                        : "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {editPaid ? "Pagado" : "Sin pagar"}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500 dark:text-slate-400">Texto de la sesión</label>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={6}
                  className="text-sm border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors resize-y"
                />
              </div>

              {/* Notas clínicas */}
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Notas clínicas</p>
                {(
                  [
                    ["Tema de hoy", editMotivo, setEditMotivo],
                    ["Humor del paciente", editHumor, setEditHumor],
                    ["Hipótesis clínica", editHipotesis, setEditHipotesis],
                    ["Intervenciones", editIntervenciones, setEditIntervenciones],
                    ["Evolución", editEvolucion, setEditEvolucion],
                    ["Plan próximo encuentro", editPlan, setEditPlan],
                  ] as [string, string, (v: string) => void][]
                ).map(([label, val, set]) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <label className="text-xs text-gray-400 dark:text-slate-500">{label}</label>
                    <textarea
                      value={val}
                      onChange={(e) => set(e.target.value)}
                      rows={2}
                      className="text-sm border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:border-emerald-400 dark:focus:border-emerald-600 transition-colors resize-y"
                    />
                  </div>
                ))}
              </div>

              {/* Análisis IA */}
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Análisis IA</p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["Sentimiento", editSentimiento, setEditSentimiento],
                      ["Pensamiento", editPensamiento, setEditPensamiento],
                      ["Mecanismo de defensa", editMecanismo, setEditMecanismo],
                      ["Temática", editTematica, setEditTematica],
                    ] as [string, string, (v: string) => void][]
                  ).map(([label, val, set]) => (
                    <div key={label} className="flex flex-col gap-0.5">
                      <label className="text-xs text-gray-400 dark:text-slate-500">{label}</label>
                      <input
                        type="text"
                        value={val}
                        onChange={(e) => set(e.target.value)}
                        className="text-sm border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-0.5">
                  <label className="text-xs text-gray-400 dark:text-slate-500">Tema principal</label>
                  <input
                    type="text"
                    value={editMainTopic}
                    onChange={(e) => setEditMainTopic(e.target.value)}
                    className="text-sm border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors"
                  />
                </div>
              </div>

              {saveError && (
                <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !editText.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
                >
                  {saving ? "Guardando..." : "Guardar cambios"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 px-3 py-1.5 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* ── Read-only view ── */}
          {!editing && (
            <>
          {localFee != null && localFee > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Honorario:</span>
              <span className="text-sm font-medium text-gray-800 dark:text-slate-200">${localFee.toLocaleString("es-AR")}</span>
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

          {localText && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                Notas libres
              </h4>
              <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{localText}</p>
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

          {/* Tags */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {localTags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 px-2 py-0.5 rounded group">
                #{tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 dark:hover:text-red-400 leading-none"
                  title="Quitar etiqueta"
                >×</button>
              </span>
            ))}
            {addingTag ? (
              <input
                autoFocus
                type="text"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddTag(newTagInput); if (e.key === "Escape") { setAddingTag(false); setNewTagInput("") } }}
                onBlur={() => handleAddTag(newTagInput)}
                placeholder="Nueva etiqueta"
                className="text-xs border border-gray-300 dark:border-slate-700 rounded px-2 py-0.5 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-400 w-28"
              />
            ) : (
              <button
                onClick={() => setAddingTag(true)}
                className="text-xs text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 border border-dashed border-gray-300 dark:border-slate-700 px-1.5 py-0.5 rounded transition-colors"
                title="Agregar etiqueta"
              >+ etiqueta</button>
            )}
          </div>

          {/* Edit / Delete bar */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="text-gray-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  title="Eliminar sesión"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 dark:text-red-400">¿Eliminar esta sesión?</span>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 px-2 py-0.5 rounded transition-colors"
                  >
                    {deleting ? "..." : "Sí, eliminar"}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    disabled={deleting}
                    className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={openEdit}
              className="text-xs text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              Editar
            </button>
          </div>
          </>
          )}
        </div>
      )}
    </div>
  )
}
