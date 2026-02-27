await stripe.subscriptions.update(subscriptionId, {
  cancel_at_period_end: true,
})
