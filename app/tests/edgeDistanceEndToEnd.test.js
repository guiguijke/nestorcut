/**
 * Distance au bord, de bout en bout, sans aucun bouchon de géométrie :
 *   - le VRAI constructeur (`buildLocalPayload`), avec les dépendances câblées
 *     comme `localJobPrivate.buildClientPayload` (`offsetRing` = `geoOffsetRing`) ;
 *   - le VRAI moteur wasm (public/engine), envoi identique au pool
 *     (`engineSendOf`, graines `deriveSeed`), borné en travail ;
 *   - le VRAI client géométrie (`geometryClient`) à travers le VRAI corps de
 *     public/workers/geometry.worker.js sur le bundle livré (public/geometry) :
 *     décalage du contour, rapport, SVG ;
 *   - la VRAIE finalisation (`assembleBrowserArtifacts` : retour au repère réel,
 *     rapport, écartement des alternatives fautives).
 *
 * (a) tôle 1000 × 500, espacement 2, bord 10 : chaque pièce à ≥ 10 − 0,05 mm des
 *     quatre bords réels, edgeOk, containers 1000 × 500 ;
 * (b) bord −5 : au moins une pièce dépasse, aucune de plus de 5 + 0,05 mm,
 *     insideSheet, edgeOk, aucune alternative écartée ;
 * (c) tôle importée (disque Ø153, 360 sommets), disques Ø30, bord −3 : vraie
 *     distance euclidienne au contour, dépassement ≤ 3 + 0,05 mm, edgeOk ;
 * (d) bord non réglé : payload, graine et rapports identiques au bord égal à
 *     l'espacement, sans aucune clé nouvelle ; empreinte égale à celle du commit
 *     de base de la fonctionnalité (même scénario, mesurée avant le lot).
 * (e) tôle importée à cavité à bouche étroite (bouche 1 mm, chambre 8 × 8 sur le
 *     bord gauche), carrés de 100, bord −3 : les vides des décalages (+5 moteur,
 *     +3 bord demandé) sont des zones du moteur, aucune pièce ne couvre la
 *     chambre ; témoin sans les vides : le moteur la couvre ;
 * (f) équerres 100 × 100 (bras de 12) sur rectangle 400 × 300, bord −45 : une
 *     équerre posée avec moins de 1 % de sa matière sur la tôle rend
 *     `insideSheet` faux (alternative signalée) ; les autres restent vraies ;
 * (g) mêmes équerres sur le même rectangle IMPORTÉ : l'alternative qui en pose
 *     une hors de la tôle est écartée (`outside_outline`), aucune livrée n'en a.
 * Le `.job` de chaque alternative affichée est verrouillé à part
 * (`edgeDistanceJobOrder`).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 })

const ROOT = path.resolve(__dirname, '../..')
const BUNDLE_JS = path.join(ROOT, 'public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.join(ROOT, 'public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null, ops: [] }))

// Le vrai corps de geometry.worker.js, sans son import : un faux Worker l'exécute
// (même harnais que geometryOffsetRing.test.js). Les opérations sont tracées.
class FakeWorker {
    constructor(url) {
        expect(url).toBe('/workers/geometry.worker.js')
        const src = readFileSync(path.join(ROOT, 'public/workers/geometry.worker.js'), 'utf8')
        const names = /import init, \{([^}]*)\}/.exec(src)[1].split(',').map((s) => s.trim()).filter(Boolean)
        for (const n of names) expect(typeof glue.mod[n], `${n} absent du bundle`).toBe('function')
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
const fileOf = (slug, count, coords, rotations = [0, 90]) => {
    const [, , x1, y1] = coords.reduce(([a, b, c, d], [x, y]) => [Math.min(a, x), Math.min(b, y), Math.max(c, x), Math.max(d, y)],
        [Infinity, Infinity, -Infinity, -Infinity])
    return { slug, name: `${slug}.dxf`, count, rotations, parts: [{ coords, holes: [], width: x1, height: y1 }] }
}

/** Dépendances du constructeur, câblées comme `buildClientPayload` (options
 * de `offsetRing` comprises : `keepVoids` passe tel quel). */
