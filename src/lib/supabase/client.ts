import { createBrowserClient } from "@supabase/ssr"

/**
 * Browser-side Supabase client.
 * Safe to use in Client Components — the anon key is protected by RLS.
 * Never use this in API routes or server-side code.
 *
 * Returns a stub during build-time SSR (when env vars are not available).
 * The real client is used at runtime when the component hydrates on the client.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    // Build time: return a stub — effects/handlers won't run during SSR prerender
    return {} as ReturnType<typeof createBrowserClient>
  }

  return createBrowserClient(url, key)
}
