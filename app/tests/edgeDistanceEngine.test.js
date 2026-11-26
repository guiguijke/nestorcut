/**
 * Distance au bord, de bout en bout avec le VRAI moteur wasm (public/engine)
 * et le VRAI bundle géométrie (public/geometry, rapport) : le constructeur
 * donne au moteur une tôle décalée de d = e − s, le moteur pose dans le repère
 * moteur, `buildAlternativeArtifacts` revient au repère réel une fois.
 *
 *   - bord 10, espacement 2 : chaque pièce reste à ≥ 10 − 0,05 mm des quatre
 *     bords de la VRAIE tôle ;
 *   - bord −5 : au moins une pièce dépasse, aucune de plus de 5 + 0,05 mm.
 *
 * Bornés en travail (itérations), pas en temps, comme localEngineLotA.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const glue = vi.hoisted(() => ({ mod: null, specs: [] }))
vi.mock('../composables/geometryClient', () => ({
    geoExportSvgSheet: vi.fn(async () => '<svg/>'),
    geoExportDxfSheet: vi.fn(async () => null),
    geoPinwheelCapacity: vi.fn(async () => ({ rotations: [] })),
    geoComputeReport: vi.fn(async (spec) => {
        glue.specs.push(spec)
        return JSON.parse(glue.mod.compute_report(JSON.stringify(spec)))
    }),
}))

import { buildLocalPayload } from '../composables/localPayloadBuilder'
import { deriveSeed } from '../composables/localPool'
import { buildAlternativeArtifacts } from '../composables/localBridge'
import { makeSheetRecord, ringArea, ringBbox } from '../utils/sheetShape'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const root = fileURLToPath(new URL('../../', import.meta.url))
let wasm

beforeAll(async () => {
    wasm = await import(/* @vite-ignore */ pathToFileURL(`${root}public/engine/nest_wasm.js`).href)
    await wasm.default({ module_or_path: readFileSync(`${root}public/engine/nest_wasm_bg.wasm`) })
    glue.mod = await import(pathToFileURL(`${root}public/geometry/nest_geometry.js`).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(`${root}public/geometry/nest_geometry_bg.wasm`)) })
})

const deps = { openHoles: async () => [], pinwheelCapacity: async () => null }
const square = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
const W = 400
const H = 300

/** Walks du pool (graines dérivées comme localPool), bornés en travail. */
function solve(payload, nWalks = 2) {
    const master = String(payload.engineConfig.prng_seed)
    const alternatives = []
    for (let w = 0; w < nWalks; w++) {
        const seed = deriveSeed(master, w).toString()
        const cfg = {
            ...payload.engineConfig, n_workers: 1, separator_workers: 1, live_events: false,
            finish_partial_sheet: false, problem: payload.problem, time_budget_sec: 3600,
            sa_max_iterations: 300, explore_max_conseq_failed_attempts: 2, compress_failure_decay: 0.5,
        }
        delete cfg.plateau_patience_sec
        const out = JSON.parse(wasm.run_nesting(JSON.stringify(payload.instance), JSON.stringify(cfg), BigInt(seed)))
        alternatives.push(...out.alternatives)
    }
    return { problem: payload.problem, alternatives }
}

/** Boîtes RÉELLES [x0, y0, x1, y1] des pièces posées (containers livrés). */
function realBoxes(arts, payload) {
    const byId = new Map(payload.parts.map((p) => [String(p.id), p]))
    const boxes = []
    for (const art of arts) {
        for (const c of art.containers) {
            expect([c.bin_width, c.bin_height]).toEqual([W, H])
            for (const t of c.transforms) {
                const cs = Math.cos(t.angle)
                const sn = Math.sin(t.angle)
                let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
                for (const [px, py] of byId.get(t.item_id).coords) {
                    const x = cs * px - sn * py + t.x
                    const y = sn * px + cs * py + t.y
                    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
                }
                boxes.push([x0, y0, x1, y1])
            }
        }
    }
    return boxes
}

const files = [
    { slug: 'a', name: 'a.dxf', count: 6, rotations: [0, 90], parts: [{ coords: square(60, 40), holes: [], width: 60, height: 40 }] },
    { slug: 'b', name: 'b.dxf', count: 4, rotations: [0, 90], parts: [{ coords: square(30, 30), holes: [], width: 30, height: 30 }] },
]
const params = (edgeDistance, extra = {}) => ({
    sheets: [{ width: W, height: H, count: 2 }], space: 2, alternativesCount: 1, edgeDistance, ...extra,
})