const depsOf = (record = null) => ({
    openHoles: (coords, holes, spaceMm) => geoOpenHoles(coords, holes, spaceMm),
    pinwheelCapacity: (ring, coords, spaceMm, allowed) => geoPinwheelCapacity(ring, coords, spaceMm, allowed),
    offsetRing: (ring, distanceMm, opts) => geoOffsetRing(ring, distanceMm, opts),
    ...(record ? { getSheetRecord: async () => record } : {}),
})

/** Walks du pool (envoi `engineSendOf`, graines dérivées), bornés en travail. */
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

async function runJob(files, params, deps = depsOf()) {
    const first = glue.ops.length
    const built = await buildLocalPayload({ files, params, profile: { timeBudgetSec: 2 } }, deps)
    const raw = solve(built.payload)
    // Sortie moteur sans son chronomètre (`run_time_sec`, seul champ qui dépend de la machine).
    const engineOut = JSON.stringify(raw, (k, v) => (k === 'run_time_sec' ? undefined : v))
    const out = await assembleBrowserArtifacts({
        result: raw, payload: built.payload, sources: {}, jobSlug: 'e2e', withPositions: false,
    })
    // Appels au worker de CE job seulement (plusieurs jobs par test).
    const reportSpecs = glue.ops.slice(first).filter((o) => o.op === 'compute_report').map((o) => JSON.parse(o.json))
    return { ...built, engineOut, out, reportSpecs }
}

/** Sommets RÉELS posés de chaque tôle livrée : [container, [[x, y], …] par pièce]. */
function placedRings(out, payload) {
    const byId = new Map(payload.parts.map((p) => [String(p.id), p]))
    const res = []
    // `alternatives` ne garde que les SVG et le rapport : les poses se relisent
    // dans le résultat, passé au repère réel par la finalisation (`edgeReal`).
    for (const alt of out.result.alternatives) {
        for (const layout of alt.solution.layouts) {
            expect(layout.edgeReal).toBe(true)
            const rings = []
            for (const pi of layout.placed_items) {
                const t = pi.transformation
                const a = (t.rotation * Math.PI) / 180
                const cs = Math.cos(a)
                const sn = Math.sin(a)
                rings.push(byId.get(String(pi.item_id)).coords.map(([px, py]) => [
                    cs * px - sn * py + t.translation[0],
                    sn * px + cs * py + t.translation[1],
                ]))
            }
            res.push({ containerId: layout.container_id ?? 0, rings })
        }
    }
    return res
}

/** Écart signé de chaque pièce aux quatre bords d'une tôle W × H (négatif = dépasse). */
function rectEdgeGaps(sheets, W, H) {
    let min = Infinity
    let count = 0
    for (const s of sheets) {
        for (const ring of s.rings) {
            count += 1
            for (const [x, y] of ring) min = Math.min(min, x, y, W - x, H - y)
        }
    }
    return { min, count }
}

const verifyOf = (alt) => alt.report
/** Marge de courbes ajoutée à l'espacement (et au bord) : interne − demandé. */
const marginOf = (payload) => payload.engineConfig.min_item_separation - payload.requestedSpace

