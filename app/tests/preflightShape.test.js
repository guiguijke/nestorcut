import { describe, expect, it } from 'vitest'
import { buildLocalPayload, convexHullRing, simplifyRing } from '../composables/localPayloadBuilder'
import { capacityReport, inflatedArea } from '../composables/capacityClient'
import { capacityPanelModel } from '../utils/capacityPanel'
import { localRecordToUiFile } from '../composables/localImport'
import { makeSheetRecord, ringArea, ringBbox } from '../utils/sheetShape'
import {
    hasActiveImportedSheet, partCoords, preflightParts, preflightSheetsOf, sheetFigure, SHAPE_UNREADABLE,
    shapeStatsOfRecord,
} from '../utils/preflightModel'

// Estimation « ≈ n tôles » de la page avec une tôle importée : les fiches de l'appareil
// n'ont que {width, height, color} par pièce, plus deux nombres (aire et périmètre du contour).

const circle = (cx, cy, r, n = 128) => Array.from({ length: n + 1 }, (_, i) => [
    cx + r * Math.cos((2 * Math.PI * (i % n)) / n), cy + r * Math.sin((2 * Math.PI * (i % n)) / n)])
const rectRing = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
const contour = (ring) => ({ ring, depth: 1, parent: null, areaMm2: ringArea(ring), bbox: ringBbox(ring) })
const recordOf = (outline, id = 'sheet-lx2k9f0a-ab12cd') => makeSheetRecord({
    id, projectSlug: 'p', name: 'Disque', sourceFileName: 'd.dxf', sourceUnits: 'mm',
    contours: [contour(outline)], outlineIndex: 0, forbidden: [], addedAt: 1,
})
const DISC_ID = 'sheet-lx2k9f0a-ab12cd'
const SQ_ID = 'sheet-lx2k9f0a-ab12ce'
const discRecord = () => recordOf(circle(500, 500, 76.5), DISC_ID)
const toMm = (v) => v // les réglages des tests sont déjà en mm
const mmRow = (w, h, count = '1') => ({ width: String(w), height: String(h), count })
const shapedRow = (id = DISC_ID, count = '1', name = 'Disque 153') => ({ width: '153', height: '153', count, shapeId: id, name })
const part = (w, h) => ({ coordinates: rectRing(w, h), holes: [] })
const extent = (ring) => {
    const xs = (ring || [[0, 0]]).map((q) => q[0])
    const ys = (ring || [[0, 0]]).map((q) => q[1])
    return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}
// Fiche enregistrée sur l'appareil -> fiche de l'interface (celle que la page reçoit).
const uiFile = (slug, parts, count = 1) => ({
    ...localRecordToUiFile({
        slug,
        name: `${slug}.dxf`,
        parts: parts.map((p) => ({ holes: [], color: '#abc', ...extent(p.coordinates), ...p })),
    }),
    count,
})
const ELL = [[0, 0], [400, 0], [400, 150], [150, 150], [150, 400], [0, 400], [0, 0]]
const TRI = [[0, 0], [200, 0], [0, 200], [0, 0]]
const boxesOnly = (files) => files.map((f) => ({
    ...f,
    parts: f.parts.map(({ width, height }) => ({ width, height })),
    block: f.block ? { pieces: f.block.pieces, width: f.block.width, height: f.block.height } : undefined,
}))
// La page : tôles et pièces du modèle, puis capacityReport.
const estimate = (files, settings, stats, space = 0) => {
    const model = preflightSheetsOf(settings, stats, toMm)
    return capacityReport(preflightParts(files, model.imported), model.sheets, space)
}
const sqStats = () => ({ [SQ_ID]: shapeStatsOfRecord(recordOf(rectRing(1000, 1000), SQ_ID)) })
const sqRow = () => shapedRow(SQ_ID, '1', 'Carré')

