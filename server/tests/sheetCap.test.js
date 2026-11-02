import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import './helpers/h3Shims'

// The mocked db is swapped per test through this hoisted state.
const state = vi.hoisted(() => ({ db: null, enqueued: [] }))

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))
vi.mock('~~/server/core/project/service', () => ({
    enqueueNestingJob: vi.fn(async (_domain, payload) => {
        state.enqueued.push(payload)
        return { ok: true, slug: 'job-1' }
    }),
}))
vi.mock('~~/server/tracking/add', () => ({
    trackEvent: vi.fn(),
}))
// Stripe must never be reached on the free-quota path.
vi.mock('~~/server/features/payment/stripe', () => ({
    ACTIVE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
    getSubscription: vi.fn(),
    mapSubscription: vi.fn(),
}))

import nestHandler from '~~/server/api/project/[slug]/nest.post.js'
import { assertSheetCountWithinMax } from '~~/server/utils/entitlement'
import { MAX_SHEETS_PER_JOB } from '~~/shared/constants/payment.constants'
import { fakeDb } from './helpers/fakeMongo'

const currentPeriod = () => new Date().toISOString().slice(0, 7)

const ev = (userId, slug, body) => ({
    context: { auth: { userId } },
    _params: { slug },
    // nest.post.js imports readBody from 'h3' directly — h3 reads
    // event._requestBody as the raw body and asserts event.method.
    method: 'POST',
    _requestBody: JSON.stringify(body),
    node: { req: { headers: { 'content-type': 'application/json' } }, res: {} },
})

const nestBody = (sheets) => ({
    files: [{ slug: 'f1', count: 10 }],
    params: {
        sheets: sheets.map(([w, h, c]) => ({ width: w, height: h, count: c })),
        space: 2,
    },
})

function baseDb(users, extra = {}) {
    return fakeDb({
        users,
        projects: [{ slug: 'p1', ownerId: 'u1' }],
        user_dxf_files: [{ slug: 'f1', name: 'part.dxf' }],
        subscription_plan: [{ priceId: 'price_std', tier: 'standard' }],
        ...extra,
    })
}

const freeUser = (overrides = {}) => ({
    id: 'u1',
    provider: 'google',
    freeNestingUsed: 0,
    freeNestingPeriod: currentPeriod(),
    ...overrides,
})

beforeEach(() => {
    state.db = null
    state.enqueued = []
})

// Démo : projet partagé, quota démo dédié (J-056).
const demoDb = (userDoc) =>
    fakeDb({
        users: [userDoc],
        projects: [{ slug: 'demo', isDemo: true }],
        user_dxf_files: [{ slug: 'f1', name: 'marine.dxf', projectSlug: 'demo', isDemo: true }],
    })

const paidUser = () =>
    freeUser({
        subscription: {
            status: 'active',
            priceId: 'price_std',
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        },
    })

describe('assertSheetCountWithinMax (borne technique d6, resolver AGENTS #34)', () => {
    it('la borne vaut 1000 tôles par job', () => {
        expect(MAX_SHEETS_PER_JOB).toBe(1000)
    })

    it('MAX passe, MAX + 1 lève le 400 stable too_many_sheets', () => {
        expect(() => assertSheetCountWithinMax(MAX_SHEETS_PER_JOB)).not.toThrow()
        let caught = null
        try {
            assertSheetCountWithinMax(MAX_SHEETS_PER_JOB + 1)
        } catch (err) {
            caught = err
        }
        expect(caught).toMatchObject({ statusCode: 400, statusMessage: 'too_many_sheets' })
        expect(caught.data).toEqual({ reason: 'too_many_sheets', max: 1000 })
    })
})

