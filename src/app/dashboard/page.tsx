export const dynamic = "force-dynamic"

import Link from "next/link"

export default function DashboardPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-6">
      <div>
        <p className="text-sm text-gray-400 dark:text-slate-600 mb-1">
          Seleccioná un paciente en el panel izquierdo.
        </p>
        <p className="text-xs text-gray-300 dark:text-slate-700">
          O visitá las secciones de análisis:
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/dashboard/estadisticas"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
        >
          <span>📊</span> Dashboard
        </Link>
        <Link
          href="/dashboard/supervision"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
        >
          <span>🔬</span> Supervisión IA
        </Link>
      </div>
    </div>
  )
}
