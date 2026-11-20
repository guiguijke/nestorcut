import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Lot 7 : le DXF LIVRÉ d'une tôle importée. Le DXF est celui du bundle wasm
// livré (public/geometry), appelé par le vrai chemin buildAlternativeArtifacts
// -> buildSheetDxf ; seul le pont worker (geometryClient) est remplacé par un
// appel direct au même module.

const BUNDLE_JS = path.resolve(__dirname, '../../public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.resolve(__dirname, '../../public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null, specs: [] }))

vi.mock('../composables/geometryClient', () => ({
    geoExportSvgSheet: vi.fn(async (spec) => glue.mod.export_svg_sheet(JSON.stringify(spec))),
    geoExportDxfSheet: vi.fn(async (slugs, sources, spec) => {
        glue.specs.push(spec)
        return glue.mod.export_dxf_sheet(slugs, sources.map((b) => new Uint8Array(b)), JSON.stringify(spec))
    }),
    geoPinwheelCapacity: vi.fn(async () => ({ rotations: [] })),
    geoComputeReport: vi.fn(async (spec) => JSON.parse(glue.mod.compute_report(JSON.stringify(spec)))),
}))

import { buildAlternativeArtifacts, buildSheetDxf, binShapeForDxf } from '../composables/localBridge'
import { uniquifyDxfHandles } from '../composables/localHydrate'

const require = createRequire(import.meta.url)
const dxfParserUrl = pathToFileURL(require.resolve('dxf-viewer/src/parser/DxfParser.js')).href

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
})
beforeEach(() => { glue.specs.length = 0 })

const enc = (s) => new Uint8Array(Buffer.from(s))
const SOURCES = {
    f0: enc('0\nSECTION\n2\nENTITIES\n0\nLINE\n5\nA1\n8\n0\n10\n0\n20\n0\n11\n10\n21\n0\n0\nENDSEC\n0\nEOF\n'),
    f1: enc('0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n5\nB2\n8\nCUT\n10\n5\n20\n5\n40\n3\n0\nENDSEC\n0\nEOF\n'),
}

const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const DISC = (() => {
    const r = Array.from({ length: 72 }, (_, k) => {
        const a = (k * 5 * Math.PI) / 180
        return [500 + 500 * Math.cos(a), 500 + 500 * Math.sin(a)]
    })
    r.push(r[0])
    return r
})()
const ZONE_A = sq(200, 200, 300, 300)
const ZONE_B = [[600, 600], [700, 620], [680, 720], [600, 600]]
const TRI = [[0, 0], [800, 0], [0, 600], [0, 0]]
const bin = (id, data) => ({ id, cost: 1, stock: 1, shape: { type: 'polygon', data } })
const RECT = (id, w = 1000, h = 1000) => bin(id, { outer: sq(0, 0, w, h) })
const part = (id) => ({
    id, file_slug: `f${id}`, handles: [id === 0 ? 'A1' : 'B2'],
    coords: sq(0, 0, 100, 100), holes: [], count: 1, color: '#2563EB',
})
const place = (x, y, id, rotation = 0) => ({ item_id: id, transformation: { rotation, translation: [x, y] } })
const payloadOf = (bins, shaped, opts = {}) => ({
    problem: 'bpp',
    instance: { name: 't', bins, items: [{ id: 0, demand: 1 }, { id: 1, demand: 1 }] },
    engineConfig: { min_item_separation: 2 },
    requestedSpace: 2,
    parts: [part(0), part(1)],
    ...opts,
    ...(shaped.length ? { shapedSheets: shaped.map((id) => ({ id, usableAreaMm2: 1, perimeterMm: 1 })) } : {}),
})
const resultOf = (layouts) => ({ problem: 'bpp', alternatives: [{ rank: 0, seed: 1, solution: { layouts } }] })
const LAYOUT = (containerId) => ({
    container_id: containerId,
    placed_items: [place(400, 400, 0), place(450, 300, 1, 90)],
})

