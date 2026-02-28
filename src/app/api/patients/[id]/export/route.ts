import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { findPatientById } from "@/lib/repositories/patient.repository"
import { findSessionsByPatient } from "@/lib/repositories/session.repository"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

function formatDate(iso: string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleDateString("es-AR", opts ?? { day: "numeric", month: "long", year: "numeric" })
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>")
}

/** GET /api/patients/[id]/export — returns full patient data as a printable HTML document */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const user = await getAuthUser(req)
    const [patient, sessions] = await Promise.all([
      findPatientById(params.id, user.id),
      findSessionsByPatient(params.id, user.id),
    ])

    if (!patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 })
    }

    const today = formatDate(new Date().toISOString())

    const sessionsHtml = sessions.map((s, idx) => {
      let aiHtml = ""
      if (s.ai_summary) {
        try {
          const ai = JSON.parse(s.ai_summary)
          const metrics = [
            ai.sentimiento_predominante && `<li><strong>Sentimiento:</strong> ${escapeHtml(ai.sentimiento_predominante)}</li>`,
            ai.pensamiento_predominante && `<li><strong>Pensamiento:</strong> ${escapeHtml(ai.pensamiento_predominante)}</li>`,
            ai.mecanismo_defensa && `<li><strong>Mecanismo de defensa:</strong> ${escapeHtml(ai.mecanismo_defensa)}</li>`,
            ai.tematica_predominante && `<li><strong>Temática:</strong> ${escapeHtml(ai.tematica_predominante)}</li>`,
            ai.main_topic && `<li><strong>Tema principal:</strong> ${escapeHtml(ai.main_topic)}</li>`,
          ].filter(Boolean).join("")

          const emotions = ai.dominant_emotions?.length
            ? `<li><strong>Emociones dominantes:</strong> ${ai.dominant_emotions.map(escapeHtml).join(", ")}</li>`
            : ""
          const hypotheses = ai.clinical_hypotheses?.length
            ? `<li><strong>Hipótesis clínicas:</strong> ${ai.clinical_hypotheses.map(escapeHtml).join("; ")}</li>`
            : ""
          const points = ai.points_to_explore?.length
            ? `<li><strong>A explorar:</strong> ${ai.points_to_explore.map(escapeHtml).join("; ")}</li>`
            : ""

          aiHtml = `<div class="ai-section"><h4>Análisis IA</h4><ul>${metrics}${emotions}${hypotheses}${points}</ul></div>`
        } catch {
          aiHtml = ""
        }
      }

      const notesHtml = s.session_notes
        ? (() => {
            const fields = [
              { label: "Motivo de consulta", val: s.session_notes.motivo_consulta },
              { label: "Hipótesis clínica", val: s.session_notes.hipotesis_clinica },
              { label: "Intervenciones", val: s.session_notes.intervenciones },
              { label: "Evolución", val: s.session_notes.evolucion },
              { label: "Plan próximo encuentro", val: s.session_notes.plan_proximo },
            ].filter(f => f.val)
            if (fields.length === 0) return ""
            return `<div class="notes-section"><h4>Estructura clínica</h4>${fields.map(f => `<p><strong>${f.label}:</strong><br>${escapeHtml(f.val!)}</p>`).join("")}</div>`
          })()
        : ""

      const rawTextHtml = s.raw_text
        ? `<div class="raw-section"><h4>Notas libres</h4><p>${escapeHtml(s.raw_text)}</p></div>`
        : ""

      const transcriptionHtml = s.transcription
        ? `<div class="transcription-section"><h4>Transcripción de audio</h4><p>${escapeHtml(s.transcription)}</p></div>`
        : ""

      const paymentBadge = s.paid
        ? `<span class="badge badge-paid">Pagada${s.fee ? ` · $${s.fee.toLocaleString("es-AR")}` : ""}</span>`
        : s.fee
        ? `<span class="badge badge-unpaid">Sin pagar · $${s.fee.toLocaleString("es-AR")}</span>`
        : ""

      return `
        <div class="session">
          <div class="session-header">
            <span class="session-number">Sesión ${sessions.length - idx}</span>
            <span class="session-date">${formatDate(s.created_at)}</span>
            ${s.audio_duration ? `<span class="badge badge-audio">${Math.round(s.audio_duration)} min audio</span>` : ""}
            ${paymentBadge}
          </div>
          ${notesHtml}
          ${rawTextHtml}
          ${transcriptionHtml}
          ${aiHtml}
        </div>`
    }).join("")

    const paidSessions = sessions.filter(s => s.paid)
    const totalIncome = paidSessions.reduce((sum, s) => sum + (s.fee ?? 0), 0)
    const unpaidSessions = sessions.filter(s => !s.paid && s.fee)
    const totalUnpaid = unpaidSessions.reduce((sum, s) => sum + (s.fee ?? 0), 0)

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Expediente clínico — ${escapeHtml(patient.name)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; color: #1a1a1a; background: white; padding: 2cm; max-width: 21cm; margin: 0 auto; }
    h1 { font-size: 20pt; color: #1e3a5f; border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 16px; }
    h2 { font-size: 14pt; color: #1e3a5f; margin: 24px 0 10px; }
    h3 { font-size: 12pt; color: #2d5a8e; margin: 16px 0 8px; }
    h4 { font-size: 11pt; color: #555; margin: 12px 0 6px; font-style: italic; }
    p { line-height: 1.6; margin-bottom: 8px; }
    ul { padding-left: 20px; line-height: 1.6; }
    li { margin-bottom: 4px; }
    .meta { color: #666; font-size: 10pt; margin-bottom: 24px; }
    .section { background: #f8f9fc; border-left: 3px solid #2d5a8e; padding: 14px 16px; margin-bottom: 16px; border-radius: 0 6px 6px 0; }
    .session { border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin-bottom: 20px; page-break-inside: avoid; }
    .session-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #eee; }
    .session-number { font-weight: bold; color: #1e3a5f; }
    .session-date { color: #555; }
    .badge { font-size: 9pt; padding: 2px 8px; border-radius: 12px; }
    .badge-paid { background: #d1fae5; color: #065f46; }
    .badge-unpaid { background: #fef3c7; color: #92400e; }
    .badge-audio { background: #dbeafe; color: #1e40af; }
    .notes-section { background: #f0fdf4; border-left: 3px solid #16a34a; padding: 12px 14px; margin-bottom: 12px; border-radius: 0 6px 6px 0; }
    .ai-section { background: #eff6ff; border-left: 3px solid #2563eb; padding: 12px 14px; margin-bottom: 12px; border-radius: 0 6px 6px 0; }
    .raw-section { background: #fafafa; border-left: 3px solid #9ca3af; padding: 12px 14px; margin-bottom: 12px; border-radius: 0 6px 6px 0; }
    .transcription-section { background: #f5f3ff; border-left: 3px solid #7c3aed; padding: 12px 14px; margin-bottom: 12px; border-radius: 0 6px 6px 0; }
    .finance-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
    .finance-card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; text-align: center; }
    .finance-value { font-size: 18pt; font-weight: bold; color: #1e3a5f; }
    .finance-label { font-size: 9pt; color: #666; margin-top: 4px; }
    .legal { font-size: 9pt; color: #888; border-top: 1px solid #ddd; padding-top: 16px; margin-top: 32px; }
    .consent-box { background: #fef9ee; border: 1px solid #d97706; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; font-size: 10pt; }
    @media print {
      body { padding: 1cm; }
      .session { page-break-inside: avoid; }
    }
  </style>
</head>
<body>

  <h1>Expediente Clínico</h1>
  <p class="meta">Generado el ${today} · PsicoApp</p>

  <h2>Datos del paciente</h2>
  <div class="section">
    <p><strong>Nombre:</strong> ${escapeHtml(patient.name)}</p>
    <p><strong>Edad:</strong> ${patient.age} años</p>
    <p><strong>Motivo de consulta inicial:</strong> ${escapeHtml(patient.reason)}</p>
    <p><strong>Estado:</strong> ${patient.is_active ? "Activo" : "Inactivo"}</p>
    <p><strong>Inicio del tratamiento:</strong> ${formatDate(patient.created_at)}</p>
    ${patient.recording_consent_at
      ? `<p><strong>Consentimiento para grabación:</strong> Otorgado el ${formatDate(patient.recording_consent_at)}</p>`
      : `<p><strong>Consentimiento para grabación:</strong> No registrado</p>`}
  </div>

  ${patient.case_summary ? `
  <h2>Resumen clínico acumulado</h2>
  <div class="section">
    <p>${escapeHtml(patient.case_summary)}</p>
  </div>` : ""}

  <h2>Resumen financiero</h2>
  <div class="finance-grid">
    <div class="finance-card">
      <div class="finance-value">${sessions.length}</div>
      <div class="finance-label">Sesiones totales</div>
    </div>
    <div class="finance-card">
      <div class="finance-value" style="color:#16a34a">$${totalIncome.toLocaleString("es-AR")}</div>
      <div class="finance-label">Total cobrado</div>
    </div>
    <div class="finance-card">
      <div class="finance-value" style="color:#d97706">$${totalUnpaid.toLocaleString("es-AR")}</div>
      <div class="finance-label">Pendiente de cobro</div>
    </div>
  </div>

  ${patient.recording_consent_at ? `
  <div class="consent-box">
    <strong>Consentimiento para grabación y procesamiento de audio:</strong><br>
    El paciente otorgó consentimiento informado el ${formatDate(patient.recording_consent_at)} para la grabación y transcripción
    de sesiones, conforme a la Ley 26.529 de Derechos del Paciente y la Ley 25.326 de Protección de Datos Personales.
  </div>` : ""}

  <h2>Historial de sesiones (${sessions.length})</h2>

  ${sessionsHtml || "<p>No hay sesiones registradas.</p>"}

  <div class="legal">
    <p><strong>Confidencialidad:</strong> Este documento contiene información clínica confidencial protegida por el secreto profesional
    (Ley 17.132 art. 11, Ley 26.529 art. 2°). Su divulgación no autorizada es pasible de sanción.</p>
    <p><strong>Datos personales:</strong> El tratamiento de datos personales sensibles se realiza conforme a la Ley 25.326 de Protección de Datos Personales (Argentina).
    El titular tiene derecho de acceso, rectificación y supresión de sus datos.</p>
    <p>Exportado desde PsicoApp · ${today}</p>
  </div>

</body>
</html>`

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="expediente-${patient.name.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.html"`,
      },
    })
  } catch (error: unknown) {
    const err = error as Error
    logger.error("GET /api/patients/[id]/export failed", { error: err.message, id: params.id })
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