describe('localRecordToUiFile — aire et périmètre du contour de chaque pièce', () => {
    it('disque : les nombres du calcul (anneau simplifié, comme le constructeur)', () => {
        const ring = circle(0, 0, 50)
        const f = uiFile('d', [{ coordinates: ring }])
        const simple = simplifyRing(ring)
        const real = inflatedArea({ coords: simple }, 0)
        expect(f.parts[0].outlineAreaMm2).toBeCloseTo(real, 6)
        expect(f.parts[0].outlineAreaMm2).toBeGreaterThan(7800)
        expect(f.parts[0].outlineAreaMm2).toBeLessThan(Math.PI * 2500)
        expect(f.parts[0].outlinePerimeterMm).toBeGreaterThan(310)
        // même formule que le calcul à un espacement donné
        expect(inflatedArea(f.parts[0], 2)).toBeCloseTo(inflatedArea({ coords: simple }, 2), 6)
    })

    it('L : 97 500 mm² et 1 600 mm exacts, trous non déduits', () => {
        const hole = [[50, 50], [100, 50], [100, 100], [50, 100], [50, 50]]
        const f = uiFile('l', [{ coordinates: ELL, holes: [hole] }])
        expect(f.parts[0].outlineAreaMm2).toBeCloseTo(97500, 6)
        expect(f.parts[0].outlinePerimeterMm).toBeCloseTo(1600, 6)
        expect(f.block).toBeUndefined()
    })

    it('bloc (deux pièces = UN item) : l\'enveloppe convexe de tous les anneaux à leur place réelle', () => {
        const p1 = rectRing(50, 50)
        const p2 = rectRing(50, 50).map(([x, y]) => [x + 120, y])
        const f = uiFile('b', [{ coordinates: p1 }, { coordinates: p2 }])
        const hull = convexHullRing([...p1, ...p2])
        expect(f.block.outlineAreaMm2).toBeCloseTo(inflatedArea({ coords: hull }, 0), 6)
        expect(f.block.outlineAreaMm2).toBeCloseTo(170 * 50, 6)
        expect(f.block.outlinePerimeterMm).toBeCloseTo(2 * (170 + 50), 6)
        expect(f.block.pieces).toBe(2)
        // chaque pièce garde ses propres nombres
        expect(f.parts[0].outlineAreaMm2).toBeCloseTo(2500, 6)
    })

    it('fiche sans anneau lisible : aucun nombre (le repli reste la boîte)', () => {
        const f = uiFile('x', [{ coordinates: undefined }])
        expect('outlineAreaMm2' in f.parts[0]).toBe(false)
    })

    it('inflatedArea accepte une pièce qui donne les nombres au lieu de l\'anneau, même formule', () => {
        for (const s of [0, 0.5, 3]) {
            expect(inflatedArea({ outlineAreaMm2: 97500, outlinePerimeterMm: 1600 }, s))
                .toBeCloseTo(inflatedArea({ coords: ELL }, s), 9)
        }
        expect(inflatedArea({}, 1)).toBe(0)
    })
})

