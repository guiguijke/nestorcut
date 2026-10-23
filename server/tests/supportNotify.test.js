import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// Notification admin des messages de support : chat in-app (USER uniquement,
// anti-spam 10 min par expéditeur), formulaire de contact (toujours), et
// no-op complet sans NUXT_ADMIN_NOTIFY_EMAIL. Resend est moqué via $fetch.

const state = vi.hoisted(() => ({
    db: null,
    config: {
        adminNotifyEmail: 'admin@x.y',
        resendToken: 'tok',
        resendFrom: 'no-reply@x.y',
        public: { supportEmail: 'support@x.y' },
    },
    fetchMock: null,
    ip: '10.0.0.1',
}))
globalThis.useRuntimeConfig = () => state.config
globalThis.$fetch = (...args) => state.fetchMock(...args)

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))
vi.mock('~~/server/utils/ratelimit', () => ({
    clientIp: () => state.ip,
}))

import chatPost from '~~/server/api/support/messages/index.post.js'
import contactPost from '~~/server/api/support/contact.post.js'
import { sendWelcomeMessage } from '~~/server/features/support/welcomemessage'
import { fakeDb } from './helpers/fakeMongo'

const ADMIN = 'admin@x.y'
let uid = 0
let ipSeq = 0

// Utilisateur frais par test : le Map anti-spam vit au niveau module.
const newUser = () => {
    uid += 1
    return { id: `local:user${uid}@x.y`, email: `user${uid}@x.y`, name: `User ${uid}`, provider: 'local' }
}

const chatEvent = (user, message) => ({
    context: { auth: { userId: user.id } },
    node: { req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } } },
    _body: { message },
})

const contactEvent = (body) => ({
    _params: {},
    method: 'POST',
    node: { req: { headers: {}, socket: { remoteAddress: '127.0.0.1' } } },
    _body: body,
})

const flush = () => new Promise((resolve) => setImmediate(resolve))

// Appels Resend destinés à l'administrateur.
const adminCalls = () => state.fetchMock.mock.calls.map((c) => c[1].body).filter((b) => b.to === ADMIN)

