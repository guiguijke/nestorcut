import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// Une adresse = une méthode de connexion (décision du propriétaire,
// 2026-11-03). La connexion Google sur l'adresse d'un compte e-mail + mot de
// passe finissait en E11000 sur l'index unique `email` → 500 → « la connexion
// Google a échoué, réessayez », à chaque essai. Elle est refusée en 409
// email_taken_local, avant toute écriture.
const state = vi.hoisted(() => ({
    db: null,
    downloadAndStoreAvatar: vi.fn(),
    sendWelcomeMessage: vi.fn(),
    notifyAdminNewUser: vi.fn(),
}))

vi.mock('~~/server/db/mongo', () => ({ connectDB: async () => state.db }))
vi.mock('~~/server/utils/avatar', () => ({ downloadAndStoreAvatar: state.downloadAndStoreAvatar }))
vi.mock('~~/server/features/support/welcomemessage', () => ({ sendWelcomeMessage: state.sendWelcomeMessage }))
vi.mock('~~/server/features/notification/adminNotify', () => ({ notifyAdminNewUser: state.notifyAdminNewUser }))

import { createOrUpdateUser } from '~~/server/utils/user'
import { fakeDb } from './helpers/fakeMongo'

const login = (email) => createOrUpdateUser({ providerId: '123', email, name: 'Ana', avatarUrl: 'https://x/a.png' })

let users
beforeEach(() => {
    users = []
    state.db = fakeDb({ users })
    state.db.collection('tracking').updateMany = vi.fn(async () => ({}))
    state.downloadAndStoreAvatar.mockReset().mockResolvedValue('avatar-key')
    state.sendWelcomeMessage.mockReset().mockResolvedValue()
})

describe('connexion Google — adresse d’un autre compte', () => {
    it('compte e-mail + mot de passe → 409 email_taken_local, rien écrit', async () => {
        users.push({ id: 'local:ana@b.co', provider: 'local', email: 'ana@b.co', passwordHash: 'h' })
        await expect(login('ana@b.co')).rejects.toMatchObject({ statusCode: 409, data: { code: 'email_taken_local' } })
        expect(state.db.collection('users').calls.updateOne).toHaveLength(0)
        expect(state.downloadAndStoreAvatar).not.toHaveBeenCalled()
        expect(users).toHaveLength(1)
    })

    it('casse différente côté Google : refus aussi (l’inscription locale stocke en minuscules)', async () => {
        users.push({ id: 'local:ana@b.co', provider: 'local', email: 'ana@b.co', passwordHash: 'h' })
        await expect(login('Ana@B.co')).rejects.toMatchObject({ statusCode: 409, data: { code: 'email_taken_local' } })
    })

    it('le même compte Google se reconnecte normalement', async () => {
        users.push({ id: 'google:123', provider: 'google', email: 'ana@b.co', sessions: [] })
        const session = await login('ana@b.co')
        expect(session.sessionId).toBeTruthy()
        const upsert = state.db.collection('users').calls.updateOne.find((c) => c.update.$set)
        expect(upsert.filter).toEqual({ id: 'google:123' })
        expect(state.sendWelcomeMessage).not.toHaveBeenCalled()
    })

    it('compte e-mail créé entre la vérification et l’écriture (E11000) → 409, pas 500', async () => {
        const col = state.db.collection('users')
        const updateOne = col.updateOne
        col.updateOne = async (filter, update, opts) => {
            if (opts?.upsert) {
                users.push({ id: 'local:ana@b.co', provider: 'local', email: 'ana@b.co' })
                throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
            }
            return updateOne(filter, update)
        }
        await expect(login('ana@b.co')).rejects.toMatchObject({ statusCode: 409, data: { code: 'email_taken_local' } })
    })

    it('une autre erreur d’écriture n’est pas maquillée en 409', async () => {
        const col = state.db.collection('users')
        col.updateOne = async (filter, update, opts) => {
            if (opts?.upsert) throw new Error('network down')
            return { matchedCount: 0 }
        }
        await expect(login('ana@b.co')).rejects.toThrow('network down')
    })
})
