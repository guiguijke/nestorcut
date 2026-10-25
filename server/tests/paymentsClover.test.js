import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// Groupe payments : API Stripe épinglée 2025-10-29.clover, champs clover
// (webhook), mois gratuit admin (discounts) et santé comptable. Aucun appel
// réseau : $fetch et Mongo sont simulés.

const state = vi.hoisted(() => ({ db: null, abbyCalls: [] }))

vi.mock('~~/server/db/mongo', () => ({ connectDB: async () => state.db }))
vi.mock('../../admin/server/db/mongo', () => ({ connectDB: async () => state.db }))
vi.mock('../../admin/server/utils/auth', () => ({ requireAdmin: () => {} }))
vi.mock('~~/server/features/accounting/abby', () => ({
    createIncomeEntry: vi.fn(async (e) => {
        state.abbyCalls.push(e)
        return 'abby_1'
    }),
}))

const VERSION = '2025-10-29.clover'
let fetchCalls
let fetchImpl

beforeEach(() => {
    fetchCalls = []
    fetchImpl = async () => ({})
    globalThis.$fetch = async (url, opts) => {
        fetchCalls.push({ url, opts })
        return fetchImpl(url, opts)
    }
    globalThis.useRuntimeConfig = () => ({ stripeSecretKey: 'sk_test_x', stripeWebhookSecret: 'whsec_t', public: {} })
    state.abbyCalls = []
})
afterEach(() => {
    delete globalThis.$fetch
})

describe('Stripe-Version épinglée', () => {
    it('server/features/payment/stripe.js envoie Stripe-Version', async () => {
        const { createCustomer, STRIPE_API_VERSION } = await import('~~/server/features/payment/stripe')
        fetchImpl = async () => ({ id: 'cus_1' })
        await createCustomer({ email: 'a@b.c', userId: 'u1' })
        expect(STRIPE_API_VERSION).toBe(VERSION)
        expect(fetchCalls[0].opts.headers['Stripe-Version']).toBe(VERSION)
    })

    it('admin utils/stripe getSubscription envoie Stripe-Version', async () => {
        const { getSubscription } = await import('../../admin/server/utils/stripe')
        await getSubscription('sub_1')
        expect(fetchCalls[0].opts.headers['Stripe-Version']).toBe(VERSION)
    })
})

describe('getInvoiceChargeId (Invoice Payments)', () => {
    it('lit payment_intent.latest_charge via /invoice_payments', async () => {
        const { getInvoiceChargeId } = await import('~~/server/features/payment/stripe')
        fetchImpl = async () => ({
            data: [
                { payment: { type: 'charge' } },
                { payment: { type: 'payment_intent', payment_intent: { latest_charge: 'ch_9' } } },
            ],
        })
        expect(await getInvoiceChargeId('in_1')).toBe('ch_9')
        expect(fetchCalls[0].url).toBe('https://api.stripe.com/v1/invoice_payments')
        expect(fetchCalls[0].opts.query.invoice).toBe('in_1')
        expect(fetchCalls[0].opts.headers['Stripe-Version']).toBe(VERSION)
    })

    it('renvoie null sans paiement PaymentIntent', async () => {
        const { getInvoiceChargeId } = await import('~~/server/features/payment/stripe')
        fetchImpl = async () => ({ data: [] })
        expect(await getInvoiceChargeId('in_1')).toBeNull()
    })
})

function fakeDb() {
    const cols = {}
    const col = (name) =>
        (cols[name] ||= {
            docs: [],
            async updateOne(filter, update, opts) {
                this.docs.push({ filter, update, opts })
            },
            async insertOne(doc) {
                this.docs.push({ inserted: doc })
            },
            async findOne() {
                return null
            },
        })
    return { collection: col, cols }
}

async function postWebhook(type, object) {
    const handler = (await import('~~/server/api/stripe/webhook.post.js')).default
    const body = JSON.stringify({ id: 'evt_1', type, data: { object } })
    const t = Math.floor(Date.now() / 1000)
    const sig = crypto.createHmac('sha256', 'whsec_t').update(`${t}.${body}`).digest('hex')
    const headers = { 'stripe-signature': `t=${t},v1=${sig}` }
    globalThis.getHeader = (_e, n) => headers[n]
    globalThis.readRawBody = async () => Buffer.from(body)
    return handler({})
}

describe('webhook clover', () => {
    it('invoice.payment_failed : abonnement via parent.subscription_details', async () => {
        state.db = fakeDb()
        await postWebhook('invoice.payment_failed', {
            id: 'in_1',
            customer: 'cus_1',
            attempt_count: 1,
            parent: { subscription_details: { subscription: 'sub_clover' } },
        })
        const doc = state.db.cols.payment_failures.docs[0].update.$setOnInsert
        expect(doc.stripeSubscriptionId).toBe('sub_clover')
    })

    it("invoice.payment_failed : repli sur l'ancien champ invoice.subscription", async () => {
        state.db = fakeDb()
        await postWebhook('invoice.payment_failed', { id: 'in_2', customer: 'cus_1', subscription: 'sub_old' })
        expect(state.db.cols.payment_failures.docs[0].update.$setOnInsert.stripeSubscriptionId).toBe('sub_old')
    })

    it('facture non-EUR : charge retrouvée via Invoice Payments, montant réglé en EUR', async () => {
        state.db = fakeDb()
        fetchImpl = async (url) => {
            if (url.endsWith('/invoice_payments')) {
                return { data: [{ payment: { type: 'payment_intent', payment_intent: { latest_charge: 'ch_1' } } }] }
            }
            if (url.endsWith('/charges/ch_1')) return { balance_transaction: { amount: 1850 } }
            throw new Error(`url inattendue ${url}`)
        }
        await postWebhook('invoice.payment_succeeded', { id: 'in_3', amount_paid: 2000, currency: 'usd', number: 'N-1' })
        expect(state.abbyCalls[0].amountCents).toBe(1850)
    })

    it('facture non-EUR sans charge retrouvable : écriture failed, rien envoyé à Abby', async () => {
        state.db = fakeDb()
        fetchImpl = async () => ({ data: [] })
        await postWebhook('invoice.payment_succeeded', { id: 'in_4', amount_paid: 2000, currency: 'usd' })
        expect(state.abbyCalls).toHaveLength(0)
        const failed = state.db.cols.accounting_entries.docs.find((d) => d.update?.$set?.status === 'failed')
        expect(failed).toBeTruthy()
    })
})

