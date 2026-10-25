import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// N-14 : course concurrent_limit — le comptage pré-insertion et l'insertion ne
// sont pas atomiques. Le contrôle post-insertion départage par _id.

const state = vi.hoisted(() => ({ db: null, ours: 'b', foreign: 'a' }))

vi.mock('~~/server/db/mongo', () => ({ connectDB: async () => state.db }))
vi.mock('~~/server/core/project/service', () => ({
    // Simule la course : un job concurrent du même propriétaire est inséré
    // pendant que le nôtre l'est (après notre comptage, qui ne voyait rien).
    enqueueNestingJob: vi.fn(async (_domain, payload) => {
        const jobs = state.db.collection('nesting_jobs')
        await jobs.insertOne({ _id: state.foreign, slug: 'job-foreign', ownerId: 'u1', status: 'pending', enqueueToken: 'other' })
        await jobs.insertOne({
            _id: state.ours,
            slug: 'job-ours',
            ownerId: 'u1',
            status: 'pending',
            ...payload.extraFields,
            charge: payload.charge,
        })
        return { slug: 'job-ours' }
    }),
}))
vi.mock('~~/server/tracking/add', () => ({ trackEvent: vi.fn() }))
vi.mock('~~/server/features/payment/stripe', () => ({
    ACTIVE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
    getSubscription: vi.fn(),
    mapSubscription: vi.fn(),
}))

import nestHandler from '~~/server/api/project/[slug]/nest.post.js'
import { fakeDb } from './helpers/fakeMongo'

const ev = (userId, slug, body) => ({
    context: { auth: { userId } },
    _params: { slug },
    method: 'POST',
    _requestBody: JSON.stringify(body),
    node: { req: { headers: { 'content-type': 'application/json' } }, res: {} },
})
const body = () => ({
    files: [{ slug: 'f1', count: 10 }],
    params: { sheets: [{ width: 3000, height: 1500, count: 1 }], space: 2 },
})
const period = () => new Date().toISOString().slice(0, 7)

function setup() {
    const user = { id: 'u1', provider: 'google', freeNestingUsed: 0, freeNestingPeriod: period() }
    state.db = fakeDb({
        users: [user],
        projects: [{ slug: 'p1', ownerId: 'u1' }],
        user_dxf_files: [{ slug: 'f1', name: 'part.dxf' }],
        subscription_plan: [{ priceId: 'price_std', tier: 'standard' }],
        nesting_jobs: [],
    })
    return user
}

beforeEach(() => {
    state.ours = 'b'
    state.foreign = 'a'
})

describe('nest.post — course concurrent_limit (N-14)', () => {
    it('le job inséré en second est annulé, 409 et quota intact', async () => {
        const user = setup()
        await expect(nestHandler(ev('u1', 'p1', body()))).rejects.toMatchObject({
            statusCode: 409,
            statusMessage: 'concurrent_limit',
        })
        const left = await state.db.collection('nesting_jobs').find({ ownerId: 'u1' }).toArray()
        expect(left.map((j) => j._id)).toEqual(['a'])
        expect(user.freeNestingUsed).toBe(0)
    })

    it('le job inséré en premier passe : une seule requête gagne, quota consommé', async () => {
        const user = setup()
        state.ours = 'a'
        state.foreign = 'b'
        await expect(nestHandler(ev('u1', 'p1', body()))).resolves.toBeTruthy()
        const left = await state.db.collection('nesting_jobs').find({ ownerId: 'u1' }).toArray()
        expect(left).toHaveLength(2) // le perdant (b) s'annule via SA propre requête
        expect(user.freeNestingUsed).toBe(1)
    })
})
