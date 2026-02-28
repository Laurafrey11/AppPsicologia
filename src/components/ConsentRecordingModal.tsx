"use client"

import { useState } from "react"

interface Props {
  patientName: string
  token: string
  patientId: string
  onConsented: () => void
  onDeclined: () => void
}

export function ConsentRecordingModal({ patientName, token, patientId, onConsented, onDeclined }: Props) {
  const [loading, setLoading] = useState(false)
  const [checked, setChecked] = useState(false)

  async function handleConsent() {
    if (!checked) return
    setLoading(true)
    try {
      await fetch(`/api/patients/${patientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ recording_consent_at: new Date().toISOString() }),
      })
      onConsented()
    } catch {
      onConsented() // proceed anyway on network error, consent can be retroactively logged
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-slate-700">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎙️</span>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100">
                Consentimiento para grabación
              </h2>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                Paciente: <strong>{patientName}</strong>
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl p-4 text-sm text-amber-800 dark:text-amber-300">
            <p className="font-semibold mb-1">Antes de grabar, confirmá el consentimiento del paciente.</p>
            <p>Según la <strong>Ley 26.529</strong> (Derechos del Paciente) y la <strong>Ley 25.326</strong> (Protección de Datos Personales), el paciente debe ser informado y consentir el uso de grabaciones de voz.</p>
          </div>

          <div className="space-y-3 text-sm text-gray-700 dark:text-slate-300">
            <p className="font-medium text-gray-900 dark:text-slate-100">Al grabar esta sesión, el paciente es informado de que:</p>
            <ul className="space-y-2 list-none">
              {[
                "El audio será transcripto automáticamente mediante IA para generar notas clínicas.",
                "Los datos se almacenan de forma encriptada y solo el profesional tiene acceso.",
                "Las transcripciones no serán compartidas con terceros sin su autorización.",
                "Puede solicitar la eliminación de sus datos en cualquier momento.",
                "La grabación es un recurso de apoyo clínico, no reemplaza la nota profesional.",
              ].map((item, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-emerald-500 flex-shrink-0 mt-0.5">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <label className="flex items-start gap-3 cursor-pointer bg-gray-50 dark:bg-slate-800 rounded-xl p-4 border border-gray-200 dark:border-slate-700">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded text-blue-600 border-gray-300 dark:border-slate-600"
            />
            <span className="text-sm text-gray-700 dark:text-slate-300">
              Confirmo que el paciente <strong>{patientName}</strong> ha sido informado y ha dado su consentimiento verbal para la grabación y procesamiento de esta sesión.
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            type="button"
            onClick={onDeclined}
            className="flex-1 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
          >
            Cancelar grabación
          </button>
          <button
            type="button"
            onClick={handleConsent}
            disabled={!checked || loading}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
          >
            {loading ? "Registrando..." : "Confirmar y grabar"}
          </button>
        </div>
      </div>
    </div>
  )
}
