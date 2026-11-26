import { describe, expect, it } from 'vitest'
import { capacityReport, edgeRectUsableArea, sheetUsableArea } from '../composables/capacityClient'
import { firstPartFittingNoSheet, maxOverhangMm, FIT_TOLERANCE_MM } from '../utils/partSheetFit'
import { preflightSheetsOf, shapeStatsFromShape } from '../utils/preflightModel'
import { engineBinShape, makeSheetRecord, perimeterSplitOf, ringArea, ringBbox } from '../utils/sheetShape'

// Distance au bord : capacité (C9), garde « la pièce tient » de la page (C10),
// partage du périmètre des tôles importées.

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const parts = [
    { coords: rect(0, 0, 100, 60), count: 40 },
    { coords: rect(0, 0, 37, 21), count: 15 },
]
const rectSheets = [{ width: 1000, height: 2000, count: 2 }, { width: 1500, height: 1000, count: 1 }]
const shaped = { width: 100, height: 200, count: 2, usableAreaMm2: 19600, perimeterMm: 680 }

const close = (a, b) => {
    for (const k of Object.keys(a)) {
        if (typeof a[k] === 'number') expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(1e-12)
        else expect(a[k]).toEqual(b[k])
    }
}

describe('capacityReport(…, opts.edge) — C9', () => {
    it('option absente, null ou undefined : chaque nombre identique (1e-12)', () => {
        for (const sheets of [rectSheets, [shaped], [...rectSheets, shaped]]) {
            for (const s of [0, 2, 4.3]) {
                const legacy = capacityReport(parts, sheets, s)
                close(capacityReport(parts, sheets, s, {}), legacy)
                close(capacityReport(parts, sheets, s, { edge: null }), legacy)
                close(capacityReport(parts, sheets, s, { edge: undefined }), legacy)
            }
        }
    })

    it('rectangle : aire utile (W − 2e + s)(H − 2e + s), e = s redonne (W − s)(H − s)', () => {
        expect(edgeRectUsableArea(1000, 2000, 2, 2)).toBe(sheetUsableArea(1000, 2000, 2))
        expect(edgeRectUsableArea(1000, 2000, 2, 10)).toBe((1000 - 20 + 2) * (2000 - 20 + 2))
        expect(edgeRectUsableArea(1000, 2000, 2, -5)).toBe((1000 + 10 + 2) * (2000 + 10 + 2))
        expect(edgeRectUsableArea(10, 10, 2, 6)).toBe(0)
        const at = capacityReport(parts, rectSheets, 2, { edge: 2 })
        expect(at.totalUsableMm2).toBe(capacityReport(parts, rectSheets, 2).totalUsableMm2)
    })

    it('e > s rétrécit la surface utile, e < 0 l’agrandit', () => {
        const base = capacityReport(parts, rectSheets, 2)
        const big = capacityReport(parts, rectSheets, 2, { edge: 30 })
        const neg = capacityReport(parts, rectSheets, 2, { edge: -5 })
        expect(big.totalUsableMm2).toBeLessThan(base.totalUsableMm2)
        expect(big.ratio).toBeGreaterThan(base.ratio)
        expect(neg.totalUsableMm2).toBeGreaterThan(base.totalUsableMm2)
        expect(neg.ratio).toBeLessThan(base.ratio)
    })

    it('grille de boîtes : floor((W − 2e + s)/(w + s)) colonnes', () => {
        // 8 × 8 sur 10 × 10 à espacement 2, bord 1 : (10 − 2 + 2)/(8 + 2) = 1 colonne → tient.
        const one = [{ coords: rect(0, 0, 8, 8), count: 1 }]
        expect(capacityReport(one, [{ width: 10, height: 10, count: 1 }], 2, { edge: 1 }).refused).toBe(false)
        // Bord 1,5 : (10 − 3 + 2)/10 = 0,9 → aucune colonne, et le ratio refuse.
        expect(capacityReport(one, [{ width: 10, height: 10, count: 1 }], 2, { edge: 1.5 }).refused).toBe(true)
    })

    it('tôle importée : utile = A − P_contour·(e − s/2) − P_zones·(s/2)', () => {
        const split = { ...shaped, outlinePerimeterMm: 600, zonesPerimeterMm: 80 }
        const one = [{ coords: rect(0, 0, 10, 10), count: 1 }]
        const r = capacityReport(one, [{ ...split, count: 1 }], 2, { edge: 10 })
        expect(r.totalUsableMm2).toBe(Math.round((19600 - 600 * (10 - 1) - 80 * 1) * 10) / 10)
        // e = s : le chiffre d'avant (perimeterMm × s/2).
        const same = capacityReport(one, [{ ...split, count: 1 }], 2, { edge: 2 })
        expect(same.totalUsableMm2).toBe(capacityReport(one, [{ ...shaped, count: 1 }], 2).totalUsableMm2)
        // Sans partage : tout le périmètre est celui du contour.
        const noSplit = capacityReport(one, [{ ...shaped, count: 1 }], 2, { edge: 10 })
        expect(noSplit.totalUsableMm2).toBe(Math.round((19600 - 680 * 9) * 10) / 10)
    })

    it('espacement max : cherché à BORD FIXE', () => {
        const legacy = capacityReport(parts, rectSheets, 2)
        const fixedHigh = capacityReport(parts, rectSheets, 2, { edge: 200 })
        // Un bord fixe de 200 mm laisse moins de place : l'espacement max baisse.
        expect(fixedHigh.maxSpacingForFitMm).toBeLessThan(legacy.maxSpacingForFitMm)
        // Bord fixe égal à 0 : la tôle ne rétrécit pas avec l'espacement, il monte.
        const fixedZero = capacityReport(parts, rectSheets, 2, { edge: 0 })
        expect(fixedZero.maxSpacingForFitMm).toBeGreaterThan(legacy.maxSpacingForFitMm)
    })
})