describe('estimation avec une tôle importée : les vraies aires, plus les boîtes', () => {
    it('90 disques de 100 mm sur une tôle importée 1000 x 1000, espacement 0 : 1 tôle (les boîtes en disaient 2)', () => {
        const files = [uiFile('d', [{ coordinates: circle(0, 0, 50) }], 90)]
        const real = estimate(files, [sqRow()], sqStats())
        expect(real.sheetsNeeded).toBe(1)
        // aire réelle d'un disque de 100 : ~7 850 mm², pas 10 000
        expect(real.totalInflatedMm2).toBeGreaterThan(90 * 7800)
        expect(real.totalInflatedMm2).toBeLessThan(90 * 7860)
        // sans les nombres (fiche d'une autre origine) : le repli d'aujourd'hui, les boîtes
        const boxes = estimate(boxesOnly(files), [sqRow()], sqStats())
        expect(boxes.sheetsNeeded).toBe(2)
        expect(boxes.totalInflatedMm2).toBeCloseTo(900000, 0)
    })

    it('60 triangles rectangles de 200 : 2 tôles (les boîtes en disaient 3)', () => {
        const files = [uiFile('t', [{ coordinates: TRI }], 60)]
        const real = estimate(files, [sqRow()], sqStats())
        expect(real.totalInflatedMm2).toBeCloseTo(60 * 20000, 0)
        expect(real.sheetsNeeded).toBe(2)
        expect(estimate(boxesOnly(files), [sqRow()], sqStats()).sheetsNeeded).toBe(3)
    })

    it('bloc : UN item de l\'aire de l\'enveloppe, jamais la somme de ses boîtes', () => {
        const p1 = rectRing(50, 50)
        const p2 = rectRing(50, 50).map(([x, y]) => [x + 120, y])
        const files = [uiFile('b', [{ coordinates: p1 }, { coordinates: p2 }], 3)]
        const parts = preflightParts(files, true)
        expect(parts).toHaveLength(1)
        expect(parts[0].count).toBe(3)
        expect(parts[0].outlineAreaMm2).toBeCloseTo(8500, 6)
        // sans tôle importée : les pièces une à une, comme avant
        expect(preflightParts(files, false)).toHaveLength(2)
    })

    it('L : l\'aire du contour, pas celle de la boîte', () => {
        const files = [uiFile('l', [{ coordinates: ELL }], 10)]
        expect(estimate(files, [sqRow()], sqStats()).totalInflatedMm2).toBeCloseTo(975000, 0)
    })

    it('rapport nul (aucune aire utile à cet espacement) : aucun chiffre, le panneau garde celui du constructeur', () => {
        const files = [uiFile('d', [{ coordinates: circle(0, 0, 5) }], 10)]
        const model = preflightSheetsOf([sqRow()], sqStats(), toMm)
        const report = capacityReport(preflightParts(files, true), model.sheets, 5000)
        expect(report).toBeNull()
        const figure = sheetFigure({ imported: model.imported, state: model.state, report })
        expect(figure).toEqual({ show: false, n: 1, panelSheets: null })
        const unfit = { reason: 'capacity', ratio: 1.07, sheetsNeeded: 2, maxPartsAtSpacing: 3, maxSpacingForFitMm: 0 }
        const sheets = [{ width: '1000', height: '1000', count: '1' }]
        expect(capacityPanelModel(unfit, { sheets, preflightSheets: figure.panelSheets }).levers.sheetsNeeded).toBe(2)
    })

    it('ligne importée à quantité vide ou nulle : pas active', () => {
        const files = [uiFile('d', [{ coordinates: circle(0, 0, 50) }], 90)]
        for (const count of ['', '0']) {
            const model = preflightSheetsOf([shapedRow(SQ_ID, count)], {}, toMm)
            expect(model.imported).toBe(false)
            expect(model.state).toBe('inactive')
            expect(model.sheets).toEqual([])
            // Le champ est vide le temps d'une saisie : aucun chiffre, jamais « 1 tôle ».
            expect(sheetFigure({ imported: model.imported, state: model.state, report: null })).toEqual({ show: false, n: 1, panelSheets: null })
        }
        // Un rectangle actif à côté : son chiffre est dit, la ligne importée vide ne compte pas.
        const mixed = preflightSheetsOf([mmRow(1000, 2000), shapedRow(SQ_ID, '')], {}, toMm)
        expect([mixed.imported, mixed.state, mixed.sheets.length]).toEqual([false, 'ready', 1])
        // avec une autre ligne importée active, la ligne rectangle vide est écartée aussi
        const rows = [mmRow(300, 300, ''), sqRow()]
        expect(preflightSheetsOf(rows, sqStats(), toMm).sheets).toHaveLength(1)
        expect(estimate(files, rows, sqStats()).sheetsNeeded).toBe(1)
    })

    it('une tôle importée lue : le panneau de refus suit le chiffre du bouton', () => {
        expect(sheetFigure({ imported: true, state: 'ready', report: { sheetsNeeded: 2 } })).toEqual({ show: true, n: 2, panelSheets: 2 })
    })

    it('un projet sans tôle importée donne EXACTEMENT les chiffres d\'avant (nombres réels)', () => {
        // 200 fiches de 300 x 200 sur 2 tôles 1000 x 2000, espacement 2,1 : le calcul de la page d'avant
        const files = [uiFile('r', [{ coordinates: rectRing(300, 200) }], 200)]
        const report = estimate(files, [mmRow(1000, 2000, '2')], {}, 2.1)
        expect(report.totalInflatedMm2).toBe(12210692.7)
        expect(report.totalUsableMm2).toBe(3987408.8)
        expect(report.ratio).toBe(3.0623)
        expect(report.sheetsNeeded).toBe(8)
        // aucune clé de nombres n'entre dans les pièces d'un projet de rectangles
        expect(preflightParts(files, false)[0]).toEqual({ coords: partCoords(files[0].parts[0]), count: 200 })
    })

    it('mêmes tôles qu\'avant sans tôle importée, au bit près', () => {
        const old = (rows, conv) => rows.map((s) => ({
            width: conv(Number(String(s.width).replace(',', '.')) || 0),
            height: conv(Number(String(s.height).replace(',', '.')) || 0),
            count: Number(s.count) || 1,
        }))
        const mmToIn = (v) => v * 25.4
        const cases = [
            [[mmRow(1000, 2000)], toMm],
            [[mmRow(1000, 2000, '3'), mmRow('1250,5', '800', '2')], toMm],
            [[{ width: '48,5', height: '96', count: '2' }, { width: 'x', height: '', count: '0' }], mmToIn],
        ]
        for (const [rows, conv] of cases) {
            const model = preflightSheetsOf(rows, {}, conv)
            expect(model.sheets).toEqual(old(rows, conv))
            expect(model.state).toBe('ready')
            expect(model.imported).toBe(false)
        }
    })
})

