import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Distance au bord, chemin navigateur après le moteur : UN retour au repère
// réel (après toutes les passes), containers / rapport / frame finale / frames
// live dans le repère RÉEL, et rien ne change sans distance au bord.

const BUNDLE_JS = path.resolve(__dirname, '../../public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.resolve(__dirname, '../../public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null, specs: [] }))

vi.mock('../composables/geometryClient', () => ({
    geoExportSvgSheet: vi.fn(async (spec) => `<svg data-w="${spec.bin_width}" data-h="${spec.bin_height}"/>`),
    geoExportDxfSheet: vi.fn(async () => null),
    geoPinwheelCapacity: vi.fn(async () => ({ rotations: [] })),
    geoComputeReport: vi.fn(async (spec) => {
        glue.specs.push(JSON.parse(JSON.stringify(spec)))
        return JSON.parse(glue.mod.compute_report(JSON.stringify(spec)))
    }),
}))

import { assembleBrowserArtifacts, buildLiveLayout } from '../composables/finalizeLocal'
import {
    applySpacingMargin,
    buildAlternativeArtifacts,
    decorateLiveLayout,
    edgeShiftOf,
    layoutsToRealFrame,
    liveFrameToReal,
    markUnresolvedShapes,
    mergeShapeVerify,
    realSheetDims,
    reportSheetShapes,
    binShapeForDxf,
    sheetDims,
} from '../composables/localBridge'
import { frameFitsSheet, liveUsedLength } from '../utils/liveJob'
import { liveShapeTable } from '../utils/sheetDraw'
import { runInWorker } from '../composables/localCompute'
import { runPool } from '../composables/localPool'

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
})
beforeEach(() => { glue.specs.length = 0 })

/** Le bundle géométrie livré connaît-il déjà `edge` (rapport reconstruit) ? */
function reportKnowsEdge() {
    const spec = {
        items: [{ id: '0', coords: rect(0, 0, 10, 10), holes: [] }],
        containers: [{ bin_width: 100, bin_height: 100, transforms: [{ item_id: '0', angle: 0, x: 20, y: 20 }] }],
        space: 2,
        edge: 5,
    }
    return 'edgeGapMm' in (JSON.parse(glue.mod.compute_report(JSON.stringify(spec))).verify || {})
}

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const place = (id, x, y, rot = 0) => ({ item_id: id, transformation: { rotation: rot, translation: [x, y] } })
const part = (id, w, h) => ({ id, file_slug: `f${id}`, coords: rect(0, 0, w, h), holes: [], count: 1, color: '#123456', handles: [] })

/** Payload BPP rectangulaire à distance au bord : vraie tôle 1000 × 2000, bord
 * `edge` à espacement 2 (d = edge − 2), conteneur moteur (W − 2d) × (H − 2d). */
function rectPayload(edge, extra = {}) {
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
        parts: [part(0, 100, 100), part(1, 50, 80)],
        hasHoles: false,
        fillHoles: false,
        requestedEdge: edge,
        edgeShift: d,
        sheetFrames: [{ width: 1000, height: 2000 }],
        ...extra,
    }
}

describe('repère réel : layoutsToRealFrame', () => {
    it('décale chaque pose UNE fois (pose partagée, appel répété)', () => {
        const shared = place(0, 2, 2)
        const a = [{ placed_items: [shared, place(1, 10, 20)] }]
        const b = [{ placed_items: [shared] }]
        const moved = new WeakSet()
        layoutsToRealFrame(a, 8, moved)
        layoutsToRealFrame(b, 8, moved)
        layoutsToRealFrame(a, 8, moved)
        expect(shared.transformation.translation).toEqual([10, 10])
        expect(a[0].placed_items[1].transformation.translation).toEqual([18, 28])
        expect(a[0].edgeReal).toBe(true)
    })

    it('d = 0 : rien, pas même la marque', () => {
        const l = [{ placed_items: [place(0, -0, 3)] }]
        layoutsToRealFrame(l, 0)
        expect(Object.is(l[0].placed_items[0].transformation.translation[0], -0)).toBe(true)
        expect('edgeReal' in l[0]).toBe(false)
    })
})