describe('bout en bout, tôle rectangulaire 1000 × 500, espacement 2', () => {
    const files = [
        fileOf('a', 10, rect(120, 80)),
        fileOf('b', 8, rect(60, 60)),
        fileOf('c', 4, circle(25, 48)),
    ]
    const total = 10 + 8 + 4
    const params = (edgeDistance) => ({
        sheets: [{ width: 1000, height: 500, count: 2 }], space: 2, alternativesCount: 1,
        ...(edgeDistance === undefined ? {} : { edgeDistance }),
    })

    it('(a) bord 10 : chaque pièce à ≥ 10 − 0,05 mm des quatre bords réels, edgeOk, containers 1000 × 500', async () => {
        const { payload, out, reportSpecs } = await runJob(files, params(10))
        expect(payload.problem).toBe('bpp')
        expect(payload.edgeShift).toBe(8)
        expect(payload.requestedEdge).toBe(10)
        expect(payload.sheetFrames).toEqual([{ width: 1000, height: 500 }])
        expect(payload.instance.bins[0].shape.data.outer).toEqual(rect(984, 484))
        // Espacement interne = demandé + marge de courbes (le disque) ; d ne la voit pas.
        const margin = marginOf(payload)
        expect(margin).toBeGreaterThan(0)

        expect(out.allAlternativesInvalid).toBe(false)
        expect(out.localDiscarded).toEqual([])
        expect(out.alternatives.length).toBeGreaterThan(0)
        const sheets = placedRings(out, payload)
        const { min, count } = rectEdgeGaps(sheets, 1000, 500)
        expect(count).toBe(total * out.result.alternatives.length)
        expect(min).toBeGreaterThanOrEqual(10 - 0.05)
        // Frame finale et SVG : la VRAIE tôle.
        expect(out.liveLayout.sheets[0]).toEqual([1000, 500])
        expect(out.liveLayout.edgeReal).toBe(true)
        for (const alt of out.alternatives) {
            const v = verifyOf(alt)
            expect(v.insideSheet).toBe(true)
            expect(v.overlapFree).toBe(true)
            expect(v.edgeOk).toBe(true)
            expect(v.edgeGapMm).toBeGreaterThanOrEqual(10 - 0.05)
            expect(v.spacingOk).toBe(true)
            expect(v.unplaced).toBe(0)
            for (const svg of alt.svgs) expect(svg).toContain('viewBox="0 0 1000.0 500.0"')
        }
        // Le rapport a jugé les VRAIES tôles, au bord interne (demandé + marge de courbes).
        expect(reportSpecs.length).toBeGreaterThan(0)
        for (const spec of reportSpecs) {
            expect(spec.edge).toBe(10 + margin)
            expect(spec.space).toBe(2 + margin)
            for (const c of spec.containers) expect([c.bin_width, c.bin_height]).toEqual([1000, 500])
        }
    })

    it('(b) bord −5 : une pièce au moins dépasse, aucune de plus de 5 + 0,05 mm, rien d’écarté', async () => {
        const { payload, out, reportSpecs } = await runJob(files, params(-5))
        expect(payload.edgeShift).toBe(-7)
        expect(payload.instance.bins[0].shape.data.outer).toEqual(rect(1014, 514))
        expect(out.allAlternativesInvalid).toBe(false)
        expect(out.localDiscarded).toEqual([])
        expect(out.alternatives.length).toBe(out.result.alternatives.length)
        const { min, count } = rectEdgeGaps(placedRings(out, payload), 1000, 500)
        expect(count).toBe(total * out.result.alternatives.length)
        expect(min).toBeLessThan(0)
        expect(min).toBeGreaterThanOrEqual(-5 - 0.05)
        for (const alt of out.alternatives) {
            const v = verifyOf(alt)
            expect(v.insideSheet).toBe(true)
            expect(v.overlapFree).toBe(true)
            expect(v.edgeOk).toBe(true)
            expect(v.edgeGapMm).toBeLessThan(0)
            expect(v.edgeGapMm).toBeGreaterThanOrEqual(-5 - 0.05)
            expect(v.spacingOk).toBe(true)
        }
        for (const spec of reportSpecs) {
            expect(spec.edge).toBe(-5 + marginOf(payload))
            for (const c of spec.containers) expect([c.bin_width, c.bin_height]).toEqual([1000, 500])
        }
    })

    it('(d) bord non réglé : payload, graine et rapports identiques au bord = espacement, empreinte du commit de base', async () => {
        const unset = await runJob(files, params(undefined))
        const blank = await runJob(files, params(''))
        const same = await runJob(files, params(2))
        for (const k of ['requestedEdge', 'edgeShift', 'sheetFrames']) expect(k in unset.payload).toBe(false)
        for (const spec of unset.reportSpecs) expect('edge' in spec).toBe(false)
        expect(unset.out.liveLayout.edgeReal).toBeUndefined()
        for (const alt of unset.out.result.alternatives) {
            for (const l of alt.solution.layouts) expect('edgeReal' in l).toBe(false)
        }
        const fp = fingerprint(unset)
        for (const other of [blank, same]) {
            expect(JSON.stringify(other.payload)).toBe(JSON.stringify(unset.payload))
            expect(other.seed).toBe(unset.seed)
            expect(JSON.stringify(other.itemMap)).toBe(JSON.stringify(unset.itemMap))
            expect(other.engineOut).toBe(unset.engineOut)
            expect(JSON.stringify(other.reportSpecs)).toBe(JSON.stringify(unset.reportSpecs))
            expect(fingerprint(other)).toEqual(fp)
        }
        // Empreinte du même scénario au commit de base (e35ad595, avant le lot),
        // mesurée sur un extrait `git archive` de ce commit : un écart dit que
        // le chemin par défaut a changé.
        expect(fp).toEqual(BASE_FINGERPRINT)
    })
})

