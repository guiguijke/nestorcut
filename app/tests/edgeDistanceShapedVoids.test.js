/**
 * Distance au bord sur une tôle IMPORTÉE, sans aucun bouchon de géométrie
 * (relecture du 27/11/2026) : vrai constructeur, vrai client géométrie à travers
 * le vrai corps de public/workers/geometry.worker.js sur le bundle livré, vrai
 * moteur wasm, vraie finalisation (même harnais que edgeDistanceEndToEnd).
 *
 * (a) cavité à bouche étroite (bouche 1 mm, chambre 8 × 8) au bord d'une chute,
 *     bord −3 à espacement 2 : le décalage moteur (+5) referme tout, mais le
 *     décalage du bord demandé (+3) laisse un vide, donné au moteur comme zone
 *     interdite. Aucune pièce ne couvre un point de la chambre à plus de 3 mm
 *     de la matière (avant : un disque posé sur la chambre, rapport tout vert) ;
 * (b) tôle en C (baie 40 × 40 derrière une bouche de 2 mm), bord −3 : avant,
 *     refus offset_enclosed_void ; maintenant le job se fait, baie interdite ;
 * (c) bord maximal annoncé d'une tôle importée (refus edge_too_large) : trouvé
 *     avec le vrai décalage, il se construit, et un peu plus ne se construit
 *     pas — tôle ronde (pièce qui ne tient plus) et tôle en L (contour rentré
 *     qui disparaît). Avant : la boîte du contour (200 et 480 mm).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 })

const ROOT = path.resolve(__dirname, '../..')
const BUNDLE_JS = path.join(ROOT, 'public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.join(ROOT, 'public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null, ops: [] }))

class FakeWorker {
    constructor(url) {
        expect(url).toBe('/workers/geometry.worker.js')
        const src = readFileSync(path.join(ROOT, 'public/workers/geometry.worker.js'), 'utf8')
        const names = /import init, \{([^}]*)\}/.exec(src)[1].split(',').map((s) => s.trim()).filter(Boolean)
        const body = src.replace(/import init, \{[^}]*\} from '[^']*'/, '')
        const self = { postMessage: (data) => this.onmessage({ data }) }
        new Function('self', 'init', ...names, body)(self, async () => {}, ...names.map((n) => glue.mod[n]))
        this.inner = self
    }
    postMessage(data) {
        glue.ops.push({ op: data?.op, json: data?.json })
        this.inner.onmessage({ data })
    }
    terminate() {}
}

let engine

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
    vi.stubGlobal('Worker', FakeWorker)
    engine = await import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, 'public/engine/nest_wasm.js')).href)
    await engine.default({ module_or_path: readFileSync(path.join(ROOT, 'public/engine/nest_wasm_bg.wasm')) })
})
beforeEach(() => { glue.ops.length = 0 })

import { buildLocalPayload } from '../composables/localPayloadBuilder'
import { deriveSeed } from '../composables/localPool'
import { assembleBrowserArtifacts } from '../composables/finalizeLocal'
import { geoOffsetRing, geoOpenHoles, geoPinwheelCapacity } from '../composables/geometryClient'
import { engineSendOf, withSwappedCutoff } from '../utils/sheetHull'
import { makeSheetRecord, ringArea, ringBbox } from '../utils/sheetShape'

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
const circle = (r, n, cx = r, cy = r) => {
    const out = Array.from({ length: n }, (_, k) => {
        const a = (2 * Math.PI * k) / n
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    })
    out.push(out[0])
    return out
}
const fileOf = (slug, count, coords, rotations = [0]) => {
    const xs = coords.map((p) => p[0])
    const ys = coords.map((p) => p[1])
    return { slug, name: `${slug}.dxf`, count, rotations, parts: [{ coords, holes: [], width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }] }
}
const recordOf = (id, ring) => makeSheetRecord({
    id, projectSlug: 'p', name: 'Chute', sourceFileName: 'chute.dxf', sourceUnits: 'mm',
    contours: [{ ring, depth: 1, parent: null, areaMm2: ringArea(ring), bbox: ringBbox(ring) }],
    outlineIndex: 0, forbidden: [], addedAt: 1,
})

/** Dépendances câblées comme `localJobPrivate.buildClientPayload` (options comprises). */
const depsOf = (record) => ({
    openHoles: (coords, holes, spaceMm) => geoOpenHoles(coords, holes, spaceMm),
    pinwheelCapacity: (ring, coords, spaceMm, allowed) => geoPinwheelCapacity(ring, coords, spaceMm, allowed),
    offsetRing: (ring, distanceMm, opts) => geoOffsetRing(ring, distanceMm, opts),
    getSheetRecord: async () => record,
})

