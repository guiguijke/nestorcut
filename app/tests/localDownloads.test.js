import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import {
    downloadLocalDxf,
    downloadLocalJob,
    downloadLocalJobs,
    downloadLocalResult,
    downloadLocalZip,
} from '../composables/localDownloads'

// O2/d4 (02/11) : le point d'étranglement navigateur du verrou des tôles.
// Le DOM n'existe pas en node : stub minimal (modèle sheetcamLeads.test.js
// J8-a) qui CAPTURE chaque téléchargement — nom ET Blob — pour relire le
// contenu réel des archives.

let downloads = []
let realDocument
let realUrl

beforeEach(() => {
    downloads = []
    realDocument = globalThis.document
    realUrl = globalThis.URL
    const blobs = new Map()
    let seq = 0
    globalThis.document = {
        createElement: (tag) => {
            const el = {
                tag,
                style: {},
                href: '',
                download: '',
                click: () => downloads.push({ name: el.download, blob: blobs.get(el.href) }),
                remove: () => {},
            }
            return el
        },
        body: { appendChild: () => {} },
    }
    globalThis.URL = class FakeURL {
        static createObjectURL(blob) {
            const url = `blob:fake/${++seq}`
            blobs.set(url, blob)
            return url
        }
        static revokeObjectURL() {}
    }
})

afterEach(() => {
    if (realDocument === undefined) delete globalThis.document
    else globalThis.document = realDocument
    globalThis.URL = realUrl
})

const entriesOf = async (blob) => {
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    return Object.keys(files)
}

const dxf = (n, alt = 0) => ({ fileName: `rec_alt${alt}_part_${n}.dxf`, content: `0\nSECTION\n${n}\n0\nEOF` })
const job = (n) => ({ fileName: `rec_tole${n}.job`, bytes: new Uint8Array([n, 0, n]) })

const makeRecord = () => ({
    slug: 'rec',
    alternatives: [
        { layoutCount: 3, dxfs: [dxf(1), dxf(2), dxf(3)], jobs: [job(1), job(2), job(3)] },
        { layoutCount: 3, dxfs: [dxf(1, 1), dxf(2, 1), dxf(3, 1)] },
    ],
})

describe('downloadLocalZip', () => {
    it('maxSheet 2 : archive partielle des tôles 1-2, nom nesting-rec-sheets-1-2.zip', async () => {
        downloadLocalZip(makeRecord(), null, { maxSheet: 2 })
        expect(downloads).toHaveLength(1)
        expect(downloads[0].name).toBe('nesting-rec-sheets-1-2.zip')
        expect(await entriesOf(downloads[0].blob)).toEqual(['rec_alt0_part_1.dxf', 'rec_alt0_part_2.dxf'])
        const files = unzipSync(new Uint8Array(await downloads[0].blob.arrayBuffer()))
        expect(strFromU8(files['rec_alt0_part_2.dxf'])).toContain('SECTION\n2')
    })

    it('sans option : les 3 tôles, nom inchangé nesting-rec.zip', async () => {
        downloadLocalZip(makeRecord())
        expect(downloads[0].name).toBe('nesting-rec.zip')
        expect(await entriesOf(downloads[0].blob)).toEqual([
            'rec_alt0_part_1.dxf', 'rec_alt0_part_2.dxf', 'rec_alt0_part_3.dxf',
        ])
    })

    it('rien d’autorisé : zip_empty (aucune archive vide livrée)', () => {
        const rec = { slug: 'rec', alternatives: [{ dxfs: [dxf(3), dxf(4)] }] }
        expect(() => downloadLocalZip(rec, null, { maxSheet: 2 })).toThrow(/zip_empty/)
        expect(downloads).toHaveLength(0)
    })
})

describe('downloadLocalDxf', () => {
    it('tôle 3 avec maxSheet 2 : sheet_locked, rien livré', () => {
        expect(() => downloadLocalDxf(makeRecord(), 0, 2, { maxSheet: 2 })).toThrow(/sheet_locked/)
        expect(downloads).toHaveLength(0)
    })

    it('tôles 1-2 : livrées sous leur nom', () => {
        downloadLocalDxf(makeRecord(), 0, 1, { maxSheet: 2 })
        expect(downloads.map((d) => d.name)).toEqual(['rec_alt0_part_2.dxf'])
    })

    it('d4 : record désaligné [part_1, part_3] — l’index 1 est la tôle 3, verrouillée par son NOM', () => {
        const rec = { slug: 'rec', alternatives: [{ dxfs: [dxf(1), dxf(3)] }] }
        expect(() => downloadLocalDxf(rec, 0, 1, { maxSheet: 2 })).toThrow(/sheet_locked/)
        downloadLocalDxf(rec, 0, 0, { maxSheet: 2 })
        expect(downloads.map((d) => d.name)).toEqual(['rec_alt0_part_1.dxf'])
    })

    it('alternative ≠ 0 : ses tôles 1-2 sont autorisées (d4, par alternative)', () => {
        downloadLocalDxf(makeRecord(), 1, 1, { maxSheet: 2 })
        expect(downloads.map((d) => d.name)).toEqual(['rec_alt1_part_2.dxf'])
        expect(() => downloadLocalDxf(makeRecord(), 1, 2, { maxSheet: 2 })).toThrow(/sheet_locked/)
    })
})

