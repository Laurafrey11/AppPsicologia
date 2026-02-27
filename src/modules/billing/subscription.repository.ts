// modules/billing/subscription.repository.ts
import { supabaseAdmin } from "@/lib/supabase-admin"

export async function createSubscription(data: any) {
  return await supabaseAdmin
    .from("subscriptions")
    .insert(data)
}

export async function updateByStripeId(stripeSubscriptionId: string, data: any) {
  return await supabaseAdmin
    .from("subscriptions")
    .update(data)
    .eq("stripe_subscription_id", stripeSubscriptionId)
}

export async function findByUserId(userId: string) {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .single()

  return data
}

export async function findByCustomerId(customerId: string) {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("stripe_customer_id", customerId)
    .single()

  return data
}
