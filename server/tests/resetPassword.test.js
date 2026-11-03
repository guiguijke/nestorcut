import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// La réinitialisation est le chemin de reprise d'une adresse prise par un
// tiers (un compte e-mail ouvert avec la boîte de quelqu'un d'autre refuse la
// connexion Google, décision 2026-11-03) : le lien arrive dans la boîte, donc
// l'adresse est prouvée, et toutes les sessions sautent.
const state = vi.hoisted(() => ({ db: null }))
vi.mock('~~/server/db/mongo', () => ({ connectDB: async () => state.db }))

import resetHandler from '~~/server/api/auth/local/reset-password.post.js'
import { fakeDb } from './helpers/fakeMongo'

const ev = (body) => ({
    _params: {},
    method: 'POST',
    _requestBody: JSON.stringify(body),
    _body: body,
    node: { req: { headers: { 'user-agent': 'vitest' }, res: {} } },
})
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')

let users
beforeEach(() => {
    users = [{ id: 'local:v@b.co', provider: 'local', email: 'v@b.co', emailVerified: false, sessions: [{ sessionId: 'squatter' }] }]
    state.db = fakeDb({
        users,
        passwordResets: [{ userId: 'local:v@b.co', tokenHash: sha('TOK'), expiresAt: new Date(Date.now() + 60_000) }],
        emailVerifications: [{ userId: 'local:v@b.co', tokenHash: 'pending' }],
    })
})

describe('reset-password — reprise de l’adresse', () => {
    it('coupe les sessions, marque l’adresse vérifiée, purge les liens de vérification', async () => {
        await expect(resetHandler(ev({ token: 'TOK', password: 'newpassword1' }))).resolves.toEqual({ ok: true })
        expect(users[0].sessions).toEqual([])
        expect(users[0].emailVerified).toBe(true)
        expect(users[0].passwordHash).toMatch(/^\$2/)
        const { update } = state.db.collection('users').calls.updateOne[0]
        // $min : la date d'une vérification antérieure n'est pas réécrite.
        expect(update.$min.emailVerifiedAt).toBeInstanceOf(Date)
        expect(state.db.collection('emailVerifications').calls.deleteMany).toEqual([{ userId: 'local:v@b.co' }])
    })

    it('lien invalide : rien ne change', async () => {
        await expect(resetHandler(ev({ token: 'AUTRE', password: 'newpassword1' }))).rejects.toMatchObject({ statusCode: 400 })
        expect(users[0].emailVerified).toBe(false)
        expect(users[0].sessions).toHaveLength(1)
    })
})
