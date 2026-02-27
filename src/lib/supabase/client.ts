import { createBrowserClient } from "@supabase/ssr"

/**
 * Browser-side Supabase client.
 * Safe to use in Client Components — the anon key is protected by RLS.
 * Never use this in API routes or server-side code.
 *
 * Fallback values prevent createBrowserClient from throwing during Next.js
 * build-time SSR when env vars are not yet available. The client is never
 * actually USED during prerendering (effects/handlers only run in the browser).
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key-for-build"
  )
}
