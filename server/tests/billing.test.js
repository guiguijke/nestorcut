import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// Facturation : garde anti-double-abonnement, essai une seule fois, portail
// client. Stripe est toujours mocké — aucun appel réseau.

const state = vi.hoisted(() => ({
    db: null,
    query: {},
    checkout: [],
    portal: [],
    portalError: null,
    stripeSubs: [],
    stripeListError: null,
}))

globalThis.getQuery = () => state.query
globalThis.getHeader = () => undefined
globalThis.useRuntimeConfig = () => ({ public: { baseUrl: 'https://app.test' } })

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))
vi.mock('~~/server/features/payment/stripe', () => ({
    createCustomer: vi.fn(async () => 'cus_new'),
    createSubscriptionCheckout: vi.fn(async (opts) => {
        state.checkout.push(opts)
        return { id: 'cs_1', url: 'https://checkout.test/cs_1' }
    }),
    listCustomerSubscriptions: vi.fn(async () => {
        if (state.stripeListError) throw state.stripeListError
        return state.stripeSubs
    }),
    createBillingPortalSession: vi.fn(async (opts) => {
        state.portal.push(opts)
        if (state.portalError) throw state.portalError
        return { url: 'https://billing.test/session' }
    }),
}))

import subscribeHandler from '~~/server/api/payment/subscribe.get.js'
import portalHandler from '~~/server/api/payment/portal.post.js'
import {
    LIVE_SUBSCRIPTION_STATUSES,
    hasLiveSubscription,
    isTrialEligible,
} from '~~/server/features/payment/eligibility'
import { fakeDb } from './helpers/fakeMongo'

const ev = (userId) => ({ context: { auth: { userId } } })

const planDocs = () => [
    { id: 'subscription', priceId: 'price_std', prices: { eur: 1900 } },
    { id: 'subscription:privacy', priceId: 'price_pro', prices: { eur: 3900 } },
]

const dbWith = (user) => fakeDb({ users: [user], subscription_plan: planDocs() })

beforeEach(() => {
    state.db = null
    state.query = {}
    state.checkout = []
    state.portal = []
    state.portalError = null
    state.stripeSubs = []
    state.stripeListError = null
})

describe('eligibility helpers', () => {
    it('live statuses are exactly trialing/active/past_due/incomplete/unpaid', () => {
        expect([...LIVE_SUBSCRIPTION_STATUSES].sort()).toEqual(
            ['active', 'incomplete', 'past_due', 'trialing', 'unpaid']
        )
    })

    it('hasLiveSubscription needs an id AND a live status', () => {
        expect(hasLiveSubscription(null)).toBe(false)
        expect(hasLiveSubscription({})).toBe(false)
        expect(hasLiveSubscription({ subscription: { status: 'active' } })).toBe(false)
        for (const status of LIVE_SUBSCRIPTION_STATUSES) {
            expect(hasLiveSubscription({ subscription: { stripeSubscriptionId: 'sub_1', status } })).toBe(true)
        }
        for (const status of ['canceled', 'incomplete_expired']) {
            expect(hasLiveSubscription({ subscription: { stripeSubscriptionId: 'sub_1', status } })).toBe(false)
        }
    })

    it('trial eligibility ignores stripeCustomerId, follows stripeSubscriptionId', () => {
        expect(isTrialEligible({ id: 'u1' })).toBe(true)
        expect(isTrialEligible({ id: 'u1', stripeCustomerId: 'cus_1' })).toBe(true)
        expect(isTrialEligible({ subscription: { stripeSubscriptionId: 'sub_1', status: 'canceled' } })).toBe(false)
    })
})

describe('subscribe.get — double billing guard', () => {
    for (const status of ['trialing', 'active', 'past_due', 'incomplete', 'unpaid']) {
        it(`refuses a new Checkout when the subscription is ${status}`, async () => {
            state.db = dbWith({
                id: 'u1',
                stripeCustomerId: 'cus_1',
                subscription: { stripeSubscriptionId: 'sub_1', status },
            })
            state.query = { tier: 'privacy' }
            await expect(subscribeHandler(ev('u1'))).rejects.toMatchObject({
                statusCode: 409,
                statusMessage: 'subscription_exists',
            })
            expect(state.checkout).toHaveLength(0)
            expect(state.db.collection('subscription_checkouts').calls.insertOne).toHaveLength(0)
        })
    }

    it('still opens a Checkout for a canceled subscriber', async () => {
        state.db = dbWith({
            id: 'u1',
            stripeCustomerId: 'cus_1',
            subscription: { stripeSubscriptionId: 'sub_old', status: 'canceled' },
        })
        const res = await subscribeHandler(ev('u1'))
        expect(res.url).toBe('https://checkout.test/cs_1')
        expect(state.checkout).toHaveLength(1)
    })
})

