import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// `.job` SheetCam de chaque alternative AFFICHÉE (relecture du 27/11/2026) :
//   - le tri d'affichage met la grille BPP (ajoutée EN DERNIER) en tête ; le
//     `.job` du rang k doit être celui de l'alternative montrée au rang k, pas
//     celui de l'alternative brute de même rang ;
//   - à distance au bord (d = 8 ici), ses poses sont celles des containers de
//     cette alternative (repère RÉEL), même après l'aller-retour du worker de
//     finalisation (structuredClone à l'entrée et à la sortie).
// Contrôle : le VRAI rédacteur `.job` (fixture de la recette) écrit, pour chaque
// rang, exactement le fichier qu'on obtient des containers calculés à part pour
// la même alternative (appariement par identité, jamais par rang).

const BUNDLE_JS = path.resolve(__dirname, '../../public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.resolve(__dirname, '../../public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null, grid: null }))

vi.mock('../composables/geometryClient', () => ({
    geoExportSvgSheet: vi.fn(async (spec) => `<svg data-w="${spec.bin_width}" data-h="${spec.bin_height}"/>`),
    geoExportDxfSheet: vi.fn(async () => null),
    geoPinwheelCapacity: vi.fn(async () => ({ rotations: [] })),
    geoComputeReport: vi.fn(async (spec) => JSON.parse(glue.mod.compute_report(JSON.stringify(spec)))),
}))
// La grille BPP (structureMultiClient) : des poses fixes dans le repère MOTEUR,
// pour que l'alternative ajoutée en dernier existe à coup sûr.
vi.mock('../composables/structureMultiClient', () => ({
    buildGridLayoutsMulti: vi.fn(async () => JSON.parse(JSON.stringify(glue.grid))),
}))

import { assembleBrowserArtifacts, jobSheetsOfContainers } from '../composables/finalizeLocal'
import { buildAlternativeArtifacts, layoutTransforms, nestedInForLayout, normalizeLayouts } from '../composables/localBridge'
import { attachSheetcamJobs } from '../composables/localJobPrivate'
import { buildNestedJobs, parseSheetCamJob, sheetsFromLayouts } from '../composables/sheetcamJobResult'

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
})

// Les deux dessins de la recette (fixture sheetcam) : hôte carré centré, éventail.
const FIX = path.resolve(__dirname, 'fixtures/sheetcam')
const JOB_BYTES = new Uint8Array(readFileSync(path.join(FIX, 'source.job')))
const HOST = [[-50, -50], [50, -50], [50, 50], [-50, 50], [-50, -50]]
const FAN = [[-19.799, 2.8284], [19.799, 2.8284], [19.799, 30.8284], [-19.799, 30.8284], [-19.799, 2.8284]]
const SLUG_HOST = 'piece-trou'
const SLUG_FAN = 'piece-fillx4'
const NAMES = { [SLUG_HOST]: 'Piece_Trou.DXF', [SLUG_FAN]: 'Piece_Fillx4.DXF' }
const RINGS = { [SLUG_HOST]: [HOST.slice(0, 4)], [SLUG_FAN]: [FAN.slice(0, 4)] }
const sheetcamContext = { jobBytes: JOB_BYTES, ringsByFileSlug: RINGS, fileNamesBySlug: NAMES, baseName: 'essai.job' }
const lib = { buildNestedJobs, sheetsFromLayouts, parseSheetCamJob, layoutTransforms, nestedInForLayout, normalizeLayouts }

const place = (id, x, y, rot = 0) => ({ item_id: id, transformation: { rotation: rot, translation: [x, y] } })
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]

/** BPP rectangulaire, vraie tôle 1000 × 2000, espacement 2, bord `edge` (d = edge − 2). */
function payloadOf(edge) {
    const d = edge - 2
    return {
        problem: 'bpp',
        instance: {
            name: 't',
            items: [{ id: 0, demand: 1 }, { id: 1, demand: 1 }],
            bins: [{ id: 0, cost: 1, stock: 2, shape: { type: 'polygon', data: { outer: rect(0, 0, 1000 - 2 * d, 2000 - 2 * d) } } }],
        },
        engineConfig: { min_item_separation: 2 },
        requestedSpace: 2,
        parts: [
            { id: 0, file_slug: SLUG_HOST, coords: HOST, holes: [], count: 1, color: '#123456', handles: [] },
            { id: 1, file_slug: SLUG_FAN, coords: FAN, holes: [], count: 1, color: '#654321', handles: [] },
        ],
        hasHoles: false,
        fillHoles: false,
        ...(d ? { requestedEdge: edge, edgeShift: d, sheetFrames: [{ width: 1000, height: 2000 }] } : {}),
    }
}

