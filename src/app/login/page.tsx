"use client"

export const dynamic = "force-dynamic"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { PixelCanvas } from "@/components/ui/pixel-canvas"
import { ThemeToggle } from "@/components/ThemeToggle"

const BG_IMAGE =
  "https://eipvpzwcapejhdldxgow.supabase.co/storage/v1/object/sign/Web-app/a406d8d3-68d9-417f-b99d-3f8ab81062d2-ezgif.com-video-to-webp-converter.webp?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV82NmY3MWEyMy05MzEyLTQwN2MtOTY1ZC0yZmNlZWUyMThiY2MiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJXZWItYXBwL2E0MDZkOGQzLTY4ZDktNDE3Zi1iOTlkLTNmOGFiODEwNjJkMi1lemdpZi5jb20tdmlkZW8tdG8td2VicC1jb252ZXJ0ZXIud2VicCIsImlhdCI6MTc3MjIzNTg3MCwiZXhwIjoxODAzNzcxODcwfQ.CAkpfsI3oQ4WCtbjoGt8-x7adHf9WvBiWwPk9mD9BkA"

export default function LoginPage() {
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  const [mode, setMode] = useState<"login" | "register">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        router.push("/dashboard")
        router.refresh()
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setSuccess("Revisá tu email para confirmar tu cuenta.")
      }
    } catch (err: unknown) {
      const e = err as { message?: string }
      setError(e.message ?? "Ocurrió un error. Intentá de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center overflow-hidden">
      {/* Background image */}
      <img
        src={BG_IMAGE}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        aria-hidden="true"
      />

      {/* Gradient overlay — darker at bottom so card is readable */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/50 to-black/70" />

      {/* Theme toggle — top right, above overlay */}
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* Login card */}
      <div className="relative z-10 w-full max-w-sm mx-4">
        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md rounded-2xl shadow-2xl border border-white/20 dark:border-slate-700/50 p-8">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">PsicoApp</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Gestión clínica para psicólogos</p>
          </div>

          {/* Mode toggle */}
          <div className="flex rounded-lg border border-gray-200 dark:border-slate-700 p-1 mb-6">
            <button
              type="button"
              onClick={() => { setMode("login"); setError(null); setSuccess(null) }}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                mode === "login"
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200"
              }`}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => { setMode("register"); setError(null); setSuccess(null) }}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                mode === "register"
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200"
              }`}
            >
              Registrarse
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Email</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="tu@email.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Contraseña</label>
              <input
                type="password"
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
                minLength={6}
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}

            {success && (
              <div className="rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 px-3 py-2 text-sm text-green-700 dark:text-green-400">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group relative w-full overflow-hidden bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg text-sm transition-colors"
            >
              <PixelCanvas gap={6} speed={80} colors={["#ffffff", "#bfdbfe", "#93c5fd"]} noFocus />
              <span className="relative z-10">
                {loading
                  ? "Cargando..."
                  : mode === "login"
                  ? "Iniciar sesión"
                  : "Crear cuenta"}
              </span>
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-gray-400 dark:text-slate-500">
            Al usar PsicoApp aceptás nuestro tratamiento de datos conforme a la{" "}
            <Link href="/privacidad" className="underline hover:text-gray-600 dark:hover:text-slate-300 transition-colors">
              Política de Privacidad
            </Link>{" "}
            · Ley 25.326
          </p>
        </div>
      </div>
    </div>
  )
}
