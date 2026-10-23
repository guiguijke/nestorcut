import { requireAdmin } from '../../utils/auth'
import { connectDB } from '../../db/mongo'

// Stripe health panel data.
//
//   1. LOCAL heartbeat: the main app's webhook upserts stripe_status
//      .last_webhook on every VERIFIED event — this is the "are webhooks
//      actually reaching us" signal (the endpoint being configured in Stripe
//      is not enough).
//   2. LIVE Stripe views: last events seen by Stripe and the account balance,
//      for cross-checking when the heartbeat looks stale.
//
// Failures against the Stripe API degrade gracefully (error string) so the
// page still renders with the local heartbeat.

// Event types the main app's webhook handles. The heartbeat only moves for
// these, so the « last Stripe event » must be compared among them only
// (otherwise e.g. customer.created, never sent to us, looks like a stopped feed).
const WEBHOOK_EVENT_TYPES = [
    'checkout.session.completed',
    'checkout.session.expired',
    'invoice.payment_succeeded',
    'invoice.payment_failed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
]

export default defineEventHandler(async (event) => {
    requireAdmin(event)
    const db = await connectDB()

    const heartbeat = await db.collection('stripe_status').findOne({ _id: 'last_webhook' })

    const key = useRuntimeConfig().stripeSecretKey as string
    let stripe: any = null
    if (key) {
        try {
            const auth = { Authorization: `Bearer ${key}` } as Record<string, string>
            // Stripe list filter: types[]=… (repeated key, not a comma list).
            const eventsQuery = new URLSearchParams({ limit: '8' })
            for (const t of WEBHOOK_EVENT_TYPES) eventsQuery.append('types[]', t)
            const [events, balance] = await Promise.all([
                $fetch(`https://api.stripe.com/v1/events?${eventsQuery}`, { headers: auth }),
                $fetch('https://api.stripe.com/v1/balance', { headers: auth }),
            ])
            // Defensive: keep only handled types even if the server-side filter is ignored.
            const lastEvent = (events?.data || []).find((e: any) => WEBHOOK_EVENT_TYPES.includes(e.type))
            stripe = {
                lastEvent: lastEvent
                    ? {
                          type: lastEvent.type,
                          created: new Date(lastEvent.created * 1000),
                      }
                    : null,
                balance: [
                    ...(balance?.available || []).map((b: any) => ({ ...b, pending: false })),
                    ...(balance?.pending || []).map((b: any) => ({ ...b, pending: true })),
                ],
            }
        } catch (err: any) {
            stripe = { error: String(err?.message || err) }
        }
    }

    return {
        stripeConfigured: Boolean(key),
        lastWebhook: heartbeat
            ? { type: heartbeat.type, eventId: heartbeat.eventId, receivedAt: heartbeat.receivedAt }
            : null,
        stripe,
    }
})