beforeEach(() => {
    state.config = {
        adminNotifyEmail: 'admin@x.y',
        resendToken: 'tok',
        resendFrom: 'no-reply@x.y',
        public: { supportEmail: 'support@x.y' },
    }
    state.db = fakeDb({ users: [] })
    state.fetchMock = vi.fn(async () => ({ id: 'resend-1' }))
    // IP propre à chaque test : le rate limit du contact (5/h/IP) ne doit pas
    // interférer entre tests.
    ipSeq += 1
    state.ip = `10.0.0.${ipSeq}`
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('chat support — message utilisateur', () => {
    it('envoie 1 e-mail à l\'admin avec l\'extrait (500 car. max)', async () => {
        const user = newUser()
        state.db.collection('users').insertOne(user)
        const long = 'x'.repeat(600)

        await chatPost(chatEvent(user, long))
        await flush()

        const mails = adminCalls()
        expect(mails).toHaveLength(1)
        expect(mails[0].subject).toContain('[NestorCut] Nouveau message de support')
        expect(mails[0].subject).toContain(user.name)
        expect(mails[0].text).toContain(`${'x'.repeat(500)}…`)
        expect(mails[0].text).not.toContain('x'.repeat(501))
        expect(mails[0].text).toContain(user.id)
        expect(mails[0].text).toContain('http://192.168.1.180:7200/support')
        expect(mails[0].html).toContain('Ouvrir le support')
    })

    it('second message dans les 10 min : pas de second e-mail, puis à nouveau après 10 min', async () => {
        const user = newUser()
        state.db.collection('users').insertOne(user)
        const t0 = 1_700_000_000_000
        const now = vi.spyOn(Date, 'now')

        now.mockReturnValue(t0)
        await chatPost(chatEvent(user, 'premier'))
        await flush()

        now.mockReturnValue(t0 + 9 * 60 * 1000)
        await chatPost(chatEvent(user, 'deuxième'))
        await flush()
        expect(adminCalls()).toHaveLength(1)

        now.mockReturnValue(t0 + 10 * 60 * 1000 + 1)
        await chatPost(chatEvent(user, 'troisième'))
        await flush()
        expect(adminCalls()).toHaveLength(2)
    })

    it('un échec Resend ne fait pas échouer la requête et libère la fenêtre anti-spam', async () => {
        const user = newUser()
        state.db.collection('users').insertOne(user)
        state.fetchMock = vi.fn(async () => { throw new Error('resend down') })

        await expect(chatPost(chatEvent(user, 'bonjour, aide svp'))).resolves.toBeDefined()
        await flush()
        expect(state.fetchMock).toHaveBeenCalledTimes(1)

        state.fetchMock = vi.fn(async () => ({ id: 'resend-2' }))
        await chatPost(chatEvent(user, 'toujours là'))
        await flush()
        expect(adminCalls()).toHaveLength(1)
    })
})

describe('messages non utilisateur', () => {
    it('le message de bienvenue (welcomemessage.js) ne déclenche aucun e-mail', async () => {
        vi.useFakeTimers()
        const user = newUser()
        state.db.collection('users').insertOne(user)

        const pending = sendWelcomeMessage(user.id)
        await vi.advanceTimersByTimeAsync(3000)
        await pending

        expect(state.db.collection('supportMessages').calls.insertOne).toHaveLength(2)
        expect(state.fetchMock).not.toHaveBeenCalled()
    })
})

describe('formulaire de contact', () => {
    it('envoie toujours un e-mail à l\'admin, en plus de la transmission au support', async () => {
        const res = await contactPost(contactEvent({
            name: 'Alice',
            email: 'alice@example.com',
            subject: 'Devis',
            message: 'Bonjour, je souhaiterais un devis.',
        }))
        await flush()

        expect(res).toEqual({ ok: true })
        const forward = state.fetchMock.mock.calls.map((c) => c[1].body).find((b) => b.to === 'support@x.y')
        expect(forward.reply_to).toBe('alice@example.com')

        const mails = adminCalls()
        expect(mails).toHaveLength(1)
        expect(mails[0].subject).toContain('Alice')
        expect(mails[0].text).toContain('Bonjour, je souhaiterais un devis.')
        expect(mails[0].text).toContain('Formulaire de contact')
        expect(mails[0].text).not.toContain('Identifiant')
    })

    it('chaque soumission de contact notifie (pas de throttle 10 min côté admin)', async () => {
        for (let i = 0; i < 2; i += 1) {
            await contactPost(contactEvent({ name: 'Bob', email: 'bob@example.com', message: `message numéro ${i} ok` }))
        }
        await flush()
        expect(adminCalls()).toHaveLength(2)
    })
})

describe('NUXT_ADMIN_NOTIFY_EMAIL absent', () => {
    it('chat : aucun envoi, aucune erreur', async () => {
        state.config = { ...state.config, adminNotifyEmail: '' }
        const user = newUser()
        state.db.collection('users').insertOne(user)

        await expect(chatPost(chatEvent(user, 'bonjour'))).resolves.toBeDefined()
        await flush()
        expect(state.fetchMock).not.toHaveBeenCalled()
    })

    it('contact : seule la transmission au support part, aucune erreur', async () => {
        state.config = { ...state.config, adminNotifyEmail: '' }

        await expect(contactPost(contactEvent({ name: 'Carl', email: 'carl@example.com', message: 'bonjour à tous' })))
            .resolves.toEqual({ ok: true })
        await flush()
        expect(state.fetchMock).toHaveBeenCalledTimes(1)
        expect(state.fetchMock.mock.calls[0][1].body.to).toBe('support@x.y')
    })
})
