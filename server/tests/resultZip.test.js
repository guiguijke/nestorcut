import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createApp, toNodeListener, eventHandler, setResponseHeaders } from 'h3'
import './helpers/h3Shims'

// M4 : une erreur de flux GridFS pendant la génération du ZIP multi-tôles ne
// doit jamais produire un ZIP tronqué servi en 200 « valide ».
globalThis.setResponseHeaders = setResponseHeaders

const state = vi.hoisted(() => ({ db: null, bucket: null, errors: [], cap: 2, job: null }))

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
// O2 (02/11) : le resolver du plafond est simulé (son comportement — flag K,
// palier, reprise Stripe — est verrouillé par downloadSheetCap.test.js).
vi.mock('~~/server/utils/entitlement', () => ({
    downloadSheetCapForUser: vi.fn(async () => state.cap),
    isWithinFreeDownloadCap: (n) => Number.isSafeInteger(n) && n >= 1 && n <= 2,
}))

import zipRoute from '~~/server/api/files/result/zip/[nestslug].get'
import { downloadSheetCapForUser } from '~~/server/utils/entitlement'

const dxfDocs = (names) => names.map((filename) => ({ filename, metadata: {} }))

// `find` respecte `$in` ; `reverse` rend les documents dans l'ordre inverse
// (l'ordre de find n'est pas celui des tôles : la route doit trier, D6).
function makeBucket(names, { failOn, reverse = false } = {}) {
    return {
        find: (q) => ({
            toArray: async () => {
                const hits = names.filter((n) => q.filename.$in.includes(n))
                return dxfDocs(reverse ? [...hits].reverse() : hits)
            },
        }),
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
    state.cap = 2 // Free par défaut
    state.job = { slug: 'nest-1', dxf_files: ['a.dxf', 'b.dxf'] }
    state.db = { collection: () => ({ findOne: async () => state.job }) }
    vi.mocked(downloadSheetCapForUser).mockClear()
})

// Noms des entrées d'un ZIP, dans l'ordre, lus dans le répertoire central
// (archiver écrit des descripteurs de données : les tailles des en-têtes
// locaux ne sont pas fiables pour sauter d'une entrée à l'autre).
function zipEntryNames(buf) {
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    if (eocd < 0) throw new Error('ZIP sans fin de répertoire central')
    const count = buf.readUInt16LE(eocd + 10)
    let off = buf.readUInt32LE(eocd + 16)
    const names = []
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('en-tête central attendu')
        const nameLen = buf.readUInt16LE(off + 28)
        const extraLen = buf.readUInt16LE(off + 30)
        const commentLen = buf.readUInt16LE(off + 32)
        names.push(buf.subarray(off + 46, off + 46 + nameLen).toString('utf8'))
        off += 46 + nameLen + extraLen + commentLen
    }
    return names
}

const SHEETS3 = ['j_alt0_part_1.dxf', 'j_alt0_part_2.dxf', 'j_alt0_part_3.dxf']

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

describe('GET /api/files/result/zip/[nestslug] — tôles téléchargeables (O2)', () => {
    beforeEach(() => {
        state.job = { slug: 'nest-1', projectSlug: 'p1', dxf_files: [...SHEETS3] }
    })

    it("Free, 3 tôles : 200, ZIP des tôles 1-2 dans l'ordre des tôles, nom partiel", async () => {
        state.bucket = makeBucket(SHEETS3, { reverse: true })
        const res = await fetch(`${base}/api/files/result/zip/nest-1`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-disposition')).toContain('nesting-nest-1-sheets-1-2.zip')
        const names = zipEntryNames(Buffer.from(await res.arrayBuffer()))
        expect(names).toEqual(['j_alt0_part_1.dxf', 'j_alt0_part_2.dxf'])
        expect(downloadSheetCapForUser).toHaveBeenCalledWith('u1', { paidPlansDisabled: undefined })
    })

    it('payant (plafond Infinity, reprise Stripe comprise) : 3 entrées, nom inchangé', async () => {
        state.cap = Infinity
        state.bucket = makeBucket(SHEETS3, { reverse: true })
        const res = await fetch(`${base}/api/files/result/zip/nest-1`)
        expect(res.status).toBe(200)
        const disposition = res.headers.get('content-disposition')
        expect(disposition).toContain('nesting-nest-1.zip')
        expect(disposition).not.toContain('sheets-1-')
        const names = zipEntryNames(Buffer.from(await res.arrayBuffer()))
        // D6 : ordre de dxf_files, même quand find rend l'ordre inverse.
        expect(names).toEqual(SHEETS3)
    })

    it('Free sur un job démo : 3 entrées, resolver jamais appelé', async () => {
        state.job = { slug: 'nest-1', projectSlug: 'demo', dxf_files: [...SHEETS3] }
        state.bucket = makeBucket(SHEETS3)
        const res = await fetch(`${base}/api/files/result/zip/nest-1`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-disposition')).toContain('nesting-nest-1.zip')
        expect(zipEntryNames(Buffer.from(await res.arrayBuffer()))).toEqual(SHEETS3)
        expect(downloadSheetCapForUser).not.toHaveBeenCalled()
    })

    it('Free sur un job au profil démo (params.computeLevel) : 3 entrées', async () => {
        state.job = { slug: 'nest-1', projectSlug: 'p1', params: { computeLevel: 'demo' }, dxf_files: [...SHEETS3] }
        state.bucket = makeBucket(SHEETS3)
        const res = await fetch(`${base}/api/files/result/zip/nest-1`)
        expect(res.status).toBe(200)
        expect(zipEntryNames(Buffer.from(await res.arrayBuffer()))).toEqual(SHEETS3)
        expect(downloadSheetCapForUser).not.toHaveBeenCalled()
    })

    it("flag paidPlansDisabled 'true' : transmis tel quel au resolver", async () => {
        const prev = globalThis.useRuntimeConfig
        globalThis.useRuntimeConfig = () => ({ public: { paidPlansDisabled: 'true' } })
        try {
            state.cap = Infinity
            state.bucket = makeBucket(SHEETS3)
            const res = await fetch(`${base}/api/files/result/zip/nest-1`)
            expect(res.status).toBe(200)
            await res.arrayBuffer()
            expect(downloadSheetCapForUser).toHaveBeenCalledWith('u1', { paidPlansDisabled: 'true' })
        } finally {
            globalThis.useRuntimeConfig = prev
        }
    })

    it("Free, bucket sans la tôle 3 : 200, la tôle 3 n'est plus attendue", async () => {
        state.bucket = makeBucket(['j_alt0_part_1.dxf', 'j_alt0_part_2.dxf'])
        const res = await fetch(`${base}/api/files/result/zip/nest-1`)
        expect(res.status).toBe(200)
        expect(zipEntryNames(Buffer.from(await res.arrayBuffer()))).toEqual(['j_alt0_part_1.dxf', 'j_alt0_part_2.dxf'])
    })

    it('payant, bucket sans la tôle 3 : 404 (jamais un ZIP auquel il manque une tôle)', async () => {
        state.cap = Infinity
        state.bucket = makeBucket(['j_alt0_part_1.dxf', 'j_alt0_part_2.dxf'])
        const res = await fetch(`${base}/api/files/result/zip/nest-1`)
        expect(res.status).toBe(404)
    })
})
