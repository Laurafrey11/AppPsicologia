import { stripe } from "@/lib/stripe"
import { findByUserId } from "@/modules/billing/subscription.repository"
import { NextResponse } from "next/server"

export async function POST(req: Request) {
  const { userId, newPriceId } = await req.json()

  const subscription = await findByUserId(userId)

  if (!subscription) {
    return NextResponse.json({ error: "No subscription" }, { status: 400 })
  }

  const stripeSub = await stripe.subscriptions.retrieve(
    subscription.stripe_subscription_id
  )

  await stripe.subscriptions.update(subscription.stripe_subscription_id, {
    items: [
      {
        id: stripeSub.items.data[0].id,
        price: newPriceId,
      },
    ],
    proration_behavior: "create_prorations",
  })

  return NextResponse.json({ success: true })
}
