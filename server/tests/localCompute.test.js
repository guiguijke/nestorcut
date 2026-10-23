import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// The mocked db + runtime config are swapped per test through this hoisted state.
const state = vi.hoisted(() => ({ db: null, enqueued: [], config: { public: { localComputeEnabled: false } } }))
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
import resultHandler from '~~/server/api/results/[slug]/local-result.post.js'
import { expireStaleTakenAwaitingLocal } from '~~/server/utils/expireOrphanAwaitingLocal'
import failHandler from '~~/server/api/results/[slug]/local-fail.post.js'
import cancelHandler from '~~/server/api/results/[slug]/cancel.post.js'
import quotaHandler from '~~/server/api/results/[slug]/local-quota.post.js'
import { BROWSER_COMPUTE, resolveComputeLocation, resolveLocalMode } from '~~/server/utils/entitlement'
import { fakeDb } from './helpers/fakeMongo'

const currentPeriod = () => new Date().toISOString().slice(0, 7)

const ev = (userId, slug, body, method = 'POST') => ({
    context: { auth: { userId } },
    _params: { slug },
    method,
    // nest.post.js uses h3's readBody (reads _requestBody); the local routes
    // use the auto-imported one (shimmed, reads _body).
    _requestBody: JSON.stringify(body ?? {}),
    _body: body ?? {},
    node: { req: { headers: { 'content-type': 'application/json' } }, res: {} },
})

const nestBody = (sheets) => ({
    files: [{ slug: 'f1', count: 10 }],
    params: { sheets: sheets.map(([w, h, c]) => ({ width: w, height: h, count: c })), space: 2 },
})

