import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import {
    downloadLocalDxf,
    downloadLocalPositions,
    downloadLocalResult,
    downloadLocalZip,
} from '../composables/localDownloads'

// Lot positions : zéro des fichiers (corner / center) et CSV des positions,
// au point d'étranglement des téléchargements navigateur. Même stub DOM que
// localDownloads.test.js : chaque téléchargement est CAPTURÉ (nom + Blob).

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

const HEAD = (units = 4) => `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n9\n$INSUNITS\n70\n${units}\n9\n$MEASUREMENT\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\n0\n70\n0\n62\n7\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n`
const sheetDxf = (n, alt = 0, { box, center, cx = 100, cy = 50, units = 4 } = {}) => ({
    fileName: `rec_alt${alt}_part_${n}.dxf`,
    content: `${HEAD(units)}0\nCIRCLE\n5\n1\n8\n0\n100\nAcDbCircle\n10\n${cx}\n20\n${cy}\n40\n8.5\n0\nENDSEC\n0\nEOF\n`,
    ...(box ? { box } : {}),
    ...(center ? { center } : {}),
})
const circleCentre = (content) => {
    const l = content.split('\n')
    const start = l.indexOf('CIRCLE')
    const at = (code) => Number(l[l.indexOf(code, start) + 1])
    return [at('10'), at('20')]
}
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer())
const textOf = async (blob) => Buffer.from(await bytesOf(blob)).toString('utf8')
const entriesOf = async (blob) => Object.keys(unzipSync(await bytesOf(blob)))
const rec = (dxfs, extra = {}) => ({ slug: 'rec', alternatives: [{ layoutCount: dxfs.length, dxfs, ...extra }] })

describe('zéro des fichiers : DXF', () => {
    it('par défaut (coin) : le fichier stocké, octet pour octet, sous son nom — comme avant', async () => {
        const d = sheetDxf(1, 0, { box: [200, 100] })
        downloadLocalDxf(rec([d]), 0, 0, { maxSheet: Infinity })
        downloadLocalDxf(rec([d]), 0, 0, { maxSheet: Infinity, origin: 'corner' })
        expect(downloads.map((x) => x.name)).toEqual(['rec_alt0_part_1.dxf', 'rec_alt0_part_1.dxf'])
        for (const dl of downloads) expect(await textOf(dl.blob)).toBe(d.content)
    })

    it('centre : le centre de la boîte stockée devient (0, 0), nom en _center', async () => {
        downloadLocalDxf(rec([sheetDxf(1, 0, { box: [153, 153], cx: 76.5, cy: 76.5 })]), 0, 0, { maxSheet: Infinity, origin: 'center' })
        expect(downloads.map((x) => x.name)).toEqual(['rec_alt0_part_1_center.dxf'])
        expect(circleCentre(await textOf(downloads[0].blob))).toEqual([0, 0])
    })

    it('centre : le centre GARDÉ de la tôle (disque importé) passe devant celui de la boîte', async () => {
        const d = sheetDxf(1, 0, { box: [152.9901, 152.995], center: [76.5, 76.5], cx: 76.5, cy: 76.5 })
        downloadLocalDxf(rec([d]), 0, 0, { maxSheet: Infinity, origin: 'center' })
        expect(circleCentre(await textOf(downloads[0].blob))).toEqual([0, 0])
    })

    it('le verrou lit le nom STOCKÉ : tôle 3 avec maxSheet 2 en centre : sheet_locked, rien livré', () => {
        const r = rec([sheetDxf(1, 0, { box: [10, 10] }), sheetDxf(3, 0, { box: [10, 10] })])
        expect(() => downloadLocalDxf(r, 0, 1, { maxSheet: 2, origin: 'center' })).toThrow(/sheet_locked/)
        downloadLocalDxf(r, 0, 0, { maxSheet: 2, origin: 'center' })
        expect(downloads.map((x) => x.name)).toEqual(['rec_alt0_part_1_center.dxf'])
    })

    it('record ancien (sans box) : dimensions du rapport, retrouvées par le NUMÉRO de tôle, pas par l\'index', async () => {
        // dxfs désaligné : [part_1, part_3] ; la tôle 3 est la 3e du rapport (index 2), pas la 2e.
        const report = { sheets: [
            { index: 0, widthMm: 200, heightMm: 100 },
            { index: 1, widthMm: 1, heightMm: 1 },
            { index: 2, widthMm: 300, heightMm: 120 },
        ] }
        const r = rec([sheetDxf(1, 0, { cx: 100, cy: 50 }), sheetDxf(3, 0, { cx: 150, cy: 60 })], { report })
        downloadLocalDxf(r, 0, 1, { maxSheet: Infinity, origin: 'center' })
        expect(downloads[0].name).toBe('rec_alt0_part_3_center.dxf')
        expect(circleCentre(await textOf(downloads[0].blob))).toEqual([0, 0])
        downloadLocalDxf(r, 0, 0, { maxSheet: Infinity, origin: 'center' })
        expect(circleCentre(await textOf(downloads[1].blob))).toEqual([0, 0])
    })

    it('aucune boîte lisible : dxf_origin_unsupported, RIEN n\'est livré (jamais un fichier au coin)', () => {
        expect(() => downloadLocalDxf(rec([sheetDxf(1)]), 0, 0, { maxSheet: Infinity, origin: 'center' })).toThrow(/dxf_origin_unsupported/)
        const noIndex = rec([sheetDxf(1)], { report: { sheets: [{ widthMm: 200, heightMm: 100 }] } })
        expect(() => downloadLocalDxf(noIndex, 0, 0, { maxSheet: Infinity, origin: 'center' })).toThrow(/dxf_origin_unsupported/)
        expect(downloads).toHaveLength(0)
    })

    it('DXF qu\'on ne sait pas décaler : dxf_origin_unsupported, rien livré', () => {
        const odd = { ...sheetDxf(1, 0, { box: [10, 10] }), content: `${HEAD()}0\nINSERT\n5\n1\n10\n1\n20\n1\n0\nENDSEC\n0\nEOF\n` }
        expect(() => downloadLocalDxf(rec([odd]), 0, 0, { maxSheet: Infinity, origin: 'center' })).toThrow(/dxf_origin_unsupported/)
        expect(downloads).toHaveLength(0)
    })

    it('pouces : la boîte est en mm, le décalage en pouces (unité lue dans l\'en-tête du fichier)', async () => {
        const k = 1 / 25.4
        const d = sheetDxf(1, 0, { box: [200, 100], cx: 100 * k, cy: 50 * k, units: 1 })
        downloadLocalDxf(rec([d]), 0, 0, { maxSheet: Infinity, origin: 'center' })
        const [x, y] = circleCentre(await textOf(downloads[0].blob))
        expect(Math.abs(x)).toBeLessThan(1e-12)
        expect(Math.abs(y)).toBeLessThan(1e-12)
    })
})