describe('POST /api/project/[slug]/nest — plus de plafond Free (O1), borne technique (d6)', () => {
    it('Free, 3 tôles en formats mixtes -> job créé, une unité Free consommée', async () => {
        const userDoc = freeUser()
        state.db = baseDb([userDoc])
        const body = nestBody([
            [3000, 1500, 1],
            [1000, 2000, 1],
            [1000, 1000, 1],
        ])
        await nestHandler(ev('u1', 'p1', body))
        expect(state.enqueued).toHaveLength(1)
        expect(state.enqueued[0].params.sheets).toHaveLength(3)
        expect(userDoc.freeNestingUsed).toBe(1)
    })

    it('Free, 29 tôles (cas prod) -> job créé', async () => {
        const userDoc = freeUser()
        state.db = baseDb([userDoc])
        await nestHandler(ev('u1', 'p1', nestBody([[3000, 1500, 29]])))
        expect(state.enqueued).toHaveLength(1)
        expect(userDoc.freeNestingUsed).toBe(1)
    })

    it('Free, ancien format sheetCount 3 -> job créé', async () => {
        const userDoc = freeUser()
        state.db = baseDb([userDoc])
        const body = {
            files: [{ slug: 'f1', count: 10 }],
            params: { width: 3000, height: 1500, sheetCount: 3, space: 2 },
        }
        await nestHandler(ev('u1', 'p1', body))
        expect(state.enqueued).toHaveLength(1)
        expect(userDoc.freeNestingUsed).toBe(1)
    })

    it('Free, 1001 tôles -> 400 too_many_sheets, rien en file, quota intact', async () => {
        const userDoc = freeUser()
        state.db = baseDb([userDoc])
        await expect(nestHandler(ev('u1', 'p1', nestBody([[3000, 1500, 1001]])))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'too_many_sheets',
            data: { reason: 'too_many_sheets', max: 1000 },
        })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.freeNestingUsed).toBe(0) // borne contrôlée AVANT toute charge
    })

    it('Free, 1001 tôles réparties sur deux formats -> 400 (somme des count)', async () => {
        const userDoc = freeUser()
        state.db = baseDb([userDoc])
        const body = nestBody([
            [3000, 1500, 500],
            [1000, 2000, 501],
        ])
        await expect(nestHandler(ev('u1', 'p1', body))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'too_many_sheets',
        })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.freeNestingUsed).toBe(0)
    })

    it('Free, ancien format sheetCount 5000 -> 400, rien consommé', async () => {
        const userDoc = freeUser()
        state.db = baseDb([userDoc])
        const body = {
            files: [{ slug: 'f1', count: 10 }],
            params: { width: 3000, height: 1500, sheetCount: 5000, space: 2 },
        }
        await expect(nestHandler(ev('u1', 'p1', body))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'too_many_sheets',
        })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.freeNestingUsed).toBe(0)
    })

    it('standard, 5 tôles -> job créé, palier standard (inchangé)', async () => {
        const userDoc = paidUser()
        state.db = baseDb([userDoc])
        await nestHandler(ev('u1', 'p1', nestBody([[3000, 1500, 5]])))
        expect(state.enqueued).toHaveLength(1)
        expect(state.enqueued[0].params.computeLevel).toBe('standard')
    })

    it('standard, 1001 tôles -> 400 (la borne vaut pour tous les paliers)', async () => {
        const userDoc = paidUser()
        state.db = baseDb([userDoc])
        await expect(nestHandler(ev('u1', 'p1', nestBody([[3000, 1500, 1001]])))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'too_many_sheets',
        })
        expect(state.enqueued).toHaveLength(0)
    })

    it('démo, 3 tôles -> job créé sur le quota démo (inchangé, J-056)', async () => {
        const userDoc = freeUser({ demoNestingUsed: 0, demoNestingPeriod: currentPeriod() })
        state.db = demoDb(userDoc)
        await nestHandler(ev('u1', 'demo', nestBody([[3000, 1500, 3]])))
        expect(state.enqueued).toHaveLength(1)
        expect(userDoc.demoNestingUsed).toBe(1)
        expect(userDoc.freeNestingUsed).toBe(0)
    })

    it('démo, 1001 tôles -> 400 (démo comprise), quota démo intact', async () => {
        const userDoc = freeUser({ demoNestingUsed: 0, demoNestingPeriod: currentPeriod() })
        state.db = demoDb(userDoc)
        await expect(nestHandler(ev('u1', 'demo', nestBody([[3000, 1500, 1001]])))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'too_many_sheets',
        })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.demoNestingUsed).toBe(0)
        expect(userDoc.freeNestingUsed).toBe(0)
    })
})