/** Chemin complet : poses -> containers -> DXF livré de chaque tôle. */
async function deliver(payload, layouts) {
    const arts = await buildAlternativeArtifacts(resultOf(layouts), payload)
    const containers = arts[0].containers
    const out = []
    for (let i = 0; i < containers.length; i++) {
        out.push(await buildSheetDxf('job', i + 1, containers[i], payload, SOURCES))
    }
    return { containers, files: out }
}

const pairs = (text) => {
    const l = text.split('\n')
    const p = []
    for (let i = 0; i + 1 < l.length; i += 2) p.push([l[i], l[i + 1]])
    return p
}
/** Entités LWPOLYLINE d'un calque, en sommets [x, y] (sans fermeture répétée). */
function polylinesOn(text, layer) {
    const p = pairs(text)
    const out = []
    for (let i = 0; i < p.length; i++) {
        if (p[i][0] !== '0' || p[i][1] !== 'LWPOLYLINE') continue
        let j = i + 1
        let on = false
        let closed = null
        const xs = []
        const ys = []
        for (; j < p.length && p[j][0] !== '0'; j++) {
            if (p[j][0] === '8') on = p[j][1] === layer
            if (p[j][0] === '70') closed = p[j][1]
            if (p[j][0] === '10') xs.push(Number(p[j][1]))
            if (p[j][0] === '20') ys.push(Number(p[j][1]))
        }
        if (on) out.push({ pts: xs.map((x, k) => [x, ys[k]]), closed })
    }
    return out
}
const withoutClosing = (ring) => ring.slice(0, -1)
/** Le texte des entités AVANT la première polyligne de tôle : les pièces. */
const partsText = (text) => {
    const body = text.slice(text.indexOf('2\nENTITIES\n'))
    return body.slice(0, body.indexOf('0\nLWPOLYLINE\n'))
}
const layerNames = (text) => {
    const p = pairs(text.slice(text.indexOf('2\nLAYER\n'), text.indexOf('0\nENDTAB')))
    return p.filter(([c]) => c === '2').map(([, v]) => v).slice(1)
}

/** Sortie de HEAD (bundle d'avant le lot), mêmes poses : tôle rectangle 1000 x 500,
 * option active, mm. Une tôle sans forme importée ne bouge pas d'un octet. */
const HEAD_PLAIN = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n9\n$INSUNITS\n70\n4\n9\n$MEASUREMENT\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\n0\n70\n0\n62\n7\n0\nLAYER\n2\nCUT\n70\n0\n62\n7\n0\nLAYER\n2\nBIN_BOUNDARY\n70\n0\n62\n5\n0\nLAYER\n2\nOUT_SHAPE\n70\n0\n62\n1\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n5\n1\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n5.0\n20\n5.0\n11\n15.0\n21\n5.0\n0\nCIRCLE\n5\n2\n100\nAcDbEntity\n8\nCUT\n100\nAcDbCircle\n10\n45.0\n20\n45.0\n40\n3.0\n0\nLWPOLYLINE\n5\n3\n100\nAcDbEntity\n8\nBIN_BOUNDARY\n100\nAcDbPolyline\n90\n4\n70\n1\n10\n0.0\n20\n0.0\n10\n1000.0\n20\n0.0\n10\n1000.0\n20\n500.0\n10\n0.0\n20\n500.0\n0\nLWPOLYLINE\n5\n4\n100\nAcDbEntity\n8\nOUT_SHAPE\n100\nAcDbPolyline\n90\n4\n70\n1\n10\n3.0\n20\n3.0\n10\n50.0\n20\n3.0\n10\n50.0\n20\n50.0\n10\n3.0\n20\n50.0\n0\nENDSEC\n0\nEOF\n'

describe('DXF livré — job sans tôle importée', () => {
    it('octets de HEAD, option active', async () => {
        const p = payloadOf([RECT(0, 1000, 500)], [], { addOutShape: true })
        const arts = await buildAlternativeArtifacts(resultOf([{
            container_id: 0,
            placed_items: [place(5, 5, 0), place(50, 40, 1, 90)],
        }]), p)
        const containers = arts[0].containers
        const file = await buildSheetDxf('job', 1, containers[0], p, SOURCES)
        expect(file.content).toBe(HEAD_PLAIN)
        // Rien de nouveau ne traverse : ni clé de container, ni forme dans le spec wasm.
        expect(Object.keys(containers[0])).not.toContain('container_id')
        expect(Object.keys(glue.specs[0])).not.toContain('bin_shape')
    })
})