describe('zéro des fichiers : ZIP et téléchargement principal', () => {
    const rec3 = () => ({
        slug: 'rec',
        alternatives: [{ layoutCount: 3, dxfs: [1, 2, 3].map((n) => sheetDxf(n, 0, { box: [200, 100] })) }],
    })

    it('centre : nesting-rec-center.zip, chaque DXF recentré et nommé _center', async () => {
        downloadLocalZip(rec3(), null, { maxSheet: Infinity, origin: 'center' })
        expect(downloads[0].name).toBe('nesting-rec-center.zip')
        expect(await entriesOf(downloads[0].blob)).toEqual([
            'rec_alt0_part_1_center.dxf', 'rec_alt0_part_2_center.dxf', 'rec_alt0_part_3_center.dxf',
        ])
        const files = unzipSync(await bytesOf(downloads[0].blob))
        for (const n of Object.keys(files)) expect(circleCentre(strFromU8(files[n]))).toEqual([0, 0])
    })

    it('archive partielle : nesting-rec-sheets-1-2-center.zip, tôle 3 absente', async () => {
        downloadLocalZip(rec3(), null, { maxSheet: 2, origin: 'center' })
        expect(downloads[0].name).toBe('nesting-rec-sheets-1-2-center.zip')
        expect(await entriesOf(downloads[0].blob)).toEqual(['rec_alt0_part_1_center.dxf', 'rec_alt0_part_2_center.dxf'])
    })

    it('un seul fichier impossible à recentrer : aucune archive livrée', () => {
        const r = rec3()
        r.alternatives[0].dxfs[1] = { ...r.alternatives[0].dxfs[1], box: undefined }
        expect(() => downloadLocalZip(r, null, { maxSheet: Infinity, origin: 'center' })).toThrow(/dxf_origin_unsupported/)
        expect(downloads).toHaveLength(0)
    })

    it('défaut : zip inchangé (nom et contenu) ; plafond 0 : sheet_locked même en centre', async () => {
        downloadLocalZip(rec3(), null, { maxSheet: Infinity })
        expect(downloads[0].name).toBe('nesting-rec.zip')
        const files = unzipSync(await bytesOf(downloads[0].blob))
        expect(strFromU8(files['rec_alt0_part_2.dxf'])).toBe(rec3().alternatives[0].dxfs[1].content)
        expect(() => downloadLocalZip(rec3(), null, { maxSheet: 0, origin: 'center' })).toThrow(/sheet_locked/)
    })

    it('downloadLocalResult : mono-tôle en centre -> un DXF _center ; multi -> le zip centré', () => {
        const mono = { slug: 'rec', alternatives: [{ layoutCount: 1, dxfs: [sheetDxf(1, 0, { box: [200, 100] })] }] }
        downloadLocalResult(mono, 0, { maxSheet: Infinity, origin: 'center' })
        expect(downloads[0].name).toBe('rec_alt0_part_1_center.dxf')
        downloadLocalResult(rec3(), 0, { maxSheet: Infinity, origin: 'center' })
        expect(downloads[1].name).toBe('nesting-rec-center.zip')
    })
})