describe('trois états de la forme', () => {
    it('en attente : aucune tôle importée dans la liste, état pending', () => {
        const model = preflightSheetsOf([shapedRow()], {}, toMm)
        expect(model.state).toBe('pending')
        expect(model.sheets).toEqual([])
    })

    it('absente (pas d\'enregistrement) ou inutilisable : missing, avec le nom', () => {
        const model = preflightSheetsOf([mmRow(100, 200), shapedRow(DISC_ID, '1', 'Ma tôle')], { [DISC_ID]: null }, toMm)
        expect(model.state).toBe('missing')
        expect(model.missing).toEqual(['Ma tôle'])
        expect(shapeStatsOfRecord(null)).toBeNull()
        expect(shapeStatsOfRecord({ contours: [], outlineIndex: 0 })).toBeNull()
    })

    it('lecture refusée : unreadable, PAS dans les tôles absentes (Nest reste actif)', () => {
        const model = preflightSheetsOf([shapedRow()], { [DISC_ID]: SHAPE_UNREADABLE }, toMm)
        expect(model.state).toBe('unreadable')
        expect(model.missing).toEqual([])
        expect(sheetFigure({ imported: true, state: model.state, report: { sheetsNeeded: 2 } }).show).toBe(false)
    })

    it('absente l\'emporte sur illisible, et illisible sur en attente', () => {
        const rows = [shapedRow(DISC_ID), shapedRow(SQ_ID, '1', 'B'), shapedRow('sheet-lx2k9f0a-ab12cf', '1', 'C')]
        expect(preflightSheetsOf(rows, { [DISC_ID]: SHAPE_UNREADABLE, [SQ_ID]: null }, toMm).state).toBe('missing')
        expect(preflightSheetsOf(rows, { [DISC_ID]: SHAPE_UNREADABLE, [SQ_ID]: sqStats()[SQ_ID] }, toMm).state).toBe('unreadable')
        expect(preflightSheetsOf(rows, { [DISC_ID]: sqStats()[SQ_ID], [SQ_ID]: sqStats()[SQ_ID] }, toMm).state).toBe('pending')
    })

    it('lue : les nombres seulement, jamais le contour', () => {
        const stats = shapeStatsOfRecord(discRecord())
        expect(Object.keys(stats).sort()).toEqual(['heightMm', 'perimeterMm', 'usableAreaMm2', 'widthMm'])
    })

    it('hasActiveImportedSheet : seulement une tôle importée de quantité > 0', () => {
        expect(hasActiveImportedSheet([mmRow(1, 2)])).toBe(false)
        expect(hasActiveImportedSheet([shapedRow(DISC_ID, '0')])).toBe(false)
        expect(hasActiveImportedSheet([mmRow(1, 2), shapedRow()])).toBe(true)
    })
})