describe('bout en bout, tôle importée : disque Ø153 (360 sommets), bord −3', () => {
    it('(c) disques Ø30 : dépassement du vrai contour ≤ 3 + 0,05 mm, edgeOk, containers réels', async () => {
        const R = 76.5
        const disc = circle(R, 360, 300 + R, 200 + R)
        const record = makeSheetRecord({
            id: 'sheet-e2e00001-bord01', projectSlug: 'p', name: 'Disque', sourceFileName: 'disque.dxf', sourceUnits: 'mm',
            contours: [{ ring: disc, depth: 1, parent: null, areaMm2: ringArea(disc), bbox: ringBbox(disc) }],
            outlineIndex: 0, forbidden: [], addedAt: 1,
        })
        const files = [fileOf('rond', 9, circle(15, 48), [0])]
        const params = {
            sheets: [{ width: 2 * R, height: 2 * R, count: 1, shapeId: 'sheet-e2e00001-bord01' }],
            space: 2, alternativesCount: 1, edgeDistance: -3,
        }
        const { payload, out, reportSpecs } = await runJob(files, params, depsOf(record))
        expect(payload.problem).toBe('bpp')
        expect(payload.edgeShift).toBe(-5)
        // Le contour a été décalé par le VRAI client géométrie (worker + wasm).
        expect(glue.ops.filter((o) => o.op === 'offset_ring')).toHaveLength(1)
        const frame = payload.sheetFrames[0]
        expect(frame.width).toBeCloseTo(2 * R, 9)
        expect(frame.height).toBeCloseTo(2 * R, 9)
        expect(frame.inner).toEqual([])
        // Contour moteur : le vrai, dilaté de 5 (rayon ≤ R + 5), translaté de (5, 5).
        const engineOuter = payload.instance.bins[0].shape.data.outer
        for (const [x, y] of engineOuter) expect(Math.hypot(x - 5 - R, y - 5 - R)).toBeLessThanOrEqual(R + 5 + 1e-3)

        expect(out.allAlternativesInvalid).toBe(false)
        expect(out.localDiscarded).toEqual([])
        const realOuter = frame.outer
        let deepest = 0
        let placed = 0
        for (const s of placedRings(out, payload)) {
            for (const ring of s.rings) {
                placed += 1
                // Pièce et disque convexes : la plus grande sortie est en un sommet.
                for (const p of ring) deepest = Math.max(deepest, outsideDepth(p, realOuter))
            }
        }
        expect(placed).toBeGreaterThan(0)
        // Le moteur se sert de la bande (calcul déterministe : graines et travail fixés).
        expect(deepest).toBeGreaterThan(0)
        expect(deepest).toBeLessThanOrEqual(3 + 0.05)
        for (const alt of out.alternatives) {
            const v = verifyOf(alt)
            expect(v.insideSheet).toBe(true)
            expect(v.overlapFree).toBe(true)
            expect(v.partsOutsideOutline ?? 0).toBe(0)
            expect(v.edgeOk).toBe(true)
            expect(v.edgeGapMm).toBeGreaterThanOrEqual(-3 - 0.05)
        }
        // Le rapport juge le contour RÉEL (celui de la tôle importée), au bord demandé.
        for (const spec of reportSpecs) {
            expect(spec.edge).toBe(-3 + marginOf(payload))
            for (const c of spec.containers) {
                expect(c.shape?.outer).toEqual(realOuter)
                expect(c.bin_width).toBeCloseTo(2 * R, 9)
            }
        }
    })
})

