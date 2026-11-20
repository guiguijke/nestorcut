import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Lot 5 : contrôles et rapport sur la VRAIE forme d'une tôle importée. Le
// calcul est celui du bundle wasm livré (public/geometry), appelé tel quel :
// seuls le SVG et le DXF sont bouchonnés.

const BUNDLE_JS = path.resolve(__dirname, '../../public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.resolve(__dirname, '../../public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null, specs: [] }))

vi.mock('../composables/geometryClient', () => ({
    geoExportSvgSheet: vi.fn(async () => '<svg/>'),
    geoExportDxfSheet: vi.fn(async () => null),
    geoPinwheelCapacity: vi.fn(async () => ({ rotations: [] })),
    geoComputeReport: vi.fn(async (spec) => {
        glue.specs.push(JSON.stringify(spec))
        return JSON.parse(glue.mod.compute_report(JSON.stringify(spec)))
    }),
}))

import { assembleBrowserArtifacts } from '../composables/finalizeLocal'
import {
    buildAlternativeArtifacts, markUnresolvedShapes, reportSheetShapes, toServerShapeAlternatives,
} from '../composables/localBridge'
import { showSheetOffcutColumn, zoneBadge } from '../utils/reportLayout'
import { DICTS, LOCALES } from '../utils/i18n'

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
})
beforeEach(() => { glue.specs.length = 0 })

const sqRing = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const DISC = (() => {
    const r = Array.from({ length: 360 }, (_, k) => {
        const a = (k * Math.PI) / 180
        return [500 + 500 * Math.cos(a), 500 + 500 * Math.sin(a)]
    })
    r.push(r[0])
    return r
})()
const DISC_AREA = 180 * 500 * 500 * Math.sin(Math.PI / 180)
const ZONE = sqRing(200, 200, 300, 300)

const bin = (id, data) => ({ id, cost: 1, stock: 1, shape: { type: 'polygon', data } })
const place = (x, y, id = 0) => ({ item_id: id, transformation: { rotation: 0, translation: [x, y] } })
const part = (id, w, h) => ({ id, file_slug: `f${id}`, coords: sqRing(0, 0, w, h), holes: [], count: 1 })

const payloadOf = (data, extra = {}) => ({
    problem: 'bpp',
    instance: { name: 't', bins: [bin(0, data)], items: [{ id: 0, demand: 1 }] },
    engineConfig: { min_item_separation: 2 },
    parts: [part(0, 100, 100)],
    ...extra,
})
const SHAPED = { shapedSheets: [{ id: 0, usableAreaMm2: 1, perimeterMm: 1 }] }
const resultOf = (items, containerId = 0) => ({
    problem: 'bpp',
    alternatives: [{ rank: 0, seed: 1, solution: { layouts: [{ container_id: containerId, placed_items: items }] } }],
})

// Aucun anneau (tableau de points) dans un rapport : la forme reste dans le navigateur.
function ringsIn(v, found = []) {
    if (Array.isArray(v)) {
        if (v.length >= 3 && v.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) found.push(v)
        else v.forEach((x) => ringsIn(x, found))
    } else if (v && typeof v === 'object') Object.values(v).forEach((x) => ringsIn(x, found))
    return found
}

