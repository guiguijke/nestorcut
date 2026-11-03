import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// 3.1.3 (lot 3) : codes d'erreur STABLES de l'auth locale — le client mappe
// data.code → clé i18n (app/utils/authServerError.js, lu en err.data.data
// côté $fetch) ; un renommage silencieux casserait le mapping.
const state = vi.hoisted(() => ({
    db: null,
    config: { public: { localAuthEnabled: true } },
}))
globalThis.useRuntimeConfig = () => state.config

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))

import loginHandler from '~~/server/api/auth/local/login.post.js'
import registerHandler from '~~/server/api/auth/local/register.post.js'
import { fakeDb } from './helpers/fakeMongo'

const ev = (body) => ({
    _params: {},
    method: 'POST',
    _requestBody: JSON.stringify(body ?? {}),
    _body: body ?? {},
    node: { req: { headers: { 'user-agent': 'vitest' }, res: {} } },
})

// La suite login n'a pas de dépendance mailer/newsletter : uniquement db.
beforeEach(() => {
    state.db = fakeDb({})
})

describe('login.post — codes d’erreur stables', () => {
    it('champs manquants → 400 fields_required', async () => {
        await expect(loginHandler(ev({ email: '', password: '' }))).rejects.toMatchObject({
            statusCode: 400,
            data: { code: 'fields_required' },
        })
    })

    it('identifiants invalides → 401 invalid_credentials', async () => {
        await expect(loginHandler(ev({ email: 'nobody@x.y', password: 'wrong1234' }))).rejects.toMatchObject({
            statusCode: 401,
            data: { code: 'invalid_credentials' },
        })
    })
})

describe('register.post — codes d’erreur stables', () => {
    it('e-mail invalide → 400 invalid_email + champ ciblé', async () => {
        await expect(registerHandler(ev({ email: 'not-an-email', name: 'A', password: 'longenough1' }))).rejects.toMatchObject({
            statusCode: 400,
            data: { code: 'invalid_email', field: 'email' },
        })
    })

    it('nom manquant → 400 name_required', async () => {
        await expect(registerHandler(ev({ email: 'a@b.co', name: '', password: 'longenough1' }))).rejects.toMatchObject({
            statusCode: 400,
            data: { code: 'name_required', field: 'name' },
        })
    })

    it('mot de passe court → 400 password_too_short', async () => {
        await expect(registerHandler(ev({ email: 'a@b.co', name: 'A', password: 'short' }))).rejects.toMatchObject({
            statusCode: 400,
            data: { code: 'password_too_short', field: 'password' },
        })
    })

    it('compte existant → 409 email_taken', async () => {
        state.db = fakeDb({
            users: [{ id: 'local:a@b.co', passwordHash: '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.0vW3q3aQ3vP3p3p3p3p3p3p3p3p3' }],
        })
        await expect(registerHandler(ev({ email: 'a@b.co', name: 'A', password: 'longenough1' }))).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'email_taken', field: 'email' },
        })
    })

    // Constat 2026-11-03 : l'index unique porte sur `email` — une adresse
    // d'un compte Google passait le contrôle par `id` puis E11000 → 500.
    it('e-mail d’un compte Google → 409 email_taken_google, aucune insertion', async () => {
        state.db = fakeDb({
            users: [{ id: 'google:123', provider: 'google', email: 'g@b.co' }],
        })
        await expect(registerHandler(ev({ email: 'G@b.co', name: 'A', password: 'longenough1' }))).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'email_taken_google', field: 'email' },
        })
        expect(state.db.collection('users').calls.insertOne).toHaveLength(0)
    })

    it('course à l’insertion (E11000) → 409 email_taken, pas 500', async () => {
        state.db = fakeDb({ users: [] })
        state.db.collection('users').insertOne = async () => {
            throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
        }
        await expect(registerHandler(ev({ email: 'race@b.co', name: 'A', password: 'longenough1' }))).rejects.toMatchObject({
            statusCode: 409,
            data: { code: 'email_taken', field: 'email' },
        })
    })
})