describe('DXF livré — tôle importée', () => {
    const bins = [bin(0, { outer: DISC, inner: [ZONE_A, ZONE_B] })]

    it('option active : le vrai contour sur BIN_BOUNDARY, chaque zone sur FORBIDDEN_ZONE', async () => {
        const p = payloadOf(bins, [0], { addOutShape: true })
        const { containers, files } = await deliver(p, [LAYOUT(0)])
        const dxf = files[0].content
        const outline = polylinesOn(dxf, 'BIN_BOUNDARY')
        expect(outline).toHaveLength(1)
        expect(outline[0].closed).toBe('1')
        expect(outline[0].pts).toHaveLength(DISC.length - 1)
        expect(outline[0].pts).toEqual(withoutClosing(DISC))
        const zones = polylinesOn(dxf, 'FORBIDDEN_ZONE')
        expect(zones.map((z) => z.pts)).toEqual([withoutClosing(ZONE_A), withoutClosing(ZONE_B)])
        expect(zones.every((z) => z.closed === '1')).toBe(true)
        // Calque déclaré, couleur explicite distincte de BIN_BOUNDARY (5), OUT_SHAPE (1) et des pièces (7).
        expect(dxf).toContain('0\nLAYER\n2\nFORBIDDEN_ZONE\n70\n0\n62\n6\n')
        // Pas de cadre autour des pièces sur une tôle importée (décision du 20/11).
        expect(layerNames(dxf)).toEqual(['0', 'CUT', 'BIN_BOUNDARY', 'FORBIDDEN_ZONE'])
        expect(dxf).not.toContain('OUT_SHAPE')
        // Plus aucune trace du rectangle de la boîte : un seul tracé BIN_BOUNDARY, à N sommets.
        expect(dxf).not.toContain('10\n1000.0\n20\n0.0\n10\n1000.0\n20\n1000.0')
        // Le container ne porte que le format, jamais un anneau.
        expect(containers[0].container_id).toBe(0)
        expect(JSON.stringify(containers)).not.toContain(`${ZONE_B[1][0]},${ZONE_B[1][1]}`)
        // Poignées valides et uniques.
        const handles = pairs(dxf).filter(([c]) => c === '5').map(([, v]) => v)
        expect(new Set(handles).size).toBe(handles.length)
        expect(handles.every((h) => /^[0-9A-F]+$/.test(h))).toBe(true)
    })

    // Décision du propriétaire (20/11) : le vrai contour et les zones sont
    // TOUJOURS dans le fichier d'une tôle importée, option cochée ou non.
    it('option cochée ou non : même fichier, vrai contour et zones dans les deux cas', async () => {
        const on = (await deliver(payloadOf(bins, [0], { addOutShape: true }), [LAYOUT(0)])).files[0].content
        const off = (await deliver(payloadOf(bins, [0], { addOutShape: false }), [LAYOUT(0)])).files[0].content
        expect(off).toBe(on)
        expect(partsText(off)).toContain('0\nLINE\n')
        expect(polylinesOn(off, 'BIN_BOUNDARY')[0].pts).toEqual(withoutClosing(DISC))
        expect(polylinesOn(off, 'FORBIDDEN_ZONE')).toHaveLength(2)
        expect(off).not.toContain('OUT_SHAPE')
    })

    it('les pièces sont celles d\'une tôle rectangulaire de même boîte ; elle garde rectangle et cadre', async () => {
        const shaped = (await deliver(payloadOf(bins, [0], { addOutShape: true }), [LAYOUT(0)])).files[0].content
        const specsBefore = glue.specs.length
        const rect = (await deliver(payloadOf([RECT(0)], [], { addOutShape: true }), [LAYOUT(0)])).files[0].content
        expect(partsText(shaped)).toBe(partsText(rect))
        expect(polylinesOn(rect, 'BIN_BOUNDARY')[0].pts).toEqual([[0, 0], [1000, 0], [1000, 1000], [0, 1000]])
        expect(polylinesOn(rect, 'OUT_SHAPE')).toHaveLength(1)
        expect(rect).not.toContain('FORBIDDEN_ZONE')
        // Le job rectangulaire n'envoie aucune clé de forme au wasm.
        expect(glue.specs.length).toBe(specsBefore + 1)
        expect(Object.keys(glue.specs[glue.specs.length - 1])).not.toContain('bin_shape')
    })

    it('coordonnée non finie dans la forme : le rectangle reste, le fichier existe', async () => {
        // Appel direct de buildSheetDxf : le rapport, en amont, refuse déjà un
        // tel anneau ; ici on verrouille seulement que l'écriture du DXF ne
        // perd pas le fichier.
        // `null` : devenu le texte "null", il faisait jeter le lecteur du wasm
        // et buildSheetDxf rendait null (fichier de la tôle perdu).
        const broken = [bin(0, { outer: DISC.map((p, i) => (i === 2 ? [null, p[1]] : p)), inner: [ZONE_A] })]
        const file = await buildSheetDxf('job', 1, {
            bin_width: 1000, bin_height: 1000, container_id: 0,
            transforms: [{ item_id: '0', file_slug: 'f0', handles: ['A1'], angle: 0, x: 1, y: 1 }],
        }, payloadOf(broken, [0], { addOutShape: false }), SOURCES)
        expect(file).not.toBeNull()
        expect(polylinesOn(file.content, 'BIN_BOUNDARY')[0].pts).toEqual([[0, 0], [1000, 0], [1000, 1000], [0, 1000]])
        expect(file.content).not.toContain('FORBIDDEN_ZONE')
    })

    it('sortie en pouces : contour et zones suivent la même conversion que les pièces', async () => {
        const p = payloadOf(bins, [0], { addOutShape: true, outputUnit: 'inch' })
        const dxf = (await deliver(p, [LAYOUT(0)])).files[0].content
        expect(dxf).toContain('9\n$INSUNITS\n70\n1\n')
        const k = 1 / 25.4
        const outline = polylinesOn(dxf, 'BIN_BOUNDARY')[0].pts
        expect(outline[3]).toEqual([DISC[3][0] * k, DISC[3][1] * k])
        const zone = polylinesOn(dxf, 'FORBIDDEN_ZONE')[1].pts
        expect(zone[1]).toEqual([ZONE_B[1][0] * k, ZONE_B[1][1] * k])
    })

    it('format importé sans zone : pas de calque de zones', async () => {
        const p = payloadOf([bin(0, { outer: TRI })], [0], { addOutShape: true })
        const dxf = (await deliver(p, [LAYOUT(0)])).files[0].content
        expect(polylinesOn(dxf, 'BIN_BOUNDARY')[0].pts).toEqual(withoutClosing(TRI))
        expect(dxf).not.toContain('FORBIDDEN_ZONE')
    })

    it('job mixte (rectangle + importée) et deux tôles importées : chaque fichier a la forme de SON format', async () => {
        const mixed = [RECT(0), bin(1, { outer: DISC, inner: [ZONE_A] }), bin(2, { outer: TRI })]
        const p = payloadOf(mixed, [1, 2], { addOutShape: true })
        // L'ordre des layouts n'est pas l'ordre des formats ; deux tôles du format 1.
        const { files } = await deliver(p, [LAYOUT(1), LAYOUT(0), LAYOUT(2), LAYOUT(1)])
        expect(files.map((f) => f.fileName)).toEqual([1, 2, 3, 4].map((n) => `job_part_${n}.dxf`))
        expect(polylinesOn(files[0].content, 'BIN_BOUNDARY')[0].pts).toEqual(withoutClosing(DISC))
        expect(polylinesOn(files[0].content, 'FORBIDDEN_ZONE')).toHaveLength(1)
        // Le rectangle reste un rectangle, sans zone.
        expect(polylinesOn(files[1].content, 'BIN_BOUNDARY')[0].pts)
            .toEqual([[0, 0], [1000, 0], [1000, 1000], [0, 1000]])
        expect(files[1].content).not.toContain('FORBIDDEN_ZONE')
        expect(polylinesOn(files[2].content, 'BIN_BOUNDARY')[0].pts).toEqual(withoutClosing(TRI))
        expect(files[2].content).not.toContain('FORBIDDEN_ZONE')
        expect(files[3].content).toBe(files[0].content)
    })

    it('forme introuvable (format hors liste) : le rectangle de HEAD, jamais un DXF vide', async () => {
        const p = payloadOf(bins, [0], { addOutShape: true })
        expect(binShapeForDxf(p, { container_id: 7 })).toBeNull()
        expect(binShapeForDxf(p, {})).toBeNull()
        expect(binShapeForDxf(payloadOf(bins, [], {}), { container_id: 0 })).toBeNull()
        const dxf = (await buildSheetDxf('job', 1, {
            bin_width: 1000, bin_height: 1000, container_id: 7,
            transforms: [{ item_id: '0', file_slug: 'f0', handles: ['A1'], angle: 0, x: 1, y: 1 }],
        }, p, SOURCES)).content
        expect(polylinesOn(dxf, 'BIN_BOUNDARY')[0].pts).toHaveLength(4)
    })
})

