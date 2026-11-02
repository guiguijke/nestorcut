import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import './helpers/h3Shims'

// The mocked db is swapped per test through this hoisted state.
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
    state.config = { public: {} }
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
        expect(state.enqueued[0].params.sheetCount).toBe(3)
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

    // Le serveur contrôle la valeur normalisée (Number('5_000') -> NaN -> 1) :
    // il doit ENREGISTRER cette valeur, pas la chaîne brute que Python
    // int('5_000') / int('٥٠٠٠') lirait comme 5000 tôles côté worker.
    describe.each(['5_000', '٥٠٠٠'])('ancien format, sheetCount en chaîne %s', (raw) => {
        const legacyBody = (files) => ({
            files,
            params: { width: 3000, height: 1500, sheetCount: raw, space: 2 },
        })

        it('Free, projet cloud -> enregistre la valeur contrôlée (entier 1), pas la chaîne', async () => {
            const userDoc = freeUser()
            state.db = baseDb([userDoc])
            await nestHandler(ev('u1', 'p1', legacyBody([{ slug: 'f1', count: 10 }])))
            expect(state.enqueued).toHaveLength(1)
            expect(state.enqueued[0].params.sheetCount).toBe(1)
            expect(userDoc.freeNestingUsed).toBe(1)
        })

        it('démo -> enregistre la valeur contrôlée (entier 1), pas la chaîne', async () => {
            const userDoc = freeUser({ demoNestingUsed: 0, demoNestingPeriod: currentPeriod() })
            state.db = demoDb(userDoc)
            await nestHandler(ev('u1', 'demo', legacyBody([{ slug: 'f1', count: 10 }])))
            expect(state.enqueued).toHaveLength(1)
            expect(state.enqueued[0].params.sheetCount).toBe(1)
            expect(userDoc.demoNestingUsed).toBe(1)
        })

        it('projet local -> enregistre la valeur contrôlée (entier 1), pas la chaîne', async () => {
            state.config = { public: { localComputeEnabled: true, localImportEnabled: true } }
            const userDoc = freeUser()
            state.db = fakeDb({
                users: [userDoc],
                projects: [{ slug: 'p1', ownerId: 'u1', local: true }],
                user_dxf_files: [],
            })
            await nestHandler(ev('u1', 'p1', legacyBody([{ slug: 'f-aabbccddeeff.dxf', count: 4 }])))
            expect(state.enqueued).toHaveLength(1)
            expect(state.enqueued[0].params.sheetCount).toBe(1)
            expect(userDoc.freeNestingUsed).toBe(1)
        })
    })

    // Ancien format : la tôle unique obéit à la même règle que le nouveau
    // (largeur/hauteur finies > 0, count ≥ 1) — 400 AVANT toute charge, et le
    // serveur ENREGISTRE les dimensions qu'il a contrôlées, pas les chaînes
    // brutes que le float() / int() Python du worker lirait autrement
    // (`'3_000'` -> NaN ici, 3000 là-bas : le 422 capacité était sauté).
    describe('ancien format, tôle unique invalide -> 400 stable, rien consommé', () => {
        const legacy = (overrides) => ({
            files: [{ slug: 'f1', count: 10 }],
            params: { width: 3000, height: 1500, sheetCount: 1, space: 2, ...overrides },
        })
        const INVALID = 'Please provide at least one valid sheet (width, height, count).'

        it.each([
            ['largeur « 3_000 » (NaN côté serveur)', { width: '3_000' }],
            ['largeur « 1e999 » (infinie)', { width: '1e999' }],
            ['largeur 0', { width: 0 }],
            ['largeur négative', { width: -3000 }],
            ['largeur absente', { width: undefined }],
            ['hauteur « abc »', { height: 'abc' }],
            ['hauteur 0', { height: 0 }],
            ['hauteur négative', { height: -1 }],
            ['sheetCount négatif (-3)', { sheetCount: -3 }],
            ['sheetCount fractionnaire < 1 (0,5)', { sheetCount: 0.5 }],
        ])('Free, projet cloud, %s', async (_label, overrides) => {
            const userDoc = freeUser()
            state.db = baseDb([userDoc])
            await expect(nestHandler(ev('u1', 'p1', legacy(overrides)))).rejects.toMatchObject({
                statusCode: 400,
                statusMessage: INVALID,
            })
            expect(state.enqueued).toHaveLength(0)
            expect(userDoc.freeNestingUsed).toBe(0)
        })

        it('même refus que le nouveau format pour une tôle invalide (code et forme)', async () => {
            state.db = baseDb([freeUser()])
            const newFormat = nestBody([[0, 1500, 1]])
            const oldFormat = legacy({ width: 0 })
            const refusals = []
            for (const body of [newFormat, oldFormat]) {
                try {
                    await nestHandler(ev('u1', 'p1', body))
                } catch (err) {
                    refusals.push({ statusCode: err.statusCode, statusMessage: err.statusMessage })
                }
            }
            expect(refusals).toHaveLength(2)
            expect(refusals[1]).toEqual(refusals[0])
        })

        it('démo, largeur « 3_000 » -> 400, quota démo intact', async () => {
            const userDoc = freeUser({ demoNestingUsed: 0, demoNestingPeriod: currentPeriod() })
            state.db = demoDb(userDoc)
            await expect(nestHandler(ev('u1', 'demo', legacy({ width: '3_000' })))).rejects.toMatchObject({
                statusCode: 400,
                statusMessage: INVALID,
            })
            expect(state.enqueued).toHaveLength(0)
            expect(userDoc.demoNestingUsed).toBe(0)
        })

        it('projet local, sheetCount négatif -> 400, rien consommé', async () => {
            state.config = { public: { localComputeEnabled: true, localImportEnabled: true } }
            const userDoc = freeUser()
            state.db = fakeDb({
                users: [userDoc],
                projects: [{ slug: 'p1', ownerId: 'u1', local: true }],
                user_dxf_files: [],
            })
            const body = {
                files: [{ slug: 'f-aabbccddeeff.dxf', count: 4 }],
                params: { width: 3000, height: 1500, sheetCount: -3, space: 2 },
            }
            await expect(nestHandler(ev('u1', 'p1', body))).rejects.toMatchObject({
                statusCode: 400,
                statusMessage: INVALID,
            })
            expect(state.enqueued).toHaveLength(0)
            expect(userDoc.freeNestingUsed).toBe(0)
        })

        it('sheetCount absent -> défaut historique 1, job créé (inchangé)', async () => {
            const userDoc = freeUser()
            state.db = baseDb([userDoc])
            await nestHandler(ev('u1', 'p1', legacy({ sheetCount: undefined })))
            expect(state.enqueued).toHaveLength(1)
            expect(state.enqueued[0].params.sheetCount).toBe(1)
        })
    })

    describe('ancien format, dimensions en chaîne -> enregistrées en nombres contrôlés', () => {
        const legacyBody = (files) => ({
            files,
            params: { width: '3000', height: '1500.5', sheetCount: 2, space: 2 },
        })

        it('Free, projet cloud', async () => {
            state.db = baseDb([freeUser()])
            await nestHandler(ev('u1', 'p1', legacyBody([{ slug: 'f1', count: 10 }])))
            expect(state.enqueued).toHaveLength(1)
            expect(state.enqueued[0].params.width).toBe(3000)
            expect(state.enqueued[0].params.height).toBe(1500.5)
            expect(state.enqueued[0].params.sheetCount).toBe(2)
        })

        it('démo', async () => {
            state.db = demoDb(freeUser({ demoNestingUsed: 0, demoNestingPeriod: currentPeriod() }))
            await nestHandler(ev('u1', 'demo', legacyBody([{ slug: 'f1', count: 10 }])))
            expect(state.enqueued).toHaveLength(1)
            expect(state.enqueued[0].params.width).toBe(3000)
            expect(state.enqueued[0].params.height).toBe(1500.5)
        })

        it('projet local', async () => {
            state.config = { public: { localComputeEnabled: true, localImportEnabled: true } }
            state.db = fakeDb({
                users: [freeUser()],
                projects: [{ slug: 'p1', ownerId: 'u1', local: true }],
                user_dxf_files: [],
            })
            await nestHandler(ev('u1', 'p1', legacyBody([{ slug: 'f-aabbccddeeff.dxf', count: 4 }])))
            expect(state.enqueued).toHaveLength(1)
            expect(state.enqueued[0].params.width).toBe(3000)
            expect(state.enqueued[0].params.height).toBe(1500.5)
        })
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