describe('grantStripeFreeMonth (clover)', () => {
    const bodyOf = (call) => Object.fromEntries(call.opts.body.entries())

    async function run(existing, { couponError } = {}) {
        const { grantStripeFreeMonth } = await import('../../admin/server/utils/stripe')
        fetchImpl = async (url, opts) => {
            if (opts.method === 'GET') return existing
            if (url.endsWith('/coupons') && couponError) throw couponError
            return {}
        }
        return grantStripeFreeMonth('sub_1')
    }

    it('GET avec expand discounts, coupon sans redeem_by, update par discounts[]', async () => {
        await run({ discounts: [] })
        expect(fetchCalls[0].opts.query['expand[]']).toBe('discounts')
        const coupon = bodyOf(fetchCalls[1])
        expect(coupon.id).toBe('aplasma_free_month')
        expect(coupon).not.toHaveProperty('redeem_by')
        const update = bodyOf(fetchCalls[2])
        expect(update).toEqual({ 'discounts[0][coupon]': 'aplasma_free_month' })
        expect(update).not.toHaveProperty('coupon')
        expect(fetchCalls[2].opts.headers['Stripe-Version']).toBe(VERSION)
    })

    it('conserve les remises existantes (di_) et ajoute le coupon', async () => {
        await run({ discounts: [{ id: 'di_1', source: { type: 'coupon', coupon: 'other' } }, 'di_2'] })
        expect(bodyOf(fetchCalls[2])).toEqual({
            'discounts[0][discount]': 'di_1',
            'discounts[1][discount]': 'di_2',
            'discounts[2][coupon]': 'aplasma_free_month',
        })
    })

    it.each([
        ['source.coupon (id)', { id: 'di_1', source: { coupon: 'aplasma_free_month' } }],
        ['source.coupon (objet développé)', { id: 'di_1', source: { coupon: { id: 'aplasma_free_month' } } }],
        ['ancienne forme coupon.id', { id: 'di_1', coupon: { id: 'aplasma_free_month' } }],
    ])('409 si déjà appliqué : %s', async (_n, discount) => {
        await expect(run({ discounts: [discount] })).rejects.toMatchObject({ statusCode: 409 })
        expect(fetchCalls).toHaveLength(1)
    })

    it('tolère resource_already_exists mais pas les autres erreurs de création du coupon', async () => {
        const exists = Object.assign(new Error('x'), { data: { error: { code: 'resource_already_exists' } } })
        await run({ discounts: [] }, { couponError: exists })
        expect(fetchCalls.at(-1).opts.method).toBe('POST')
        fetchCalls.length = 0
        const auth = Object.assign(new Error('auth'), { data: { error: { code: 'api_key_invalid' } } })
        await expect(run({ discounts: [] }, { couponError: auth })).rejects.toThrow('auth')
        expect(fetchCalls).toHaveLength(2) // GET + coupon, pas d'update
    })

    it('ne masque plus un échec de lecture', async () => {
        const { grantStripeFreeMonth } = await import('../../admin/server/utils/stripe')
        fetchImpl = async () => {
            throw new Error('stripe down')
        }
        await expect(grantStripeFreeMonth('sub_1')).rejects.toThrow('stripe down')
    })
})

describe('stripe-health : comptabilité', () => {
    it('compte failed / processing > 1 h et tronque les erreurs', async () => {
        const seen = {}
        const entries = {
            countDocuments: async (f) => (f.status === 'failed' ? 3 : 1),
            find: () => {
                const chain = {
                    project: () => chain,
                    sort: () => chain,
                    limit: (n) => {
                        seen.limit = n
                        return chain
                    },
                    toArray: async () => [
                        { stripeInvoiceId: 'in_1', status: 'failed', error: 'x'.repeat(500), createdAt: new Date(1), updatedAt: new Date(2) },
                        { stripeInvoiceId: 'in_2', status: 'processing', createdAt: new Date(3) },
                    ],
                }
                return chain
            },
        }
        state.db = {
            collection: (n) => (n === 'accounting_entries' ? entries : { findOne: async () => null }),
        }
        globalThis.useRuntimeConfig = () => ({ stripeSecretKey: '' })
        const handler = (await import('../../admin/server/api/payments/stripe-health.get.ts')).default
        const res = await handler({})
        expect(res.accounting.failed).toBe(3)
        expect(res.accounting.stuckProcessing).toBe(1)
        expect(seen.limit).toBe(10)
        expect(res.accounting.recent[0].error).toHaveLength(160)
        expect(res.accounting.recent[0].at).toEqual(new Date(2))
        expect(res.accounting.recent[1]).toEqual({ stripeInvoiceId: 'in_2', status: 'processing', error: null, at: new Date(3) })
        expect(Object.keys(res.accounting.recent[0]).sort()).toEqual(['at', 'error', 'status', 'stripeInvoiceId'])
    })
})
