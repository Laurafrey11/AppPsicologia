// modules/billing/billing.service.ts

import { stripe } from "@/lib/stripe"
import {
  createSubscription,
  updateByStripeId,
  findByUserId,
} from "./subscription.repository"

/**
 * CREATE CHECKOUT SESSION
 */
export async function createCheckoutSession(
  userId: string,
  email: string,
  priceId: string
) {
  // 1️⃣ Verificar si ya tiene suscripción
  const existing = await findByUserId(userId)

  let customerId = existing?.stripe_customer_id

  // 2️⃣ Crear customer si no existe
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { userId },
    })

    customerId = customer.id
  }

  // 3️⃣ Crear checkout
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    mode: "subscription",
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    subscription_data: {
      trial_period_days: 7,
    },
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/pricing`,
  })

  return session.url
}

/**
 * CREATE BILLING PORTAL
 */
export async function createPortalSession(userId: string) {
  const subscription = await findByUserId(userId)

  if (!subscription?.stripe_customer_id) {
    throw new Error("Customer not found")
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
  })

  return portal.url
}

/**
 * UPGRADE / DOWNGRADE
 */
export async function upgradeSubscription(
  userId: string,
  newPriceId: string
) {
  const subscription = await findByUserId(userId)

  if (!subscription) {
    throw new Error("Subscription not found")
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

  return true
}

/**
 * CANCEL AT PERIOD END
 */
export async function cancelSubscription(userId: string) {
  const subscription = await findByUserId(userId)

  if (!subscription) {
    throw new Error("Subscription not found")
  }

  await stripe.subscriptions.update(subscription.stripe_subscription_id, {
    cancel_at_period_end: true,
  })

  return true
}

/**
 * STRIPE WEBHOOK HANDLER
 */
export async function handleWebhook(event: any) {
  switch (event.type) {
    /**
     * CHECKOUT COMPLETED
     */
    case "checkout.session.completed": {
      const session = event.data.object

      await createSubscription({
        user_id: session.customer_details?.metadata?.userId || session.metadata?.userId,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        status: "active",
      })

      break
    }

    /**
     * SUBSCRIPTION UPDATED
     */
    case "customer.subscription.updated": {
      const subscription = event.data.object

      await updateByStripeId(subscription.id, {
        status: subscription.status,
        current_period_end: new Date(
          subscription.current_period_end * 1000
        ),
        cancel_at_period_end: subscription.cancel_at_period_end,
      })

      break
    }

    /**
     * PAYMENT FAILED
     */
    case "invoice.payment_failed": {
      const invoice = event.data.object

      await updateByStripeId(invoice.subscription, {
        status: "past_due",
      })

      break
    }

    /**
     * PAYMENT SUCCEEDED
     */
    case "invoice.payment_succeeded": {
      const invoice = event.data.object

      await updateByStripeId(invoice.subscription, {
        status: "active",
      })

      break
    }

    /**
     * SUBSCRIPTION CANCELED
     */
    case "customer.subscription.deleted": {
      const subscription = event.data.object

      await updateByStripeId(subscription.id, {
        status: "canceled",
      })

      break
    }

    default:
      break
  }
}
