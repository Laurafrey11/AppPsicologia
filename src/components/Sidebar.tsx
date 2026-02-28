"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { PixelCanvas } from "@/components/ui/pixel-canvas"
import { ThemeToggle } from "@/components/ThemeToggle"
import { NewPatientModal } from "./NewPatientModal"

interface Patient {
  id: string
  name: string
  age: number
}

export function Sidebar() {
  const supabase = createSupabaseBrowserClient()
  const pathname = usePathname()
  const router = useRouter()

  const [patients, setPatients] = useState<Patient[]>([])
  const [token, setToken] = useState<string | null>(null)
  const [showNewPatient, setShowNewPatient] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null)
    })
  }, [supabase])

  useEffect(() => {
    if (!token) return
    fetchPatients(token)
  }, [token])

  function fetchPatients(tok: string) {
    fetch("/api/patients", { headers: { Authorization: `Bearer ${tok}` } })
      .then((r) => r.json())
      .then(setPatients)
      .catch(() => {})
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <aside className="w-64 flex-shrink-0 bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 flex flex-col">
      {/* Header */}
      <div className="px-4 py-5 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between">
        <h1 className="text-base font-bold text-gray-900 dark:text-slate-100">PsicoApp</h1>
        <ThemeToggle />
      </div>

      {/* Add patient CTA — pixel shimmer */}
      <div className="px-3 py-3">
        <button
          onClick={() => setShowNewPatient(true)}
          className="group relative w-full overflow-hidden flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          <PixelCanvas
            gap={6}
            speed={70}
            colors={["#ffffff", "#bfdbfe", "#93c5fd"]}
            noFocus
          />
          <span className="relative z-10 flex items-center gap-1.5">
            <span className="text-base leading-none">+</span>
            <span>Nuevo paciente</span>
          </span>
        </button>
      </div>

      {/* Navigation */}
      <nav className="px-2 pb-1 border-b border-gray-100 dark:border-slate-800">
        {[
          { href: "/dashboard/estadisticas", label: "Dashboard", icon: "📊" },
          { href: "/dashboard/supervision", label: "Supervisión IA", icon: "🔬" },
          { href: "/dashboard/perfil", label: "Perfil", icon: "⚙️" },
        ].map(({ href, label, icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors mb-0.5 ${
                active
                  ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 font-medium"
                  : "text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
              }`}
            >
              <span className="text-base">{icon}</span>
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Patient list */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-2 py-1.5 text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">
          Pacientes
        </p>
        {patients.length === 0 && (
          <p className="px-2 py-2 text-xs text-gray-400 dark:text-slate-500">No hay pacientes aún.</p>
        )}
        {patients.map((p) => {
          const href = `/dashboard/patients/${p.id}`
          const active = pathname === href
          return (
            <Link
              key={p.id}
              href={href}
              className={`flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors mb-0.5 ${
                active
                  ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-400 font-medium"
                  : "text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800"
              }`}
            >
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-xs text-gray-400 dark:text-slate-500 flex-shrink-0">{p.age}a</span>
            </Link>
          )
        })}
      </nav>

      {/* Sign out */}
      <div className="px-3 py-3 border-t border-gray-200 dark:border-slate-800">
        <button
          onClick={handleSignOut}
          className="w-full text-left text-xs text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 transition-colors py-1"
        >
          Cerrar sesión
        </button>
      </div>

      {showNewPatient && token && (
        <NewPatientModal
          token={token}
          onClose={() => setShowNewPatient(false)}
          onCreated={(patient) => {
            setPatients((prev) => [...prev, patient])
            setShowNewPatient(false)
            router.push(`/dashboard/patients/${patient.id}`)
          }}
        />
      )}
    </aside>
  )
}