/** Résultat moteur : « bottom » PUIS « left » (le tri les inverse), poses moteur. */
const engineResult = () => ({
    problem: 'bpp',
    alternatives: [
        { rank: 0, bias: 'bottom', tag: 'bottom', solution: { layouts: [{ container_id: 0, placed_items: [place(0, 52, 52), place(1, 200, 30)] }] } },
        { rank: 1, bias: 'left', tag: 'left', solution: { layouts: [{ container_id: 0, placed_items: [place(0, 52, 300), place(1, 52, 500, 90)] }] } },
    ],
})
const GRID = [{ container_id: 0, placed_items: [place(0, 52, 900), place(1, 300, 900, 180)] }]

/** Identité d'une alternative brute : sa marque, ou « grid » pour la grille ajoutée. */
const identityOf = (alt) => (alt?.structural ? 'grid' : alt?.tag)

/** Containers de chaque alternative, calculés À PART (copie du résultat, grille
 * ajoutée comme le fait la finalisation), par identité. */
async function containersByIdentity(payload) {
    const result = engineResult()
    result.alternatives.push({ rank: 2, seed: null, bias: null, structural: true, selfContained: true, solution: { layouts: JSON.parse(JSON.stringify(GRID)) } })
    const arts = await buildAlternativeArtifacts(result, structuredClone(payload))
    return new Map(result.alternatives.map((alt, i) => [identityOf(alt), arts[i].containers]))
}

/** Aller-retour du worker de finalisation : clone à l'entrée, clone à la sortie,
 * puis le recopiage de `result.alternatives` que fait runLocalJobPrivate. */
async function viaWorker(result, payload) {
    const args = structuredClone({ result, payload, sources: {}, jobSlug: 'j', withPositions: false })
    const out = structuredClone(await assembleBrowserArtifacts(args))
    if (out.result?.alternatives) result.alternatives = out.result.alternatives
    return out
}

const jobsOf = (alternatives, ctx) => attachSheetcamJobs(alternatives.map((a) => ({ ...a })), { ...ctx, sheetcamContext }, lib)

