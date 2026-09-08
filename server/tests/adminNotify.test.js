import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// C1-b — le marqueur adminNotifiedAt : posé après un envoi Resend réussi,
// jamais posé sur échec (le digest reprendra l'inscrit).

const state = vi.hoisted(() => ({
    db: null,
    config: { adminNotifyEmail: 'admin@x.y', resendToken: 'tok', resendFrom: 'no-reply@x.y' },
    fetchMock: null,
}))
globalThis.useRuntimeConfig = () => state.config
globalThis.$fetch = (...args) => state.fetchMock(...args)

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))

import { notifyAdminNewUser } from '~~/server/features/notification/adminNotify'
import { fakeDb } from './helpers/fakeMongo'

const ev = () => ({
    node: { req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } } },
})

const userDoc = () => ({ id: 'local:u@x.y', email: 'u@x.y', name: 'U', provider: 'local' })

const markerCalls = () =>
    state.db.collection('users').calls.updateOne.filter((c) => c.update?.$set && 'adminNotifiedAt' in c.update.$set)

beforeEach(() => {
    state.db = fakeDb({ users: [userDoc()] })
    state.fetchMock = vi.fn(async () => ({ id: 'resend-1' }))
})

describe('notifyAdminNewUser — marqueur adminNotifiedAt (D4)', () => {
    it('pose le marqueur après un envoi réussi', async () => {
        await notifyAdminNewUser(ev(), { id: 'local:u@x.y', email: 'u@x.y', name: 'U', provider: 'local' })

        expect(state.fetchMock).toHaveBeenCalledTimes(1)
        const calls = markerCalls()
        expect(calls).toHaveLength(1)
        expect(calls[0].filter).toEqual({ id: 'local:u@x.y' })
        expect(calls[0].update.$set.adminNotifiedAt).toBeInstanceOf(Date)
    })

    it('ne pose RIEN sur échec Resend (le digest reprendra)', async () => {
        state.fetchMock = vi.fn(async () => { throw new Error('resend down') })

        await notifyAdminNewUser(ev(), { id: 'local:u@x.y', email: 'u@x.y', name: 'U', provider: 'local' })

        expect(state.fetchMock).toHaveBeenCalledTimes(1)
        expect(markerCalls()).toHaveLength(0)
    })

    it('sans destinataire configuré : no-op complet', async () => {
        const previous = globalThis.useRuntimeConfig
        globalThis.useRuntimeConfig = () => ({ ...state.config, adminNotifyEmail: '' })
        try {
            await notifyAdminNewUser(ev(), { id: 'local:u@x.y', email: 'u@x.y', name: 'U', provider: 'local' })
            expect(state.fetchMock).not.toHaveBeenCalled()
            expect(markerCalls()).toHaveLength(0)
        } finally {
            globalThis.useRuntimeConfig = previous
        }
    })
})
