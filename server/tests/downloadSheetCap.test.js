import { beforeEach, describe, expect, it, vi } from 'vitest'

// O2/d1 (02/11) : resolver du plafond de TÉLÉCHARGEMENT des tôles
// (AGENTS #34). Les tests de route (resultZip, resultDxfGate) le simulent ;
// son comportement — flag K, palier, reprise Stripe — est verrouillé ici.

const state = vi.hoisted(() => ({ db: null }))

vi.mock('~~/server/db/mongo', () => ({
    // Un appel à connectDB alors que state.db est null fait échouer le test :
    // le chemin K (paidPlansDisabled) ne doit faire AUCUNE requête.
    connectDB: async () => {
        if (!state.db) throw new Error('connectDB inattendu')
        return state.db
    },
}))
vi.mock('~~/server/features/payment/stripe', () => ({
    ACTIVE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
    getSubscription: vi.fn(),
    mapSubscription: vi.fn(),
}))

import { downloadSheetCapForUser, isWithinFreeDownloadCap } from '~~/server/utils/entitlement'
import { getSubscription, mapSubscription } from '~~/server/features/payment/stripe'
import { fakeDb } from './helpers/fakeMongo'

// Plafond Free attendu, écrit en clair : côté serveur, seul entitlement.js lit
// la constante partagée (AGENTS #34, grep de contrôle du lot).
const FREE_CAP = 2

const DAY = 24 * 3600 * 1000
const future = () => new Date(Date.now() + 30 * DAY)
const past = () => new Date(Date.now() - 2 * DAY)

const user = (overrides = {}) => ({ id: 'u1', provider: 'google', ...overrides })

beforeEach(() => {
    state.db = null
    vi.mocked(getSubscription).mockReset()
    vi.mocked(mapSubscription).mockReset()
})

describe('downloadSheetCapForUser — flag K (d2)', () => {
    for (const flag of ['true', true]) {
        it(`paidPlansDisabled ${JSON.stringify(flag)} -> Infinity sans aucune requête`, async () => {
            state.db = null
            await expect(downloadSheetCapForUser('u1', { paidPlansDisabled: flag })).resolves.toBe(Infinity)
        })
    }

    it("paidPlansDisabled 'false' -> le palier est lu (Free = plafond)", async () => {
        state.db = fakeDb({ users: [user()] })
        await expect(downloadSheetCapForUser('u1', { paidPlansDisabled: 'false' })).resolves.toBe(FREE_CAP)
    })
})

describe('downloadSheetCapForUser — palier (d1)', () => {
    it('Free sans abonnement -> 2, Stripe jamais appelé', async () => {
        state.db = fakeDb({ users: [user()] })
        await expect(downloadSheetCapForUser('u1')).resolves.toBe(FREE_CAP)
        expect(getSubscription).not.toHaveBeenCalled()
    })

    it('grant actif (grantedUntil futur) -> Infinity', async () => {
        state.db = fakeDb({ users: [user({ grantedUntil: future() })] })
        await expect(downloadSheetCapForUser('u1')).resolves.toBe(Infinity)
        expect(getSubscription).not.toHaveBeenCalled()
    })

    it('grant échu -> 2', async () => {
        state.db = fakeDb({ users: [user({ grantedUntil: past() })] })
        await expect(downloadSheetCapForUser('u1')).resolves.toBe(FREE_CAP)
    })

    it('abonnement active, période future -> Infinity, Stripe non appelé', async () => {
        state.db = fakeDb({
            users: [
                user({
                    subscription: {
                        stripeSubscriptionId: 'sub_1',
                        status: 'active',
                        priceId: 'price_std',
                        currentPeriodEnd: future(),
                    },
                }),
            ],
        })
        await expect(downloadSheetCapForUser('u1')).resolves.toBe(Infinity)
        expect(getSubscription).not.toHaveBeenCalled()
    })

    it('abonnement stocké past_due -> 2, Stripe non appelé', async () => {
        state.db = fakeDb({
            users: [
                user({
                    subscription: { stripeSubscriptionId: 'sub_1', status: 'past_due', currentPeriodEnd: past() },
                }),
            ],
        })
        await expect(downloadSheetCapForUser('u1')).resolves.toBe(FREE_CAP)
        expect(getSubscription).not.toHaveBeenCalled()
    })

    it('abonnement stocké active échu SANS stripeSubscriptionId -> 2, Stripe non appelé', async () => {
        state.db = fakeDb({
            users: [user({ subscription: { status: 'active', currentPeriodEnd: past() } })],
        })
        await expect(downloadSheetCapForUser('u1')).resolves.toBe(FREE_CAP)
        expect(getSubscription).not.toHaveBeenCalled()
    })
})

