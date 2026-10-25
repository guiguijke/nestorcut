import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createApp, toNodeListener, eventHandler, setResponseHeaders } from 'h3'
import './helpers/h3Shims'

// M4 : une erreur de flux GridFS pendant la génération du ZIP multi-tôles ne
// doit jamais produire un ZIP tronqué servi en 200 « valide ».
globalThis.setResponseHeaders = setResponseHeaders

const state = vi.hoisted(() => ({ db: null, bucket: null, errors: [] }))

vi.mock('#imports', () => ({ getRouterParam: (event, name) => event._params?.[name] }))
vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
    getDxfResultBucket: async () => state.bucket,
}))
vi.mock('~~/server/tracking/add', () => ({ trackEvent: vi.fn() }))
vi.mock('~~/server/utils/vault', () => ({ requireFileAccess: vi.fn() }))
vi.mock('~~/server/utils/crypto', () => ({ createDecryptStream: vi.fn() }))
vi.mock('~~/server/utils/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: (m) => state.errors.push(m) },
}))

import zipRoute from '~~/server/api/files/result/zip/[nestslug].get'

const dxfDocs = (names) => names.map((filename) => ({ filename, metadata: {} }))

function makeBucket(names, { failOn } = {}) {
    return {
        find: () => ({ toArray: async () => dxfDocs(names) }),
        openDownloadStreamByName: (name) => {
            if (name !== failOn) return Readable.from([Buffer.from(`DXF ${name}`)])
            // Émet des octets puis une erreur de flux au milieu de la lecture.
            const s = new Readable({ read() {} })
            s.push(Buffer.alloc(1024, 'x'))
            setTimeout(() => s.destroy(new Error('gridfs boom')), 20)
            return s
        },
    }
}

let server
let base
beforeAll(async () => {
    const app = createApp()
    app.use(eventHandler((event) => {
        event.context.auth = { userId: 'u1' }
        event._params = { nestslug: 'nest-1' }
        return zipRoute(event)
    }))
    server = createServer(toNodeListener(app))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}`
})
afterAll(() => new Promise((resolve) => server.close(resolve)))

beforeEach(() => {
    state.errors = []
    state.db = { collection: () => ({ findOne: async () => ({ slug: 'nest-1', dxf_files: ['a.dxf', 'b.dxf'] }) }) }
})

describe('GET /api/files/result/zip/[nestslug]', () => {
    it('sert le ZIP complet quand tous les flux sont sains', async () => {
        state.bucket = makeBucket(['a.dxf', 'b.dxf'])
        const res = await fetch(`${base}/api/files/result/zip/nest-1`)
        expect(res.status).toBe(200)
        const buf = Buffer.from(await res.arrayBuffer())
        expect(buf.subarray(0, 2).toString()).toBe('PK')
        expect(buf.includes('a.dxf')).toBe(true)
        expect(buf.includes('b.dxf')).toBe(true)
    })

    it('flux GridFS en erreur en cours de route : jamais un ZIP complet en 200, erreur journalisée', async () => {
        state.bucket = makeBucket(['a.dxf', 'b.dxf'], { failOn: 'b.dxf' })
        let outcome
        try {
            const res = await fetch(`${base}/api/files/result/zip/nest-1`)
            await res.arrayBuffer()
            outcome = { status: res.status, ok: true }
        } catch {
            outcome = { ok: false } // connexion détruite : échec réseau côté client
        }
        // Soit échec réseau, soit 500 propre ; jamais un corps lu jusqu'au bout sous 200.
        expect(outcome.ok && outcome.status === 200).toBe(false)
        await vi.waitFor(() => expect(state.errors.some((m) => m.includes('gridfs boom'))).toBe(true))
    })

    it('fichier source manquant : 404 avant tout en-tête de ZIP', async () => {
        state.bucket = makeBucket(['a.dxf'])
        const res = await fetch(`${base}/api/files/result/zip/nest-1`)
        expect(res.status).toBe(404)
        expect(res.headers.get('content-type')).not.toBe('application/zip')
    })
})