describe('forme de tôle du rapport (reportSheetShapes)', () => {
    it('job sans tôle importée : null, rien ne change', () => {
        expect(reportSheetShapes(payloadOf({ outer: sqRing(0, 0, 10, 10) }), [{ container_id: 0 }])).toBeNull()
    })

    it('résout le contour et les zones du format de chaque layout', () => {
        const p = payloadOf({ outer: DISC, inner: [ZONE] }, SHAPED)
        const out = reportSheetShapes(p, [{ container_id: 0 }, {}])
        expect(out[0].shape.outer).toBe(DISC)
        expect(out[0].shape.inner).toEqual([ZONE])
        expect(out[1].shape.outer).toBe(DISC)
    })

    it('format rectangle dans un job à tôle importée : null (boîte)', () => {
        const p = payloadOf({ outer: DISC }, SHAPED)
        p.instance.bins.push(bin(1, { outer: sqRing(0, 0, 100, 100) }))
        expect(reportSheetShapes(p, [{ container_id: 1 }])).toEqual([null])
    })

    it('forme introuvable : non résolue, jamais rabattue sur la boîte (piège 60)', () => {
        const p = payloadOf({ outer: DISC }, SHAPED)
        expect(reportSheetShapes(p, [{ container_id: 5 }])).toEqual([{ unresolved: true }])
        const noOuter = payloadOf({}, SHAPED)
        expect(reportSheetShapes(noOuter, [{ container_id: 0 }])).toEqual([{ unresolved: true }])
        const noBins = { ...p, instance: { items: [] } }
        expect(reportSheetShapes(noBins, [{ container_id: 0 }])).toEqual([{ unresolved: true }])
    })

    it('markUnresolvedShapes : rien de vert sur une forme non résolue', () => {
        const rep = { verify: { insideSheet: true, zoneClear: true, verifyStatus: 'measured' } }
        markUnresolvedShapes(rep, [{ unresolved: true }])
        expect(rep.verify).toMatchObject({
            insideSheet: null, zoneClear: null, shapeVerified: false, verifyStatus: 'skipped',
        })
        // Résolu : intact. Sans forme : intact.
        const ok = { verify: { insideSheet: true } }
        expect(markUnresolvedShapes(ok, [null]).verify.insideSheet).toBe(true)
        expect(markUnresolvedShapes(ok, null).verify.insideSheet).toBe(true)
        // Rapport en échec sur un job à tôle importée : « non vérifié », pas une absence.
        const failed = markUnresolvedShapes(null, [{ shape: {} }])
        expect(failed.verify).toMatchObject({ insideSheet: null, verifyStatus: 'skipped', shapeVerified: false })
        expect(markUnresolvedShapes(null, null)).toBeNull()
    })
})

describe('rapport d\'une tôle disque (wasm réel)', () => {
    it('pièce dans le coin de la boîte : hors du disque, insideSheet faux', async () => {
        const arts = await buildAlternativeArtifacts(
            resultOf([place(0, 0)]), payloadOf({ outer: DISC }, SHAPED))
        const v = arts[0].report.verify
        expect(v.insideSheet).toBe(false)
        expect(v.partsOutsideOutline).toBe(1)
        expect(v.minDistToOutlineMm).toBeLessThan(-100)
    })

    it('pièce au centre : tout vert, distance au contour mesurée', async () => {
        const arts = await buildAlternativeArtifacts(
            resultOf([place(450, 450)]), payloadOf({ outer: DISC }, SHAPED))
        const v = arts[0].report.verify
        expect(v.insideSheet).toBe(true)
        expect(v.overlapFree).toBe(true)
        expect(v.partsOutsideOutline).toBe(0)
        // Le carré (450..550)² est à ~ 500 - 71 mm du bord : plus de 400 mm.
        expect(v.minDistToOutlineMm).toBeGreaterThan(400)
        expect(v.zoneClear).toBeNull() // pas de zone : pas de verdict de zone
    })

    it('aire, libre et densité sur l\'aire utile ; pas de chute rectangle', async () => {
        const arts = await buildAlternativeArtifacts(
            resultOf([place(450, 450)]), payloadOf({ outer: DISC, inner: [ZONE] }, SHAPED))
        const usable = DISC_AREA - 100 * 100
        const row = arts[0].report.per_sheet[0]
        expect(row.shaped).toBe(true)
        expect(row.widthMm).toBe(1000)
        expect(row.sheetAreaMm2).toBeCloseTo(usable, -1)
        expect(row.partsAreaMm2).toBe(10000)
        expect(row.freeAreaMm2).toBeCloseTo(usable - 10000, -1)
        expect(row.densityPct).toBeCloseTo((10000 / usable) * 100, 1)
        expect(row.offcut).toBeNull()
        const t = arts[0].report.totals
        expect(t.densityPct).toBe(row.densityPct)
        expect(t.formats[0]).toMatchObject({ widthMm: 1000, heightMm: 1000, shaped: true })
    })

    it('forme de la tôle absente du rapport, des containers et de leur JSON', async () => {
        const arts = await buildAlternativeArtifacts(
            resultOf([place(450, 450)]), payloadOf({ outer: DISC, inner: [ZONE] }, SHAPED))
        expect(ringsIn(arts[0].report)).toEqual([])
        expect(arts[0].containers.every((c) => !('shape' in c))).toBe(true)
        expect(JSON.stringify(arts[0].containers)).not.toContain('"outer"')
        // Le calcul local, lui, a bien reçu la forme.
        expect(glue.specs[0]).toContain('"shape"')
    })

    it('forme illisible : non vérifié, jamais vert', async () => {
        const arts = await buildAlternativeArtifacts(
            resultOf([place(450, 450)], 3), payloadOf({ outer: DISC }, SHAPED))
        const v = arts[0].report.verify
        expect(v.insideSheet).toBeNull()
        expect(v.verifyStatus).toBe('skipped')
        expect(v.shapeVerified).toBe(false)
    })
})

