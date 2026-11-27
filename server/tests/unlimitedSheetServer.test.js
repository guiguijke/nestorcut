import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// « Quantité illimitée » d'une tôle : booléen, projet « cet appareil »
// seulement, refus AVANT toute charge ; non comptée par la borne technique ; et
// elle revient au navigateur avec les paramètres du job.

const state = vi.hoisted(() => ({ db: null, enqueued: [], config: { public: {} } }))
globalThis.useRuntimeConfig = () => state.config

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
vi.mock('~~/server/features/payment/stripe', () => ({
    ACTIVE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
    getSubscription: vi.fn(),
    mapSubscription: vi.fn(),
}))

import nestHandler from '~~/server/api/project/[slug]/nest.post.js'
import payloadHandler from '~~/server/api/results/[slug]/local-payload.get.js'
import { fakeDb } from './helpers/fakeMongo'
import { MAX_SHEETS_PER_JOB } from '~~/shared/constants/payment.constants'

const currentPeriod = () => new Date().toISOString().slice(0, 7)

const ev = (userId, slug, body, method = 'POST') => ({
    context: { auth: { userId } },
    _params: { slug },
    method,
    _requestBody: JSON.stringify(body ?? {}),
    _body: body ?? {},
    node: { req: { headers: { 'content-type': 'application/json' } }, res: {} },
})

const user = (overrides = {}) => ({
    id: 'u1',
    provider: 'google',
    freeNestingUsed: 0,
    freeNestingPeriod: currentPeriod(),
    demoNestingUsed: 0,
    demoNestingPeriod: currentPeriod(),
    ...overrides,
})

const body = (sheets) => ({ files: [{ slug: 'f-aabbccddeeff.dxf', count: 4 }], params: { sheets, space: 2 } })
const A = (count, extra = {}) => ({ width: 1000, height: 2000, count, ...extra })
const OPEN = A(1, { unlimited: true })

const localDb = (userDoc = user()) => fakeDb({
    users: [userDoc],
    projects: [{ slug: 'p1', ownerId: 'u1', local: true }],
    user_dxf_files: [],
})
const serverDb = (userDoc) => fakeDb({
    users: [userDoc],
    projects: [{ slug: 'p1', ownerId: 'u1' }],
    user_dxf_files: [{ slug: 'f-aabbccddeeff.dxf', name: 'p.dxf' }],
})
const demoDb = (userDoc) => fakeDb({
    users: [userDoc],
    projects: [{ slug: 'p1', isDemo: true }],
    user_dxf_files: [{ slug: 'f-aabbccddeeff.dxf', name: 'm.dxf', projectSlug: 'p1', isDemo: true }],
})

beforeEach(() => {
    state.db = null
    state.enqueued = []
    state.config = { public: { localComputeEnabled: true, localImportEnabled: true } }
})

describe('POST nest - quantité illimitée', () => {
    it('projet local : `unlimited: true` est gardé, la tôle finie reste sans la clé', async () => {
        state.db = localDb()
        await nestHandler(ev('u1', 'p1', body([A(2), OPEN])))
        expect(state.enqueued).toHaveLength(1)
        expect(state.enqueued[0].params.sheets).toEqual([A(2), OPEN])
        expect('unlimited' in state.enqueued[0].params.sheets[0]).toBe(false)
    })

    it('`false` : clé omise, document identique à une requête sans la clé', async () => {
        state.db = localDb()
        await nestHandler(ev('u1', 'p1', body([A(2)])))
        state.db = localDb()
        await nestHandler(ev('u1', 'p1', body([A(2, { unlimited: false })])))
        expect(JSON.stringify(state.enqueued[1].params)).toBe(JSON.stringify(state.enqueued[0].params))
        expect(JSON.stringify(state.enqueued[1].params)).not.toContain('unlimited')
    })

    it.each([['projet serveur', serverDb], ['projet démo', demoDb]])('%s : `false` passe, sans la clé', async (_l, make) => {
        state.db = make(user())
        await nestHandler(ev('u1', 'p1', body([A(2, { unlimited: false })])))
        expect(state.enqueued).toHaveLength(1)
        expect(JSON.stringify(state.enqueued[0].params)).not.toContain('unlimited')
    })

    it.each([['projet serveur', serverDb], ['projet démo', demoDb]])('%s : 400 unlimited_sheet_local_only, rien en file, quota intact', async (_l, make) => {
        const userDoc = user()
        state.db = make(userDoc)
        await expect(nestHandler(ev('u1', 'p1', body([A(1), OPEN])))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'unlimited_sheet_local_only',
            data: { reason: 'unlimited_sheet_local_only' },
        })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.freeNestingUsed).toBe(0)
        expect(userDoc.demoNestingUsed).toBe(0)
    })

    it.each([
        ['chaîne', 'true'], ['nombre', 1], ['zéro', 0], ['null', null], ['objet', {}], ['liste', [true]],
    ])('valeur non booléenne (%s) : 400 unlimited_sheet_invalid, quota intact', async (_l, bad) => {
        const userDoc = user()
        state.db = localDb(userDoc)
        await expect(nestHandler(ev('u1', 'p1', body([A(1, { unlimited: bad })])))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'unlimited_sheet_invalid',
        })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.freeNestingUsed).toBe(0)
    })
})

describe('POST nest - borne technique et quantité illimitée', () => {
    it('la borne ne compte pas les illimitées : stock à la borne exacte + une illimitée', async () => {
        state.db = localDb()
        await nestHandler(ev('u1', 'p1', body([A(MAX_SHEETS_PER_JOB), OPEN])))
        expect(state.enqueued).toHaveLength(1)
    })

    it('le stock au-delà de la borne reste refusé, illimitée ou non', async () => {
        const userDoc = user()
        state.db = localDb(userDoc)
        await expect(nestHandler(ev('u1', 'p1', body([A(MAX_SHEETS_PER_JOB + 1), OPEN])))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'too_many_sheets',
        })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.freeNestingUsed).toBe(0)
    })

    it('une illimitée envoyée avec une grande quantité ne compte pas non plus', async () => {
        state.db = localDb()
        await nestHandler(ev('u1', 'p1', body([A(5), A(100_000, { unlimited: true })])))
        expect(state.enqueued).toHaveLength(1)
    })
})

describe('GET local-payload - quantité illimitée', () => {
    const job = (sheets) => ({
        slug: 'job-1',
        ownerId: 'u1',
        status: 'awaiting_local',
        localConfig: { timeBudgetSec: 13, vcores: 1 },
        files: [{ slug: 'f-aabbccddeeff.dxf', count: 3 }],
        params: { sheets, space: 2 },
    })

    it('la clé revient au navigateur quand le job la porte, et seulement alors', async () => {
        state.db = fakeDb({ nesting_jobs: [job([A(2), OPEN, A(1, { unlimited: 'true' })])] })
        const res = await payloadHandler(ev('u1', 'job-1', null, 'GET'))
        expect(res.params.sheets).toEqual([A(2), OPEN, A(1)])
        expect('unlimited' in res.params.sheets[0]).toBe(false)
        expect('unlimited' in res.params.sheets[2]).toBe(false)
    })
})
