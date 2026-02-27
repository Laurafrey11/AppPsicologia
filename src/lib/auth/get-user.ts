import { supabaseAdmin } from "@/lib/supabase-admin"
import { UnauthorizedError } from "@/lib/errors/UnauthorizedError"

/**
 * Extracts and verifies the authenticated psychologist from an API request.
 *
 * Expects: Authorization: Bearer <supabase_access_token>
 *
 * Returns the verified Supabase user. Throws UnauthorizedError if the
 * token is missing or invalid. Never trust the psychologistId from the
 * request body — always derive it from the verified token.
 */
export async function getAuthUser(req: Request) {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header")
  }

  const token = authHeader.slice(7)
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !user) {
    throw new UnauthorizedError("Invalid or expired token")
  }

  return user
}