function solve(payload, nWalks = 2) {
    const master = String(payload.engineConfig.prng_seed)
    const send = engineSendOf(payload)
    const alternatives = []
    for (let w = 0; w < nWalks; w++) {
        const seed = deriveSeed(master, w).toString()
        const cfg = withSwappedCutoff({
            ...payload.engineConfig, n_workers: 1, separator_workers: 1, live_events: false,
            finish_partial_sheet: false, problem: payload.problem, time_budget_sec: 3600,
            sa_max_iterations: 300, explore_max_conseq_failed_attempts: 2, compress_failure_decay: 0.5,
        }, send.swapped)
        delete cfg.plateau_patience_sec
        const out = JSON.parse(engine.run_nesting(JSON.stringify(send.instance), JSON.stringify(cfg), BigInt(seed)))
        alternatives.push(...out.alternatives)
    }
    return { problem: payload.problem, alternatives }
}

async function runJob(files, params, deps) {
    const built = await buildLocalPayload({ files, params, profile: { timeBudgetSec: 2 } }, deps)
    const raw = solve(built.payload)
    const out = await assembleBrowserArtifacts({ result: raw, payload: built.payload, sources: {}, jobSlug: 'vides', withPositions: false })
    return { ...built, out }
}

/** Anneaux RÉELS posés (repère de la vraie tôle), toutes alternatives. */
function placedRings(out, payload) {
    const byId = new Map(payload.parts.map((p) => [String(p.id), p]))
    const rings = []
    for (const alt of out.result.alternatives) {
        for (const layout of alt.solution.layouts) {
            for (const pi of layout.placed_items) {
                const t = pi.transformation
                const a = (t.rotation * Math.PI) / 180
                rings.push(byId.get(String(pi.item_id)).coords.map(([x, y]) => [
                    Math.cos(a) * x - Math.sin(a) * y + t.translation[0],
                    Math.sin(a) * x + Math.cos(a) * y + t.translation[1],
                ]))
            }
        }
    }
    return rings
}

function inRing(p, ring) {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
}
function distToRing(p, ring) {
    let d = Infinity
    for (let i = 0; i + 1 < ring.length; i++) {
        const [ax, ay] = ring[i]
        const [bx, by] = ring[i + 1]
        const dx = bx - ax
        const dy = by - ay
        const l2 = dx * dx + dy * dy
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2))
        d = Math.min(d, Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]))
    }
    return d
}

/** Plus grande distance à la matière d'un point de la boîte `box` (pas `step`)
 * couvert par une pièce posée et hors de la tôle `outer`. */
function deepestCoveredVoid(rings, outer, [x0, y0, x1, y1], step = 0.05) {
    let worst = 0
    for (let x = x0; x <= x1 + 1e-9; x += step) {
        for (let y = y0; y <= y1 + 1e-9; y += step) {
            const p = [x, y]
            if (inRing(p, outer)) continue
            if (!rings.some((r) => inRing(p, r))) continue
            worst = Math.max(worst, distToRing(p, outer))
        }
    }
    return worst
}

const verifyOk = (out, overhang) => {
    expect(out.allAlternativesInvalid).toBe(false)
    expect(out.localDiscarded).toEqual([])
    for (const alt of out.alternatives) {
        const v = alt.report
        expect(v.insideSheet).toBe(true)
        expect(v.overlapFree).toBe(true)
        expect(v.partsOutsideOutline ?? 0).toBe(0)
        expect(v.edgeOk).toBe(true)
        expect(v.edgeGapMm).toBeGreaterThanOrEqual(-overhang - 0.05)
        expect(v.unplaced).toBe(0)
    }
}

