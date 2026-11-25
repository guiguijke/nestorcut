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
import { MAX_SHEET_FORMATS } from '~~/shared/constants/payment.constants'

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

const bodyWith = (sheet, slug = 'f-aabbccddeeff.dxf') => ({
    files: [{ slug, count: 4 }],
    params: { sheets: [sheet], space: 2 },
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

describe('POST nest — shapeId d\'une tôle importée', () => {
    it('projet local : le shapeId est gardé, avec dimensions et stock, et RIEN d\'autre', async () => {
        state.db = localDb()
        await nestHandler(ev('u1', 'p1', bodyWith({
            width: 100,
            height: 200,
            count: 2,
            shapeId: SHAPE_ID,
            // Tout ce qui ne doit jamais arriver au serveur : s'il est envoyé, il est écarté.
            name: 'Tôle secrète du client',
            contours: [{ ring: [[0, 0], [1, 0], [1, 1]] }],
            outer: [[0, 0]],
            forbidden: [1],
        })))
        expect(state.enqueued).toHaveLength(1)
        expect(state.enqueued[0].params.sheets).toEqual([
            { width: 100, height: 200, count: 2, shapeId: SHAPE_ID },
        ])
        const raw = JSON.stringify(state.enqueued[0])
        expect(raw).not.toContain('secrète')
        expect(raw).not.toContain('contours')
        expect(raw).not.toContain('forbidden')
    })

    it('projet local, tôle rectangulaire : aucune clé shapeId (document inchangé)', async () => {
        state.db = localDb()
        await nestHandler(ev('u1', 'p1', bodyWith({ width: 1000, height: 2000, count: 1 })))
        expect(state.enqueued[0].params.sheets).toEqual([{ width: 1000, height: 2000, count: 1 }])
        expect('shapeId' in state.enqueued[0].params.sheets[0]).toBe(false)
    })

    it.each([
        ['projet démo', (userDoc) => fakeDb({
            users: [userDoc],
            projects: [{ slug: 'p1', isDemo: true }],
            user_dxf_files: [{ slug: 'f1', name: 'marine.dxf', projectSlug: 'p1', isDemo: true }],
        }), 'f1'],
        ['projet serveur ordinaire', (userDoc) => fakeDb({
            users: [userDoc],
            projects: [{ slug: 'p1', ownerId: 'u1' }],
            user_dxf_files: [{ slug: 'f1', name: 'part.dxf' }],
        }), 'f1'],
    ])('%s : refus 400 imported_sheet_not_local, rien en file, quota intact', async (_label, makeDb, fileSlug) => {
        const userDoc = user()
        state.db = makeDb(userDoc)
        await expect(nestHandler(ev('u1', 'p1', bodyWith(
            { width: 100, height: 200, count: 1, shapeId: SHAPE_ID }, fileSlug,
        )))).rejects.toMatchObject({ statusCode: 400, statusMessage: 'imported_sheet_not_local' })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.freeNestingUsed).toBe(0)
        expect(userDoc.demoNestingUsed).toBe(0)
    })

    // Un identifiant mal formé est REFUSÉ (400), pas écarté : l'écarter ferait
    // nicher dans le rectangle englobant, donc sur du vide, sans le dire.
    it.each([
        ['chemin', '../../etc/passwd'],
        ['préfixe seul', 'sheet-'],
        ['majuscules', 'SHEET-LX2K9F0A-AB12CD'],
        ['trop long', `sheet-${'a'.repeat(40)}-ab12cd`],
        ['suffixe trop court', 'sheet-lx2k9f0a-ab12'],
        ['nombre', 12345],
        ['objet', { slug: SHAPE_ID }],
        ['liste', [SHAPE_ID]],
        ['chaîne vide', ''],
    ])('identifiant mal formé (%s) : refus 400 invalid_sheet_shape_id', async (_label, bad) => {
        state.db = localDb()
        await expect(nestHandler(ev('u1', 'p1', bodyWith(
            { width: 100, height: 200, count: 1, shapeId: bad },
        )))).rejects.toMatchObject({ statusCode: 400, statusMessage: 'invalid_sheet_shape_id' })
        expect(state.enqueued).toHaveLength(0)
    })

    it('shapeId null ou absent : tôle ordinaire, pas de refus', async () => {
        state.db = localDb()
        await nestHandler(ev('u1', 'p1', bodyWith({ width: 100, height: 200, count: 1, shapeId: null })))
        expect(state.enqueued[0].params.sheets).toEqual([{ width: 100, height: 200, count: 1 }])
    })
})

describe('POST nest — plafond de formats (MAX_SHEET_FORMATS)', () => {
    const formats = (n, shaped = 0) => Array.from({ length: n }, (_, i) => (i < shaped
        ? { width: 100 + i, height: 200, count: 1, shapeId: `sheet-lx2k9f0a-ab12c${i}` }
        : { width: 1000 + i, height: 2000, count: 1 }))
    const post = (sheets) => nestHandler(ev('u1', 'p1', { files: [{ slug: 'f-aabbccddeeff.dxf', count: 4 }], params: { sheets, space: 2 } }))

    it('la constante vaut 10', () => {
        expect(MAX_SHEET_FORMATS).toBe(10)
    })

    it('10 formats passent, tous gardés', async () => {
        state.db = localDb()
        await post(formats(10))
        expect(state.enqueued).toHaveLength(1)
        expect(state.enqueued[0].params.sheets).toHaveLength(10)
    })

    it('11 formats : 400 too_many_formats, rien en file, quota intact (jamais tronqué en silence)', async () => {
        const userDoc = user()
        state.db = localDb(userDoc)
        await expect(post(formats(11))).rejects.toMatchObject({
            statusCode: 400,
            statusMessage: 'too_many_formats',
            data: { reason: 'too_many_formats', max: 10 },
        })
        expect(state.enqueued).toHaveLength(0)
        expect(userDoc.freeNestingUsed).toBe(0)
    })

    it('10 rectangles + 1 tôle importée : refusé, la tôle importée n’est pas perdue en silence', async () => {
        state.db = localDb()
        const sheets = [...formats(10), { width: 100, height: 200, count: 1, shapeId: SHAPE_ID }]
        await expect(post(sheets)).rejects.toMatchObject({ statusMessage: 'too_many_formats' })
        expect(state.enqueued).toHaveLength(0)
    })

    it('les lignes invalides ne comptent pas dans le plafond (elles étaient déjà écartées)', async () => {
        state.db = localDb()
        await post([...formats(10), { width: 0, height: 0, count: 0 }])
        expect(state.enqueued[0].params.sheets).toHaveLength(10)
    })
})

describe('GET local-payload — ce qui revient au navigateur', () => {
    const job = (sheets) => ({
        slug: 'job-1',
        ownerId: 'u1',
        status: 'awaiting_local',
        localConfig: { timeBudgetSec: 13, vcores: 1 },
        files: [{ slug: 'f-aabbccddeeff.dxf', count: 3, rotations: [0, 90] }],
        params: { sheets, space: 2 },
    })

    it('le shapeId repasse avec les tôles ; géométrie et nom jamais, même stockés', async () => {
        state.db = fakeDb({
            nesting_jobs: [job([
                { width: 100, height: 200, count: 1, shapeId: SHAPE_ID, name: 'Tôle secrète', contours: [[0, 0]] },
                { width: 1000, height: 500, count: 3 },
            ])],
        })
        const res = await payloadHandler(ev('u1', 'job-1', null, 'GET'))
        expect(res.params.sheets).toEqual([
            { width: 100, height: 200, count: 1, shapeId: SHAPE_ID },
            { width: 1000, height: 500, count: 3 },
        ])
        const raw = JSON.stringify(res)
        expect(raw).not.toContain('secrète')
        expect(raw).not.toContain('contours')
    })

    it('un shapeId qui n\'est pas une chaîne courte est écarté', async () => {
        state.db = fakeDb({
            nesting_jobs: [job([
                { width: 1, height: 2, count: 1, shapeId: { x: 1 } },
                { width: 1, height: 2, count: 1, shapeId: 'x'.repeat(65) },
            ])],
        })
        const res = await payloadHandler(ev('u1', 'job-1', null, 'GET'))
        expect(res.params.sheets.every((s) => !('shapeId' in s))).toBe(true)
    })
})
