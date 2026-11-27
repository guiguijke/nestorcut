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

// Compte payant : accès accordé (palier « standard »).
const PAID = { grantedUntil: new Date(Date.now() + 86400000).toISOString(), grantedTier: 'standard' }

// Projet « Nos serveurs » : un carré de 100 mm, polygone connu du serveur.
const SQUARE = [[0, 0], [100, 0], [100, 100], [0, 100]]
const serverDb = (userDoc = user()) => fakeDb({
    users: [userDoc],
    projects: [{ slug: 'p1', ownerId: 'u1' }],
    user_dxf_files: [{
        slug: 'f-aabbccddeeff.dxf',
        name: 'p.dxf',
        polygonParts: [{ coordinates: SQUARE }],
    }],
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

    it('demo : 400 edge_distance_local_only, rien en file, quota intact', async () => {
        const userDoc = user()
        state.db = fakeDb({
            users: [userDoc],
            projects: [{ slug: 'p1', isDemo: true }],
            user_dxf_files: [{ slug: 'f-aabbccddeeff.dxf', name: 'm.dxf', projectSlug: 'p1', isDemo: true }],
        })
        await expect(nestHandler(ev('u1', 'p1', bodyEdge(3)))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'edge_distance_local_only',
            data: { reason: 'edge_distance_local_only' },
        })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.demoNestingUsed).toBe(0)
    })

    it('serveurs, calcul navigateur coupe : 400 edge_distance_local_only, quota intact', async () => {
        for (const flag of [false, 'false', undefined]) {
            state.config = { public: { localComputeEnabled: flag } }
            const userDoc = user()
            state.db = serverDb(userDoc)
            await expect(nestHandler(ev('u1', 'p1', bodyEdge(-2)))).rejects.toMatchObject({
                statusCode: 400,
                statusMessage: 'edge_distance_local_only',
                data: { reason: 'edge_distance_local_only' },
            })
            expect(userDoc.freeNestingUsed).toBe(0)
        }
        expect(state.enqueued).toHaveLength(0)
    })

    it('serveurs, calcul navigateur active en chaine "true" : accepte', async () => {
        state.config = { public: { localComputeEnabled: 'true' } }
        state.db = serverDb(user())
        await nestHandler(ev('u1', 'p1', bodyEdge(3)))
        expect(state.enqueued).toHaveLength(1)
    })

    it.each([['gratuit', {}, 'browser'], ['payant', PAID, 'standard']])(
        'projet serveur %s : job en file, calcul navigateur, bord et profil navigateur du palier',
        async (_l, extra, level) => {
            state.db = serverDb(user(extra))
            await nestHandler(ev('u1', 'p1', bodyEdge(-3.5)))
            expect(state.enqueued).toHaveLength(1)
            const { params } = state.enqueued[0]
            expect(params.computeLocation).toBe('local')
            expect(params.edgeDistance).toBe(-3.5)
            expect(params.computeLevel).toBe(level)
            expect(params.browser_walks).toBeDefined()
            expect(params.browser_concurrency).toBeDefined()
            // Le worker prépare encore le payload : pas de awaiting_local direct.
            expect(state.enqueued[0].initialStatus).toBe('pending')
        })

    it('serveurs payant sans bord : reste calcule sur le serveur (computeLocation server)', async () => {
        for (const edge of [undefined, null]) {
            state.enqueued = []
            state.db = serverDb(user(PAID))
            await nestHandler(ev('u1', 'p1', bodyEdge(edge)))
            const { params } = state.enqueued[0]
            expect(params.computeLocation).toBe('server')
            expect('edgeDistance' in params).toBe(false)
        }
    })

    it('serveurs payant, bord egal a l espacement : calcul inchange (pas de force navigateur)', async () => {
        state.db = serverDb(user(PAID))
        await nestHandler(ev('u1', 'p1', bodyEdge(undefined)))
        const sans = state.enqueued[0].params.computeLocation
        state.enqueued = []
        state.db = serverDb(user(PAID))
        await nestHandler(ev('u1', 'p1', bodyEdge(2)))
        expect(state.enqueued[0].params.computeLocation).toBe(sans)
        expect(sans).toBe('server')
    })

    it('serveurs avec un DWG : 400 edge_distance_dwg, rien en file, quota intact', async () => {
        const userDoc = user()
        state.db = fakeDb({
            users: [userDoc],
            projects: [{ slug: 'p1', ownerId: 'u1' }],
            user_dxf_files: [{ slug: 'f-aabbccddeeff.dxf', name: 'p.dxf' }, { slug: 'f-112233445566.DWG', name: 'q.dwg' }],
        })
        const body = bodyEdge(3)
        body.files = [{ slug: 'f-aabbccddeeff.dxf', count: 2 }, { slug: 'f-112233445566.DWG', count: 2 }]
        await expect(nestHandler(ev('u1', 'p1', body))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'edge_distance_dwg',
            data: { reason: 'edge_distance_dwg' },
        })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.freeNestingUsed).toBe(0)
    })

    it('refus local_only : le compteur de quota du compte reste a zero', async () => {
        const userDoc = user()
        state.db = fakeDb({
            users: [userDoc],
            projects: [{ slug: 'p1', isDemo: true }],
            user_dxf_files: [{ slug: 'f-aabbccddeeff.dxf', name: 'm.dxf', projectSlug: 'p1', isDemo: true }],
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

describe('POST nest - capacite a distance au bord (Nos serveurs)', () => {
    // Tole 500 x 500, espacement 2, pieces de 100 mm : 20 tiennent, 22 non.
    const body = (count, edge) => ({
        files: [{ slug: 'f-aabbccddeeff.dxf', count }],
        params: {
            sheets: [{ width: 500, height: 500, count: 1 }],
            space: 2,
            ...(edge === undefined ? {} : { edgeDistance: edge }),
        },
    })

    it('un bord positif fait refuser un job qui tenait a l\'espacement', async () => {
        state.db = serverDb()
        await nestHandler(ev('u1', 'p1', body(20)))
        expect(state.enqueued).toHaveLength(1)

        const userDoc = user()
        state.db = serverDb(userDoc)
        let err
        await nestHandler(ev('u1', 'p1', body(20, 12))).catch((e) => { err = e })
        expect(err).toMatchObject({ statusCode: 422, statusMessage: 'capacity_exceeded' })
        expect(err.data.unfit.reason).toBe('capacity')
        expect(state.enqueued).toHaveLength(1)
        expect(userDoc.freeNestingUsed).toBe(0)
    })

    it('un bord negatif fait accepter un job refuse sans lui', async () => {
        state.db = serverDb()
        await expect(nestHandler(ev('u1', 'p1', body(22)))).rejects.toMatchObject({ statusCode: 422 })
        expect(state.enqueued).toHaveLength(0)
        state.db = serverDb()
        await nestHandler(ev('u1', 'p1', body(22, -8)))
        expect(state.enqueued).toHaveLength(1)
        expect(state.enqueued[0].params.edgeDistance).toBe(-8)
    })

    it('espacement max du refus : calcule a bord fixe sur les vraies toles', async () => {
        const { capacityReport } = await import('~~/app/composables/capacityClient')
        const { userMaxSpacing } = await import('~~/app/composables/localPayloadBuilder')
        const real = capacityReport(
            [{ coords: SQUARE, count: 20 }], [{ width: 500, height: 500, count: 1 }], 2, { edge: 12 })
        state.db = serverDb()
        let err
        await nestHandler(ev('u1', 'p1', body(20, 12))).catch((e) => { err = e })
        const expected = userMaxSpacing(real.maxSpacingForFitMm, 0)
        for (const k of Object.keys(expected)) expect(err.data.unfit[k]).toEqual(expected[k])
    })

    it('tole moteur sans place (bord enorme) : pas de pre-controle, le job part', async () => {
        state.db = serverDb()
        await nestHandler(ev('u1', 'p1', body(1, 300)))
        expect(state.enqueued).toHaveLength(1)
    })

    it('piece qui ne tient sur aucune tole moteur (bord 240) : pas de 422, le job part', async () => {
        state.db = serverDb()
        await nestHandler(ev('u1', 'p1', body(4, 240)))
        expect(state.enqueued).toHaveLength(1)
    })

    it('barre 130 x 5 a 0 et 45 degres, tole 120 x 120, bord 12 : elle tient a 45, le 422 est garde', async () => {
        const BAR = [[0, 0], [130, 0], [130, 5], [0, 5]]
        const userDoc = user()
        state.db = fakeDb({
            users: [userDoc],
            projects: [{ slug: 'p1', ownerId: 'u1' }],
            user_dxf_files: [{ slug: 'f-aabbccddeeff.dxf', name: 'p.dxf', polygonParts: [{ coordinates: BAR }] }],
        })
        let err
        await nestHandler(ev('u1', 'p1', {
            files: [{ slug: 'f-aabbccddeeff.dxf', count: 40, rotation: '[0,45]' }],
            params: { sheets: [{ width: 120, height: 120, count: 1 }], space: 2, edgeDistance: 12 },
        })).catch((e) => { err = e })
        expect(err).toMatchObject({ statusCode: 422, statusMessage: 'capacity_exceeded' })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.freeNestingUsed).toBe(0)
    })

    it('bord egal a l\'espacement : meme verdict que sans bord', async () => {
        state.db = serverDb()
        await nestHandler(ev('u1', 'p1', body(20, 2)))
        expect(state.enqueued).toHaveLength(1)
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
