import { createBrowserClient } from "@supabase/ssr"

/**
 * Browser-side Supabase client.
 * Safe to use in Client Components — the anon key is protected by RLS.
 * Never use this in API routes or server-side code.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
