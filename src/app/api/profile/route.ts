import { NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth/get-user"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { BaseError } from "@/lib/errors/BaseError"
import { logger } from "@/lib/logger/logger"

/** GET /api/profile — get the psychologist's profile */
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req)

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("scheduling_link")
      .eq("psychologist_id", user.id)
      .single()

    if (error && error.code !== "PGRST116") {
      // PGRST116 = "no rows found" — treat as empty profile
      logger.error("GET /api/profile failed", { error: error.message })
      return NextResponse.json({ scheduling_link: null })
    }

    return NextResponse.json({ scheduling_link: data?.scheduling_link ?? null })
  } catch (error: unknown) {
    const err = error as Error
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    logger.error("GET /api/profile failed", { error: err.message })
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** PATCH /api/profile — update the psychologist's profile */
export async function PATCH(req: Request) {
  try {
    const user = await getAuthUser(req)
    const body = await req.json()
    const scheduling_link: string | null = body.scheduling_link ?? null

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .upsert(
        { psychologist_id: user.id, scheduling_link },
        { onConflict: "psychologist_id" }
      )
      .select("scheduling_link")
      .single()

    if (error) {
      logger.error("PATCH /api/profile failed", { error: error.message })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ scheduling_link: data?.scheduling_link ?? null })
  } catch (error: unknown) {
    const err = error as Error
    if (error instanceof BaseError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.statusCode })
    }
    logger.error("PATCH /api/profile failed", { error: err.message })
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
