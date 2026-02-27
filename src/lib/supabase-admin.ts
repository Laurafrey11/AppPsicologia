import { createClient, SupabaseClient } from "@supabase/supabase-js"

/**
 * Lazy singleton for the Supabase admin client (service role).
 *
 * Using a Proxy so the client is only instantiated on first property access
 * (i.e., during a real request), not at module evaluation time.
 * This avoids "supabaseUrl is required" errors during Next.js build-time
 * module scanning when env vars are not available.
 */
let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _client
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop: string | symbol) {
    return (getClient() as unknown as Record<string | symbol, unknown>)[prop]
  },
})
