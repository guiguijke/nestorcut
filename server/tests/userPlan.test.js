import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// GET /api/user/plan : champs de palier seuls, identiques à /api/user, et
// jamais le coffre (AGENTS.md 65b).

const state = vi.hoisted(() => ({ db: null, connect: null }))
const vault = vi.hoisted(() => ({
    getVaultStatus: vi.fn(async () => ({ enabled: false, locked: false, keyId: null })),
}))
const statuses = []
globalThis.setResponseStatus = (_event, code) => { statuses.push(code) }
globalThis.useRuntimeConfig = () => ({ public: {} })

vi.mock('~~/server/db/mongo', () => ({ connectDB: (...a) => state.connect(...a) }))
vi.mock('~~/server/features/payment/stripe', () => ({
    ACTIVE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
    getSubscription: vi.fn(),
    mapSubscription: vi.fn(),
}))
vi.mock('~~/server/utils/vault', () => vault)

import planHandler from '~~/server/api/user/plan.get.js'
import userHandler from '~~/server/api/user/index.get.js'
import { fakeDb } from './helpers/fakeMongo'

const period = () => new Date().toISOString().slice(0, 7)
const base = (o) => ({ id: 'u1', name: 'U', email: 'u@x.y', provider: 'google', freeNestingUsed: 3, freeNestingPeriod: period(), ...o })
const ev = (userId = 'u1') => ({ context: userId ? { auth: { userId } } : {} })

const PLAN_KEYS = ['freeRemaining', 'demoRemaining', 'demoUnlimited', 'subscriptionStatus', 'trialEligible', 'granted', 'requiresPaywall', 'compute', 'promo']

const users = {
    free: base({}),
    granted: base({ freeNestingUsed: 10, grantedUntil: new Date(Date.now() + 86400000), grantedTier: 'standard' }),
    subscribed: base({ subscription: { status: 'active', priceId: 'p1', currentPeriodEnd: new Date(Date.now() + 86400000) } }),
}

beforeEach(() => {
    state.connect = vi.fn(async () => state.db)
    statuses.length = 0
    vault.getVaultStatus.mockClear()
})

describe('GET /api/user/plan', () => {
    it('401 et {} sans authentification', async () => {
        state.db = fakeDb({ users: [base({})] })
        expect(await planHandler(ev(null))).toEqual({})
        expect(statuses).toEqual([401])
        // refusé avant toute lecture de base
        expect(state.connect).not.toHaveBeenCalled()
    })

    it('401 et {} quand le document utilisateur a disparu', async () => {
        state.db = fakeDb({ users: [] })
        expect(await planHandler(ev('ghost'))).toEqual({})
        expect(statuses).toEqual([401])
    })

    for (const [label, doc] of Object.entries(users)) {
        it(`mêmes champs de palier que /api/user : ${label}`, async () => {
            state.db = fakeDb({ users: [structuredClone(doc)], subscription_plan: [{ priceId: 'p1', tier: 'standard' }] })
            const plan = await planHandler(ev())
            const full = await userHandler(ev())
            expect(plan.id).toBe('u1')
            expect(Object.keys(plan).sort()).toEqual(['id', ...PLAN_KEYS].sort())
            for (const k of PLAN_KEYS) expect(plan[k]).toEqual(full[k])
        })
    }

    it('valeurs de palier attendues pour un compte accordé', async () => {
        state.db = fakeDb({ users: [structuredClone(users.granted)] })
        const plan = await planHandler(ev())
        expect(plan.granted).toBe(true)
        expect(plan.requiresPaywall).toBe(false)
        expect(plan.freeRemaining).toBe(0)
    })

    it('valeurs de palier attendues pour un abonné et un compte gratuit', async () => {
        state.db = fakeDb({ users: [structuredClone(users.subscribed)], subscription_plan: [{ priceId: 'p1', tier: 'standard' }] })
        const sub = await planHandler(ev())
        expect(sub.subscriptionStatus).toBe('active')
        expect(sub.requiresPaywall).toBe(false)
        state.db = fakeDb({ users: [structuredClone(users.free)] })
        const free = await planHandler(ev())
        expect(free.subscriptionStatus).toBeNull()
        expect(free.granted).toBe(false)
        expect(free.freeRemaining).toBe(7)
        expect(free.promo).toBeNull()
    })

    it('ne touche jamais au coffre et ne renvoie rien d identité', async () => {
        state.db = fakeDb({ users: [structuredClone(users.free)] })
        const plan = await planHandler(ev())
        expect(vault.getVaultStatus).not.toHaveBeenCalled()
        expect(plan).not.toHaveProperty('encryption')
        expect(plan).not.toHaveProperty('preferredUnit')
        expect(plan).not.toHaveProperty('email')
    })

    it('/api/user lit toujours le coffre (le test précédent n est pas vide)', async () => {
        state.db = fakeDb({ users: [structuredClone(users.free)] })
        await userHandler(ev())
        expect(vault.getVaultStatus).toHaveBeenCalledTimes(1)
    })
})