describe('downloadLocalJob / downloadLocalJobs', () => {
    it('downloadLocalJobs maxSheet 2 : deux .job, tole1 et tole2 seulement', async () => {
        downloadLocalJobs(makeRecord(), 0, { maxSheet: 2 })
        await new Promise((r) => setTimeout(r, 700))
        expect(downloads.map((d) => d.name)).toEqual(['rec_tole1.job', 'rec_tole2.job'])
    })

    it('downloadLocalJobs sans .job autorisé : job_unavailable', () => {
        const rec = { slug: 'rec', alternatives: [{ jobs: [job(3), job(4)] }] }
        expect(() => downloadLocalJobs(rec, 0, { maxSheet: 2 })).toThrow(/job_unavailable/)
    })

    it('downloadLocalJob tôle 3 : sheet_locked ; tôle 2 : livrée', () => {
        expect(() => downloadLocalJob(makeRecord(), 0, 2, { maxSheet: 2 })).toThrow(/sheet_locked/)
        expect(downloads).toHaveLength(0)
        downloadLocalJob(makeRecord(), 0, 1, { maxSheet: 2 })
        expect(downloads.map((d) => d.name)).toEqual(['rec_tole2.job'])
    })
})

describe('downloadLocalResult', () => {
    it('multi-tôles avec maxSheet 2 : ZIP partiel', async () => {
        downloadLocalResult(makeRecord(), 0, { maxSheet: 2 })
        expect(downloads[0].name).toBe('nesting-rec-sheets-1-2.zip')
        expect(await entriesOf(downloads[0].blob)).toEqual(['rec_alt0_part_1.dxf', 'rec_alt0_part_2.dxf'])
    })

    it('mono-tôle : le DXF part_1 (jamais verrouillé)', () => {
        const rec = { slug: 'rec', alternatives: [{ layoutCount: 1, dxfs: [dxf(1)] }] }
        downloadLocalResult(rec, 0, { maxSheet: 2 })
        expect(downloads.map((d) => d.name)).toEqual(['rec_alt0_part_1.dxf'])
    })
})

// §3.4 / C1-6 : le filtre est OUVERT par défaut (Infinity) — un appelant
// oublié livrerait tout en silence. Ce test statique ferme la porte : tout
// appel de l'app passe un `maxSheet`.
describe('test statique des appelants', () => {
    const appDir = fileURLToPath(new URL('..', import.meta.url))
    const SKIP_DIRS = new Set(['tests', 'node_modules', '.nuxt', '.output', '.cache'])
    const walk = (dir, out = []) => {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name)
            if (statSync(full).isDirectory()) {
                if (!SKIP_DIRS.has(name)) walk(full, out)
            } else if (/\.(vue|js)$/.test(name)) {
                out.push(full)
            }
        }
        return out
    }
    const balancedCall = (src, start) => {
        let depth = 0
        for (let i = start; i < src.length; i++) {
            if (src[i] === '(') depth++
            else if (src[i] === ')') {
                depth--
                if (depth === 0) return src.slice(start, i + 1)
            }
        }
        return src.slice(start)
    }

    it('chaque appel downloadLocal(Dxf|Zip|Job|Jobs|Result)( hors du module passe maxSheet', () => {
        const files = walk(appDir).filter((f) => !f.endsWith(join('composables', 'localDownloads.js')))
        const calls = []
        const re = /\bdownloadLocal(Dxf|Zip|Job|Jobs|Result)\(/g
        for (const file of files) {
            const src = readFileSync(file, 'utf8')
            for (const m of src.matchAll(re)) {
                const parenAt = m.index + m[0].length - 1
                calls.push({ file: relative(appDir, file), call: m[0].slice(0, -1) + balancedCall(src, parenAt) })
            }
        }
        // Garde contre un motif devenu aveugle : 6 appelants aujourd'hui
        // (ResultModal ×5, UserResultItem ×1).
        expect(calls.length).toBeGreaterThanOrEqual(6)
        const missing = calls.filter((c) => !c.call.includes('maxSheet'))
        expect(missing).toEqual([])
    })
})