describe('downloadLocalPositions', () => {
    const rows1 = [
        { fileSlug: 'a', x: 76.5, y: 76.5, d: 17, rot: null },
        { fileSlug: 'b', x: 100, y: 20, d: null, rot: 90 },
    ]
    const recP = (extra = {}) => ({
        slug: 'rec',
        alternatives: [{
            layoutCount: 3,
            outputUnit: 'mm',
            fileNames: { a: 'rond.dxf' },
            positions: [
                { sheet: 1, box: [153, 153], rows: rows1 },
                { sheet: 2, box: [153, 153], rows: [{ fileSlug: 'a', x: 10, y: 10, d: 17, rot: null }] },
                { sheet: 3, box: [153, 153], rows: [{ fileSlug: 'a', x: 20, y: 20, d: 17, rot: null }] },
            ],
            ...extra,
        }],
    })
    const lines = async (blob) => (await textOf(blob)).slice(1).split('\r\n')

    it('coin : rec_alt0_positions.csv (même jeton 0-based que les DXF), noms du record, slug en repli', async () => {
        downloadLocalPositions(recP(), 0, { maxSheet: Infinity })
        expect(downloads[0].name).toBe('rec_alt0_positions.csv')
        const l = await lines(downloads[0].blob)
        expect(l[0]).toBe('Sheet,Part,X (mm),Y (mm),Diameter (mm),Rotation (deg)')
        expect(l[1]).toBe('1,rond.dxf,76.5000,76.5000,17.0000,')
        expect(l[2]).toBe('1,b,100.0000,20.0000,,90.0000')
    })

    it('centre : _center dans le nom, centre de CHAQUE tôle', async () => {
        downloadLocalPositions(recP(), 0, { maxSheet: Infinity, origin: 'center' })
        expect(downloads[0].name).toBe('rec_alt0_positions_center.csv')
        const l = await lines(downloads[0].blob)
        expect(l[1]).toBe('1,rond.dxf,0.0000,0.0000,17.0000,')
        expect(l[2]).toBe('1,b,23.5000,-56.5000,,90.0000')
    })

    it('même verrou que les DXF : tôles au-delà de maxSheet écartées, plafond 0 : sheet_locked', async () => {
        downloadLocalPositions(recP(), 0, { maxSheet: 2 })
        const l = await lines(downloads[0].blob)
        expect(l.map((x) => x.split(',')[0])).toEqual(['Sheet', '1', '1', '2'])
        expect(() => downloadLocalPositions(recP(), 0, { maxSheet: 0 })).toThrow(/sheet_locked/)
        // Tôle importée + compte verrouillé (plafond fini) : plafond 0, comme les DXF.
        const imported = recP({ report: { totals: { shapedSheetCount: 1 } } })
        expect(() => downloadLocalPositions(imported, 0, { maxSheet: 2 })).toThrow(/sheet_locked/)
        downloadLocalPositions(imported, 0, { maxSheet: Infinity })
        expect(downloads).toHaveLength(2)
    })

    it('tôles écartées par le plafond : le nom le dit (_sheets-1-N), comme l’archive', async () => {
        downloadLocalPositions(recP(), 0, { maxSheet: 2 })
        downloadLocalPositions(recP(), 0, { maxSheet: 2, origin: 'center' })
        downloadLocalPositions(recP(), 0, { maxSheet: Infinity, origin: 'center' })
        expect(downloads.map((d) => d.name)).toEqual([
            'rec_alt0_positions_sheets-1-2.csv',
            'rec_alt0_positions_sheets-1-2_center.csv',
            'rec_alt0_positions_center.csv',
        ])
    })

    it('le CSV d’une option porte le même jeton que ses DXF : option 2 = rec_alt1_', () => {
        const r = recP()
        r.alternatives.push({ ...r.alternatives[0], dxfs: [sheetDxf(1, 1, { box: [153, 153] })] })
        downloadLocalPositions(r, 1, { maxSheet: Infinity })
        downloadLocalDxf(r, 1, 0, { maxSheet: Infinity })
        expect(downloads.map((d) => d.name)).toEqual(['rec_alt1_positions.csv', 'rec_alt1_part_1.dxf'])
    })

    it('sortie en pouces : unité du DXF livré (5 décimales)', async () => {
        downloadLocalPositions(recP({ outputUnit: 'inch' }), 0, { maxSheet: Infinity })
        const l = await lines(downloads[0].blob)
        expect(l[0]).toContain('X (in)')
        expect(l[1]).toBe(`1,rond.dxf,${(76.5 / 25.4).toFixed(5)},${(76.5 / 25.4).toFixed(5)},${(17 / 25.4).toFixed(5)},`)
    })

    it('record d\'avant (sans positions) : positions_unavailable ; alternative inconnue de même', () => {
        const old = { slug: 'rec', alternatives: [{ layoutCount: 1, dxfs: [sheetDxf(1)] }] }
        expect(() => downloadLocalPositions(old, 0, { maxSheet: Infinity })).toThrow(/positions_unavailable/)
        expect(() => downloadLocalPositions(recP(), 5, { maxSheet: Infinity })).toThrow(/positions_unavailable/)
        expect(downloads).toHaveLength(0)
    })
})
