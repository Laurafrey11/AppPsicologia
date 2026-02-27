// app/api/admin/metrics/route.ts

import { supabaseAdmin } from "@/lib/supabase-admin"
import { NextResponse } from "next/server"

export async function GET() {
  const { data: subscriptions } = await supabaseAdmin
    .from("subscriptions")
    .select("*")

  if (!subscriptions) {
    return NextResponse.json({ error: "No data" }, { status: 500 })
  }

  const active = subscriptions.filter(
    (s) => s.status === "active"
  ).length

  const trialing = subscriptions.filter(
    (s) => s.status === "trialing"
  ).length

  const canceled = subscriptions.filter(
    (s) => s.status === "canceled"
  ).length

  // ⚠️ Esto es ejemplo simple.
  // Idealmente deberías guardar price en DB.
  const averagePrice = 10
  const mrr = active * averagePrice

  return NextResponse.json({
    active,
    trialing,
    canceled,
    mrr,
  })
}
