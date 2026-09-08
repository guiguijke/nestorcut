import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// C1-c — PATCH /api/user/preferences : l'horloge newsletterAsked.

const state = vi.hoisted(() => ({ db: null }))
globalThis.useRuntimeConfig = () => ({ public: {} })

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))
vi.mock('~~/server/features/listmonk/subscribe', () => ({
    subscribeToNewsletter: vi.fn().mockResolvedValue(),
    unsubscribeFromNewsletter: vi.fn().mockResolvedValue(),
}))

import preferencesHandler from '~~/server/api/user/preferences.patch.js'
import { fakeDb } from './helpers/fakeMongo'

const ev = (body) => ({
    _params: {},
    method: 'PATCH',
    _requestBody: JSON.stringify(body ?? {}),
    _body: body ?? {},
    context: { auth: { userId: 'local:u@x.y' } },
    node: { req: { headers: { 'user-agent': 'vitest' }, res: {} } },
})

beforeEach(() => {
    state.db = fakeDb({
        users: [{ id: 'local:u@x.y', email: 'u@x.y', name: 'U', newsletterOptIn: null }],
    })
})

const lastUpdate = () => {
    const calls = state.db.collection('users').calls.updateOne
    return calls[calls.length - 1]
}

describe('PATCH preferences — horloge newsletter (C1-c)', () => {
    it('newsletterAsked: true pose SEULEMENT la date — optIn intact', async () => {
        const res = await preferencesHandler(ev({ newsletterAsked: true }))

        expect(res.ok).toBe(true)
        const { filter, update } = lastUpdate()
        expect(filter).toEqual({ id: 'local:u@x.y' })
        expect(Object.keys(update.$set)).toEqual(['newsletterAskedAt'])
        expect(update.$set.newsletterAskedAt).toBeInstanceOf(Date)
    })

    it('newsletterOptIn: false pose optIn + optInAt + askedAt (une réponse vaut une demande)', async () => {
        await preferencesHandler(ev({ newsletterOptIn: false }))

        const { update } = lastUpdate()
        expect(update.$set.newsletterOptIn).toBe(false)
        expect(update.$set.newsletterOptInAt).toBeInstanceOf(Date)
        expect(update.$set.newsletterAskedAt).toBeInstanceOf(Date)
    })

    it('newsletterOptIn: true pose les trois également', async () => {
        await preferencesHandler(ev({ newsletterOptIn: true }))

        const { update } = lastUpdate()
        expect(update.$set.newsletterOptIn).toBe(true)
        expect(update.$set.newsletterAskedAt).toBeInstanceOf(Date)
    })
})
