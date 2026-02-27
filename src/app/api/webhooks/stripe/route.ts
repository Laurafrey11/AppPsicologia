// app/api/webhooks/stripe/route.ts
import { stripe } from "@/lib/stripe"
import { handleWebhook } from "@/modules/billing/billing.service"
import { headers } from "next/headers"

export async function POST(req: Request) {
  const body = await req.text()
  const signature = headers().get("stripe-signature")!

  let event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    return new Response("Webhook error", { status: 400 })
  }

  await handleWebhook(event)

  return new Response("Success", { status: 200 })
}