describe('zones interdites (wasm réel)', () => {
    it('pièce à cheval sur une zone : zoneClear faux, compte et aire exacts', async () => {
        // Pièce 100 x 100 en (250 ; 250) : recouvre 50 x 50 de la zone (200..300)².
        const arts = await buildAlternativeArtifacts(
            resultOf([place(250, 250)]), payloadOf({ outer: DISC, inner: [ZONE] }, SHAPED))
        const v = arts[0].report.verify
        expect(v.zoneClear).toBe(false)
        expect(v.zoneViolations).toBe(1)
        expect(v.zoneOverlapAreaMm2).toBe(2500)
        expect(v.minDistToZoneMm).toBe(0)
    })

    it('pièce nette : zoneClear vrai et distance à la zone', async () => {
        // Pièce (400..500)² : à 100 mm de la zone en x et en y.
        const arts = await buildAlternativeArtifacts(
            resultOf([place(400, 400)]), payloadOf({ outer: DISC, inner: [ZONE] }, SHAPED))
        const v = arts[0].report.verify
        expect(v.zoneClear).toBe(true)
        expect(v.zoneViolations).toBe(0)
        expect(v.minDistToZoneMm).toBeCloseTo(Math.hypot(100, 100), 2)
    })
})

describe('garde finale (finalizeLocal)', () => {
    const run = (items, data) => assembleBrowserArtifacts({
        result: resultOf(items), payload: payloadOf(data, SHAPED), sources: {}, jobSlug: 'j',
    })

    it('une option hors du vrai contour est écartée comme un recouvrement', async () => {
        const out = await run([place(0, 0)], { outer: DISC })
        expect(out.alternatives).toEqual([])
        expect(out.allAlternativesInvalid).toBe(true)
        expect(out.localDiscarded).toHaveLength(1)
        expect(out.localDiscarded[0]).toMatchObject({
            reason: 'outside_outline',
            verification: { partsOutsideOutline: 1, zoneViolations: 0 },
        })
    })

    it('une option sur une zone interdite est écartée, avec le compte', async () => {
        const out = await run([place(250, 250)], { outer: DISC, inner: [ZONE] })
        expect(out.allAlternativesInvalid).toBe(true)
        expect(out.localDiscarded[0]).toMatchObject({
            reason: 'forbidden_zone',
            verification: { zoneViolations: 1, zoneOverlapAreaMm2: 2500 },
        })
    })

    it('une option nette est livrée avec son rapport', async () => {
        const out = await run([place(450, 450)], { outer: DISC, inner: [ZONE] })
        expect(out.allAlternativesInvalid).toBe(false)
        expect(out.localDiscarded).toEqual([])
        expect(out.alternatives).toHaveLength(1)
        const r = out.alternatives[0].report
        expect(r.insideSheet).toBe(true)
        expect(r.zoneClear).toBe(true)
        expect(r.sheetAreaMm2).toBeCloseTo(DISC_AREA - 100 * 100, -1)
        expect(r.offcut).toBeNull()
        expect(out.alternatives[0].offcut).toBeNull()
        expect(ringsIn(out.alternatives[0])).toEqual([])
    })

    it('forme illisible : non vérifié, l\'option n\'est pas écartée à tort', async () => {
        const out = await assembleBrowserArtifacts({
            result: resultOf([place(450, 450)], 3), payload: payloadOf({ outer: DISC }, SHAPED),
            sources: {}, jobSlug: 'j',
        })
        expect(out.alternatives).toHaveLength(1)
        expect(out.alternatives[0].report.verifyStatus).toBe('skipped')
        expect(out.alternatives[0].report.insideSheet).toBeNull()
    })
})