describe('bout en bout, tôle importée à cavité à bouche étroite, bord −3', () => {
    // Bord gauche : bouche 1 mm (y 59,5..60,5, x 0..5) ouvrant sur une chambre
    // 8 × 8 (x 5..13, y 56..64). Le centre de la chambre est à 4 mm de la
    // matière (> |e|) ; le décalage moteur (+5) referme tout, celui du bord
    // demandé (+3) y laisse un vide.
    const KEY = [[0, 0], [110, 0], [110, 400], [0, 400], [0, 60.5], [5, 60.5], [5, 64], [13, 64], [13, 56], [5, 56], [5, 59.5], [0, 59.5], [0, 0]]
    const CHAMBER_CENTRE = [9, 60]
    const files = [fileOf('carre', 3, rect(100, 100), [0])]
    const params = {
        sheets: [{ width: 110, height: 400, count: 1, shapeId: 'sheet-e2e00001-bord02' }],
        space: 2, alternativesCount: 1, edgeDistance: -3,
    }
    const record = sheetRecordOf('sheet-e2e00001-bord02', KEY)

    it('(e) vides des décalages = zones du moteur : aucune pièce sur la chambre, rapport vert', async () => {
        const { payload, out } = await runJob(files, params, depsOf(record))
        expect(payload.edgeShift).toBe(-5)
        // Deux décalages, tous deux avec les vides : le moteur (+5), le bord demandé (+3).
        const offs = glue.ops.filter((o) => o.op === 'offset_ring').map((o) => JSON.parse(o.json))
        expect(offs.map((s) => [Number(s.distance_mm), s.keep_voids])).toEqual([[5, true], [3, true]])
        // Une zone moteur : la chambre moins 3 mm (≈ 2 × 2 autour de (9, 60)),
        // translatée de (5, 5) ; le repère réel, lui, n'a aucune zone.
        const inner = payload.instance.bins[0].shape.data.inner || []
        expect(inner).toHaveLength(1)
        const [zx0, zy0, zx1, zy1] = ringBbox(inner[0])
        expect(zx0).toBeCloseTo(8 + 5, 1)
        expect(zy0).toBeCloseTo(59 + 5, 1)
        expect(zx1).toBeCloseTo(10 + 5, 1)
        expect(zy1).toBeCloseTo(61 + 5, 1)
        expect(payload.sheetFrames[0].inner).toEqual([])

        expect(out.allAlternativesInvalid).toBe(false)
        expect(out.localDiscarded).toEqual([])
        const rings = placedRings(out, payload).flatMap((s) => s.rings)
        expect(rings.length).toBe(3 * out.result.alternatives.length)
        for (const r of rings) expect(inRing(CHAMBER_CENTRE, r)).toBe(false)
        // Aucun point de la cavité sous une pièce n'est à plus de |e| de la matière.
        let deepest = 0
        for (let x = -0.5; x <= 13.5; x += 0.05) {
            for (let y = 55.5; y <= 64.5; y += 0.05) {
                const p = [x, y]
                if (rings.some((r) => inRing(p, r))) deepest = Math.max(deepest, outsideDepth(p, KEY))
            }
        }
        expect(deepest).toBeLessThanOrEqual(3 + 0.05)
        for (const alt of out.alternatives) {
            const v = verifyOf(alt)
            expect(v.insideSheet).toBe(true)
            expect(v.overlapFree).toBe(true)
            expect(v.partsOutsideOutline ?? 0).toBe(0)
            expect(v.edgeOk).toBe(true)
            expect(v.edgeGapMm).toBeGreaterThanOrEqual(-3 - 0.05)
        }
    })

    it('(e) témoin : sans les vides, le moteur pose un carré sur la chambre (les zones sont la seule défense)', async () => {
        const base = depsOf(record)
        const noVoids = { ...base, offsetRing: async (ring, d, opts) => ({ ...(await base.offsetRing(ring, d, opts)), voids: [] }) }
        const { payload, out } = await runJob(files, params, noVoids)
        expect(payload.instance.bins[0].shape.data.inner || []).toEqual([])
        const rings = placedRings(out, payload).flatMap((s) => s.rings)
        expect(rings.some((r) => inRing(CHAMBER_CENTRE, r))).toBe(true)
    })
})