describe('vrai moteur : la distance au bord est tenue sur la VRAIE tôle', () => {
    it('multi-tôles, bord 10 : toute pièce à ≥ 10 − 0,05 mm des quatre bords', async () => {
        const { payload } = await buildLocalPayload({ files, params: params(10), profile: { timeBudgetSec: 2 } }, deps)
        expect(payload.problem).toBe('bpp')
        expect(payload.edgeShift).toBe(8)
        const arts = await buildAlternativeArtifacts(solve(payload), payload)
        const boxes = realBoxes(arts, payload)
        expect(boxes.length).toBe(2 * 10)
        let gap = Infinity
        for (const [x0, y0, x1, y1] of boxes) gap = Math.min(gap, x0, y0, W - x1, H - y1)
        expect(gap).toBeGreaterThanOrEqual(10 - 0.05)
        for (const a of arts) {
            const v = a.report.verify
            expect(v.insideSheet).toBe(true)
            expect(v.edgeOk).toBe(true)
            expect(v.edgeGapMm).toBeGreaterThanOrEqual(10 - 0.05)
        }
        expect(glue.specs.every((s) => s.edge === 10)).toBe(true)
    })

    it('multi-tôles, bord −5 : au moins une pièce dépasse, aucune de plus de 5 + 0,05 mm', async () => {
        const { payload } = await buildLocalPayload({ files, params: params(-5), profile: { timeBudgetSec: 2 } }, deps)
        expect(payload.edgeShift).toBe(-7)
        const arts = await buildAlternativeArtifacts(solve(payload), payload)
        const boxes = realBoxes(arts, payload)
        let worst = Infinity
        for (const [x0, y0, x1, y1] of boxes) worst = Math.min(worst, x0, y0, W - x1, H - y1)
        expect(worst).toBeLessThan(0)
        expect(worst).toBeGreaterThanOrEqual(-5 - 0.05)
        for (const a of arts) {
            const v = a.report.verify
            expect(v.insideSheet).toBe(true)
            expect(v.edgeOk).toBe(true)
            expect(v.edgeGapMm).toBeLessThan(0)
        }
    })

    it('tôle importée (disque Ø400) : vraie distance euclidienne au contour, à 10 et à −5', async () => {
        const R = 200
        const disc = Array.from({ length: 180 }, (_, k) => {
            const a = (k * 2 * Math.PI) / 180
            return [1000 + R + R * Math.cos(a), 500 + R + R * Math.sin(a)]
        })
        disc.push(disc[0])
        const record = makeSheetRecord({
            id: 'sheet-lx2k9f0a-ab12cd', projectSlug: 'p', name: 'Disque', sourceFileName: 'd.dxf', sourceUnits: 'mm',
            contours: [{ ring: disc, depth: 1, parent: null, areaMm2: ringArea(disc), bbox: ringBbox(disc) }],
            outlineIndex: 0, forbidden: [], addedAt: 1,
        })
        const offsetRing = async (ring, distanceMm) => {
            const r = JSON.parse(glue.mod.offset_ring(JSON.stringify({ ring, distance_mm: distanceMm })))
            return { ring: r.ring, pieces: r.pieces, lostAreaMm2: r.lost_area_mm2, appliedDistanceMm: r.applied_distance_mm }
        }
        const shapedDeps = { ...deps, getSheetRecord: async () => record, offsetRing }
        const small = [{ slug: 'c', name: 'c.dxf', count: 8, rotations: [0, 90], parts: [{ coords: square(40, 30), holes: [], width: 40, height: 30 }] }]
        // Rayon RÉEL du contour échantillonné : celui du polygone inscrit (apothème au milieu des arêtes).
        const apothem = R * Math.cos(Math.PI / 180)
        for (const [edge, check] of [
            [10, (dist) => expect(dist).toBeLessThanOrEqual(apothem - 10 + 0.05)],
            [-5, (dist) => expect(dist).toBeLessThanOrEqual(R + 5 + 0.05)],
        ]) {
            const p = { sheets: [{ width: 2 * R, height: 2 * R, count: 1, shapeId: 'sheet-lx2k9f0a-ab12cd' }], space: 2, alternativesCount: 1, edgeDistance: edge }
            const { payload } = await buildLocalPayload({ files: small, params: p, profile: { timeBudgetSec: 2 } }, shapedDeps)
            expect(payload.edgeShift).toBe(edge - 2)
            expect(payload.sheetFrames[0]).toMatchObject({ width: 2 * R, height: 2 * R })
            const arts = await buildAlternativeArtifacts(solve(payload), payload)
            const byId = new Map(payload.parts.map((q) => [String(q.id), q]))
            let farthest = 0
            for (const art of arts) {
                for (const c of art.containers) {
                    for (const t of c.transforms) {
                        const cs = Math.cos(t.angle)
                        const sn = Math.sin(t.angle)
                        for (const [px, py] of byId.get(t.item_id).coords) {
                            const x = cs * px - sn * py + t.x
                            const y = sn * px + cs * py + t.y
                            const dist = Math.hypot(x - R, y - R)
                            farthest = Math.max(farthest, dist)
                            check(dist)
                        }
                    }
                }
                const v = art.report.verify
                expect(v.partsOutsideOutline ?? 0).toBe(0)
                expect(v.edgeOk).toBe(true)
            }
            if (edge < 0) expect(farthest).toBeGreaterThan(apothem)
        }
    })

    it('bande (une tôle, –X), bord 10 : pièces dans la vraie tôle, longueur réelle = moteur + d', async () => {
        const one = { ...params(10), sheets: [{ width: W, height: H, count: 1 }], directions: ['left'] }
        const { payload } = await buildLocalPayload({ files, params: one, profile: { timeBudgetSec: 2 } }, deps)
        expect(payload.problem).toBe('spp')
        expect(payload.instance.strip_height).toBe(H - 16)
        expect(payload.engineConfig.max_strip_width).toBe(W - 16)
        const result = solve(payload, 1)
        const engineStrip = result.alternatives[0].strip_width
        const arts = await buildAlternativeArtifacts(result, payload)
        const boxes = realBoxes(arts, payload)
        let gap = Infinity
        let maxX = -Infinity
        for (const [x0, y0, x1, y1] of boxes) {
            gap = Math.min(gap, x0, y0, W - x1, H - y1)
            maxX = Math.max(maxX, x1)
        }
        expect(gap).toBeGreaterThanOrEqual(10 - 0.05)
        // La coupe de fin garde l'espacement après la dernière pièce : longueur
        // réelle = largeur moteur + d ≥ dernière pièce + s (à l'arrondi f32 près).
        expect(engineStrip + 8).toBeGreaterThanOrEqual(maxX + 2 - 0.05)
        expect(engineStrip + 8).toBeLessThanOrEqual(W - 8 + 0.05)
    })
})
