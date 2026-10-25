const STRIPE_BASE = 'https://api.stripe.com/v1'
// Version d'API épinglée sur celle du compte et du webhook de production
// (même valeur que server/features/payment/stripe.js).
export const STRIPE_API_VERSION = '2025-10-29.clover'

function authHeaders(contentType?: string) {
  const key = useRuntimeConfig().stripeSecretKey as string
  if (!key) {
    throw createError({ statusCode: 500, statusMessage: 'Stripe non configuré (NUXT_STRIPE_SECRET_KEY).' })
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_API_VERSION }
  if (contentType) headers['Content-Type'] = contentType
  return headers
}

/**
 * Grants one free month to a subscriber: a once-per-subscription coupon
 * (percent_off 100, duration once) added to the subscription's `discounts`,
 * visible in the Stripe dashboard. The coupon is created idempotently.
 *
 * API clover: the singular `coupon` parameter of Subscription#update and the
 * `subscription.discount` field are gone; discounts live in `discounts[]`
 * (ids `di_…` once expanded) and a Discount carries its coupon under
 * `source.coupon`. Updating `discounts` REPLACES the list, so the existing
 * discounts are sent back by id to avoid wiping a customer's other discount.
 */
export async function grantStripeFreeMonth(subscriptionId: string): Promise<{ couponId: string }> {
  const couponId = 'aplasma_free_month'

  // Read errors are NOT swallowed: guessing "not granted yet" on a failed read
  // would defeat the anti-stacking guard below.
  const existing: any = await $fetch(`${STRIPE_BASE}/subscriptions/${subscriptionId}`, {
    method: 'GET',
    headers: authHeaders(),
    query: { 'expand[]': 'discounts' },
  })
  const discounts: any[] = Array.isArray(existing?.discounts) ? existing.discounts : []

  // Guard against repeated application: refuse instead of stacking, otherwise
  // an admin clicking N times would grant N free cycles. Clover form first
  // (source.coupon, a string id or an expanded object), then older shapes.
  const couponOf = (d: any) => {
    const c = d?.source?.coupon ?? d?.coupon
    return typeof c === 'string' ? c : c?.id
  }
  if (discounts.some((d) => couponOf(d) === couponId)) {
    throw createError({
      statusCode: 409,
      statusMessage: "Ce mois gratuit a déjà été appliqué à cet abonnement.",
    })
  }

  // Ensure the coupon exists. No redeem_by: it would make the coupon (shared
  // by every later grant) unusable after a fixed delay. Only
  // `resource_already_exists` is expected on repeat runs; anything else
  // (auth, network, bad params) must surface.
  try {
    await $fetch(`${STRIPE_BASE}/coupons`, {
      method: 'POST',
      headers: authHeaders('application/x-www-form-urlencoded'),
      body: new URLSearchParams({
        'id': couponId,
        'percent_off': '100',
        'duration': 'once',
        'name': 'APlasma — Mois offert (admin)',
      }),
    })
  } catch (err: any) {
    const code = err?.data?.error?.code ?? err?.response?._data?.error?.code
    if (code !== 'resource_already_exists') throw err
  }

  // Keep every existing discount (by its di_ id) and append the coupon.
  const body = new URLSearchParams()
  let i = 0
  for (const d of discounts) {
    const id = typeof d === 'string' ? d : d?.id
    if (id) body.append(`discounts[${i++}][discount]`, id)
  }
  body.append(`discounts[${i}][coupon]`, couponId)

  await $fetch(`${STRIPE_BASE}/subscriptions/${subscriptionId}`, {
    method: 'POST',
    headers: authHeaders('application/x-www-form-urlencoded'),
    body,
  })

  return { couponId }
}

/**
 * Returns a lightweight view of a subscription for the admin UI.
 */
export async function getSubscription(subscriptionId: string) {
  return await $fetch(`${STRIPE_BASE}/subscriptions/${subscriptionId}`, {
    method: 'GET',
    headers: authHeaders('application/x-www-form-urlencoded'),
  })
}