describe('bout en bout, équerres au bord −45 : pièce presque hors de la tôle', () => {
    // Équerre 100 × 100, bras de 12 : le plafond (moitié du plus petit côté,
    // 50) laisse passer −45, et toute la matière d'une équerre posée dans un
    // coin de la bande de dépassement peut être hors de la tôle.
    const W = 400
    const H = 300
    const L = [[0, 0], [100, 0], [100, 12], [12, 12], [12, 100], [0, 100], [0, 0]]
    const files = [fileOf('equerre', 14, L, [0, 90, 180, 270])]
    const params = (sheet) => ({ sheets: [{ width: W, height: H, count: 3, ...sheet }], space: 2, alternativesCount: 1, edgeDistance: -45 })
    /** Plus petite part de matière SUR la tôle W × H, sur les pièces données. */
    const minOnSheet = (rings) => Math.min(...rings.map((r) => ringAreaInRect(r, W, H) / ringArea(r)))
    /** Anneaux RÉELS d'une alternative brute du moteur (pose moteur + (d, d)). */
    const rawRings = (alt, payload) => {
        const byId = new Map(payload.parts.map((p) => [String(p.id), p]))
        const d = payload.edgeShift
        return alt.solution.layouts.flatMap((l) => l.placed_items.map((pi) => {
            const t = pi.transformation
            const a = (t.rotation * Math.PI) / 180
            return byId.get(String(pi.item_id)).coords.map(([px, py]) => [
                Math.cos(a) * px - Math.sin(a) * py + t.translation[0] + d,
                Math.sin(a) * px + Math.cos(a) * py + t.translation[1] + d,
            ])
        }))
    }

    it('(f) rectangle : l’alternative qui pose une équerre hors de la tôle est écartée (règle R1)', async () => {
        const { payload } = await buildLocalPayload({ files, params: params({}), profile: { timeBudgetSec: 2 } }, depsOf())
        expect(payload.edgeShift).toBe(-47)
        expect(payload.instance.bins[0].shape.data.outer).toEqual(rect(494, 394))
        const raw = solve(payload)
        const before = structuredClone(raw.alternatives)
        const out = await assembleBrowserArtifacts({ result: raw, payload, sources: {}, jobSlug: 'e2e', withPositions: false })
        // Le moteur le fait vraiment : au moins une alternative pose une équerre
        // sans matière sur la tôle…
        expect(before.some((alt) => minOnSheet(rawRings(alt, payload)) < 0.01)).toBe(true)
        // … elle est écartée (sur un rectangle aussi, au lieu d'être livrée en
        // rouge), et toute alternative livrée a chaque pièce au moins à 1 %.
        expect(out.localDiscarded.map((x) => x.reason)).toContain('outside_sheet')
        expect(out.allAlternativesInvalid).toBe(false)
        expect(out.alternatives.length).toBe(out.result.alternatives.length)
        const sheets = placedRings(out, payload)
        expect(minOnSheet(sheets.flatMap((s) => s.rings))).toBeGreaterThanOrEqual(0.01)
        for (const alt of out.alternatives) {
            const v = verifyOf(alt)
            expect(v.insideSheet).toBe(true)
            expect(v.edgeOk).toBe(true)
            expect(v.edgeGapMm).toBeGreaterThanOrEqual(-45 - 0.05)
        }
    })

    it('(g) tôle importée (même rectangle) : l’alternative fautive est écartée, aucune livrée n’a de pièce hors tôle', async () => {
        const record = sheetRecordOf('sheet-e2e00001-bord03', rect(W, H))
        const { payload } = await buildLocalPayload({ files, params: params({ shapeId: 'sheet-e2e00001-bord03' }), profile: { timeBudgetSec: 2 } }, depsOf(record))
        expect(payload.edgeShift).toBe(-47)
        // Contour convexe : un seul décalage (moteur), avec les vides (aucun ici).
        const offs = glue.ops.filter((o) => o.op === 'offset_ring').map((o) => JSON.parse(o.json))
        expect(offs.map((s) => [Number(s.distance_mm), s.keep_voids])).toEqual([[47, true]])
        const raw = solve(payload)
        const before = structuredClone(raw.alternatives)
        const out = await assembleBrowserArtifacts({ result: raw, payload, sources: {}, jobSlug: 'e2e', withPositions: false })
        // Le moteur pose au moins une équerre sans matière sur la tôle…
        expect(before.some((alt) => minOnSheet(rawRings(alt, payload)) < 0.01)).toBe(true)
        // … cette alternative est écartée, et toute alternative livrée a chaque
        // pièce au moins à 1 % sur la tôle.
        // Écartée par la règle R1 (insideSheet faux) ou par le contrôle du contour.
        expect(out.localDiscarded.map((x) => x.reason).some((r) => r === 'outside_sheet' || r === 'outside_outline')).toBe(true)
        expect(out.allAlternativesInvalid).toBe(false)
        const sheets = placedRings(out, payload)
        expect(minOnSheet(sheets.flatMap((s) => s.rings))).toBeGreaterThanOrEqual(0.01)
        for (const alt of out.alternatives) {
            const v = verifyOf(alt)
            expect(v.insideSheet).toBe(true)
            expect(v.partsOutsideOutline ?? 0).toBe(0)
            expect(v.edgeOk).toBe(true)
        }
    })
})