describe('buildAlternativeArtifacts : un seul retour au repère réel, pour toute alternative', () => {
    it('bord 10 (d = 8) : moteur, grille structurelle et grille BPP décalées une fois ; containers réels ; rapport avec edge', async () => {
        const payload = rectPayload(10)
        const result = {
            problem: 'bpp',
            alternatives: [
                { rank: 0, bias: 'left', solution: { layouts: [{ container_id: 0, placed_items: [place(0, 2, 2), place(1, 200, 2)] }] } },
                { rank: 1, structural: true, selfContained: true, solution: { layouts: [{ container_id: 0, placed_items: [place(0, 2, 300), place(1, 300, 300)] }] } },
                { rank: 2, structural: true, solution: { layouts: [{ container_id: 0, placed_items: [place(0, 500, 2), place(1, 2, 500)] }] } },
            ],
        }
        const arts = await buildAlternativeArtifacts(result, payload)
        expect(arts).toHaveLength(3)
        expect(arts[0].containers[0].transforms.map((t) => [t.x, t.y])).toEqual([[10, 10], [208, 10]])
        expect(arts[1].containers[0].transforms.map((t) => [t.x, t.y])).toEqual([[10, 308], [308, 308]])
        expect(arts[2].containers[0].transforms.map((t) => [t.x, t.y])).toEqual([[508, 10], [10, 508]])
        for (const a of arts) {
            expect(a.containers[0].bin_width).toBe(1000)
            expect(a.containers[0].bin_height).toBe(2000)
            expect(a.sheets[0]).toContain('data-w="1000"')
        }
        // Les layouts du résultat sont passés au repère réel (frame finale, .job).
        expect(result.alternatives[0].solution.layouts[0].placed_items[0].transformation.translation).toEqual([10, 10])
        // Spec du rapport : edge interne = demandé + marge (0 ici).
        expect(glue.specs).toHaveLength(3)
        for (const s of glue.specs) expect(s.edge).toBe(10)
        // Le bundle livré connaît `edge` (rapport reconstruit) : plus de garde.
        expect(reportKnowsEdge()).toBe(true)
        for (const a of arts) {
            expect(a.report.verify.edgeGapMm).toBeCloseTo(10, 6)
            expect(a.report.verify.edgeOk).toBe(true)
            expect(a.report.verify.insideSheet).toBe(true)
        }
    })

    it('sans distance au bord : spec sans `edge`, containers = sheetDims, poses inchangées', async () => {
        const payload = rectPayload(2)
        for (const k of ['requestedEdge', 'edgeShift', 'sheetFrames']) delete payload[k]
        const result = { problem: 'bpp', alternatives: [{ rank: 0, solution: { layouts: [{ container_id: 0, placed_items: [place(0, 2, 2)] }] } }] }
        const arts = await buildAlternativeArtifacts(result, payload)
        expect('edge' in glue.specs[0]).toBe(false)
        expect([arts[0].containers[0].bin_width, arts[0].containers[0].bin_height]).toEqual(sheetDims(payload, 0))
        expect(arts[0].containers[0].transforms[0]).toMatchObject({ x: 2, y: 2 })
        expect('edgeReal' in result.alternatives[0].solution.layouts[0]).toBe(false)
        expect(edgeShiftOf(payload)).toBe(0)
    })

    it('marge de courbes : le rapport reçoit edge = demandé + (interne − demandé)', async () => {
        const payload = rectPayload(10, { engineConfig: { min_item_separation: 2.08 } })
        const result = { problem: 'bpp', alternatives: [{ rank: 0, solution: { layouts: [{ container_id: 0, placed_items: [place(0, 2.08, 2.08)] }] } }] }
        await buildAlternativeArtifacts(result, payload)
        expect(glue.specs[0].edge).toBeCloseTo(10.08, 12)
        expect(glue.specs[0].space).toBe(2.08)
    })
})

describe('finalizeLocal : un dépassement permis n’est jamais écarté', () => {
    it('bord −5 : grille structurelle qui dépasse de 4 mm gardée ; de 6 mm écartée (outside_sheet)', async () => {
        expect(reportKnowsEdge()).toBe(true)
        const payload = rectPayload(-5)
        // Moteur d = −7 : (3, 3) moteur = (−4, −4) réel.
        const ok = { problem: 'bpp', alternatives: [
            { rank: 0, bias: 'left', solution: { layouts: [{ container_id: 0, placed_items: [place(0, 3, 3), place(1, 300, 300)] }] } },
            { rank: 1, structural: true, selfContained: true, solution: { layouts: [{ container_id: 0, placed_items: [place(0, 3, 500), place(1, 600, 600)] }] } },
        ] }
        const kept = await assembleBrowserArtifacts({ result: ok, payload, sources: {}, jobSlug: 'j' })
        expect(kept.localDiscarded).toEqual([])
        expect(kept.alternatives).toHaveLength(2)
        for (const a of kept.alternatives) {
            expect(a.report.insideSheet).toBe(true)
            expect(a.report.edgeOk).toBe(true)
            expect(a.report.edgeGapMm).toBeCloseTo(-4, 6)
        }
        const bad = { problem: 'bpp', alternatives: [
            { rank: 0, bias: 'left', solution: { layouts: [{ container_id: 0, placed_items: [place(0, 300, 300), place(1, 600, 600)] }] } },
            { rank: 1, structural: true, selfContained: true, solution: { layouts: [{ container_id: 0, placed_items: [place(0, 1, 500), place(1, 600, 600)] }] } },
        ] }
        const out = await assembleBrowserArtifacts({ result: bad, payload, sources: {}, jobSlug: 'j' })
        expect(out.localDiscarded.map((d) => d.reason)).toEqual(['outside_sheet'])
    })
})