describe('vides enfermés du décalage vers l’extérieur : zones interdites du moteur', () => {
    it('(a) cavité à bouche étroite, bord −3 : aucune pièce sur la chambre à plus de 3 mm de la matière', async () => {
        const KEY = [[0, 0], [59.5, 0], [59.5, 5], [56, 5], [56, 13], [64, 13], [64, 5], [60.5, 5], [60.5, 0], [110, 0], [110, 400], [0, 400], [0, 0]]
        const record = recordOf('sheet-vides001-key01', KEY)
        const files = [fileOf('rond', 3, circle(50, 128))]
        const params = { sheets: [{ width: 110, height: 400, count: 1, shapeId: 'sheet-vides001-key01' }], space: 2, alternativesCount: 1, edgeDistance: -3 }
        const { payload, out } = await runJob(files, params, depsOf(record))
        expect(payload.edgeShift).toBe(-5)
        // Deux décalages : le moteur (+5) et le bord demandé (+3), tous deux avec les vides.
        const offs = glue.ops.filter((o) => o.op === 'offset_ring').map((o) => JSON.parse(o.json))
        expect(offs.map((s) => [Number(s.distance_mm), s.keep_voids])).toEqual([[5, true], [3, true]])
        // Le vide (chambre moins 3 mm, ≈ 2 × 2 autour de (60, 9)) est une zone du
        // moteur, translatée de (5, 5) ; le repère réel n'en a pas.
        const inner = payload.instance.bins[0].shape.data.inner || []
        expect(inner).toHaveLength(1)
        const [vx0, vy0, vx1, vy1] = ringBbox(inner[0])
        expect(vx0).toBeCloseTo(59 + 5, 2)
        expect(vy0).toBeCloseTo(8 + 5, 1)
        expect(vx1).toBeCloseTo(61 + 5, 2)
        expect(vy1).toBeCloseTo(10 + 5, 2)
        expect(payload.sheetFrames[0].inner).toEqual([])

        verifyOk(out, 3)
        const rings = placedRings(out, payload)
        expect(rings.length).toBe(3 * out.result.alternatives.length)
        // Le centre de la chambre (à 4 mm de la matière) n'est sous aucune pièce,
        // et aucun point de la cavité couvert n'est à plus de |e| de la matière.
        for (const r of rings) expect(inRing([60, 9], r)).toBe(false)
        expect(deepestCoveredVoid(rings, KEY, [55.5, -0.5, 64.5, 13.5])).toBeLessThanOrEqual(3 + 0.05)
    })

    it('(b) tôle en C (baie 40 × 40, bouche 2 mm), bord −3 : le job se fait, la baie reste vide au-delà de 3 mm', async () => {
        const C = [[0, 0], [149, 0], [149, 5], [130, 5], [130, 45], [170, 45], [170, 5], [151, 5], [151, 0], [300, 0], [300, 300], [0, 300], [0, 0]]
        // Avant : le décalage moteur (+5) sans les vides était un refus.
        await expect(geoOffsetRing(C, 5)).rejects.toThrow('offset_enclosed_void')
        const record = recordOf('sheet-vides001-cbay1', C)
        const files = [fileOf('rond', 4, circle(30, 96))]
        const params = { sheets: [{ width: 300, height: 300, count: 1, shapeId: 'sheet-vides001-cbay1' }], space: 2, alternativesCount: 1, edgeDistance: -3 }
        const { payload, out } = await runJob(files, params, depsOf(record))
        // Une seule zone : le vide du bord demandé contient celui du décalage moteur.
        expect((payload.instance.bins[0].shape.data.inner || []).length).toBe(1)
        verifyOk(out, 3)
        const rings = placedRings(out, payload)
        expect(rings.length).toBe(4 * out.result.alternatives.length)
        expect(deepestCoveredVoid(rings, C, [128, -0.5, 172, 46], 0.25)).toBeLessThanOrEqual(3 + 0.05)
    })
})

describe('bord maximal annoncé d’une tôle importée : trouvé avec le vrai décalage, il se construit', () => {
    const build = (files, params, record) => buildLocalPayload({ files, params, profile: { timeBudgetSec: 2 } }, depsOf(record))

    it('(c1) tôle ronde Ø1000, carré 600 (0°/90°) : ≈ 75 mm et non la boîte (200)', async () => {
        const disc = circle(500, 256)
        const record = recordOf('sheet-vides001-rond1', disc)
        const files = [fileOf('carre', 1, rect(600, 600), [0, 90])]
        const params = (e) => ({ sheets: [{ width: 1000, height: 1000, count: 1, shapeId: 'sheet-vides001-rond1' }], space: 2, alternativesCount: 1, edgeDistance: e })
        const err = await build(files, params(80), record).catch((e) => e)
        expect(err.message).toBe('edge_too_large')
        const max = err.__edge.maxEdgeMm
        // Demi-diagonale du carré 424,26 + espacement : le vrai maximum est vers 75,7.
        expect(max).toBeGreaterThan(70)
        expect(max).toBeLessThan(76.5)
        expect(Math.round(max * 100) / 100).toBe(max)
        const ok = await build(files, params(max), record)
        expect(ok.payload.edgeShift).toBeCloseTo(max - 2, 9)
        const over = await build(files, params(max + 0.5), record).catch((e) => e)
        expect(over.message).toBe('edge_too_large')
    })

    it('(c2) tôle en L (bras de 100) : le contour rentré disparaît à d = 50 ; annoncé < 52, et non 480', async () => {
        const L = [[0, 0], [1000, 0], [1000, 100], [100, 100], [100, 1000], [0, 1000], [0, 0]]
        const record = recordOf('sheet-vides001-enl01', L)
        const files = [fileOf('petit', 1, rect(40, 40), [0, 90])]
        const params = (e) => ({ sheets: [{ width: 1000, height: 1000, count: 1, shapeId: 'sheet-vides001-enl01' }], space: 2, alternativesCount: 1, edgeDistance: e })
        const err = await build(files, params(60), record).catch((e) => e)
        expect(err.message).toBe('edge_too_large')
        const max = err.__edge.maxEdgeMm
        expect(max).toBeGreaterThanOrEqual(30)
        expect(max).toBeLessThan(52)
        await expect(build(files, params(max), record)).resolves.toBeTruthy()
        const over = await build(files, params(52), record).catch((e) => e)
        expect(over.message).toBe('edge_too_large')
    })
})
