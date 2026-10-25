import { requireAdmin } from '../../utils/auth'
import { connectDB } from '../../db/mongo'
import { STRIPE_API_VERSION } from '../../utils/stripe'

// Stripe health panel data.
//
//   1. LOCAL heartbeat: the main app's webhook upserts stripe_status
//      .last_webhook on every VERIFIED event — this is the "are webhooks
//      actually reaching us" signal (the endpoint being configured in Stripe
//      is not enough).
//   2. LIVE Stripe views: last events seen by Stripe and the account balance,
//      for cross-checking when the heartbeat looks stale.
//
//   3. ACCOUNTING failures: accounting_entries stuck in 'failed' or in
//      'processing' for over an hour (Abby push). No automatic replay — the
//      owner decides; this only makes them visible. No personal data: invoice
//      id, status, truncated error, date.
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

const ACCOUNTING_STUCK_MS = 60 * 60 * 1000
const ACCOUNTING_ERROR_MAX = 160

async function accountingHealth(db: any) {
    const entries = db.collection('accounting_entries')
    const stuckBefore = new Date(Date.now() - ACCOUNTING_STUCK_MS)
    const stuckFilter = { status: 'processing', createdAt: { $lt: stuckBefore } }
    const [failed, stuckProcessing, recent] = await Promise.all([
        entries.countDocuments({ status: 'failed' }),
        entries.countDocuments(stuckFilter),
        entries
            .find({ $or: [{ status: 'failed' }, stuckFilter] })
            .project({ stripeInvoiceId: 1, status: 1, error: 1, createdAt: 1, updatedAt: 1 })
            .sort({ createdAt: -1 })
            .limit(10)
            .toArray(),
    ])
    return {
        failed,
        stuckProcessing,
        recent: recent.map((e: any) => ({
            stripeInvoiceId: e.stripeInvoiceId,
            status: e.status,
            error: e.error ? String(e.error).slice(0, ACCOUNTING_ERROR_MAX) : null,
            at: e.updatedAt || e.createdAt || null,
        })),
    }
}

export default defineEventHandler(async (event) => {
    requireAdmin(event)
    const db = await connectDB()

    const heartbeat = await db.collection('stripe_status').findOne({ _id: 'last_webhook' })

    const key = useRuntimeConfig().stripeSecretKey as string
    let stripe: any = null
    if (key) {
        try {
            const auth = { Authorization: `Bearer ${key}`, 'Stripe-Version': STRIPE_API_VERSION } as Record<string, string>
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

    // Degrades to null: a Mongo hiccup on this block must not hide the rest.
    const accounting = await accountingHealth(db).catch(() => null)

    return {
        stripeConfigured: Boolean(key),
        lastWebhook: heartbeat
            ? { type: heartbeat.type, eventId: heartbeat.eventId, receivedAt: heartbeat.receivedAt }
            : null,
        stripe,
        accounting,
    }
})