const freeUser = (overrides = {}) => ({
    id: 'u1',
    provider: 'google',
    freeNestingUsed: 0,
    freeNestingPeriod: currentPeriod(),
    ...overrides,
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

beforeEach(() => {
    state.db = null
    state.enqueued = []
    state.config = { public: { localComputeEnabled: false } }
})

describe('resolveComputeLocation (resolver, J-059)', () => {
    it('flag OFF => null (nothing written, pipeline unchanged)', () => {
        expect(resolveComputeLocation(false, true, 'free', null)).toBe(null)
        expect(resolveComputeLocation('false', false, 'free', null)).toBe(null)
    })
    it('demo => local (QA vehicle, every account)', () => {
        expect(resolveComputeLocation(true, true, 'standard', null)).toBe('local')
    })
    it('free => local ; paid => project opt-in or server', () => {
        expect(resolveComputeLocation(true, false, 'free', null)).toBe('local')
        expect(resolveComputeLocation('true', false, 'standard', {})).toBe('server')
        expect(resolveComputeLocation(true, false, 'privacy', { localCompute: true })).toBe('local')
    })
})

describe('POST nest — computeLocation written server-side (P3)', () => {
    it('flag OFF: no computeLocation, legacy profile (strictly unchanged)', async () => {
        state.db = baseDb([freeUser()])
        await nestHandler(ev('u1', 'p1', nestBody([[3000, 1500, 1]])))
        expect(state.enqueued).toHaveLength(1)
        const params = state.enqueued[0].params
        expect(params.computeLocation).toBeUndefined()
        expect(params.computeLevel).toBe('free')
        expect(params.timeBudgetSec).toBe(600)
        expect(params.walks).toBe(8)
        expect(params.vcores).toBe(1)
    })

    it('flag ON + free: local + same-quality search (600 s wall, 8 walks, 1 at a time)', async () => {
        state.config = { public: { localComputeEnabled: 'true' } }
        state.db = baseDb([freeUser()])
        await nestHandler(ev('u1', 'p1', nestBody([[3000, 1500, 1]])))
        const params = state.enqueued[0].params
        expect(params.computeLocation).toBe('local')
        expect(params.computeLevel).toBe('browser')
        expect(params.timeBudgetSec).toBe(600)
        expect(params.browser_walks).toBe(8)
        expect(params.browser_concurrency).toBe(1)
        expect(params.vcores).toBe(1)
        expect(params.directions).toHaveLength(1)
    })

    it('flag ON + demo: local regardless of tier, demo quota NOT consumed', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const userDoc = freeUser({ demoNestingUsed: 0, demoNestingPeriod: currentPeriod() })
        state.db = fakeDb({
            users: [userDoc],
            projects: [{ slug: 'demo', isDemo: true }],
            user_dxf_files: [{ slug: 'f1', name: 'marine.dxf', projectSlug: 'demo', isDemo: true }],
        })
        await nestHandler(ev('u1', 'demo', nestBody([[3000, 1500, 2]])))
        expect(state.enqueued[0].params.computeLocation).toBe('local')
        expect(state.enqueued[0].params.computeLevel).toBe('demo')
        expect(state.enqueued[0].params.timeBudgetSec).toBe(600)
        expect(state.enqueued[0].params.browser_walks).toBe(8)
        expect(state.enqueued[0].params.browser_concurrency).toBe(1)
        expect(state.enqueued[0].params.vcores).toBe(1)
        expect(state.enqueued[0].charge).toEqual({ type: 'demo', skippedQuota: true })
        expect(userDoc.demoNestingUsed).toBe(0)
    })

    it('flag ON + demo: picker sets concurrency only (search stays 8 walks)', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const body4 = nestBody([[3000, 1500, 2]])
        body4.params.demoWalks = 4
        state.db = fakeDb({
            users: [freeUser()],
            projects: [{ slug: 'demo', isDemo: true }],
            user_dxf_files: [{ slug: 'f1', name: 'marine.dxf', projectSlug: 'demo', isDemo: true }],
        })
        await nestHandler(ev('u1', 'demo', body4))
        expect(state.enqueued[0].params.browser_walks).toBe(8)
        expect(state.enqueued[0].params.browser_concurrency).toBe(4)
        expect(state.enqueued[0].params.vcores).toBe(4)

        const body8 = nestBody([[3000, 1500, 2]])
        body8.params.demoWalks = 8
        state.enqueued = []
        await nestHandler(ev('u1', 'demo', body8))
        expect(state.enqueued[0].params.browser_walks).toBe(8)
        expect(state.enqueued[0].params.browser_concurrency).toBe(8)

        const bodyBad = nestBody([[3000, 1500, 2]])
        bodyBad.params.demoWalks = 99
        state.enqueued = []
        await nestHandler(ev('u1', 'demo', bodyBad))
        expect(state.enqueued[0].params.browser_walks).toBe(8)
        expect(state.enqueued[0].params.browser_concurrency).toBe(1)
    })

    it('flag OFF + Unlimited: 8 walks de recherche, 4 vcores de concurrence', async () => {
        const day = 24 * 3600 * 1000
        state.db = baseDb([freeUser({ grantedUntil: new Date(Date.now() + day) })])
        await nestHandler(ev('u1', 'p1', nestBody([[3000, 1500, 1]])))
        const params = state.enqueued[0].params
        expect(params.computeLocation).toBeUndefined()
        expect(params.computeLevel).toBe('standard')
        expect(params.walks).toBe(8)
        expect(params.vcores).toBe(4)
        expect(params.browser_walks).toBeUndefined()
    })

    it('projet 100 % privé : le nom de fichier du body est ignoré', async () => {
        state.config = { public: { localComputeEnabled: true, localImportEnabled: true } }
        state.db = fakeDb({
            users: [freeUser()],
            projects: [{ slug: 'p1', ownerId: 'u1', local: true }],
            user_dxf_files: [],
        })
        await nestHandler(ev('u1', 'p1', {
            files: [{
                slug: 'f-aabbccddeeff.dxf',
                count: 4,
                name: 'secret-client.dxf',
                rotation: JSON.stringify([0, 90]),
            }],
            params: { sheets: [{ width: 1000, height: 2000, count: 1 }], space: 2 },
        }))
        expect(state.enqueued).toHaveLength(1)
        const meta = state.enqueued[0].fileMetadata
        expect(meta).toEqual([{
            slug: 'f-aabbccddeeff.dxf',
            count: 4,
            rotations: [0, 90],
        }])
        expect(JSON.stringify(state.enqueued[0])).not.toContain('secret-client')
        expect(state.enqueued[0].initialStatus).toBe('awaiting_local')
        expect(state.enqueued[0].skipVaultGate).toBe(true)
    })

    it('flag ON + paid serveur: même 8 walks, concurrence = vcores du tier', async () => {
        const day = 24 * 3600 * 1000
        state.config = { public: { localComputeEnabled: true } }
        state.db = baseDb([freeUser({ grantedUntil: new Date(Date.now() + day) })])
        await nestHandler(ev('u1', 'p1', nestBody([[3000, 1500, 1]])))
        const params = state.enqueued[0].params
        expect(params.computeLocation).toBe('server')
        expect(params.walks).toBe(8)
        expect(params.vcores).toBe(4)
    })
})