describe('subscribe.get — Stripe lookup (webhook not landed yet)', () => {
    const userWithCustomer = () => dbWith({ id: 'u1', stripeCustomerId: 'cus_1' })

    it('refuses when Stripe already has a live subscription for the customer', async () => {
        state.db = userWithCustomer()
        state.stripeSubs = [{ status: 'canceled' }, { status: 'trialing' }]
        await expect(subscribeHandler(ev('u1'))).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: 'subscription_exists',
        })
        expect(state.checkout).toHaveLength(0)
    })

    it('opens Checkout when Stripe only has dead subscriptions', async () => {
        state.db = userWithCustomer()
        state.stripeSubs = [{ status: 'canceled' }, { status: 'incomplete_expired' }]
        const res = await subscribeHandler(ev('u1'))
        expect(res.url).toBe('https://checkout.test/cs_1')
    })

    it('fails OPEN (Checkout still opens) when the Stripe lookup errors', async () => {
        state.db = userWithCustomer()
        state.stripeListError = new Error('stripe down')
        const res = await subscribeHandler(ev('u1'))
        expect(res.url).toBe('https://checkout.test/cs_1')
        expect(state.checkout).toHaveLength(1)
    })
})

describe('subscribe.get — trial only once', () => {
    it('grants the trial to a user who never subscribed', async () => {
        state.db = dbWith({ id: 'u1' })
        await subscribeHandler(ev('u1'))
        expect(state.checkout[0].trialDays).toBe(7)
    })

    it('still grants the trial when only a customer exists (abandoned checkout)', async () => {
        state.db = dbWith({ id: 'u1', stripeCustomerId: 'cus_1' })
        await subscribeHandler(ev('u1'))
        expect(state.checkout[0].trialDays).toBe(7)
    })

    it('grants no trial to a returning subscriber', async () => {
        state.db = dbWith({
            id: 'u1',
            stripeCustomerId: 'cus_1',
            subscription: { stripeSubscriptionId: 'sub_old', status: 'canceled' },
        })
        await subscribeHandler(ev('u1'))
        expect(state.checkout[0].trialDays).toBe(0)
    })
})

describe('payment/portal.post', () => {
    it('rejects anonymous callers', async () => {
        await expect(portalHandler({ context: {} })).rejects.toMatchObject({ statusCode: 401 })
    })

    it('rejects users without a Stripe customer', async () => {
        state.db = dbWith({ id: 'u1' })
        await expect(portalHandler(ev('u1'))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'no_billing_customer',
        })
        expect(state.portal).toHaveLength(0)
    })

    it('creates a portal session for the user customer, returning to /profile', async () => {
        state.db = dbWith({ id: 'u1', stripeCustomerId: 'cus_1' })
        const res = await portalHandler(ev('u1'))
        expect(res).toEqual({ url: 'https://billing.test/session' })
        expect(state.portal).toEqual([{ customerId: 'cus_1', returnUrl: 'https://app.test/profile' }])
    })

    it('maps a Stripe failure (portal not configured) to a stable 502 code', async () => {
        state.db = dbWith({ id: 'u1', stripeCustomerId: 'cus_1' })
        state.portalError = Object.assign(new Error('400'), {
            data: { error: { message: 'No configuration provided' } },
        })
        await expect(portalHandler(ev('u1'))).rejects.toMatchObject({
            statusCode: 502,
            statusMessage: 'portal_unavailable',
        })
    })
})

describe('createBillingPortalSession (REST helper)', () => {
    it('POSTs customer + return_url to /v1/billing_portal/sessions', async () => {
        const actual = await vi.importActual('~~/server/features/payment/stripe')
        const calls = []
        globalThis.$fetch = async (url, opts) => {
            calls.push({ url, opts })
            return { url: 'https://billing.test/s' }
        }
        const prevConfig = globalThis.useRuntimeConfig
        globalThis.useRuntimeConfig = () => ({ stripeSecretKey: 'sk_test_x' })
        try {
            const res = await actual.createBillingPortalSession({
                customerId: 'cus_9',
                returnUrl: 'https://app.test/profile',
            })
            expect(res).toEqual({ url: 'https://billing.test/s' })
        } finally {
            globalThis.useRuntimeConfig = prevConfig
            delete globalThis.$fetch
        }
        expect(calls[0].url).toBe('https://api.stripe.com/v1/billing_portal/sessions')
        expect(calls[0].opts.method).toBe('POST')
        expect(calls[0].opts.headers.Authorization).toBe('Bearer sk_test_x')
        expect(calls[0].opts.body.get('customer')).toBe('cus_9')
        expect(calls[0].opts.body.get('return_url')).toBe('https://app.test/profile')
    })
})
