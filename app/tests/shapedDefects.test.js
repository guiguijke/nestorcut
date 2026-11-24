import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Défauts dessinés sur une tôle importée : payload, rapport (double calcul),
// DXF, vue live. Le calcul de rapport est celui du bundle wasm livré.

const BUNDLE_JS = path.resolve(__dirname, '../../public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.resolve(__dirname, '../../public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null, specs: [], failSecond: false, errorSecond: false }))

vi.mock('../composables/geometryClient', () => ({
    geoExportSvgSheet: vi.fn(async () => '<svg/>'),
    geoExportDxfSheet: vi.fn(async () => null),
    geoPinwheelCapacity: vi.fn(async () => ({ rotations: [] })),
    geoComputeReport: vi.fn(async (spec) => {
        glue.specs.push(JSON.stringify(spec))
        if (glue.specs.length === 2 && glue.failSecond) throw new Error('boom')
        if (glue.specs.length === 2 && glue.errorSecond) return { error: 'x' }
        return JSON.parse(glue.mod.compute_report(JSON.stringify(spec)))
    }),
}))

import {
    binShapeForDxf, buildAlternativeArtifacts, mergeShapeVerify, reportSheetShapes,
} from '../composables/localBridge'
import { buildLocalPayload } from '../composables/localPayloadBuilder'
import { liveShapeTable } from '../utils/sheetDraw'
import { makeDefect } from '../utils/sheetDefects'
import { bindCut, makeSheetRecord, ringArea, ringBbox } from '../utils/sheetShape'

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
})
beforeEach(() => { glue.specs.length = 0; glue.failSecond = false; glue.errorSecond = false })

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const contour = (ring, depth, parent) => ({ ring, depth, parent, areaMm2: ringArea(ring), bbox: ringBbox(ring) })
const NOTCHED = [[0, 0], [100, 0], [100, 40], [90, 40], [90, 60], [100, 60], [100, 100], [0, 100], [0, 0]]
const CHIP = rect(90, 40, 110, 60)

const SHEET_ID = 'sheet-lx2k9f0a-ab12cd'
const OX = -37.5
const OY = 12.25
const chipCut = () => ({
    ok: true,
    outer: NOTCHED.map(([x, y]) => [x + OX, y + OY]),
    holes: [],
    hazards: [CHIP.map(([x, y]) => [x + OX, y + OY])],
    lostPieces: [],
    usableArea: 9800,
    pieces: 1,
    lostArea: 0,
    removedArea: 200,
    changed: true,
    repairs: 0,
    maxShift: 0,
})
const chipRecord = () => {
    const contours = [contour(rect(OX, OY, OX + 100, OY + 100), 1, null)]
    const drawn = [makeDefect('d1', 'rect', { a: [OX + 90, OY + 40], b: [OX + 110, OY + 60] })]
    return makeSheetRecord({
        id: SHEET_ID, projectSlug: 'p', name: 'n', sourceFileName: 'f.dxf', sourceUnits: 'mm',
        contours, outlineIndex: 0, forbidden: [], addedAt: 1,
        drawn, cut: bindCut(chipCut(), contours, 0, [], drawn),
    })
}
const plainRecord = () => makeSheetRecord({
    id: SHEET_ID, projectSlug: 'p', name: 'n', sourceFileName: 'f.dxf', sourceUnits: 'mm',
    contours: [contour(rect(OX, OY, OX + 100, OY + 100), 1, null), contour(rect(-20, 30, -10, 40), 2, 0)],
    outlineIndex: 0, forbidden: [1], addedAt: 1,
})

const profile = { timeBudgetSec: 13, vcores: 1, maxDirections: 1, level: 'browser' }
const part = () => ({ coordinates: rect(0, 0, 10, 10), holes: [], handles: ['A'], color: null })
const build = (record) => buildLocalPayload(
    {
        files: [{ slug: 'a.dxf', name: 'a.dxf', count: 3, rotations: [0, 90], parts: [part()] }],
        params: { sheets: [{ width: 1, height: 1, count: 1, shapeId: SHEET_ID }], space: 2, directions: ['left'], alternativesCount: 1 },
        profile,
    },
    { getSheetRecord: async (slug) => (slug === SHEET_ID ? record : null) },
)