describe('frame finale (buildLiveLayout) : repère réel, longueur de bande réelle', () => {
    it('bande, bord 10 : poses déjà réelles gardées, strip_width + d, tôle réelle, stripMaxWidth', () => {
        const payload = {
            problem: 'spp',
            instance: { name: 't', items: [], strip_height: 1984 },
            engineConfig: { min_item_separation: 2, max_strip_width: 984 },
            parts: [],
            requestedEdge: 10, edgeShift: 8, sheetFrames: [{ width: 1000, height: 2000 }],
        }
        const layout = { placed_items: [place(0, 2, 2)] }
        layoutsToRealFrame([layout], 8)
        const frame = buildLiveLayout({ problem: 'spp' }, payload, { bias: 'left', strip_width: 402, solution: { layout, strip_width: 402 } }, 0.5)
        expect(frame.items).toEqual([[0, 0, 0, 10, 10]])
        expect(frame.strip_width).toBe(410)
        expect(frame.sheets).toEqual([[1000, 2000]])
        expect(frame.edgeReal).toBe(true)
        expect(frame.stripMaxWidth).toBe(992)
        // Un layout jamais passé au repère réel l'est ici (jamais zéro fois).
        const raw = { placed_items: [place(0, 2, 2)] }
        expect(buildLiveLayout({ problem: 'spp' }, payload, { solution: { layout: raw } }).items).toEqual([[0, 0, 0, 10, 10]])
    })

    it('sans distance au bord : la frame d’avant (aucune clé de plus)', () => {
        const payload = { problem: 'spp', instance: { strip_height: 2000 }, engineConfig: { max_strip_width: 1000 }, parts: [] }
        const frame = buildLiveLayout({ problem: 'spp' }, payload, { solution: { layout: { placed_items: [place(0, -0, 2)] }, strip_width: 300 } })
        expect(frame.strip_width).toBe(300)
        expect(Object.is(frame.items[0][3], -0)).toBe(true)
        expect('edgeReal' in frame).toBe(false)
        expect('stripMaxWidth' in frame).toBe(false)
    })
})

