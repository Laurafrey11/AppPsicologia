import { findByUserId } from "./subscription.repository"

export async function requireActiveSubscription(userId: string) {
  const subscription = await findByUserId(userId)

  if (!subscription) return false

  return (
    subscription.status === "active" ||
    subscription.status === "trialing"
  )
}
