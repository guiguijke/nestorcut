import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// N-4 / M-3 : la boucle de sync d'abonnements survit à une erreur Mongo.
// N-11 / N-11b / M-2 : les flux SSE ne poussent plus après fermeture et
// nettoient leurs timers sur erreur initiale.

const state = vi.hoisted(() => ({ db: null, results: null, streams: [] }))

vi.mock('~~/server/db/mongo', () => ({ connectDB: async () => state.db }))
vi.mock('../db/mongo', () => ({ connectDB: async () => state.db }))
vi.mock('../features/payment/stripe', () => ({
    getCheckoutSession: vi.fn(),
    getSubscription: vi.fn(),
    mapSubscription: vi.fn(),
}))
vi.mock('~~/server/features/results/resultcontroller', () => ({
    getResults: (...args) => state.results(...args),
}))
vi.mock('~~/server/utils/expireOrphanAwaitingLocal', () => ({
    expireOrphanAwaitingLocalForEvent: vi.fn(async () => {}),
}))

globalThis.defineNitroPlugin = globalThis.defineNitroPlugin || ((fn) => fn)
globalThis.setResponseStatus = globalThis.setResponseStatus || (() => {})
globalThis.createEventStream = () => {
    let onClosed = () => {}
    const stream = {
        pushed: [],
        closedCalls: 0,
        push: vi.fn(async (msg) => { stream.pushed.push(msg) }),
        onClosed: (cb) => { onClosed = cb },
        close: vi.fn(async () => { stream.closedCalls++ }),
        send: vi.fn(async () => 'sent'),
        fireClosed: () => onClosed(),
    }
    state.streams.push(stream)
    return stream
}

const { runSyncIteration } = await import('../plugins/7_subscription_sync.js')
const { default: resultsHandler } = await import('~~/server/api/results.get.js')
const { default: projectResultsHandler } = await import('~~/server/api/project/[slug]/results.get.js')
const { default: supportHandler } = await import('~~/server/api/support/messages/index.get.js')

const evt = { context: { auth: { userId: 'u1' } }, _params: { slug: 'p1' } }

describe('7_subscription_sync - runSyncIteration (N-4 / M-3)', () => {
    it('une erreur Mongo ne rejette pas : retourne false (la boucle attend IDLE_DELAY_MS)', async () => {
        const db = {
            collection: () => ({
                updateMany: async () => { throw new Error('mongo down') },
                findOneAndUpdate: async () => { throw new Error('mongo down') },
                findOne: async () => { throw new Error('mongo down') },
            }),
        }
        await expect(runSyncIteration(db)).resolves.toBe(false)
    })

    it('remet en file les checkouts processing orphelins à chaque itération', async () => {
        const calls = []
        const db = {
            collection: (name) => ({
                updateMany: async (filter, update) => { calls.push({ name, filter, update }); return {} },
                findOneAndUpdate: async () => null,
                findOne: async () => null,
            }),
        }
        await expect(runSyncIteration(db)).resolves.toBe(false)
        expect(calls[0].name).toBe('subscription_checkouts')
        expect(calls[0].filter.status).toBe('processing')
        expect(calls[0].filter.updatedAt.$lt).toBeInstanceOf(Date)
        expect(calls[0].update.$set.status).toBe('created')
    })

    it('un updateOne du catch qui échoue ne tue pas la boucle', async () => {
        const { getCheckoutSession } = await import('../features/payment/stripe')
        getCheckoutSession.mockRejectedValueOnce(new Error('stripe down'))
        const db = {
            collection: (name) => ({
                updateMany: async () => ({}),
                findOneAndUpdate: async () => (name === 'subscription_checkouts' ? { _id: 1, checkoutId: 'c', userId: 'u' } : null),
                updateOne: async () => { throw new Error('mongo down') },
                findOne: async () => null,
            }),
        }
        await expect(runSyncIteration(db)).resolves.toBe(false)
    })
})

describe('SSE - pas de push après fermeture, timers nettoyés', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        state.streams.length = 0
    })
    afterEach(() => vi.useRealTimers())

    const itemsOf = (n) => ({ items: [{ slug: 'a', isInProgress: n }] })

    for (const [label, handler] of [['results', resultsHandler], ['project results', projectResultsHandler]]) {
        it(`${label} : plus aucun push ni lecture après onClosed`, async () => {
            const getResults = vi.fn(async () => itemsOf(false))
            state.results = getResults
            await handler(evt)
            const stream = state.streams[0]
            expect(stream.pushed).toHaveLength(1)
            getResults.mockImplementation(async () => itemsOf(true))
            await vi.advanceTimersByTimeAsync(1000)
            expect(stream.pushed).toHaveLength(2)
            await stream.fireClosed()
            const reads = getResults.mock.calls.length
            await vi.advanceTimersByTimeAsync(60000)
            expect(stream.pushed).toHaveLength(2)
            expect(getResults.mock.calls.length).toBe(reads)
        })

        it(`${label} : fermeture pendant une lecture en vol, aucun push`, async () => {
            let release
            state.results = vi.fn(async () => itemsOf(false))
            await handler(evt)
            const stream = state.streams[0]
            state.results = () => new Promise((r) => { release = () => r(itemsOf(true)) })
            await vi.advanceTimersByTimeAsync(1000)
            await stream.fireClosed()
            release()
            await vi.advanceTimersByTimeAsync(10)
            expect(stream.pushed).toHaveLength(1)
        })

        it(`${label} : une erreur dans le poll ne produit pas de rejet non géré`, async () => {
            state.results = vi.fn(async () => itemsOf(false))
            await handler(evt)
            state.results = async () => { throw new Error('boom') }
            await vi.advanceTimersByTimeAsync(3000)
            expect(state.streams[0].pushed).toHaveLength(1)
        })

        it(`${label} : lecture initiale en échec, flux fermé, erreur relancée, aucun timer`, async () => {
            state.results = async () => { throw new Error('init fail') }
            await expect(handler(evt)).rejects.toThrow('init fail')
            expect(state.streams[0].closedCalls).toBe(1)
            expect(vi.getTimerCount()).toBe(0)
        })
    }

    it('support : pas de push après fermeture, erreur initiale nettoyée', async () => {
        let docs = []
        const cursor = () => ({ sort() { return this }, project() { return this }, toArray: async () => docs })
        state.db = { collection: () => ({ find: cursor }) }
        await supportHandler(evt)
        const stream = state.streams[0]
        docs = [{ message: 'hi', timestamp: new Date(5) }]
        await vi.advanceTimersByTimeAsync(1000)
        expect(stream.pushed).toHaveLength(1)
        await stream.fireClosed()
        docs = [{ message: 'late', timestamp: new Date(9) }]
        await vi.advanceTimersByTimeAsync(60000)
        expect(stream.pushed).toHaveLength(1)

        state.db = { collection: () => ({ find: () => { throw new Error('mongo down') } }) }
        await expect(supportHandler(evt)).rejects.toThrow('mongo down')
        expect(state.streams[1].closedCalls).toBe(1)
        expect(vi.getTimerCount()).toBe(0)
    })
})
