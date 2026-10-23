import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { createApp, toNodeListener, eventHandler, readBody } from 'h3'
import './helpers/h3Shims'

// Verrou S-1 (audit 2026-09-27) : le journal HTTP ne garde AUCUN contenu —
// ni corps de requête, ni réponse, ni URL avec query. Seuls six champs.
// Le test monte un vrai serveur h3 (vrai readBody, vrai flux de réponse) :
// l'ancien middleware, qui lisait le corps et recopiait la réponse, y échoue.
const state = vi.hoisted(() => ({ db: null }))

vi.mock('../../server/db/mongo', () => ({
    connectDB: async () => state.db,
    getBucket: vi.fn(),
}))
vi.mock('../../server/utils/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import logRequests from '~~/server/middleware/1_log-requests'
import unlock from '~~/server/api/security/vault/unlock.post'
import { fakeDb } from './helpers/fakeMongo'

const ALLOWED_KEYS = ['method', 'route', 'statusCode', 'duration', 'isSSE', 'timestamp']

let server
let base
let httpDocs

beforeAll(async () => {
    const app = createApp()
    app.use(eventHandler(logRequests))
    app.use(eventHandler(async (event) => {
        const path = event.node.req.url.split('?')[0]
        if (path === '/api/security/vault/unlock') {
            event.context.matchedRoute = { path: '/api/security/vault/unlock' }
            event.context.auth = { userId: 'u1' }
            return unlock(event)
        }
        if (path.startsWith('/api/files/project/geometry/')) {
            event.context.matchedRoute = { path: '/api/files/project/geometry/[slug]' }
            return { polygons: 'SENTINELLE-REP' }
        }
        if (path === '/api/upload') {
            event.context.matchedRoute = { path: '/api/upload' }
            await readBody(event).catch(() => null)
            return { ok: true }
        }
        // page (pas de route API appariée)
        return 'ok'
    }))
    server = createServer(toNodeListener(app))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}`
})

afterAll(() => new Promise((resolve) => server.close(resolve)))

beforeEach(() => {
    httpDocs = []
    state.db = fakeDb({ http: httpDocs, users: [{ id: 'u1', encryption: { enabled: true, fingerprint: 'x' } }] })
})

// h3 rend un corps multipart sous forme de Buffer : on le déplie en texte pour
// que la recherche de sentinelle voie aussi les octets (sinon faux négatif).
const dump = (doc) =>
    JSON.stringify(doc, (_k, v) => (v?.type === 'Buffer' ? Buffer.from(v.data).toString('latin1') : v))

// L'insertion est fire-and-forget dans le middleware : on attend qu'elle ait eu lieu.
async function lastDoc() {
    await vi.waitFor(() => expect(httpDocs.length).toBe(1))
    return httpDocs[0]
}

describe('1_log-requests — journal sans contenu (S-1)', () => {
    it('(a) unlock : exactement six clés, la clé du coffre n\'est jamais écrite', async () => {
        await fetch(`${base}/api/security/vault/unlock`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: 'SENTINELLE-KEY' }),
        })
        const doc = await lastDoc()
        expect(Object.keys(doc).sort()).toEqual([...ALLOWED_KEYS].sort())
        expect(dump(doc)).not.toContain('SENTINELLE-KEY')
    })

    it('(b) multipart : ni le nom ni le contenu du DXF ne sont écrits', async () => {
        const form = new FormData()
        form.append('file', new Blob(['0\nSECTION\nSENTINELLE-GEOM\n']), 'piece-client.dxf')
        await fetch(`${base}/api/upload`, { method: 'POST', body: form })
        const raw = dump(await lastDoc())
        expect(raw).not.toContain('piece-client.dxf')
        expect(raw).not.toContain('SENTINELLE-GEOM')
    })

    it('(b bis) corps brut non JSON (DXF en text/plain) : contenu non écrit', async () => {
        await fetch(`${base}/api/upload`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: ['0', 'SECTION', 'SENTINELLE-GEOM', ''].join('\n'),
        })
        expect(dump(await lastDoc())).not.toContain('SENTINELLE-GEOM')
    })

    it('(c) le jeton de la query n\'est pas écrit', async () => {
        await fetch(`${base}/auth/reset-password?token=TOKSENT`)
        const raw = dump(await lastDoc())
        expect(raw).not.toContain('TOKSENT')
    })

    it('(d) le corps de réponse JSON n\'est pas écrit', async () => {
        await fetch(`${base}/api/files/project/geometry/mon-slug`)
        const raw = dump(await lastDoc())
        expect(raw).not.toContain('SENTINELLE-REP')
    })

    it('(e) route = motif de route, sans slug ; page par défaut', async () => {
        await fetch(`${base}/api/files/project/geometry/mon-slug`)
        const doc = await lastDoc()
        expect(doc.route).toBe('/api/files/project/geometry/[slug]')
        expect(dump(doc)).not.toContain('mon-slug')
        expect(doc.method).toBe('GET')
        expect(doc.statusCode).toBe(200)
        expect(doc.isSSE).toBe(false)
        expect(doc.timestamp).toBeInstanceOf(Date)
    })

    it('route retombe sur « page » sans route appariée', async () => {
        await fetch(`${base}/une-page?x=1`)
        expect((await lastDoc()).route).toBe('page')
    })
})