describe('frames live : repère réel une fois', () => {
    const sppPayload = {
        problem: 'spp',
        instance: { name: 't', items: [], strip_height: 2014 },
        engineConfig: { min_item_separation: 2, max_strip_width: 1014 },
        parts: [part(0, 100, 100)],
        requestedEdge: -5, edgeShift: -7, sheetFrames: [{ width: 1000, height: 2000 }],
    }

    it('frame moteur → poses −7, largeur de bande −7, plus grande longueur 1007', () => {
        // Les frames du moteur portent `type: 'layout'` (engine.worker.js).
        const evt = { type: 'layout', feasible: true, strip_width: 1010, used_height: 300, items: [[0, 0, 3, 3]], sheets: [[1000, 2000]], isSpp: true }
        const real = liveFrameToReal(decorateLiveLayout(evt, sppPayload), sppPayload)
        expect(real.items).toEqual([[0, 0, -4, -4]])
        expect(real.strip_width).toBe(1003)
        expect(real.used_height).toBe(293)
        expect(real.stripMaxWidth).toBe(1007)
        expect(real.edgeReal).toBe(true)
        // Bande réelle 1003 > tôle 1000 : elle tient quand même (dépassement permis au bout).
        expect(frameFitsSheet(real)).toBe(true)
        expect(liveUsedLength(real, 'searching')).toBe(1003)
        // Une frame déjà réelle ne bouge plus.
        expect(liveFrameToReal(real, sppPayload).items).toEqual([[0, 0, -4, -4]])
        expect(liveFrameToReal(real, sppPayload).strip_width).toBe(1003)
    })

    it('frame finale déjà réelle : décorée dans le repère moteur puis rendue réelle, sans double décalage', () => {
        const fin = { stage: 'final', edgeReal: true, densityMeasured: true, density: 0.4, items: [[0, 0, 0, -4, -4]], sheets: [[1000, 2000]] }
        const out = liveFrameToReal(decorateLiveLayout(fin, sppPayload), sppPayload)
        expect(out.items).toEqual([[0, 0, 0, -4, -4]])
    })

    it('bord plus grand que l’espacement : la limite de bande est plus courte que la tôle', () => {
        const p = { ...sppPayload, engineConfig: { max_strip_width: 984 }, requestedEdge: 10, edgeShift: 8 }
        const tooLong = liveFrameToReal({ type: 'layout', feasible: true, strip_width: 990, items: [[0, 0, 2, 2]], sheets: [[1000, 2000]] }, p)
        expect(tooLong.strip_width).toBe(998)
        expect(tooLong.stripMaxWidth).toBe(992)
        expect(frameFitsSheet(tooLong)).toBe(false)
    })

    it('évènements sans poses et d = 0 : rendus tels quels (même objet)', () => {
        const evals = { type: 'evals', evals: 12 }
        expect(liveFrameToReal(evals, sppPayload)).toBe(evals)
        const zone = { type: 'zone', items: [[0, 0, 1, 1]] }
        expect(liveFrameToReal(zone, sppPayload)).toBe(zone)
        const plain = { ...sppPayload }
        for (const k of ['requestedEdge', 'edgeShift', 'sheetFrames']) delete plain[k]
        const f = { feasible: true, items: [[0, 0, 3, 3]], strip_width: 5 }
        expect(liveFrameToReal(f, plain)).toBe(f)
        expect(frameFitsSheet({ feasible: true, strip_width: 1000.4, sheets: [[1000, 10]] })).toBe(true)
        expect(frameFitsSheet({ feasible: true, strip_width: 1000.6, sheets: [[1000, 10]] })).toBe(false)
    })

    it('format de chaque rang (binFormats) : tôles réelles par format', () => {
        const p = rectPayload(10, {
            instance: { name: 't', items: [], bins: [
                { id: 0, stock: 1, shape: { data: { outer: rect(0, 0, 984, 1984) } } },
                { id: 1, stock: 1, shape: { data: { outer: rect(0, 0, 484, 484) } } },
            ] },
            sheetFrames: [{ width: 1000, height: 2000 }, { width: 500, height: 500 }],
        })
        const out = liveFrameToReal({ type: 'layout', feasible: true, items: [[0, 0, 0, 2, 2]], binFormats: [1], sheets: [[484, 484]] }, p)
        expect(out.sheets).toEqual([[500, 500]])
        expect(out.items).toEqual([[0, 0, 0, 10, 10]])
        expect(realSheetDims(p, 1)).toEqual([500, 500])
        expect(sheetDims(p, 1)).toEqual([484, 484])
    })

    it('localPool.runPool : les frames portent les VRAIES tôles (le moteur garde les siennes)', async () => {
        const posted = []
        vi.stubGlobal('Worker', class {
            postMessage(msg) {
                posted.push(msg)
                queueMicrotask(() => {
                    this.onmessage?.({ data: { jobSlug: msg.jobSlug, live: { items: [[0, 0, 3, 3]], feasible: true, strip_width: 10 } } })
                    this.onmessage?.({ data: { jobSlug: msg.jobSlug, ok: true, result: { problem: 'spp', alternatives: [] } } })
                })
            }

            terminate() {}
        })
        const frames = []
        const out = await runPool('j-pool-edge', { ...sppPayload, engineConfig: { ...sppPayload.engineConfig, prng_seed: '1' } },
            { onLive: (f) => frames.push(f), walks: 1, concurrency: 1 })
        expect(out.ok).toBe(true)
        expect(frames[0].sheets).toEqual([[1000, 2000]])
        expect(posted[0].instance.strip_height).toBe(2014)
        expect(posted[0].engineConfig.max_strip_width).toBe(1014)
        vi.unstubAllGlobals()
    })

    it('localCompute.runInWorker : les frames portent les VRAIES tôles', async () => {
        vi.stubGlobal('Worker', class {
            postMessage(msg) {
                queueMicrotask(() => {
                    this.onmessage?.({ data: { jobSlug: msg.jobSlug, live: { items: [[0, 0, 3, 3]] } } })
                    this.onmessage?.({ data: { jobSlug: msg.jobSlug, ok: true, result: {} } })
                })
            }

            terminate() {}
        })
        const frames = []
        await runInWorker('j-edge', sppPayload, { onLive: (f) => frames.push(f) })
        expect(frames[0].sheets).toEqual([[1000, 2000]])
        vi.unstubAllGlobals()
    })
})

