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
import { safeReturnPath, checkoutUrls } from '~~/server/features/payment/returnTo'
import { createCustomer } from '~~/server/features/payment/stripe'
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

describe('subscribe.get — e-mail non vérifié (d9)', () => {
    it('compte local non vérifié : 403 email_not_verified, aucun client Stripe ni checkout', async () => {
        vi.mocked(createCustomer).mockClear()
        state.db = dbWith({ id: 'u1', provider: 'local', emailVerified: false })
        await expect(subscribeHandler(ev('u1'))).rejects.toMatchObject({
            statusCode: 403,
            statusMessage: 'email_not_verified',
        })
        expect(createCustomer).not.toHaveBeenCalled()
        expect(state.checkout).toHaveLength(0)
        expect(state.db.collection('subscription_checkouts').calls.insertOne).toHaveLength(0)
    })

    it('compte local non vérifié AVEC un abonnement vivant : 409 (les gardes 409 passent avant)', async () => {
        state.db = dbWith({
            id: 'u1',
            provider: 'local',
            emailVerified: false,
            stripeCustomerId: 'cus_1',
            subscription: { stripeSubscriptionId: 'sub_1', status: 'active' },
        })
        await expect(subscribeHandler(ev('u1'))).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: 'subscription_exists',
        })
        expect(state.checkout).toHaveLength(0)
    })

    it('compte local non vérifié, abonnement vivant connu de Stripe seul : 409', async () => {
        state.db = dbWith({ id: 'u1', provider: 'local', emailVerified: false, stripeCustomerId: 'cus_1' })
        state.stripeSubs = [{ status: 'trialing' }]
        await expect(subscribeHandler(ev('u1'))).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: 'subscription_exists',
        })
    })

    it('compte local vérifié : Checkout ouvert', async () => {
        state.db = dbWith({ id: 'u1', provider: 'local', emailVerified: true })
        const res = await subscribeHandler(ev('u1'))
        expect(res.url).toBe('https://checkout.test/cs_1')
        expect(state.checkout).toHaveLength(1)
    })

    it('compte local sans le champ emailVerified : Checkout ouvert (même règle que assertCanNest)', async () => {
        state.db = dbWith({ id: 'u1', provider: 'local' })
        const res = await subscribeHandler(ev('u1'))
        expect(res.url).toBe('https://checkout.test/cs_1')
    })

    it('compte Google non vérifié (emailVerified false) : Checkout ouvert, la garde vise les comptes locaux', async () => {
        state.db = dbWith({ id: 'u1', provider: 'google', emailVerified: false })
        const res = await subscribeHandler(ev('u1'))
        expect(res.url).toBe('https://checkout.test/cs_1')
    })
})

describe('subscribe.get — URL de retour (d10 / D14)', () => {
    const PROJECT = '/project/brave-otter-0123456789ab'

    it('returnTo de projet valide : succès et annulation reviennent sur le projet', async () => {
        state.db = dbWith({ id: 'u1' })
        state.query = { returnTo: PROJECT }
        await subscribeHandler(ev('u1'))
        const opts = state.checkout[0]
        const id = opts.internalId
        expect(id).toMatch(/^[0-9a-f]{24}$/)
        expect(opts.successUrl).toBe(`https://app.test${PROJECT}?subscriptionInternalId=${id}`)
        expect(opts.cancelUrl).toBe(`https://app.test${PROJECT}?checkout=cancelled`)
        // Le checkout persisté porte le même identifiant que l'URL de succès.
        const inserted = state.db.collection('subscription_checkouts').calls.insertOne
        expect(inserted).toHaveLength(1)
        expect(inserted[0].internalId).toBe(id)
    })

    it('returnTo valide aussi pour le Checkout Pro (?tier=privacy)', async () => {
        state.db = dbWith({ id: 'u1' })
        state.query = { tier: 'privacy', returnTo: PROJECT }
        await subscribeHandler(ev('u1'))
        expect(state.checkout[0].priceId).toBe('price_pro')
        expect(state.checkout[0].successUrl.startsWith(`https://app.test${PROJECT}?subscriptionInternalId=`)).toBe(true)
        expect(state.checkout[0].cancelUrl).toBe(`https://app.test${PROJECT}?checkout=cancelled`)
    })

    const unsafe = [
        'https://evil.test',
        '//evil.test',
        '/project/../admin',
        '/project/x\n',
        '/projectx',
        '/project/',
        '/home',
        ['a'],
    ]
    for (const returnTo of [...unsafe, undefined]) {
        it(`returnTo ${JSON.stringify(returnTo) ?? 'absent'} : les deux URL sur /home`, async () => {
            state.db = dbWith({ id: 'u1' })
            state.query = returnTo === undefined ? {} : { returnTo }
            await subscribeHandler(ev('u1'))
            const opts = state.checkout[0]
            expect(opts.successUrl).toBe(`https://app.test/home?subscriptionInternalId=${opts.internalId}`)
            expect(opts.cancelUrl).toBe('https://app.test/home?checkout=cancelled')
        })
    }

    it('safeReturnPath : seul un chemin de projet relatif passe', () => {
        expect(safeReturnPath(PROJECT)).toBe(PROJECT)
        expect(safeReturnPath('/project/demo')).toBe('/project/demo')
        const more = [undefined, null, 42, '/project/Demo', '/project/a b', '/project/a/b', '/project/x?y=1']
        for (const raw of [...unsafe, ...more, '/project/x#h', ' /project/x']) {
            expect(safeReturnPath(raw)).toBeNull()
        }
        expect(safeReturnPath(`/project/${'a'.repeat(200)}`)).toBe(`/project/${'a'.repeat(200)}`)
        expect(safeReturnPath(`/project/${'a'.repeat(201)}`)).toBeNull()
    })

    it('checkoutUrls : repli /home', () => {
        expect(checkoutUrls('https://app.test', 'https://evil.test', 'abc')).toEqual({
            successUrl: 'https://app.test/home?subscriptionInternalId=abc',
            cancelUrl: 'https://app.test/home?checkout=cancelled',
        })
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

describe('mapSubscription — period end', () => {
    it('reads the period end from the item (API >= 2025-03-31)', async () => {
        const { mapSubscription } = await vi.importActual('~~/server/features/payment/stripe')
        const mapped = mapSubscription({
            id: 'sub_1',
            status: 'trialing',
            items: { data: [{ current_period_end: 1793540758, price: { id: 'price_u' } }] },
        })
        expect(mapped.currentPeriodEnd).toEqual(new Date(1793540758 * 1000))
        expect(mapped.priceId).toBe('price_u')
    })

    it('still honours the legacy top-level field', async () => {
        const { mapSubscription } = await vi.importActual('~~/server/features/payment/stripe')
        const mapped = mapSubscription({ id: 'sub_2', status: 'active', current_period_end: 1700000000, items: { data: [] } })
        expect(mapped.currentPeriodEnd).toEqual(new Date(1700000000 * 1000))
    })

    it('is null when Stripe gives no period at all', async () => {
        const { mapSubscription } = await vi.importActual('~~/server/features/payment/stripe')
        expect(mapSubscription({ id: 'sub_3', status: 'incomplete' }).currentPeriodEnd).toBeNull()
    })
})