describe('`.job` SheetCam : celui de l’alternative affichée, poses de SES containers', () => {
    it('bord 10 (d = 8), aller-retour du worker : rang k = alternative affichée k, repère réel', async () => {
        glue.grid = GRID
        const payload = payloadOf(10)
        const expected = await containersByIdentity(payload)
        const result = engineResult()
        const out = await viaWorker(result, payload)

        // Grille (ajoutée en dernier) en tête, puis left, bottom.
        expect(out.alternatives.map((a) => a.strategy)).toEqual(['grid', 'left', 'bottom'])
        // Le résultat brut suit l'ordre affiché.
        expect(out.result.alternatives.map(identityOf)).toEqual(['grid', 'left', 'bottom'])
        expect(result.alternatives.map(identityOf)).toEqual(['grid', 'left', 'bottom'])
        expect(out.jobSheets).toHaveLength(3)

        const partsById = new Map(payload.parts.map((p) => [String(p.id), p]))
        for (let k = 0; k < 3; k++) {
            const id = out.alternatives[k].strategy
            const fromContainers = jobSheetsOfContainers(expected.get(id))
            // Tôles du `.job` = containers de la MÊME alternative.
            expect(out.jobSheets[k]).toEqual(fromContainers)
            // Les layouts relus après l'aller-retour disent la même chose (repère réel).
            const relu = sheetsFromLayouts(normalizeLayouts(result.alternatives[k].solution), partsById, { layoutTransforms, nestedInForLayout })
            expect(relu).toEqual(fromContainers)
        }
        // Repère réel : pose moteur + (8, 8).
        expect(out.jobSheets[0][0][0].pose).toMatchObject({ x: 60, y: 908 })
        expect(out.jobSheets[1][0][0].pose).toMatchObject({ x: 60, y: 308 })
        expect(out.jobSheets[2][0][0].pose).toMatchObject({ x: 60, y: 60 })

        // Le VRAI rédacteur : le fichier du rang k est celui des containers de
        // l'alternative affichée k — par les tôles rendues ET par le repli sur
        // les layouts du résultat (record sans `jobSheets`).
        const withSheets = jobsOf(out.alternatives, { jobSheets: out.jobSheets, result, payload })
        const fallback = jobsOf(out.alternatives, { jobSheets: null, result, payload })
        const bytesOf = (alts, k) => Array.from(alts[k].jobs[0].bytes)
        for (let k = 0; k < 3; k++) {
            const ref = buildNestedJobs(parseSheetCamJob(JOB_BYTES), {
                sheets: jobSheetsOfContainers(expected.get(out.alternatives[k].strategy)),
                ringsByFileSlug: RINGS,
                fileNamesBySlug: NAMES,
                baseName: 'essai',
            })
            expect(withSheets[k].jobs).toHaveLength(1)
            expect(bytesOf(withSheets, k)).toEqual(Array.from(ref[0].bytes))
            expect(bytesOf(fallback, k)).toEqual(Array.from(ref[0].bytes))
        }
        // Trois mises en page différentes : trois fichiers différents (le contrôle mord).
        expect(bytesOf(withSheets, 0)).not.toEqual(bytesOf(withSheets, 1))
        expect(bytesOf(withSheets, 1)).not.toEqual(bytesOf(withSheets, 2))
    })

    it('vrai relais : finalizeClient + module finalize.worker.js, messages clonés', async () => {
        glue.grid = GRID
        const payload = payloadOf(10)
        const viaClone = await viaWorker(engineResult(), payload)
        // Le module du worker s'installe sur `self` ; le faux Worker clone chaque
        // message dans les deux sens, comme postMessage.
        const workerSelf = { onmessage: null, postMessage: null }
        vi.stubGlobal('self', workerSelf)
        await import('../workers/finalize.worker.js')
        class FakeFinalizeWorker {
            constructor() {
                workerSelf.postMessage = (msg) => this.onmessage({ data: structuredClone(msg) })
            }
            postMessage(data) { workerSelf.onmessage({ data: structuredClone(data) }) }
            terminate() {}
        }
        vi.stubGlobal('Worker', FakeFinalizeWorker)
        try {
            const { assembleBrowserArtifactsOffThread } = await import('../composables/finalizeClient')
            const result = engineResult()
            const out = await assembleBrowserArtifactsOffThread({ result, payload, sources: {}, jobSlug: 'j', withPositions: false })
            // Rien n'a été muté côté appelant : seul le recopiage de runLocalJobPrivate compte.
            expect(result.alternatives.map(identityOf)).toEqual(['bottom', 'left'])
            expect(out.result).not.toBe(result)
            result.alternatives = out.result.alternatives
            expect(result.alternatives.map(identityOf)).toEqual(['grid', 'left', 'bottom'])
            expect(out.jobSheets).toEqual(viaClone.jobSheets)
            const jobs = jobsOf(out.alternatives, { jobSheets: out.jobSheets, result, payload })
            const fallback = jobsOf(out.alternatives, { jobSheets: null, result, payload })
            for (let k = 0; k < 3; k++) expect(Array.from(fallback[k].jobs[0].bytes)).toEqual(Array.from(jobs[k].jobs[0].bytes))
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it('sans Worker (repli thread principal, mutation en place) : mêmes tôles, même ordre', async () => {
        glue.grid = GRID
        const payload = payloadOf(10)
        const viaClone = await viaWorker(engineResult(), payload)
        const result = engineResult()
        const out = await assembleBrowserArtifacts({ result, payload: structuredClone(payload), sources: {}, jobSlug: 'j', withPositions: false })
        expect(out.result).toBe(result)
        expect(result.alternatives.map(identityOf)).toEqual(['grid', 'left', 'bottom'])
        expect(out.jobSheets).toEqual(viaClone.jobSheets)
    })

    it('sans distance au bord : même appariement (défaut ancien, indépendant du bord)', async () => {
        glue.grid = GRID
        const payload = payloadOf(2)
        expect('edgeShift' in payload).toBe(false)
        const result = engineResult()
        const out = await viaWorker(result, payload)
        expect(out.alternatives.map((a) => a.strategy)).toEqual(['grid', 'left', 'bottom'])
        expect(result.alternatives.map(identityOf)).toEqual(['grid', 'left', 'bottom'])
        // Repère moteur = repère réel : poses telles quelles.
        expect(out.jobSheets[0][0][0].pose).toMatchObject({ x: 52, y: 900 })
        expect(out.jobSheets[2][0][0].pose).toMatchObject({ x: 52, y: 52 })
    })
})