describe('downloadSheetCapForUser — reprise Stripe (C1-1, copie d’assertCanNest)', () => {
    const staleActiveDb = () =>
        fakeDb({
            users: [
                user({
                    subscription: {
                        stripeSubscriptionId: 'sub_1',
                        status: 'active',
                        priceId: 'price_std',
                        currentPeriodEnd: past(),
                    },
                }),
            ],
        })

    it('Stripe confirme un abonnement actif à période future -> Infinity, stock corrigé', async () => {
        state.db = staleActiveDb()
        vi.mocked(getSubscription).mockResolvedValue({ id: 'sub_1' })
        vi.mocked(mapSubscription).mockReturnValue({
            stripeSubscriptionId: 'sub_1',
            status: 'active',
            priceId: 'price_std',
            currentPeriodEnd: future(),
        })
        await expect(downloadSheetCapForUser('u1')).resolves.toBe(Infinity)
        expect(getSubscription).toHaveBeenCalledTimes(1)
        expect(getSubscription).toHaveBeenCalledWith('sub_1')
        const updates = state.db.collection('users').calls.updateOne
        expect(updates).toHaveLength(1)
        expect(updates[0].filter).toEqual({ id: 'u1' })
        expect(updates[0].update.$set.subscription.status).toBe('active')
    })

    it('trialing échu, Stripe confirme -> Infinity', async () => {
        state.db = fakeDb({
            users: [
                user({
                    subscription: { stripeSubscriptionId: 'sub_1', status: 'trialing', currentPeriodEnd: past() },
                }),
            ],
        })
        vi.mocked(getSubscription).mockResolvedValue({ id: 'sub_1' })
        vi.mocked(mapSubscription).mockReturnValue({
            stripeSubscriptionId: 'sub_1',
            status: 'trialing',
            currentPeriodEnd: future(),
        })
        await expect(downloadSheetCapForUser('u1')).resolves.toBe(Infinity)
        expect(getSubscription).toHaveBeenCalledTimes(1)
    })

    it('Stripe rend canceled -> 2', async () => {
        state.db = staleActiveDb()
        vi.mocked(getSubscription).mockResolvedValue({ id: 'sub_1' })
        vi.mocked(mapSubscription).mockReturnValue({
            stripeSubscriptionId: 'sub_1',
            status: 'canceled',
            currentPeriodEnd: past(),
        })
        await expect(downloadSheetCapForUser('u1')).resolves.toBe(FREE_CAP)
        expect(getSubscription).toHaveBeenCalledTimes(1)
    })

    it('getSubscription qui jette -> 2, aucune exception remontée', async () => {
        state.db = staleActiveDb()
        vi.mocked(getSubscription).mockRejectedValue(new Error('stripe down'))
        await expect(downloadSheetCapForUser('u1')).resolves.toBe(FREE_CAP)
        expect(getSubscription).toHaveBeenCalledTimes(1)
    })
})

describe('isWithinFreeDownloadCap (chemin rapide, aucune requête)', () => {
    it('1 et 2 -> true', () => {
        expect(isWithinFreeDownloadCap(1)).toBe(true)
        expect(isWithinFreeDownloadCap(2)).toBe(true)
    })

    it('3, 0, null, 2.5 -> false', () => {
        for (const n of [3, 0, null, 2.5, -1, '1', undefined, NaN]) {
            expect(isWithinFreeDownloadCap(n)).toBe(false)
        }
    })
})
