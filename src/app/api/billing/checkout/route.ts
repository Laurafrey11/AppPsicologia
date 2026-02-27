// app/api/billing/checkout/route.ts
import { NextResponse } from "next/server"
import { createCheckoutSession } from "@/modules/billing/billing.service"
import { createClient } from "@supabase/supabase-js"

export async function POST(req: Request) {
  const { priceId } = await req.json()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = await createCheckoutSession(
    user.id,
    user.email!,
    priceId
  )

  return NextResponse.json({ url })
}
