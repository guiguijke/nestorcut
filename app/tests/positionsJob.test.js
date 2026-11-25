import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Lot positions, résultats SheetCam (.job) : la réserve d'amorce ÉLARGIT l'anneau du
// payload ; les positions se mesurent sur les entités livrées, elles sont donc
// justes aussi pour un projet .job.

const BUNDLE_JS = path.resolve(__dirname, '../../public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.resolve(__dirname, '../../public/geometry/nest_geometry_bg.wasm')
const FIX = path.resolve(__dirname, 'fixtures/sheetcam')
const glue = vi.hoisted(() => ({ mod: null }))

vi.mock('../composables/geometryClient', async (importOriginal) => ({
    ...(await importOriginal()),
    geoExportSvgSheet: vi.fn(async (spec) => glue.mod.export_svg_sheet(JSON.stringify(spec))),
    geoExportDxfSheet: vi.fn(async (slugs, sources, spec) =>
        glue.mod.export_dxf_sheet(slugs, sources.map((b) => new Uint8Array(b)), JSON.stringify(spec))),
    geoPinwheelCapacity: vi.fn(async () => ({ rotations: [] })),
    geoComputeReport: vi.fn(async (spec) => JSON.parse(glue.mod.compute_report(JSON.stringify(spec)))),
}))

import { attachRingHulls, buildLocalPayload } from '../composables/localPayloadBuilder'
import { assembleBrowserArtifacts, dropPositionsUnlessBrowserBuilt } from '../composables/finalizeLocal'
import { readSheetCamJob } from '../composables/localImport'
import { cutSettingsFor, prefillFromJob, splitSheetCamDrop } from '../composables/sheetcamJobImport'
import { jobDrawings } from '../../shared/sheetcamJob'
import { hydrateLocalItem } from '../composables/localHydrate'
import { readDxfEntities } from '../utils/dxfEntities'

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
})