describe('job SANS tôle importée : inchangé', () => {
    const RECT = { outer: sqRing(0, 0, 1000, 1000) }

    it('le calcul ne reçoit aucune forme, le rapport n\'a aucun champ de forme', async () => {
        const arts = await buildAlternativeArtifacts(resultOf([place(0, 0)]), payloadOf(RECT))
        expect(glue.specs[0]).not.toContain('"shape"')
        const v = arts[0].report.verify
        for (const k of ['shapedSheets', 'shapeVerified', 'partsOutsideOutline', 'zoneClear',
            'zoneViolations', 'zoneOverlapAreaMm2', 'minDistToZoneMm', 'minDistToOutlineMm', 'zonesChecked']) {
            expect(k in v, k).toBe(false)
        }
        const row = arts[0].report.per_sheet[0]
        expect('shaped' in row).toBe(false)
        expect(row.offcut).not.toBeNull()
        expect(row.sheetAreaMm2).toBe(1000000)
        expect(v.insideSheet).toBe(true) // la boîte est la tôle
    })

    it('la garde ne touche pas insideSheet d\'une tôle rectangle', async () => {
        // Pièce qui sort de la tôle : le comportement d'avant (verdict « unfit »
        // à l'écran) reste, l'option n'est pas écartée par la garde de forme.
        const out = await assembleBrowserArtifacts({
            result: resultOf([place(950, 0)]), payload: payloadOf(RECT), sources: {}, jobSlug: 'j',
        })
        expect(out.localDiscarded).toEqual([])
        expect(out.alternatives).toHaveLength(1)
        expect(out.alternatives[0].report.insideSheet).toBe(false)
    })
})

describe('affichage', () => {
    it('la colonne chute disparaît quand toutes les tôles sont importées', () => {
        expect(showSheetOffcutColumn([{ shaped: true }, { shaped: true }], null)).toBe(false)
        expect(showSheetOffcutColumn([{ shaped: true }, {}], null)).toBe(true)
        // Inchangé pour des tôles rectangulaires.
        expect(showSheetOffcutColumn([{}, {}], null)).toBe(true)
        expect(showSheetOffcutColumn([{}], { areaMm2: 5 })).toBe(false)
        expect(showSheetOffcutColumn([{ offcut: { a: 1 } }], null)).toBe(true)
    })

    it('pastille de zone : verte, rouge avec le compte, absente sans verdict', () => {
        const t = (k) => k
        const tp = (k, n) => `${k}#${n}`
        expect(zoneBadge({ zoneClear: true }, t, tp)).toEqual({ ok: true, label: 'report.zoneClear' })
        expect(zoneBadge({ zoneClear: false, zoneViolations: 3 }, t, tp))
            .toEqual({ ok: false, label: 'report.zoneHit#3' })
        expect(zoneBadge({ zoneClear: null }, t, tp)).toBeNull()
        expect(zoneBadge({}, t, tp)).toBeNull()
        expect(zoneBadge(null, t, tp)).toBeNull()
    })

    it.each(LOCALES.map((l) => l.code || l))('les textes de la pastille existent (%s)', (code) => {
        for (const k of ['report.zoneClear', 'report.zoneHit.one', 'report.zoneHit.other']) {
            expect(DICTS[code][k], `${code} ${k}`).toBeTruthy()
        }
        expect(DICTS[code]['report.zoneHit.other']).toContain('{n}')
        expect(DICTS[code]['settings.sheetShape.badge']).toBeTruthy()
    })

    it('les écrans lisent le verdict de zone et l\'étiquette de tôle importée', () => {
        const read = (rel) => readFileSync(path.resolve(__dirname, rel), 'utf8')
        const modal = read('../components/ResultModal.vue')
        expect(modal).toMatch(/r\.zoneClear === false/)
        expect(modal).toContain('zoneBadge(r, t, tp)')
        expect(modal).toMatch(/f\.shaped \?/)
        expect(read('../components/UserResultItem.vue')).toMatch(/r0\.zoneClear === false/)
        expect(read('../components/ResultReport.vue')).toContain('data-testid="report-row-shaped"')
    })
})

describe('alternatives au format serveur', () => {
    it('densité et aire de tôle de l\'alternative : l\'aire utile', async () => {
        const payload = payloadOf({ outer: DISC, inner: [ZONE] }, SHAPED)
        const result = resultOf([place(450, 450)])
        const arts = await buildAlternativeArtifacts(result, payload)
        const [alt] = toServerShapeAlternatives(result, payload, arts)
        const usable = DISC_AREA - 100 * 100
        expect(alt.report.sheetAreaMm2).toBeCloseTo(usable, -1)
        expect(alt.density).toBeCloseTo(10000 / usable, 3)
        expect(alt.offcut).toBeNull()
        // `usedSheetShare` ne sert qu'à ordonner les options (emprise / boîte) :
        // il garde la boîte, sinon il saturerait à 1 sur une tôle courbe.
        expect(alt.usedSheetShare).toBeCloseTo(10000 / 1000000, 3)
    })
})