// ---------------------------------------------------------------------------

/** Fiche de tôle importée à un seul contour (le contour extérieur `ring`). */
function sheetRecordOf(id, ring) {
    return makeSheetRecord({
        id, projectSlug: 'p', name: 'Chute', sourceFileName: 'chute.dxf', sourceUnits: 'mm',
        contours: [{ ring, depth: 1, parent: null, areaMm2: ringArea(ring), bbox: ringBbox(ring) }],
        outlineIndex: 0, forbidden: [], addedAt: 1,
    })
}

/** Point dans un anneau fermé (pair-impair). */
function inRing(p, ring) {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
}

/** Aire d'un anneau fermé coupé par le rectangle [0 ; W] × [0 ; H]
 * (Sutherland-Hodgman : sur un anneau concave, les allers-retours le long de la
 * droite de coupe s'annulent dans l'aire). */
function ringAreaInRect(ring, W, H) {
    let poly = ring.slice(0, -1)
    for (const [axis, bound, keepGe] of [[0, 0, true], [0, W, false], [1, 0, true], [1, H, false]]) {
        const next = []
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i]
            const b = poly[(i + 1) % poly.length]
            const ia = keepGe ? a[axis] >= bound : a[axis] <= bound
            const ib = keepGe ? b[axis] >= bound : b[axis] <= bound
            if (ia) next.push(a)
            if (ia !== ib) {
                const t = (bound - a[axis]) / (b[axis] - a[axis])
                const q = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
                q[axis] = bound
                next.push(q)
            }
        }
        poly = next
        if (poly.length < 3) return 0
    }
    let s = 0
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        s += a[0] * b[1] - b[0] * a[1]
    }
    return Math.abs(s) / 2
}

/** Profondeur d'un point hors d'un anneau fermé (0 dedans). */
function outsideDepth(p, ring) {
    let inside = false
    let d = Infinity
    for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i]
        const b = ring[i + 1]
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) inside = !inside
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const l2 = dx * dx + dy * dy
        const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
        d = Math.min(d, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]))
    }
    return inside ? 0 : d
}

const sha = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex')

/** Empreinte stable d'un job : payload, graine, sortie moteur, rapports et SVG
 * livrés (les compteurs de temps des passes, `postPass`, en sont exclus). */
function fingerprint(job) {
    const reports = job.out.alternatives.map((a) => {
        const { postPass, ...rest } = a.report
        void postPass
        return rest
    })
    return {
        payload: sha(job.payload),
        seed: String(job.seed),
        engine: sha(job.engineOut),
        reports: sha(reports),
        svgs: sha(job.out.alternatives.map((a) => a.svgs)),
    }
}

// Mesurée au commit e35ad595 (avant la distance au bord) : ce même fichier lancé
// sur un extrait `git archive` de ce commit (ses sources, son moteur, son bundle
// géométrie et son worker), scénario (d). Un changement VOULU du chemin par
// défaut (constructeur, moteur, rapport, SVG) remesure ces valeurs ; un
// changement non voulu est exactement ce que ce verrou doit attraper.
const BASE_FINGERPRINT = {
    payload: '978116725d6b38e0f623edb68f8b7bf899f749e50c14c153e863dfd5812123ae',
    seed: '1190311913150033760',
    engine: 'e91761a70dc267aed89bb1561c94610b068d8ac481104ffdc95afea026fe296f',
    reports: 'f93252f08630191e2b24ee15957605ff4ed6fcdb452eb8f8d0aa11a405a985d2',
    svgs: 'aef2a182a6c794cfd58913d8d38cbc926c9fe4b4443f589923f7425b75c5b941',
}
