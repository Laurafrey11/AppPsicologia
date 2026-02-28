"use client"

export const dynamic = "force-dynamic"

import { useEffect, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

export default function PerfilPage() {
  const supabase = createSupabaseBrowserClient()
  const [token, setToken] = useState<string | null>(null)
  const [schedulingLink, setSchedulingLink] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const tok = data.session?.access_token ?? null
      setToken(tok)
      if (tok) loadProfile(tok)
      else setLoading(false)
    })
  }, [supabase])

  async function loadProfile(tok: string) {
    try {
      const res = await fetch("/api/profile", { headers: { Authorization: `Bearer ${tok}` } })
      const data = await res.json()
      setSchedulingLink(data.scheduling_link ?? "")
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scheduling_link: schedulingLink.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setSchedulingLink(data.scheduling_link ?? "")
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: unknown) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-gray-400 dark:text-slate-500">Cargando...</p>
    </div>
  )

  return (
    <div className="max-w-xl mx-auto py-8 px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Perfil</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Configuración de tu consultorio</p>
      </div>

      <section className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6">
        <h2 className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-4">
          Link de agendamiento
        </h2>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              URL de Calendly o Cal.com
            </label>
            <input
              type="url"
              value={schedulingLink}
              onChange={(e) => setSchedulingLink(e.target.value)}
              placeholder="https://calendly.com/tu-usuario o https://cal.com/tu-usuario"
              className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-400 dark:focus:border-blue-600 transition-colors"
            />
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1.5">
              Si configurás este link, aparecerá un botón "Agendar sesión" en la vista de cada paciente.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {saving ? "Guardando..." : "Guardar"}
            </button>
            {saved && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                ✓ Guardado
              </p>
            )}
          </div>
        </form>

        {schedulingLink && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-800">
            <p className="text-xs text-gray-400 dark:text-slate-500 mb-1">Vista previa del botón:</p>
            <a
              href={schedulingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <span>📅</span>
              Agendar sesión
            </a>
          </div>
        )}
      </section>
    </div>
  )
}