// Aucun anneau (tableau de points) dans une structure : la forme reste dans le navigateur.
function ringsIn(v, found = []) {
    if (Array.isArray(v)) {
        if (v.length >= 3 && v.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) found.push(v)
        else v.forEach((x) => ringsIn(x, found))
    } else if (v && typeof v === 'object') Object.values(v).forEach((x) => ringsIn(x, found))
    return found
}

describe('payload', () => {
    it('sans défaut : shapedSheets et bins d\'avant, aucune clé shape', async () => {
        const { payload } = await build(plainRecord())
        expect(payload.shapedSheets).toEqual([{ id: 0, usableAreaMm2: 9900, perimeterMm: 440 }])
        expect(Object.keys(payload.shapedSheets[0])).toEqual(['id', 'usableAreaMm2', 'perimeterMm'])
        expect(payload.instance.bins[0].shape.data).toEqual({
            outer: rect(0, 0, 100, 100),
            inner: [rect(17.5, 17.75, 27.5, 27.75)],
        })
    })

    it('avec défaut : le moteur reçoit le contour original + dangers ; shapedSheets porte la forme livrée', async () => {
        const { payload } = await build(chipRecord())
        expect(payload.instance.bins[0].shape.data).toEqual({ outer: rect(0, 0, 100, 100), inner: [CHIP] })
        expect(payload.shapedSheets).toHaveLength(1)
        expect(payload.shapedSheets[0]).toMatchObject({ id: 0, usableAreaMm2: 9800 })
        expect(payload.shapedSheets[0].shape).toEqual({ outer: NOTCHED, inner: [] })
        expect(payload.engineConfig.finish_partial_sheet).toBe(false)
    })

    it('une coupe illisible arrête le job avant tout calcul', async () => {
        const rec = chipRecord()
        await expect(build({ ...rec, cut: undefined })).rejects.toThrow('sheet_shape_missing')
    })
})

describe('reportSheetShapes, binShapeForDxf, liveShapeTable', () => {
    const payloadOf = async (record = chipRecord()) => (await build(record)).payload

    it('forme livrée + forme du moteur ; sans défaut : l\'entrée d\'avant', async () => {
        const p = await payloadOf()
        const [e] = reportSheetShapes(p, [{ container_id: 0 }])
        expect(e.shape).toEqual({ outer: NOTCHED, inner: [] })
        expect(e.engineShape).toEqual({ outer: rect(0, 0, 100, 100), inner: [CHIP] })
        const q = await payloadOf(plainRecord())
        const [f] = reportSheetShapes(q, [{ container_id: 0 }])
        expect(Object.keys(f)).toEqual(['shape'])
        expect(f.shape).toEqual({ outer: rect(0, 0, 100, 100), inner: [rect(17.5, 17.75, 27.5, 27.75)] })
    })

    it('forme livrée illisible : unresolved, jamais la forme du moteur', async () => {
        const p = await payloadOf()
        p.shapedSheets[0].shape = { outer: [[0, 0]], inner: [] }
        expect(reportSheetShapes(p, [{ container_id: 0 }])).toEqual([{ unresolved: true }])
        p.shapedSheets[0].shape = null
        expect(reportSheetShapes(p, [{ container_id: 0 }])).toEqual([{ unresolved: true }])
    })

    it('DXF : la forme livrée ; illisible : lève (pas de rectangle ni de tôle non coupée en silence)', async () => {
        const p = await payloadOf()
        expect(binShapeForDxf(p, { container_id: 0 })).toEqual({ outer: NOTCHED, inner: [] })
        p.shapedSheets[0].shape = { outer: [[0, 0], [NaN, 1], [2, 2], [0, 0]], inner: [] }
        expect(() => binShapeForDxf(p, { container_id: 0 })).toThrow('sheet_shape_missing')
        const q = await payloadOf(plainRecord())
        expect(binShapeForDxf(q, { container_id: 0 })).toEqual({
            outer: rect(0, 0, 100, 100), inner: [rect(17.5, 17.75, 27.5, 27.75)],
        })
    })

    it('vue live : taille du moteur, chemins de la forme livrée', async () => {
        const p = await payloadOf()
        const [t] = liveShapeTable(p)
        expect(t.w).toBe(100)
        expect(t.h).toBe(100)
        expect(t.outline).toBe('M0 100 100 100 100 60 90 60 90 40 100 40 100 0 0 0Z')
        expect(t.zones).toBe('')
        const q = await payloadOf(plainRecord())
        expect(liveShapeTable(q)[0].outline).toBe('M0 100 100 100 100 0 0 0Z')
    })
})