describe('tôle importée : formes RÉELLES pour le rapport, le DXF, la vue live', () => {
    const real = rect(0, 0, 100, 200)
    const zone = rect(20, 20, 40, 40)
    const payload = {
        problem: 'bpp',
        instance: { name: 't', items: [], bins: [{ id: 0, stock: 1, shape: { type: 'polygon', data: { outer: rect(0, 0, 84, 184), inner: [rect(12, 12, 32, 32)] } } }] },
        engineConfig: { min_item_separation: 2 },
        parts: [part(0, 10, 10)],
        shapedSheets: [{ id: 0, usableAreaMm2: 19600, perimeterMm: 680 }],
        requestedEdge: 10, edgeShift: 8,
        sheetFrames: [{ width: 100, height: 200, outer: real, inner: [zone] }],
    }

    it('reportSheetShapes / binShapeForDxf : le contour d’origine et ses zones, jamais le contour moteur', () => {
        expect(reportSheetShapes(payload, [{ container_id: 0 }])).toEqual([{ shape: { outer: real, inner: [zone] } }])
        expect(binShapeForDxf(payload, { container_id: 0 })).toEqual({ outer: real, inner: [zone] })
    })

    it('défauts dessinés : forme livrée pour le rapport, contour ORIGINAL + dangers pour la forme moteur', () => {
        const deliver = { outer: rect(0, 0, 90, 200), inner: [zone] }
        const p = { ...payload, shapedSheets: [{ id: 0, usableAreaMm2: 17600, perimeterMm: 660, shape: deliver }] }
        expect(reportSheetShapes(p, [{ container_id: 0 }])).toEqual([{ shape: deliver, engineShape: { outer: real, inner: [zone] } }])
    })

    it('vue live : dimensions et contour réels', () => {
        const table = liveShapeTable(payload)
        expect(table[0].w).toBe(100)
        expect(table[0].h).toBe(200)
    })

    it('rapport : écart au bord jugé sur le contour ORIGINAL (rapport moteur) ; non vérifié = jamais vert', () => {
        const d = { verify: { insideSheet: true, edgeGapMm: 3, edgeOk: true, smallestGapMm: 5, spacingOk: true, overlapFree: true, shapeVerified: true } }
        const e = { verify: { insideSheet: true, edgeGapMm: 9, edgeOk: false, smallestGapMm: 4, spacingOk: true, overlapFree: true, shapeVerified: true } }
        const merged = mergeShapeVerify(d, e)
        expect(merged.verify.edgeGapMm).toBe(9)
        expect(merged.verify.edgeOk).toBe(false)
        expect(merged.verify.smallestGapMm).toBe(4)
        expect(mergeShapeVerify(d, null).verify.edgeOk).toBeNull()
        const legacy = mergeShapeVerify({ verify: { insideSheet: true } }, { verify: { insideSheet: true } })
        expect('edgeGapMm' in legacy.verify).toBe(false)
        const unresolved = markUnresolvedShapes({ verify: { edgeOk: true, edgeGapMm: 2 } }, [{ unresolved: true }])
        expect(unresolved.verify.edgeOk).toBeNull()
    })
})

describe('applySpacingMargin : l’écart au bord perd la marge, sans plancher', () => {
    it('négatif conservé, jugé contre le bord demandé', () => {
        const r = { verify: { smallestGapMm: 2.1, spacingOk: true, edgeGapMm: -4.92, edgeOk: true } }
        applySpacingMargin(r, 0.08, 2, -5)
        expect(r.verify.edgeGapMm).toBe(-5)
        expect(r.verify.edgeOk).toBe(true)
        expect(r.verify.smallestGapMm).toBe(2.02)
        const low = { verify: { smallestGapMm: null, spacingOk: true, edgeGapMm: 9.95, edgeOk: true } }
        applySpacingMargin(low, 0.08, 2, 10)
        expect(low.verify.edgeGapMm).toBe(9.87)
        expect(low.verify.edgeOk).toBe(false)
        expect(low.verify.smallestGapMm).toBeNull()
    })
    it('sans bord demandé : le comportement d’avant', () => {
        const r = { verify: { smallestGapMm: 2.1, spacingOk: true, edgeGapMm: 1, edgeOk: true } }
        applySpacingMargin(r, 0.08, 2)
        expect(r.verify.edgeGapMm).toBe(1)
    })
})

afterEach(() => vi.unstubAllGlobals())
