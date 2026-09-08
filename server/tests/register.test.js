import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// C1-a — chemin heureux de l'inscription locale + latence (D7) + porte
// e-mail du nesting. Les dépendances externes (mailer, admin, bienvenue,
// listmonk) sont moquées ; la base est le fakeMongo habituel.

const state = vi.hoisted(() => ({
    db: null,
    config: { public: { localAuthEnabled: true } },
    sendEmailVerification: vi.fn(),
    notifyAdminNewUser: vi.fn(),
    sendWelcomeMessage: vi.fn(),
    subscribeToNewsletter: vi.fn(),
    setSessionCookie: vi.fn(),
}))
globalThis.useRuntimeConfig = () => state.config

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))
vi.mock('~~/server/features/notification/emailVerification', () => ({
    sendEmailVerification: state.sendEmailVerification,
}))
vi.mock('~~/server/features/notification/adminNotify', () => ({
    notifyAdminNewUser: state.notifyAdminNewUser,
}))
vi.mock('~~/server/features/support/welcomemessage', () => ({
    sendWelcomeMessage: state.sendWelcomeMessage,
}))
vi.mock('~~/server/features/listmonk/subscribe', () => ({
    subscribeToNewsletter: state.subscribeToNewsletter,
    unsubscribeFromNewsletter: vi.fn(),
}))
vi.mock('~~/server/utils/user', () => ({
    setSessionCookie: state.setSessionCookie,
}))

import registerHandler from '~~/server/api/auth/local/register.post.js'
import { assertCanNest } from '~~/server/utils/entitlement'
import { fakeDb } from './helpers/fakeMongo'

// Stripe ne doit jamais être touché sur le chemin gratuit (mock bruyant).
vi.mock('~~/server/features/payment/stripe', () => ({
    ACTIVE_SUBSCRIPTION_STATUSES: ['active', 'trialing'],
    getSubscription: vi.fn(),
    mapSubscription: vi.fn(),
}))

const ev = (body) => ({
    _params: {},
    method: 'POST',
    _requestBody: JSON.stringify(body ?? {}),
    _body: body ?? {},
    node: { req: { headers: { 'user-agent': 'vitest' }, res: {} } },
})

beforeEach(() => {
    state.db = fakeDb({})
    state.sendEmailVerification.mockReset().mockResolvedValue()
    state.notifyAdminNewUser.mockReset().mockResolvedValue()
    state.sendWelcomeMessage.mockReset().mockResolvedValue()
    state.subscribeToNewsletter.mockReset().mockResolvedValue()
    state.setSessionCookie.mockReset()
})

describe('register.post — chemin heureux (C1-a)', () => {
    it('insère emailVerified false, UN seul envoi de vérification, répond avec l\'e-mail', async () => {
        const res = await registerHandler(ev({ email: 'new@x.y', name: 'New', password: 'longenough1' }))

        expect(res).toEqual({ ok: true, needsVerification: true, email: 'new@x.y' })

        const users = state.db.collection('users')
        expect(users.calls.insertOne).toHaveLength(1)
        const doc = users.calls.insertOne[0]
        expect(doc.emailVerified).toBe(false)
        // Case non cochée → false ET horloge posée (D6).
        expect(doc.newsletterOptIn).toBe(false)
        expect(doc.newsletterOptInAt).toBeNull()

        expect(state.sendEmailVerification).toHaveBeenCalledTimes(1)
        expect(state.sendEmailVerification.mock.calls[0][1]).toBe('local:new@x.y')
        expect(state.sendEmailVerification.mock.calls[0][2]).toBe('new@x.y')
        expect(state.subscribeToNewsletter).not.toHaveBeenCalled()
        expect(state.sendWelcomeMessage).toHaveBeenCalledTimes(1)
        expect(state.notifyAdminNewUser).toHaveBeenCalledTimes(1)
    })
})

describe('register.post — latence (D7 : la bienvenue n\'est plus attendue)', () => {
    it('répond en < 500 ms alors que le message de bienvenue met 2 s', async () => {
        let releaseWelcome
        const slow = new Promise((resolve) => { releaseWelcome = resolve })
        state.sendWelcomeMessage.mockReturnValue(slow)

        const t0 = Date.now()
        const res = await registerHandler(ev({ email: 'slow@x.y', name: 'S', password: 'longenough1' }))
        const elapsed = Date.now() - t0

        expect(res.ok).toBe(true)
        expect(elapsed).toBeLessThan(500)

        releaseWelcome()
        await slow
    })
})

describe('assertCanNest — porte e-mail (C1-a)', () => {
    const currentPeriod = () => new Date().toISOString().slice(0, 7)

    it('refuse un local emailVerified false par 403 email_not_verified', async () => {
        state.db = fakeDb({
            users: [{ id: 'local:a@b.co', provider: 'local', emailVerified: false, freeNestingUsed: 0, freeNestingPeriod: currentPeriod() }],
        })
        await expect(assertCanNest('local:a@b.co')).rejects.toMatchObject({
            statusCode: 403,
            statusMessage: 'email_not_verified',
        })
    })

    it('accepte un Google sans champ emailVerified (vérifié d\'office)', async () => {
        state.db = fakeDb({
            users: [{ id: 'google:g', provider: 'google', freeNestingUsed: 0, freeNestingPeriod: currentPeriod() }],
        })
        await expect(assertCanNest('google:g')).resolves.toEqual({ type: 'free' })
    })
})
