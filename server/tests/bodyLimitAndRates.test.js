import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// track/index.post.ts importe readBody depuis h3 (pas le global) : on le
// remplace par la lecture de l'événement factice.
vi.mock('h3', async (orig) => ({ ...(await orig()), readBody: async (e) => e._body }))

const state = vi.hoisted(() => ({ inserted: [] }))
vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => ({
        collection: () => ({
            insertOne: async (doc) => { state.inserted.push(doc); return { insertedId: 'm1' } },
            findOne: async () => ({ id: 'u1', email: 'a@b.c', name: 'A' }),
        }),
    }),
}))
vi.mock('~~/server/features/notification/adminNotify', () => ({
    notifyAdminSupportMessage: vi.fn(async () => {}),
}))
vi.mock('~~/server/tracking/add', () => ({ saveTrackRecordInBackground: vi.fn() }))
vi.mock('~~/server/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import bodyLimit, { bodyLimitFor } from '~~/server/middleware/0_body_limit'
import filesRateLimit from '~~/server/middleware/5_files_ratelimit'
import supportPost from '~~/server/api/support/messages/index.post'
import trackPost from '~~/server/api/track/index.post'

const MB = 1024 * 1024
let n = 0
const uniq = (p) => `${p}-${Date.now()}-${n++}`

function ev({ method = 'POST', path = '/api/x', headers = {}, userId, body } = {}) {
    return {
        path,
        _body: body,
        context: { auth: userId ? { userId } : undefined },
        node: { req: { method, url: path, headers, socket: { remoteAddress: uniq('9.9.9') } }, res: {} },
    }
}
const status = async (fn) => {
    try { await fn(); return 200 } catch (e) { return e.statusCode }
}

describe('0_body_limit (S-5)', () => {
    it('plafonds par route', () => {
        expect(bodyLimitFor('/api/project')).toBe(101 * MB)
        expect(bodyLimitFor('/api/project/abc/addfiles')).toBe(101 * MB)
        expect(bodyLimitFor('/api/results/abc/local-result')).toBe(64 * MB)
        expect(bodyLimitFor('/api/security/vault/unlock')).toBe(1 * MB)
        expect(bodyLimitFor('/api/stripe/webhook')).toBe(1 * MB)
    })

    it('413 au-dessus du plafond JSON, accepté en dessous', async () => {
        const big = ev({ path: '/api/user/preferences', headers: { 'content-length': String(1 * MB + 1) } })
        expect(await status(() => bodyLimit(big))).toBe(413)
        const ok = ev({ path: '/api/user/preferences', headers: { 'content-length': '2000' } })
        expect(await status(() => bodyLimit(ok))).toBe(200)
    })

    it('un upload de 100 Mo passe sur addfiles mais pas sur une route JSON', async () => {
        const headers = { 'content-length': String(100 * MB) }
        expect(await status(() => bodyLimit(ev({ path: '/api/project/p1/addfiles?x=1', headers })))).toBe(200)
        expect(await status(() => bodyLimit(ev({ path: '/api/track', headers })))).toBe(413)
        expect(await status(() => bodyLimit(ev({ path: '/api/project/p1/addfiles', headers: { 'content-length': String(102 * MB) } })))).toBe(413)
    })

    it('GET non concerné ; chunked sans content-length : 411 sauf routes upload (mode refus)', async () => {
        process.env.BODY_LIMIT_REJECT_CHUNKED = 'true'
        try {
            expect(await status(() => bodyLimit(ev({ method: 'GET', headers: { 'content-length': String(500 * MB) } })))).toBe(200)
            const chunked = { 'transfer-encoding': 'chunked' }
            expect(await status(() => bodyLimit(ev({ path: '/api/track', headers: chunked })))).toBe(411)
            expect(await status(() => bodyLimit(ev({ path: '/api/support/messages', headers: chunked })))).toBe(411)
            expect(await status(() => bodyLimit(ev({ path: '/api/project/p1/addfiles', headers: chunked })))).toBe(200)
            expect(await status(() => bodyLimit(ev({ path: '/api/track', headers: {} })))).toBe(200)
        } finally {
            delete process.env.BODY_LIMIT_REJECT_CHUNKED
        }
    })

    it('mode observation par défaut : chunked journalisé (préfixe seul, une fois), jamais refusé', async () => {
        const { default: logger } = await import('~~/server/utils/logger')
        logger.warn.mockClear()
        const chunked = { 'transfer-encoding': 'chunked' }
        expect(await status(() => bodyLimit(ev({ path: '/api/results/secret-slug/local-fail', headers: chunked })))).toBe(200)
        expect(await status(() => bodyLimit(ev({ path: '/api/results/other-slug/local-fail', headers: chunked })))).toBe(200)
        const calls = logger.warn.mock.calls.filter(([msg]) => String(msg).includes('[body-limit]'))
        expect(calls).toHaveLength(1)
        expect(calls[0][1]).toEqual({ prefix: '/api/results' })
        expect(JSON.stringify(calls)).not.toContain('slug')
    })
})

describe('5_files_ratelimit - résultats (A-9)', () => {
    it('40 vignettes/DXF de résultat ne vident pas le budget strict', async () => {
        const userId = uniq('u')
        for (let i = 0; i < 40; i++) {
            const path = ['/api/files/result/svg/a.svg', '/api/files/result/dxf/a.dxf'][i % 2]
            expect(await status(() => filesRateLimit(ev({ method: 'GET', path, userId })))).toBe(200)
        }
        // Le budget anti-brute-force (autres routes /api/files) reste intact.
        expect(await status(() => filesRateLimit(ev({ method: 'GET', path: '/api/files/abc', userId })))).toBe(200)
    })

    it('le budget résultat est plafonné à 180/min', async () => {
        const userId = uniq('u')
        let last = 200
        for (let i = 0; i < 181; i++) {
            last = await status(() => filesRateLimit(ev({ method: 'GET', path: '/api/files/result/svg/a.svg', userId })))
        }
        expect(last).toBe(429)
    })

    it('le ZIP a son propre budget strict de 20/min, sans toucher dxf/svg', async () => {
        const userId = uniq('u')
        let last = 200
        for (let i = 0; i < 21; i++) {
            last = await status(() => filesRateLimit(ev({ method: 'GET', path: '/api/files/result/zip/s', userId })))
        }
        expect(last).toBe(429)
        expect(await status(() => filesRateLimit(ev({ method: 'GET', path: '/api/files/result/dxf/a.dxf', userId })))).toBe(200)
    })

    it('les autres routes /api/files gardent 30/min', async () => {
        const userId = uniq('u')
        let last = 200
        for (let i = 0; i < 31; i++) {
            last = await status(() => filesRateLimit(ev({ method: 'GET', path: '/api/files/some-slug', userId })))
        }
        expect(last).toBe(429)
    })
})

describe('POST /api/support/messages (S-5)', () => {
    beforeEach(() => { state.inserted = [] })

    it.each([[undefined], [''], ['   \n'], [42], ['x'.repeat(5001)]])('refuse %j en 400', async (message) => {
        const code = await status(() => supportPost(ev({ userId: uniq('u'), body: { message } })))
        expect(code).toBe(400)
        expect(state.inserted).toHaveLength(0)
    })

    it('accepte 5000 caractères exactement', async () => {
        const code = await status(() => supportPost(ev({ userId: uniq('u'), body: { message: 'x'.repeat(5000) } })))
        expect(code).toBe(200)
        expect(state.inserted).toHaveLength(1)
    })

    it('limite de débit par utilisateur : 429 au 21e message', async () => {
        const userId = uniq('u')
        let last = 200
        for (let i = 0; i < 21; i++) {
            last = await status(() => supportPost(ev({ userId, body: { message: 'salut' } })))
        }
        expect(last).toBe(429)
    })
})

describe('POST /api/track (S-5)', () => {
    it('limite de débit : accepte 120/min puis 429', async () => {
        const userId = uniq('u')
        const body = () => ({ action: 'page_view', data: {} })
        for (let i = 0; i < 120; i++) {
            expect(await status(() => trackPost(ev({ userId, body: body() })))).toBe(200)
        }
        expect(await status(() => trackPost(ev({ userId, body: body() })))).toBe(429)
    })
})