describe('mergeShapeVerify', () => {
    const rep = (v) => ({
        per_sheet: [{ densityPct: 1 }], totals: { densityPct: 1 },
        verify: {
            insideSheet: true, zoneClear: true, zoneViolations: 0, zonesChecked: 0, zoneOverlapAreaMm2: 0,
            minDistToZoneMm: null, minDistToOutlineMm: 5, partsOutsideOutline: 0, smallestGapMm: 10,
            spacingOk: true, overlapFree: true, shapeVerified: true, verifyStatus: 'measured', holesFilled: 2,
            ...v,
        },
    })

    it('table de vérité', () => {
        const d = rep({})
        const e = rep({ zoneClear: false, zoneViolations: 2, zonesChecked: 3, zoneOverlapAreaMm2: 7, minDistToZoneMm: 0, smallestGapMm: 4, partsOutsideOutline: 1 })
        const m = mergeShapeVerify(d, e).verify
        expect(m).toMatchObject({
            zoneClear: false, zoneViolations: 2, zonesChecked: 3, zoneOverlapAreaMm2: 7, minDistToZoneMm: 0,
            partsOutsideOutline: 1, smallestGapMm: 4, minDistToOutlineMm: 5, holesFilled: 2,
            insideSheet: true, spacingOk: true, overlapFree: true, shapeVerified: true, verifyStatus: 'measured',
        })
        const both = (field, a, b) => mergeShapeVerify(rep({ [field]: a }), rep({ [field]: b })).verify[field]
        for (const field of ['insideSheet', 'spacingOk', 'overlapFree']) {
            expect(both(field, true, true)).toBe(true)
            expect(both(field, true, false)).toBe(false)
            expect(both(field, false, true)).toBe(false)
            expect(both(field, false, false)).toBe(false)
            expect(both(field, true, null)).toBeNull()
            expect(both(field, null, true)).toBeNull()
            expect(both(field, null, null)).toBeNull()
        }
        expect(both('shapeVerified', true, true)).toBe(true)
        expect(both('shapeVerified', true, false)).toBe(false)
        expect(both('shapeVerified', false, true)).toBe(false)
        expect(both('verifyStatus', 'measured', 'measured')).toBe('measured')
        expect(both('verifyStatus', 'measured', 'skipped')).toBe('skipped')
        expect(both('verifyStatus', 'skipped', 'measured')).toBe('skipped')
        expect(both('partsOutsideOutline', 3, 1)).toBe(3)
        expect(both('partsOutsideOutline', 0, 2)).toBe(2)
        expect(both('smallestGapMm', 3, 1)).toBe(1)
        expect(both('smallestGapMm', null, 1)).toBe(1)
        expect(both('smallestGapMm', null, null)).toBeNull()
    })

    it('ne touche pas ses entrées ; tout le reste vient du rapport livré', () => {
        const d = rep({})
        const e = rep({ zoneClear: false })
        const before = JSON.stringify([d, e])
        const out = mergeShapeVerify(d, e)
        expect(JSON.stringify([d, e])).toBe(before)
        expect(out).not.toBe(d)
        expect(out.per_sheet).toBe(d.per_sheet)
        expect(out.totals).toBe(d.totals)
    })

    it('second rapport absent ou en erreur : non vérifié, jamais vert', () => {
        for (const e of [null, undefined, { error: 'x' }, { per_sheet: [] }]) {
            const m = mergeShapeVerify(rep({}), e).verify
            expect(m).toMatchObject({ insideSheet: null, zoneClear: null, shapeVerified: false, verifyStatus: 'skipped' })
        }
    })

    it('rapport livré absent ou en erreur : rendu tel quel', () => {
        expect(mergeShapeVerify(null, rep({}))).toBeNull()
        const err = { error: 'x' }
        expect(mergeShapeVerify(err, rep({}))).toBe(err)
    })
})

