import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// La clé du coffre ne vit qu'en mémoire du processus, par utilisateur, deux heures
// glissantes. La déconnexion et la réinitialisation du mot de passe (toutes les
// sessions sautent) l'effacent, AVANT que la session ne disparaisse.

const state = vi.hoisted(() => ({ db: null, order: [] }))
vi.mock('~~/server/db/mongo', () => ({ connectDB: async () => state.db }))

const authMocks = vi.hoisted(() => ({
    removeSessionFromUser: vi.fn(async () => {}),
}))
vi.mock('~~/server/utils/auth', () => authMocks)

import logoutHandler from '~~/server/api/auth/logout.post.js'
import resetHandler from '~~/server/api/auth/local/reset-password.post.js'
import jobDekHandler from '~~/server/api/security/vault/job-dek.post.js'
import { createVaultSession, getVaultSession } from '~~/server/utils/vault'
import { fakeDb } from './helpers/fakeMongo'
import crypto from 'node:crypto'

globalThis.parseCookies = (event) => event._cookies || {}
globalThis.setCookie = vi.fn()

const DEK = Buffer.alloc(32, 9)
const logoutEvent = (userId, sessionId = 'sess-1') => ({
    _cookies: { sessionId },
    context: userId ? { auth: { userId } } : {},
})

beforeEach(() => {
    authMocks.removeSessionFromUser.mockReset()
    authMocks.removeSessionFromUser.mockImplementation(async () => {})
})

describe('déconnexion et clé du coffre', () => {
    it('efface la clé de l\'utilisateur, et seulement la sienne', async () => {
        await createVaultSession('u-logout', DEK)
        await createVaultSession('u-other', DEK)
        expect(await getVaultSession('u-logout')).not.toBeNull()
        await logoutHandler(logoutEvent('u-logout'))
        expect(await getVaultSession('u-logout')).toBeNull()
        expect(await getVaultSession('u-other')).not.toBeNull()
    })

    it('la clé est effacée avant le retrait de la session', async () => {
        await createVaultSession('u-order', DEK)
        let keyWhenSessionRemoved = 'unset'
        authMocks.removeSessionFromUser.mockImplementation(async () => {
            keyWhenSessionRemoved = await getVaultSession('u-order')
        })
        await logoutHandler(logoutEvent('u-order'))
        expect(authMocks.removeSessionFromUser).toHaveBeenCalledWith('sess-1')
        expect(keyWhenSessionRemoved).toBeNull()
    })

    it("la session est remise à zéro, pas la clé qu'une requête en cours tient déjà", async () => {
        await createVaultSession('u-wipe', DEK)
        const { dek } = await getVaultSession('u-wipe')
        const fill = vi.spyOn(Buffer.prototype, 'fill')
        await logoutHandler(logoutEvent('u-wipe'))
        const wiped = fill.mock.contexts.filter((b, i) => b.length === 32 && fill.mock.calls[i][0] === 0)
        fill.mockRestore()
        expect(wiped).toHaveLength(1)
        expect(wiped[0].every((b) => b === 0)).toBe(true)
        // une copie : l'envoi en cours finit avec la vraie clé
        expect(dek.equals(DEK)).toBe(true)
    })

    it('session déjà expirée ou inconnue : la déconnexion passe, rien à effacer', async () => {
        await expect(logoutHandler(logoutEvent(null))).resolves.toEqual({})
        expect(authMocks.removeSessionFromUser).toHaveBeenCalledTimes(1)
    })

    it("un calcul qui demande la clé ensuite reçoit vault_locked, comme à l'expiration", async () => {
        const ecdh = crypto.createECDH('prime256v1')
        ecdh.generateKeys()
        state.db = fakeDb({
            nesting_jobs: [{ slug: 'job-1', ownerId: 'u-job', workerKeyPub: ecdh.getPublicKey().toString('base64') }],
            users: [{ id: 'u-job', sessions: [{ sessionHash: 'h', expiresAt: new Date(Date.now() + 86_400_000) }] }],
        })
        await createVaultSession('u-job', DEK)
        await expect(jobDekHandler({ context: {}, _body: { jobSlug: 'job-1' } })).resolves.toHaveProperty('parcel')
        await logoutHandler(logoutEvent('u-job'))
        await expect(jobDekHandler({ context: {}, _body: { jobSlug: 'job-1' } }))
            .rejects.toMatchObject({ statusCode: 409, statusMessage: 'vault_locked' })
    })
})

describe('réinitialisation du mot de passe', () => {
    const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
    it('toutes les sessions sautent, la clé du coffre aussi', async () => {
        const users = [{ id: 'u-reset', provider: 'local', email: 'r@b.co', sessions: [{ sessionId: 'x' }] }]
        state.db = fakeDb({
            users,
            passwordResets: [{ userId: 'u-reset', tokenHash: sha('TOK'), expiresAt: new Date(Date.now() + 60_000) }],
            emailVerifications: [],
        })
        await createVaultSession('u-reset', DEK)
        const ev = { _params: {}, method: 'POST', _body: { token: 'TOK', password: 'newpassword1' }, node: { req: { headers: {}, res: {} } } }
        await expect(resetHandler(ev)).resolves.toEqual({ ok: true })
        expect(users[0].sessions).toEqual([])
        expect(await getVaultSession('u-reset')).toBeNull()
    })
})