describe('partage du périmètre des tôles importées', () => {
    const contour = (ring, depth, parent) => ({ ring, depth, parent, areaMm2: ringArea(ring), bbox: ringBbox(ring) })
    const record = (forbidden) => makeSheetRecord({
        id: 'sheet-lx2k9f0a-ab12cd', projectSlug: 'p', name: 'T', sourceFileName: 's.dxf', sourceUnits: 'mm',
        contours: [contour(rect(0, 0, 100, 200), 1, null), contour(rect(20, 20, 40, 40), 2, 0)],
        outlineIndex: 0, forbidden, addedAt: 1,
    })

    it('contour + zones = perimeterMm', () => {
        const shape = engineBinShape(record([1]))
        const split = perimeterSplitOf(shape)
        expect(split).toEqual({ outlinePerimeterMm: 600, zonesPerimeterMm: 80 })
        expect(split.outlinePerimeterMm + split.zonesPerimeterMm).toBe(shape.perimeterMm)
    })

    it('pré-vol : le partage voyage avec des zones ; sans zone, l’objet d’avant', () => {
        const withZone = shapeStatsFromShape(engineBinShape(record([1])))
        expect(withZone).toMatchObject({ outlinePerimeterMm: 600, zonesPerimeterMm: 80, perimeterMm: 680 })
        const noZone = shapeStatsFromShape(engineBinShape(record([])))
        expect(Object.keys(noZone).sort()).toEqual(['heightMm', 'perimeterMm', 'usableAreaMm2', 'widthMm'])
        const rows = [{ shapeId: 'sheet-lx2k9f0a-ab12cd', count: '1', name: 'T' }]
        const model = preflightSheetsOf(rows, { 'sheet-lx2k9f0a-ab12cd': withZone }, (v) => v)
        expect(model.sheets[0]).toMatchObject({ outlinePerimeterMm: 600, zonesPerimeterMm: 80 })
    })
})

describe('firstPartFittingNoSheet(…, edgeMm) — C10', () => {
    const toMm = (v) => v
    const files = [{ name: 'barre.dxf', count: 1, parts: [{ width: 900, height: 40 }] }]
    const sheets = [{ width: 1000, height: 100, count: 1 }]

    it('sans bord : le test d’avant', () => {
        expect(firstPartFittingNoSheet({ files, sheets, toMm })).toBeNull()
        expect(firstPartFittingNoSheet({ files, sheets, toMm, edgeMm: null })).toBeNull()
    })

    it('bord positif : L − 2e (+ 0,1 mm)', () => {
        expect(firstPartFittingNoSheet({ files, sheets, toMm, edgeMm: 30 })).toBeNull() // 40 ≤ 100 − 60
        expect(firstPartFittingNoSheet({ files, sheets, toMm, edgeMm: 30.05 })).toBeNull() // tolérance
        expect(firstPartFittingNoSheet({ files, sheets, toMm, edgeMm: 30 + FIT_TOLERANCE_MM })).toEqual({ name: 'barre.dxf', width: 900, height: 40 })
        expect(firstPartFittingNoSheet({ files, sheets, toMm, edgeMm: 51 })).not.toBeNull() // 900 > 1000 − 102
    })

    it('bord négatif : la pièce peut dépasser la tôle de 2|e|', () => {
        const wide = [{ name: 'large.dxf', count: 1, parts: [{ width: 1008, height: 40 }] }]
        expect(firstPartFittingNoSheet({ files: wide, sheets, toMm })).not.toBeNull()
        expect(firstPartFittingNoSheet({ files: wide, sheets, toMm, edgeMm: -4 })).toBeNull()
        expect(firstPartFittingNoSheet({ files: wide, sheets, toMm, edgeMm: -3.9 })).not.toBeNull()
    })
})

describe('maxOverhangMm — moitié de la plus petite dimension', () => {
    it('fichiers du projet : min sur les pièces de min(w, h) / 2, bloc = sa boîte, quantité 0 ignorée', () => {
        const files = [
            { name: 'a', count: 2, parts: [{ width: 100, height: 60 }, { width: 30, height: 80 }] },
            { name: 'b', count: 0, parts: [{ width: 2, height: 2 }] },
            { name: 'c', count: 1, block: { width: 50, height: 24 }, parts: [{ width: 4, height: 4 }] },
        ]
        expect(maxOverhangMm(files)).toBe(12)
    })
    it('liste de pièces { width, height }', () => {
        expect(maxOverhangMm([{ width: 10, height: 7 }, { width: 9, height: 20 }])).toBe(3.5)
    })
    it('rien de mesurable : Infinity (rien ne limite)', () => {
        expect(maxOverhangMm([])).toBe(Infinity)
        expect(maxOverhangMm(null)).toBe(Infinity)
    })
})