describe('local-payload / local-result / local-fail routes (flag-gated)', () => {
    const localJob = (overrides = {}) => ({
        slug: 'job-1',
        ownerId: 'u1',
        projectSlug: 'p1',
        status: 'awaiting_local',
        requested: 10,
        params: { sheets: [{ width: 3000, height: 1500, count: 1 }] },
        charge: { type: 'free' },
        localPayload: {
            problem: 'bpp',
            instance: { name: 'x', items: [], bins: [] },
            // Mongo BSON Int64 surfaces as a Long — mimic its toString().
            engineConfig: { time_budget_sec: 13, prng_seed: { toString: () => '4122680510047324256' } },
        },
        ...overrides,
    })

    it('local-payload: 404 when flag OFF, 409 when not awaiting, 200 with seed as string', async () => {
        state.db = fakeDb({ nesting_jobs: [localJob()] })
        await expect(payloadHandler(ev('u1', 'job-1', null, 'GET'))).rejects.toMatchObject({ statusCode: 404 })

        state.config = { public: { localComputeEnabled: 'true' } }
        const res = await payloadHandler(ev('u1', 'job-1', null, 'GET'))
        expect(res.problem).toBe('bpp')
        expect(res.engineConfig.prng_seed).toBe('4122680510047324256') // Int64 serialized (AGENTS #16)

        state.db = fakeDb({ nesting_jobs: [localJob({
            localPayload: undefined,
            localConfig: { timeBudgetSec: 13, vcores: 1 },
            files: [{ slug: 'f-aabbccddeeff.dxf', count: 3, rotations: [0, 90], simpleName: 'secret-client' }],
        })] })
        const clientBuilt = await payloadHandler(ev('u1', 'job-1', null, 'GET'))
        expect(clientBuilt.mode).toBe('client-built')
        expect(clientBuilt.files[0]).toEqual({
            slug: 'f-aabbccddeeff.dxf',
            count: 3,
            rotations: [0, 90],
        })
        expect(clientBuilt.files[0].name).toBeUndefined()
        expect(JSON.stringify(clientBuilt)).not.toContain('secret-client')

        state.db = fakeDb({ nesting_jobs: [localJob({ status: 'done', localPayload: null })] })
        await expect(payloadHandler(ev('u1', 'job-1', null, 'GET'))).rejects.toMatchObject({ statusCode: 409 })
    })

    it('local-result: marks done with normalized alternatives, payload unset, charge NOT refunded', async () => {
        const jobDoc = localJob()
        state.config = { public: { localComputeEnabled: true } }
        state.db = fakeDb({ nesting_jobs: [jobDoc] })
        const alternatives = [{
            rank: 0,
            seed: 42,
            bias: 'left',
            iterations: 25,
            solution: {
                cost: 2,
                density: 0.375,
                layouts: [{ placed_items: [{ item_id: 0, transformation: { rotation: 90, translation: [10, 20] } }] }],
            },
        }]
        const res = await resultHandler(ev('u1', 'job-1', { alternatives }))
        expect(res.ok).toBe(true)
        expect(jobDoc.status).toBe('done')
        expect(jobDoc.alternatives[0].strategy).toBe('left')
        expect(jobDoc.alternatives[0].layoutCount).toBe(1)
        expect(jobDoc.alternatives[0].metrics.cost).toBe(2)
        expect(jobDoc.liveLayout.stage).toBe('final')
        expect(jobDoc.liveLayout.items[0]).toEqual([0, 0, 90, 10, 20])
        expect(jobDoc.localPayload).toBeUndefined()
        expect(jobDoc.charge.refunded).toBeUndefined()
    })

    it('local-fail: refunds the free slot inline (mirror refund.py), marks error', async () => {
        const userDoc = freeUser({ freeNestingUsed: 3 })
        const jobDoc = localJob()
        state.config = { public: { localComputeEnabled: true } }
        state.db = fakeDb({ nesting_jobs: [jobDoc], users: [userDoc] })
        const res = await failHandler(ev('u1', 'job-1', { error: 'memory_cap' }))
        expect(res.ok).toBe(true)
        expect(jobDoc.status).toBe('error')
        expect(userDoc.freeNestingUsed).toBe(2) // refunded
        expect(jobDoc.charge.refunded).toBe(true)
    })

    it('local-fail: stores a non-empty stable reason in error + errorCode (and keeps information)', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const j1 = localJob()
        state.db = fakeDb({ nesting_jobs: [j1], users: [freeUser({ freeNestingUsed: 1 })] })
        await failHandler(ev('u1', 'job-1', { error: 'payload_build', detail: 'local_geometry_missing' }))
        expect(j1.error).toBe('payload_build: local_geometry_missing')
        expect(j1.errorCode).toBe('payload_build')
        expect(j1.information).toBe('payload_build')

        // Texte moteur libre : code générique, texte brut conservé.
        const j2 = localJob({ slug: 'job-2' })
        state.db = fakeDb({ nesting_jobs: [j2], users: [freeUser({ freeNestingUsed: 1 })] })
        await failHandler(ev('u1', 'job-2', { error: 'Rayon panic: strip-width is running away' }))
        expect(j2.error).toBe('Rayon panic: strip-width is running away')
        expect(j2.errorCode).toBe('engine_error')

        // Corps vide : jamais de raison vide.
        const j3 = localJob({ slug: 'job-3' })
        state.db = fakeDb({ nesting_jobs: [j3], users: [freeUser({ freeNestingUsed: 1 })] })
        await failHandler(ev('u1', 'job-3', {}))
        expect(j3.status).toBe('error')
        expect(j3.error).toBe('local_unknown')
        expect(j3.errorCode).toBe('local_unknown')
    })

    it('local-fail: drops free-text detail (privacy: categories only, never file names)', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const j = localJob()
        state.db = fakeDb({ nesting_jobs: [j], users: [freeUser({ freeNestingUsed: 1 })] })
        await failHandler(ev('u1', 'job-1', { error: 'payload_build', detail: "Cannot read 'client-secret-plan.dxf'" }))
        expect(j.error).toBe('payload_build')
        expect(JSON.stringify(j)).not.toContain('client-secret')

        // errorCode inconnu -> catégorie générique.
        const j2 = localJob({ slug: 'job-2' })
        state.db = fakeDb({ nesting_jobs: [j2], users: [freeUser({ freeNestingUsed: 1 })] })
        await failHandler(ev('u1', 'job-2', { error: 'my_private_file_v2' }))
        expect(j2.errorCode).toBe('engine_error')
    })

    it('local-fail: job already done -> 409, no refund, status stays done', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const userDoc = freeUser({ freeNestingUsed: 3 })
        const done = localJob({ status: 'done' })
        state.db = fakeDb({ nesting_jobs: [done], users: [userDoc] })
        await expect(failHandler(ev('u1', 'job-1', { error: 'crash' }))).rejects.toMatchObject({ statusCode: 409 })
        expect(done.status).toBe('done')
        expect(done.charge.refunded).toBeUndefined()
        expect(userDoc.freeNestingUsed).toBe(3)
    })

    it('local-fail racing the stale sweeper: one single refund', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const userDoc = freeUser({ freeNestingUsed: 3 })
        const job = localJob({ takenAt: new Date(Date.now() - 3 * 3600_000) })
        state.db = fakeDb({ nesting_jobs: [job], users: [userDoc] })
        const [sweep, fail] = await Promise.allSettled([
            expireStaleTakenAwaitingLocal(state.db, 'u1', { staleMin: 120 }),
            failHandler(ev('u1', 'job-1', { error: 'crash' })),
        ])
        expect(sweep.status).toBe('fulfilled')
        expect(userDoc.freeNestingUsed).toBe(2) // jamais 1
        expect(job.status).toBe('error')
        expect(job.charge.refunded).toBe(true)
        // Un seul des deux a gagné la transition.
        expect(fail.status === 'rejected' ? sweep.value.length : 1 - sweep.value.length).toBe(1)
    })

    it('local-fail: sweeper wins between the read and the write -> 409, no second refund', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const userDoc = freeUser({ freeNestingUsed: 3 })
        const job = localJob({ takenAt: new Date(Date.now() - 3 * 3600_000) })
        const inner = fakeDb({ nesting_jobs: [job], users: [userDoc] })
        let swept = false
        state.db = {
            collection: (name) => {
                const col = inner.collection(name)
                if (name !== 'nesting_jobs') return col
                return {
                    ...col,
                    // Instantané lu AVANT que le sweeper ne bascule le job.
                    findOne: async (f) => {
                        const live = await col.findOne(f)
                        const snap = { ...live, charge: { ...live.charge } }
                        if (!swept) {
                            swept = true
                            await expireStaleTakenAwaitingLocal(inner, 'u1', { staleMin: 120 })
                        }
                        return snap
                    },
                }
            },
        }
        await expect(failHandler(ev('u1', 'job-1', { error: 'crash' }))).rejects.toMatchObject({ statusCode: 409 })
        expect(userDoc.freeNestingUsed).toBe(2)
        expect(job.errorCode).toBe('local_interrupted')
    })

    it('local-fail: demo charge refunds the demo slot ; grant refunds nothing', async () => {
        const userDoc = freeUser({ demoNestingUsed: 4 })
        const demoJob = localJob({ projectSlug: 'demo', charge: { type: 'demo' } })
        state.config = { public: { localComputeEnabled: true } }
        state.db = fakeDb({ nesting_jobs: [demoJob], users: [userDoc] })
        await failHandler(ev('u1', 'job-1', { error: 'boom' }))
        expect(userDoc.demoNestingUsed).toBe(3)

        const grantJob = localJob({ slug: 'job-2', ownerId: 'u2', charge: { type: 'grant' } })
        const userDoc2 = freeUser({ id: 'u2', freeNestingUsed: 5 })
        state.db = fakeDb({ nesting_jobs: [grantJob], users: [userDoc2] })
        await failHandler(ev('u2', 'job-2', { error: 'boom' }))
        expect(userDoc2.freeNestingUsed).toBe(5)
        expect(grantJob.charge.refunded).toBe(true)
    })

    it('routes 404 for other users\u2019 jobs (never reveal existence)', async () => {
        state.config = { public: { localComputeEnabled: true } }
        state.db = fakeDb({ nesting_jobs: [localJob({ ownerId: 'someone-else' })] })
        await expect(payloadHandler(ev('u1', 'job-1', null, 'GET'))).rejects.toMatchObject({ statusCode: 404 })
        await expect(resultHandler(ev('u1', 'job-1', { alternatives: [{}] }))).rejects.toMatchObject({ statusCode: 404 })
    })

    it('owner-only even for demo jobs: no writing to another user\u2019s demo job (review fix)', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const someoneElsesDemoJob = localJob({ ownerId: 'someone-else', projectSlug: 'demo' })
        state.db = fakeDb({ nesting_jobs: [someoneElsesDemoJob] })
        await expect(payloadHandler(ev('u1', 'job-1', null, 'GET'))).rejects.toMatchObject({ statusCode: 404 })
        await expect(resultHandler(ev('u1', 'job-1', { alternatives: [{}] }))).rejects.toMatchObject({ statusCode: 404 })
        await expect(failHandler(ev('u1', 'job-1', { error: 'x' }))).rejects.toMatchObject({ statusCode: 404 })
        expect(someoneElsesDemoJob.status).toBe('awaiting_local')
    })
})

