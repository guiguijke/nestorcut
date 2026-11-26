import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// Tôle importée d'un DXF : le serveur ne voit qu'un identifiant opaque
// (shapeId, le slug du dossier IndexedDB). Jamais de nom, jamais de forme.
// Il ne vaut que pour un projet « cet appareil » ; ailleurs le job est refusé.

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
const currentPeriod = () => new Date().toISOString().slice(0, 7)
const SHAPE_ID = 'sheet-lx2k9f0a-ab12cd'

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

const bodyEdge = (edge, extra = {}) => ({
    files: [{ slug: 'f-aabbccddeeff.dxf', count: 4 }],
    params: { sheets: [{ width: 1000, height: 2000, count: 1 }], space: 2, ...(edge === undefined ? {} : { edgeDistance: edge }), ...extra },
})

const localDb = (userDoc = user()) => fakeDb({
    users: [userDoc],
    projects: [{ slug: 'p1', ownerId: 'u1', local: true }],
    user_dxf_files: [],
})

beforeEach(() => {
    state.db = null
    state.enqueued = []
    state.config = { public: { localComputeEnabled: true, localImportEnabled: true } }
})

describe('POST nest - distance au bord', () => {
    it.each([[5], [0], [-3.5], [-5000], [5000]])('projet local : %s accepte et enregistre (nombre, mm)', async (e) => {
        state.db = localDb()
        await nestHandler(ev('u1', 'p1', bodyEdge(e)))
        expect(state.enqueued).toHaveLength(1)
        expect(state.enqueued[0].params.edgeDistance).toBe(e)
    })

    it('absente ou null : aucune cle edgeDistance, document identique', async () => {
        for (const edge of [undefined, null]) {
            state.enqueued = []
            state.db = localDb()
            await nestHandler(ev('u1', 'p1', bodyEdge(edge)))
            expect(state.enqueued).toHaveLength(1)
            expect('edgeDistance' in state.enqueued[0].params).toBe(false)
        }
    })

    it('les autres champs enregistres ne changent pas quand la distance est posee', async () => {
        state.db = localDb()
        await nestHandler(ev('u1', 'p1', bodyEdge(undefined)))
        state.db = localDb()
        await nestHandler(ev('u1', 'p1', bodyEdge(4)))
        const { edgeDistance, ...withEdge } = state.enqueued[1].params
        expect(edgeDistance).toBe(4)
        expect(withEdge).toEqual(state.enqueued[0].params)
    })

    it.each([
        ['demo', () => fakeDb({
            users: [user()],
            projects: [{ slug: 'p1', isDemo: true }],
            user_dxf_files: [{ slug: 'f-aabbccddeeff.dxf', name: 'm.dxf', projectSlug: 'p1', isDemo: true }],
        })],
        ['serveur', () => fakeDb({
            users: [user()],
            projects: [{ slug: 'p1', ownerId: 'u1' }],
            user_dxf_files: [{ slug: 'f-aabbccddeeff.dxf', name: 'p.dxf' }],
        })],
    ])('projet %s : 400 edge_distance_local_only, rien en file, quota intact', async (_l, make) => {
        state.db = make()
        await expect(nestHandler(ev('u1', 'p1', bodyEdge(3)))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'edge_distance_local_only',
            data: { reason: 'edge_distance_local_only' },
        })
        expect(state.enqueued).toHaveLength(0)
    })

    it('refus local_only : le compteur de quota du compte reste a zero', async () => {
        const userDoc = user()
        state.db = fakeDb({
            users: [userDoc],
            projects: [{ slug: 'p1', ownerId: 'u1' }],
            user_dxf_files: [{ slug: 'f-aabbccddeeff.dxf', name: 'p.dxf' }],
        })
        await expect(nestHandler(ev('u1', 'p1', bodyEdge(-2)))).rejects.toMatchObject({ statusMessage: 'edge_distance_local_only' })
        expect(userDoc.freeNestingUsed).toBe(0)
        expect(userDoc.demoNestingUsed).toBe(0)
    })

    it.each([
        ['chaine', '5'], ['chaine vide', ''], ['trop grand', 5000.5], ['trop negatif', -5001], ['objet', { v: 1 }], ['liste', [1]], ['booleen', true],
    ])('valeur invalide (%s) : 400 edge_distance_invalid, quota intact', async (_l, bad) => {
        const userDoc = user()
        state.db = localDb(userDoc)
        await expect(nestHandler(ev('u1', 'p1', bodyEdge(bad)))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'edge_distance_invalid',
        })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.freeNestingUsed).toBe(0)
    })
})

describe('GET local-payload - distance au bord', () => {
    const job = (params) => ({
        slug: 'job-1',
        ownerId: 'u1',
        status: 'awaiting_local',
        localConfig: { timeBudgetSec: 13, vcores: 1 },
        files: [{ slug: 'f-aabbccddeeff.dxf', count: 3 }],
        params: { sheets: [{ width: 100, height: 200, count: 1 }], space: 2, ...params },
    })

    it.each([[-4], [0], [6.5]])('renvoie edgeDistance %s quand le job la porte', async (e) => {
        state.db = fakeDb({ nesting_jobs: [job({ edgeDistance: e })] })
        const res = await payloadHandler(ev('u1', 'job-1', null, 'GET'))
        expect(res.params.edgeDistance).toBe(e)
    })

    it('absente du job : aucune cle dans la reponse', async () => {
        state.db = fakeDb({ nesting_jobs: [job({})] })
        const res = await payloadHandler(ev('u1', 'job-1', null, 'GET'))
        expect('edgeDistance' in res.params).toBe(false)
    })

    it('valeur non numerique stockee : ecartee', async () => {
        state.db = fakeDb({ nesting_jobs: [job({ edgeDistance: '5' })] })
        const res = await payloadHandler(ev('u1', 'job-1', null, 'GET'))
        expect('edgeDistance' in res.params).toBe(false)
    })
})