const PARSER_WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.parserUrl).then((mod) => {
    const parsed = new mod.default().parseSync(workerData.dxf);
    const layers = (parsed.tables && parsed.tables.layer && parsed.tables.layer.layers) || {};
    parentPort.postMessage({
        ok: true,
        layers: Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, v.colorIndex])),
        entities: (parsed.entities || []).map((e) => ({ type: e.type, layer: e.layer, n: (e.vertices || []).length, shape: e.shape })),
    });
}).catch((err) => parentPort.postMessage({ ok: false, error: String((err && err.stack) || err) }));
`
function parseInWorker(dxf, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const w = new Worker(PARSER_WORKER_SRC, { eval: true, workerData: { parserUrl: dxfParserUrl, dxf } })
        const timer = setTimeout(() => { w.terminate(); reject(new Error('analyseur sans réponse (boucle ?)')) }, timeoutMs)
        w.on('message', (m) => { clearTimeout(timer); w.terminate(); if (m.ok) resolve(m); else reject(new Error(m.error)) })
        w.on('error', (e) => { clearTimeout(timer); reject(e) })
    })
}

describe('DXF livré — la vue DXF (analyseur de dxf-viewer)', () => {
    it('le texte passé par uniquifyDxfHandles est analysé, calques et couleurs compris', async () => {
        const bins = [bin(0, { outer: DISC, inner: [ZONE_A, ZONE_B] })]
        const dxf = (await deliver(payloadOf(bins, [0], { addOutShape: true }), [LAYOUT(0)])).files[0].content
        const msg = await parseInWorker(uniquifyDxfHandles(dxf))
        expect(msg.layers.BIN_BOUNDARY).toBe(5)
        expect(msg.layers.FORBIDDEN_ZONE).toBe(6)
        const onLayer = (l) => msg.entities.filter((e) => e.layer === l)
        expect(onLayer('BIN_BOUNDARY')).toHaveLength(1)
        expect(onLayer('BIN_BOUNDARY')[0].n).toBe(DISC.length - 1)
        expect(onLayer('FORBIDDEN_ZONE').map((e) => e.n)).toEqual([4, 3])
        expect(onLayer('FORBIDDEN_ZONE').every((e) => e.shape === true)).toBe(true)
        // Réécrire les poignées ne change ni les calques ni la géométrie.
        const handles = pairs(uniquifyDxfHandles(dxf)).filter(([c]) => c === '5').map(([, v]) => v)
        expect(new Set(handles).size).toBe(handles.length)
    }, 15000)
})