describe('resolveLocalMode (PR5, J-078)', () => {
    it('DWG => serveur, non négociable', () => {
        expect(resolveLocalMode('free', true, 'local')).toEqual({ mode: 'server', canToggle: false, reason: 'dwg' })
        expect(resolveLocalMode('privacy', true, 'local')).toEqual({ mode: 'server', canToggle: false, reason: 'dwg' })
    })
    it('Free => local forcé (pas de toggle)', () => {
        expect(resolveLocalMode('free', false, 'server')).toEqual({ mode: 'local', canToggle: false, reason: 'free' })
    })
    it('payants => choix, défaut serveur', () => {
        expect(resolveLocalMode('standard', false)).toEqual({ mode: 'server', canToggle: true, reason: 'choice' })
        expect(resolveLocalMode('privacy', false, 'local')).toEqual({ mode: 'local', canToggle: true, reason: 'choice' })
    })
})

describe('POST local-quota — comptabilité seule, zéro géométrie (PR5, J-077)', () => {
    const localJob = (overrides = {}) => ({
        slug: 'job-1',
        ownerId: 'u1',
        projectSlug: 'p1',
        status: 'awaiting_local',
        requested: 10,
        charge: { type: 'free' },
        ...overrides,
    })

    it('succès: done avec scalaires bornés, quota NON remboursé, aucune géométrie stockée', async () => {
        const userDoc = freeUser({ freeNestingUsed: 2 })
        const jobDoc = localJob()
        state.config = { public: { localComputeEnabled: true } }
        state.db = fakeDb({ nesting_jobs: [jobDoc], users: [userDoc] })
        const res = await quotaHandler(ev('u1', 'job-1', { placed: 10, layoutCount: 2, density: 0.4 }))
        expect(res.ok).toBe(true)
        expect(jobDoc.status).toBe('done')
        expect(jobDoc.placed).toBe(10)
        expect(jobDoc.layoutCount).toBe(2)
        expect(jobDoc.density).toBe(0.4)
        expect(jobDoc.localOnly).toBe(true)
        expect(userDoc.freeNestingUsed).toBe(2) // succès = quota consommé, pas de refund
        expect(jobDoc.alternatives).toBeUndefined() // aucune géométrie côté serveur
    })

    it('borne les scalaires et ignore le reste du corps', async () => {
        const jobDoc = localJob()
        state.config = { public: { localComputeEnabled: true } }
        state.db = fakeDb({ nesting_jobs: [jobDoc], users: [freeUser()] })
        await quotaHandler(ev('u1', 'job-1', { placed: 99999999, density: 7, junk: 'x', alternatives: [{}] }))
        expect(jobDoc.placed).toBe(10_000_000) // borné
        expect(jobDoc.density).toBe(1) // clampé [0,1]
        expect(jobDoc.alternatives).toBeUndefined() // corps ignoré
    })

    it('409 si pas awaiting_local, 404 pour un autre utilisateur, 404 flag OFF', async () => {
        state.config = { public: { localComputeEnabled: true } }
        state.db = fakeDb({ nesting_jobs: [localJob({ status: 'done' })], users: [freeUser()] })
        await expect(quotaHandler(ev('u1', 'job-1', {}))).rejects.toMatchObject({ statusCode: 409 })

        state.db = fakeDb({ nesting_jobs: [localJob({ ownerId: 'other' })], users: [freeUser()] })
        await expect(quotaHandler(ev('u1', 'job-1', {}))).rejects.toMatchObject({ statusCode: 404 })

        state.config = { public: { localComputeEnabled: false } }
        state.db = fakeDb({ nesting_jobs: [localJob()], users: [freeUser()] })
        await expect(quotaHandler(ev('u1', 'job-1', {}))).rejects.toMatchObject({ statusCode: 404 })
    })
})