describe('sheetFigure', () => {
    const report = { sheetsNeeded: 3 }
    it('sans tôle importée : toujours dit, avec le repli à 1 d\'aujourd\'hui', () => {
        expect(sheetFigure({ imported: false, state: 'ready', report })).toEqual({ show: true, n: 3, panelSheets: 3 })
        expect(sheetFigure({ imported: false, state: 'ready', report: null })).toEqual({ show: true, n: 1, panelSheets: null })
    })
    it('avec une tôle importée : caché tant que la forme n\'est pas lue ou si le rapport est nul', () => {
        for (const state of ['pending', 'missing', 'unreadable']) {
            const f = sheetFigure({ imported: true, state, report })
            expect(f.show).toBe(false)
            expect(f.panelSheets).toBeNull()
        }
        expect(sheetFigure({ imported: true, state: 'ready', report }).show).toBe(true)
    })
})

describe('buildLocalPayload — garde c) avec le contour de la tôle importée', () => {
    const profile = { timeBudgetSec: 13, vcores: 1, maxDirections: 1, level: 'browser' }
    const records = { [DISC_ID]: discRecord() }
    const build = (sheets, files, space = 0.5) => buildLocalPayload(
        { files, params: { sheets, space, directions: ['left'], alternativesCount: 1 }, profile },
        { getSheetRecord: async (id) => records[id] ?? null })
    const square = (n, side, rotations = [0, 90, 180, 270]) => ({
        slug: 'sq.dxf', name: 'carre.dxf', count: n, rotations, parts: [part(side, side)],
    })
    const disc = (stock) => [{ width: 153, height: 153, count: stock, shapeId: DISC_ID }]

    it('150 carré : refus part_too_large avec shape: true, à stock 1 ET à stock 2 (jamais capacity_exceeded)', async () => {
        for (const stock of [1, 2]) {
            const err = await build(disc(stock), [square(1, 150)]).catch((e) => e)
            expect(err.message).toMatch(/^Part\(s\) too large for the sheet/)
            expect(err.message).not.toBe('capacity_exceeded')
            expect(err.__tooLarge).toMatchObject({ slug: 'sq.dxf', name: 'carre.dxf', width: '150', height: '150', shape: true })
            expect(err.__unfit).toBeUndefined()
        }
    })

    it('100 carré : passe la garde, le job se construit', async () => {
        const out = await build(disc(1), [square(1, 100)])
        expect(out.payload.instance.items).toHaveLength(1)
    })

    it('rectangles seuls : le refus d\'une pièce trop grande ne porte PAS la clé shape (texte d\'avant)', async () => {
        const err = await build([{ width: 100, height: 100, count: 1 }], [square(1, 150)]).catch((e) => e)
        expect(err.__tooLarge).toMatchObject({ width: '150', height: '150' })
        expect('shape' in err.__tooLarge).toBe(false)
    })

    it('pièce plus grande que la BOÎTE de la tôle importée : refus sans shape (c\'est la boîte)', async () => {
        const err = await build(disc(1), [square(1, 200)]).catch((e) => e)
        expect(err.__tooLarge).toBeDefined()
        expect('shape' in err.__tooLarge).toBe(false)
    })

    it('une pièce qui tient un rectangle du même calcul n\'est pas refusée à cause du disque', async () => {
        const sheets = [...disc(1), { width: 400, height: 400, count: 1 }]
        const out = await build(sheets, [square(1, 150)])
        expect(out.payload.instance.items).toHaveLength(1)
    })

    it('la marge de courbes est dite dans la phrase, la clé shape reste', async () => {
        // carré de 108 aux coins arrondis (rayon 4) : la boîte tient, la diagonale (74,7 + 2 mm) sort du disque
        const half = 54
        const corners = [[half - 4, half - 4], [-(half - 4), half - 4], [-(half - 4), -(half - 4)], [half - 4, -(half - 4)]]
        const ring = corners.flatMap(([cx, cy], k) => Array.from({ length: 9 }, (_, i) => {
            const a = ((k * 90 + i * 10) * Math.PI) / 180
            return [cx + 4 * Math.cos(a), cy + 4 * Math.sin(a)]
        }))
        const round = { slug: 'r.dxf', name: 'rond.dxf', count: 1, rotations: [0, 90], parts: [{ coordinates: [...ring, ring[0]], holes: [] }] }
        const err = await build(disc(1), [round], 2).catch((e) => e)
        expect(err.__tooLarge).toMatchObject({ shape: true, space: 2 })
        expect(err.__tooLarge.margin).toBeDefined()
    })
})