const file = (name) => {
    const b = readFileSync(path.join(FIX, name))
    return { name, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
}

/** Le chemin de l'application, de la dépose du .job au DXF livré. */
async function runJob(jobName) {
    const dxf = new Uint8Array(readFileSync(path.join(FIX, 'piece-l.dxf')))
    let sheetcam = null
    let space = 4
    if (jobName) {
        const drop = await splitSheetCamDrop([file(jobName), file('piece-l.dxf')])
        const read = readSheetCamJob(drop.jobBytes)
        const d = read.drawings[0]
        const block = jobDrawings(read.job.binary)[d.originalRank]
        const starts = (block.paths || []).map((p, pathIndex) => ({
            pathIndex, offset: p.startRaw ?? p.start, leadIn: p.leadIn ?? d.leadIn, leadOut: p.leadOut ?? d.leadOut,
            leadInType: d.leadInType, leadOutType: d.leadOutType, order: p.order, moved: p.moved,
        }))
        sheetcam = { ...cutSettingsFor(d, { jobName: 'x', kerfWidth: read.kerfWidth }), starts, origin: block.origin, blockIndex: d.originalRank }
        const pre = prefillFromJob(read)
        if (pre.space != null) space = pre.space
    }
    const imported = JSON.parse(glue.mod.import_file_limited(dxf, 0.01, 10000, 20000)).result
    const canon = new Uint8Array(glue.mod.canonical_dxf(dxf, 0.01))
    const files = [{ slug: 'f', name: 'piece-l.dxf', count: 1, rotations: [0], parts: imported.parts, ...(sheetcam ? { sheetcam } : {}) }]
    const { payload, ringHulls } = await buildLocalPayload(
        { files, params: { sheets: [{ width: 1000, height: 1000, count: 2 }], space, outputUnit: 'mm', alternativesCount: 1 }, profile: {} },
        { openHoles: async (c, h, s) => JSON.parse(glue.mod.open_holes(JSON.stringify({ outer: c, holes: h, space_mm: s }))) },
    )
    payload.problem = 'bpp'
    attachRingHulls(payload, ringHulls)
    const result = { problem: 'bpp', alternatives: [{ rank: 0, seed: 1, solution: { layouts: [{ container_id: 0, placed_items: [{ item_id: 0, transformation: { rotation: 0, translation: [300, 200] } }] }] } }] }
    const out = await assembleBrowserArtifacts({ result, payload, sources: { f: canon }, jobSlug: 'j' })
    return { payload, alt: out.alternatives[0] }
}

/** Boîte des entités LIVRÉES (hors cadre de la tôle), sans passer par nos lecteurs de pose. */
function deliveredBox(content) {
    const ents = [...readDxfEntities(content).values()].flat().filter((e) => e.layer === '0')
    const xs = []
    const ys = []
    for (const e of ents) {
        if (e.type === 'LINE') { xs.push(e.pts[0], e.pts[2]); ys.push(e.pts[1], e.pts[3]) }
        else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') for (const v of e.verts) { xs.push(v[0]); ys.push(v[1]) }
        else if (e.type === 'CIRCLE') { xs.push(e.c[0] - e.r, e.c[0] + e.r); ys.push(e.c[1] - e.r, e.c[1] + e.r) }
        else if (e.type === 'ARC') { xs.push(e.c[0] - e.r, e.c[0] + e.r); ys.push(e.c[1] - e.r, e.c[1] + e.r) }
    }
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

describe('résultat d\'un projet .job : la réserve d\'amorce ne fausse pas les positions', () => {
    it('piece-l-45deg.job : la réserve est bien appliquée, et la ligne est le centre de la pièce LIVRÉE', async () => {
        const { payload, alt } = await runJob('piece-l-45deg.job')
        // Le test n'est pas une tautologie : l'anneau du payload a bien été élargi.
        expect((payload.leadInReserve || []).some((n) => n.applied)).toBe(true)
        const row = alt.positions[0].rows[0]
        const box = deliveredBox(alt.dxfs[0].content)
        expect(row.x).toBeCloseTo((box[0] + box[2]) / 2, 3)
        expect(row.y).toBeCloseTo((box[1] + box[3]) / 2, 3)
        // Entités livrées du fichier : 300..480 x 200..400 (pièce en L de 180 x 200).
        expect(row.x).toBeCloseTo(390, 3)
        expect(row.y).toBeCloseTo(300, 3)
        expect(row.d).toBeNull()
        expect(row.rot).toBe(0)
        // Le même fichier sans .job donne le même résultat : la réserve n'y change rien.
        const plain = (await runJob(null)).alt.positions[0].rows[0]
        expect(plain.x).toBeCloseTo(row.x, 6)
        expect(plain.y).toBeCloseTo(row.y, 6)
    })

    it('piece-l-none-default.job : idem', async () => {
        const { alt } = await runJob('piece-l-none-default.job')
        const row = alt.positions[0].rows[0]
        const box = deliveredBox(alt.dxfs[0].content)
        expect(row.x).toBeCloseTo((box[0] + box[2]) / 2, 3)
        expect(row.y).toBeCloseTo((box[1] + box[3]) / 2, 3)
    })

    it('un résultat .job garde son bouton Positions ; le zéro au choix reste caché (coin seulement)', async () => {
        const { alt } = await runJob('piece-l-45deg.job')
        const withJob = { ...alt, jobs: [{ fileName: 'a_tole1.job', bytes: new Uint8Array([1]) }] }
        const h = hydrateLocalItem({ slug: 'j' }, { slug: 'j', alternatives: [withJob] })
        expect(h.hasJobs).toBe(true)
        expect(h.alternatives[0].hasPositions).toBe(true)
    })
})

describe('positions : seulement pour un job construit dans le navigateur', () => {
    it('payload préparé par le serveur : aucune position dans le record', async () => {
        const { alt } = await runJob(null)
        expect(alt.positions).toHaveLength(1)
        const server = [{ ...alt }]
        dropPositionsUnlessBrowserBuilt(server, 'server-prepared')
        expect(server[0].positions).toBeUndefined()
        const none = [{ ...alt }]
        dropPositionsUnlessBrowserBuilt(none, undefined)
        expect(none[0].positions).toBeUndefined()
        const browser = [{ ...alt }]
        dropPositionsUnlessBrowserBuilt(browser, 'client-built')
        expect(browser[0].positions).toHaveLength(1)
        // hydrate : plus de bouton
        const h = hydrateLocalItem({ slug: 'j' }, { slug: 'j', alternatives: server })
        expect(h.alternatives[0].hasPositions).toBe(false)
    })
})