describe('cancel / local-result — transitions atomiques (courses de remboursement)', () => {
    const localJob = (overrides = {}) => ({
        slug: 'job-1',
        ownerId: 'u1',
        projectSlug: 'p1',
        status: 'awaiting_local',
        requested: 10,
        params: { sheets: [{ width: 3000, height: 1500, count: 1 }] },
        charge: { type: 'free' },
        ...overrides,
    })
    const alts = { alternatives: [{ solution: { layouts: [{ placed_items: [] }], density: 0.5 } }] }

    it('cancel awaiting_local: cancelled + un seul remboursement', async () => {
        const userDoc = freeUser({ freeNestingUsed: 3 })
        const job = localJob()
        state.db = fakeDb({ nesting_jobs: [job], users: [userDoc] })
        const res = await cancelHandler(ev('u1', 'job-1'))
        expect(res).toEqual({ ok: true, status: 'cancelled' })
        expect(job.status).toBe('cancelled')
        expect(job.charge.refunded).toBe(true)
        expect(userDoc.freeNestingUsed).toBe(2)
    })

    it('cancel vs local-fail concurrents: un seul remboursement, statut cohérent', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const userDoc = freeUser({ freeNestingUsed: 3 })
        const job = localJob()
        state.db = fakeDb({ nesting_jobs: [job], users: [userDoc] })
        const [c, f] = await Promise.allSettled([
            cancelHandler(ev('u1', 'job-1')),
            failHandler(ev('u1', 'job-1', { error: 'crash' })),
        ])
        expect(userDoc.freeNestingUsed).toBe(2) // jamais 1
        expect(job.charge.refunded).toBe(true)
        if (f.status === 'rejected') {
            expect(f.reason.statusCode).toBe(409)
            expect(job.status).toBe('cancelled')
        } else {
            expect(c.value.ok).toBe(false)
            expect(job.status).toBe('error')
        }
    })

    it('cancel: le job passe en error entre la lecture et l\u2019écriture -> ok:false, pas de double refund, error conservé', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const userDoc = freeUser({ freeNestingUsed: 3 })
        const job = localJob()
        const inner = fakeDb({ nesting_jobs: [job], users: [userDoc] })
        let failed = false
        state.db = {
            collection: (name) => {
                const col = inner.collection(name)
                if (name !== 'nesting_jobs') return col
                return {
                    ...col,
                    findOne: async (f) => {
                        const snap = { ...(await col.findOne(f)) }
                        if (!failed) {
                            failed = true
                            snap.charge = { ...snap.charge }
                            await failHandler(ev('u1', 'job-1', { error: 'crash' }))
                        }
                        return snap
                    },
                }
            },
        }
        const res = await cancelHandler(ev('u1', 'job-1'))
        expect(res.ok).toBe(false)
        expect(job.status).toBe('error')
        expect(userDoc.freeNestingUsed).toBe(2)
    })

    it('cancel sur un job done: ok:false, aucun remboursement, reste done', async () => {
        const userDoc = freeUser({ freeNestingUsed: 3 })
        const job = localJob({ status: 'done' })
        state.db = fakeDb({ nesting_jobs: [job], users: [userDoc] })
        const res = await cancelHandler(ev('u1', 'job-1'))
        expect(res).toEqual({ ok: false, status: 'done' })
        expect(job.status).toBe('done')
        expect(userDoc.freeNestingUsed).toBe(3)
    })

    it('cancel vs local-result: le done livré n\u2019est pas écrasé ni remboursé', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const userDoc = freeUser({ freeNestingUsed: 3 })
        const job = localJob()
        state.db = fakeDb({ nesting_jobs: [job], users: [userDoc] })
        await resultHandler(ev('u1', 'job-1', alts))
        const res = await cancelHandler(ev('u1', 'job-1'))
        expect(res.ok).toBe(false)
        expect(job.status).toBe('done')
        expect(userDoc.freeNestingUsed).toBe(3)
    })

    it('local-result sur un job error/cancelled: 409, aucun écrasement', async () => {
        state.config = { public: { localComputeEnabled: true } }
        for (const status of ['error', 'cancelled']) {
            const job = localJob({ status, charge: { type: 'free', refunded: true } })
            state.db = fakeDb({ nesting_jobs: [job], users: [freeUser()] })
            await expect(resultHandler(ev('u1', 'job-1', alts))).rejects.toMatchObject({ statusCode: 409 })
            expect(job.status).toBe(status)
            expect(job.alternatives).toBeUndefined()
        }
    })

    it('local-result: le job bascule entre la lecture et l\u2019écriture -> 409, rien stocké', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const job = localJob()
        const inner = fakeDb({ nesting_jobs: [job], users: [freeUser({ freeNestingUsed: 3 })] })
        let failed = false
        state.db = {
            collection: (name) => {
                const col = inner.collection(name)
                if (name !== 'nesting_jobs') return col
                return {
                    ...col,
                    findOne: async (f) => {
                        const snap = { ...(await col.findOne(f)) }
                        if (!failed) {
                            failed = true
                            await failHandler(ev('u1', 'job-1', { error: 'crash' }))
                        }
                        return snap
                    },
                }
            },
        }
        await expect(resultHandler(ev('u1', 'job-1', alts))).rejects.toMatchObject({ statusCode: 409 })
        expect(job.status).toBe('error')
        expect(job.alternatives).toBeUndefined()
    })

    it('local-result sur awaiting_local: done (chemin nominal inchangé)', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const userDoc = freeUser({ freeNestingUsed: 3 })
        const job = localJob()
        state.db = fakeDb({ nesting_jobs: [job], users: [userDoc] })
        expect(await resultHandler(ev('u1', 'job-1', alts))).toEqual({ ok: true })
        expect(job.status).toBe('done')
        expect(job.alternatives).toHaveLength(1)
        expect(userDoc.freeNestingUsed).toBe(3)
    })
})