describe('rapport, double calcul (wasm réel)', () => {
    const place = (x, y, id = 0) => ({ item_id: id, transformation: { rotation: 0, translation: [x, y] } })
    const resultOf = (items) => ({
        problem: 'bpp',
        alternatives: [{ rank: 0, seed: 1, solution: { layouts: [{ container_id: 0, placed_items: items }] } }],
    })
    const run = async (record, items) => {
        const { payload } = await build(record)
        payload.parts = [{ id: 0, file_slug: 'f0', coords: rect(0, 0, 10, 10), holes: [], count: 1 }]
        payload.instance.items = [{ id: 0, demand: 1 }]
        return buildAlternativeArtifacts(resultOf(items), payload)
    }

    it('pièce nette : tout vert, aires et densité sur la forme coupée', async () => {
        const arts = await run(chipRecord(), [place(20, 20)])
        expect(glue.specs).toHaveLength(2)
        const v = arts[0].report.verify
        expect(v).toMatchObject({
            insideSheet: true, zoneClear: true, zoneViolations: 0, partsOutsideOutline: 0,
            shapeVerified: true, verifyStatus: 'measured', overlapFree: true,
        })
        expect(v.zonesChecked).toBe(1)
        const row = arts[0].report.per_sheet[0]
        expect(row.sheetAreaMm2).toBeCloseTo(9800, 6)
        expect(row.widthMm).toBe(100)
        expect(row.heightMm).toBe(100)
        expect(row.densityPct).toBeCloseTo((100 / 9800) * 100, 1)
    })

    it('pièce dans l\'éclat : hors du contour livré et sur le danger du moteur', async () => {
        const arts = await run(chipRecord(), [place(85, 45)])
        const v = arts[0].report.verify
        expect(v.partsOutsideOutline).toBe(1)
        expect(v.insideSheet).toBe(false)
        expect(v.zoneClear).toBe(false)
        expect(v.zoneViolations).toBe(1)
        expect(v.minDistToZoneMm).toBe(0)
    })

    it('sans défaut : un seul calcul de rapport (chemin d\'avant)', async () => {
        await run(plainRecord(), [place(50, 50)])
        expect(glue.specs).toHaveLength(1)
    })

    it('second calcul en échec (levée ou erreur) : non vérifié, jamais vert', async () => {
        for (const mode of ['failSecond', 'errorSecond']) {
            glue.specs.length = 0
            glue[mode] = true
            const arts = await run(chipRecord(), [place(20, 20)])
            glue[mode] = false
            const v = arts[0].report.verify
            expect(v.insideSheet).toBeNull()
            expect(v.zoneClear).toBeNull()
            expect(v.shapeVerified).toBe(false)
            expect(v.verifyStatus).toBe('skipped')
        }
    })

    it('aucun anneau dans le rapport ni dans les containers livrés ; le moteur envoie ses formes au calcul seulement', async () => {
        const arts = await run(chipRecord(), [place(20, 20)])
        expect(ringsIn(arts[0].report)).toEqual([])
        expect(ringsIn(arts[0].containers.map((c) => ({ ...c, transforms: undefined, nestedIn: undefined })))).toEqual([])
        expect(arts[0].containers.every((c) => !('shape' in c))).toBe(true)
        expect(glue.specs.every((s) => s.includes('"shape"'))).toBe(true)
        expect(JSON.stringify(arts[0].report)).not.toContain('"outer"')
    })

    it('spacingOk jugé sur le rapport fusionné, une seule fois', async () => {
        const arts = await run(chipRecord(), [place(20, 20)])
        const v = arts[0].report.verify
        expect(typeof v.smallestGapMm).toBe('number')
        expect(v.spacingOk).toBe(v.smallestGapMm >= 2 - 0.01 ? true : v.spacingOk)
    })
})