describe('local-quota — écriture conditionnelle (filtre status awaiting_local)', () => {
    const localJob = (overrides = {}) => ({
        slug: 'job-1',
        ownerId: 'u1',
        projectSlug: 'p1',
        status: 'awaiting_local',
        requested: 10,
        charge: { type: 'free' },
        ...overrides,
    })

    it('awaiting_local: done avec placed/layoutCount/density, quota NON remboursé, filtre conditionnel', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const userDoc = freeUser({ freeNestingUsed: 2 })
        const job = localJob()
        state.db = fakeDb({ nesting_jobs: [job], users: [userDoc] })
        const res = await quotaHandler(ev('u1', 'job-1', { placed: 10, layoutCount: 2, density: 0.4 }))
        expect(res).toEqual({ ok: true })
        expect(job.status).toBe('done')
        expect(job.placed).toBe(10)
        expect(job.layoutCount).toBe(2)
        expect(job.density).toBe(0.4)
        expect(job.finishedAt).toBeInstanceOf(Date)
        expect(userDoc.freeNestingUsed).toBe(2)
        expect(job.charge.refunded).toBeUndefined()
        expect(state.db.collection('nesting_jobs').calls.updateOne.at(-1).filter)
            .toEqual({ slug: 'job-1', ownerId: 'u1', status: 'awaiting_local' })
    })

    it('job déjà error/cancelled (remboursé) à la lecture: 409, statut et remboursement intacts, aucun done', async () => {
        state.config = { public: { localComputeEnabled: true } }
        for (const status of ['error', 'cancelled']) {
            const userDoc = freeUser({ freeNestingUsed: 2 })
            const job = localJob({ status, charge: { type: 'free', refunded: true } })
            state.db = fakeDb({ nesting_jobs: [job], users: [userDoc] })
            await expect(quotaHandler(ev('u1', 'job-1', { placed: 10 }))).rejects.toMatchObject({ statusCode: 409 })
            expect(job.status).toBe(status)
            expect(job.placed).toBeUndefined()
            expect(job.finishedAt).toBeUndefined()
            expect(userDoc.freeNestingUsed).toBe(2)
        }
    })

    it('annulé entre la lecture et l’écriture: 409, reste cancelled, rien stocké, un seul remboursement', async () => {
        state.config = { public: { localComputeEnabled: true } }
        const userDoc = freeUser({ freeNestingUsed: 3 })
        const job = localJob()
        const inner = fakeDb({ nesting_jobs: [job], users: [userDoc] })
        let cancelled = false
        state.db = {
            collection: (name) => {
                const col = inner.collection(name)
                if (name !== 'nesting_jobs') return col
                return {
                    ...col,
                    findOne: async (f) => {
                        const snap = { ...(await col.findOne(f)) }
                        if (!cancelled) {
                            cancelled = true
                            snap.charge = { ...snap.charge }
                            await cancelHandler(ev('u1', 'job-1'))
                        }
                        return snap
                    },
                }
            },
        }
        await expect(quotaHandler(ev('u1', 'job-1', { placed: 10, layoutCount: 2, density: 0.4 })))
            .rejects.toMatchObject({ statusCode: 409 })
        expect(job.status).toBe('cancelled')
        expect(job.charge.refunded).toBe(true)
        expect(job.placed).toBeUndefined()
        expect(job.layoutCount).toBeUndefined()
        expect(job.density).toBeUndefined()
        expect(job.localOnly).toBeUndefined()
        expect(userDoc.freeNestingUsed).toBe(2)
    })
})
