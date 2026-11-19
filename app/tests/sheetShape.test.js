import { describe, expect, it } from 'vitest'
import {
    MAX_SHEET_VERTICES,
    MAX_SHEET_ZONES,
    describeOutline,
    engineRings,
    makeSheetRecord,
    normalizeForbidden,
    pickOutlineIndex,
    pointInRing,
    ringArea,
    ringBbox,
    scaleContours,
    sheetLimits,
    usableAreaMm2,
    zoneCandidates,
} from '../utils/sheetShape'

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const circle = (cx, cy, r, n = 32) => {
    const pts = Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)])
    return [...pts, pts[0]]
}
const contour = (ring, depth, parent) => ({ ring, depth, parent, areaMm2: ringArea(ring), bbox: ringBbox(ring) })

// 0 : tôle 100x100 ; 1 : zone A ; 2 : zone B DANS A ; 3 : zone C ; 4 : rectangle voisin (depth 1, plus petit)
const CONTOURS = [
    contour(rect(0, 0, 100, 100), 1, null),
    contour(rect(10, 10, 30, 30), 2, 0),
    contour(rect(12, 12, 15, 15), 3, 1),
    contour(rect(50, 50, 60, 60), 2, 0),
    contour(rect(200, 0, 210, 10), 1, null),
]

describe('primitives', () => {
    it('ringArea est absolue (horaire ou anti-horaire)', () => {
        expect(ringArea(rect(0, 0, 10, 5))).toBe(50)
        expect(ringArea([...rect(0, 0, 10, 5)].reverse())).toBe(50)
        expect(ringArea([])).toBe(0)
    })
    it('ringBbox', () => {
        expect(ringBbox(rect(-2, 3, 10, 5))).toEqual([-2, 3, 10, 5])
        expect(ringBbox([])).toBeNull()
    })
    it('pointInRing sur un anneau fermé, concave inclus', () => {
        const ell = [[0, 0], [10, 0], [10, 2], [2, 2], [2, 10], [0, 10], [0, 0]]
        expect(pointInRing([1, 1], ell)).toBe(true)
        expect(pointInRing([5, 5], ell)).toBe(false)
        expect(pointInRing([1, 8], ell)).toBe(true)
        expect(pointInRing([-1, 1], ell)).toBe(false)
    })
})

describe('contours et zones', () => {
    it('pickOutlineIndex : le plus grand de profondeur 1, -1 sinon', () => {
        expect(pickOutlineIndex(CONTOURS)).toBe(0)
        expect(pickOutlineIndex([CONTOURS[1], CONTOURS[2]])).toBe(-1)
        expect(pickOutlineIndex([])).toBe(-1)
        // Un grand contour de profondeur 2 ne gagne pas.
        expect(pickOutlineIndex([contour(rect(0, 0, 1000, 1000), 2, 1), contour(rect(0, 0, 5, 5), 1, null)])).toBe(1)
    })
    it('zoneCandidates : descendants à toute profondeur, pas le voisin ni la tôle', () => {
        expect(zoneCandidates(CONTOURS, 0)).toEqual([1, 2, 3])
        expect(zoneCandidates(CONTOURS, 4)).toEqual([])
        expect(zoneCandidates(CONTOURS, 99)).toEqual([])
    })
    it('normalizeForbidden : trié, unique, candidats seulement, sans zone dans une zone', () => {
        expect(normalizeForbidden(CONTOURS, 0, [3, 1, 3])).toEqual([1, 3])
        expect(normalizeForbidden(CONTOURS, 0, [1, 2, 3])).toEqual([1, 3])
        expect(normalizeForbidden(CONTOURS, 0, [2])).toEqual([2])
        expect(normalizeForbidden(CONTOURS, 0, [0, 4, 99, -1, 1.5])).toEqual([])
        expect(normalizeForbidden(CONTOURS, 0, undefined)).toEqual([])
    })
    it('usableAreaMm2 : tôle moins zones normalisées (B dans A non retranchée deux fois)', () => {
        expect(usableAreaMm2(CONTOURS, 0, [])).toBe(10000)
        expect(usableAreaMm2(CONTOURS, 0, [1, 3])).toBe(10000 - 400 - 100)
        expect(usableAreaMm2(CONTOURS, 0, [1, 2, 3])).toBe(10000 - 400 - 100)
    })
})

describe('sheetLimits', () => {
    it('constantes', () => {
        expect(MAX_SHEET_VERTICES).toBe(5000)
        expect(MAX_SHEET_ZONES).toBe(200)
    })
    it('compte les sommets distincts du contour + zones normalisées', () => {
        expect(sheetLimits(CONTOURS, 0, [1, 2, 3])).toEqual({ ok: true, reason: null, vertexCount: 12, zoneCount: 2 })
    })
    it('too_many_vertices au-dessus de 5000', () => {
        const big = [contour(circle(0, 0, 100, 5000), 1, null)]
        expect(sheetLimits(big, 0, []).ok).toBe(true)
        const bigger = [contour(circle(0, 0, 100, 5001), 1, null)]
        const r = sheetLimits(bigger, 0, [])
        expect(r).toMatchObject({ ok: false, reason: 'too_many_vertices', vertexCount: 5001 })
    })
    it('too_many_zones au-dessus de 200', () => {
        const mk = (n) => [contour(rect(0, 0, 1000, 1000), 1, null),
            ...Array.from({ length: n }, (_, i) => contour(rect(i * 4 + 1, 1, i * 4 + 3, 3), 2, 0))]
        const all = (n) => Array.from({ length: n }, (_, i) => i + 1)
        expect(sheetLimits(mk(200), 0, all(200)).ok).toBe(true)
        expect(sheetLimits(mk(201), 0, all(201))).toMatchObject({ ok: false, reason: 'too_many_zones', zoneCount: 201 })
    })
})

describe('describeOutline', () => {
    it('disque : 32 sommets sur un cercle', () => {
        const d = describeOutline([contour(circle(500, -300, 50), 1, null)], 0)
        expect(d.kind).toBe('disc')
        expect(d.diameterMm).toBeCloseTo(100, 6)
    })
    it('un carré, un octogone (moins de 16 sommets) et un cercle déformé sont des boîtes', () => {
        expect(describeOutline(CONTOURS, 0)).toEqual({ kind: 'box', widthMm: 100, heightMm: 100 })
        expect(describeOutline([contour(circle(0, 0, 50, 8), 1, null)], 0).kind).toBe('box')
        const squashed = circle(0, 0, 50).map(([x, y]) => [x, y * 0.9])
        const d = describeOutline([contour(squashed, 1, null)], 0)
        expect(d.kind).toBe('box')
        expect(d.widthMm).toBeCloseTo(100, 6)
        expect(d.heightMm).toBeCloseTo(90, 6)
    })
    it('tolérance : un défaut de 0,03 mm reste un disque, 1 mm non', () => {
        const nudge = (dr) => {
            const ring = circle(0, 0, 50)
            ring[3] = [ring[3][0] * (50 + dr) / 50, ring[3][1] * (50 + dr) / 50]
            return [contour(ring, 1, null)]
        }
        expect(describeOutline(nudge(0.03), 0).kind).toBe('disc')
        expect(describeOutline(nudge(1), 0).kind).toBe('box')
    })
})

describe('engineRings et makeSheetRecord', () => {
    const base = {
        id: 's-1', projectSlug: 'p1', name: 'Rondelle', sourceFileName: 'a.dxf', sourceUnits: 4,
        contours: CONTOURS, outlineIndex: 0, forbidden: [3, 2, 1], addedAt: '2026-11-19T10:00:00.000Z',
    }
    it('engineRings : contour + zones normalisées', () => {
        const r = makeSheetRecord(base)
        const { outer, holes } = engineRings(r)
        expect(outer).toBe(CONTOURS[0].ring)
        expect(holes).toEqual([CONTOURS[1].ring, CONTOURS[3].ring])
    })
    it('record : champs dérivés', () => {
        const r = makeSheetRecord(base)
        expect(r).toMatchObject({
            slug: 's-1', kind: 'sheet', projectSlug: 'p1', name: 'Rondelle', sourceFileName: 'a.dxf',
            sourceUnits: 4, addedAt: base.addedAt, lastUsedAt: base.addedAt, outlineIndex: 0,
            forbidden: [1, 3], bbox: [0, 0, 100, 100], widthMm: 100, heightMm: 100,
            areaMm2: 9500, vertexCount: 12,
        })
        expect(r.contours).toBe(CONTOURS)
        expect(makeSheetRecord({ ...base, projectSlug: undefined }).projectSlug).toBeNull()
    })
    it('geometryKey : déterministe, ignore le bruit sous 1e-3 mm, l ordre des zones, id et nom', () => {
        const k = makeSheetRecord(base).geometryKey
        expect(k).toMatch(/^g1-2-[0-9a-f]{16}$/)
        expect(makeSheetRecord({ ...base, id: 'autre', name: 'x', forbidden: [1, 3] }).geometryKey).toBe(k)
        const noisy = CONTOURS.map((c) => ({ ...c, ring: c.ring.map(([x, y]) => [x + 0.0001, y - 0.0001]) }))
        expect(makeSheetRecord({ ...base, contours: noisy }).geometryKey).toBe(k)
    })
    it('geometryKey : change si la géométrie ou les zones changent', () => {
        const k = makeSheetRecord(base).geometryKey
        expect(makeSheetRecord({ ...base, forbidden: [1] }).geometryKey).not.toBe(k)
        const moved = CONTOURS.map((c, i) => (i === 0 ? { ...c, ring: rect(0, 0, 100, 100.01) } : c))
        expect(makeSheetRecord({ ...base, contours: moved }).geometryKey).not.toBe(k)
    })
    it('erreurs nommées', () => {
        expect(() => makeSheetRecord({ ...base, outlineIndex: -1 })).toThrow('sheet_no_outline')
        expect(() => makeSheetRecord({ ...base, contours: [] })).toThrow('sheet_no_outline')
        expect(() => makeSheetRecord({ ...base, contours: [{ depth: 1, parent: null }], outlineIndex: 0 })).toThrow('sheet_no_outline')
        expect(() => makeSheetRecord({ ...base, contours: [contour([[0, 0], [1, 1]], 1, null)], outlineIndex: 0 })).toThrow('sheet_bad_geometry')
        const big = [contour(circle(0, 0, 100, 5001), 1, null)]
        expect(() => makeSheetRecord({ ...base, contours: big, forbidden: [] })).toThrow('sheet_too_many_vertices')
        const many = [contour(rect(0, 0, 1000, 1000), 1, null),
            ...Array.from({ length: 201 }, (_, i) => contour(rect(i * 4 + 1, 1, i * 4 + 3, 3), 2, 0))]
        expect(() => makeSheetRecord({ ...base, contours: many, forbidden: many.slice(1).map((_, i) => i + 1) })).toThrow('sheet_too_many_zones')
    })

    it('coordonnée non finie (contour ou zone) : sheet_bad_geometry', () => {
        for (const bad of [NaN, Infinity, -Infinity, '5', null, undefined]) {
            const ring = rect(0, 0, 100, 100)
            ring[2] = [bad, 100]
            const outlineBad = CONTOURS.map((c, i) => (i === 0 ? { ...c, ring } : c))
            expect(() => makeSheetRecord({ ...base, contours: outlineBad })).toThrow('sheet_bad_geometry')
            const zring = rect(10, 10, 30, 30)
            zring[1] = [30, bad]
            const zoneBad = CONTOURS.map((c, i) => (i === 1 ? { ...c, ring: zring } : c))
            expect(() => makeSheetRecord({ ...base, contours: zoneBad })).toThrow('sheet_bad_geometry')
        }
    })
    it('moins de 3 sommets distincts : sheet_bad_geometry', () => {
        const dup = [[0, 0], [10, 0], [0, 0], [10, 0], [0, 0]]
        expect(() => makeSheetRecord({ ...base, contours: [contour(dup, 1, null)], forbidden: [] })).toThrow('sheet_bad_geometry')
        expect(() => makeSheetRecord({ ...base, contours: [contour([[0, 0], [10, 0]], 1, null)], forbidden: [] })).toThrow('sheet_bad_geometry')
        const zoneTwo = CONTOURS.map((c, i) => (i === 1 ? { ...c, ring: [[10, 10], [20, 10], [10, 10]] } : c))
        expect(() => makeSheetRecord({ ...base, contours: zoneTwo, forbidden: [1] })).toThrow('sheet_bad_geometry')
        // Une zone non retenue (hors liste interdite) n'est pas validée.
        expect(() => makeSheetRecord({ ...base, contours: zoneTwo, forbidden: [] })).not.toThrow()
    })
    it('contour horaire : accepté tel que donné, même enregistrement hors anneau', () => {
        const ccw = makeSheetRecord(base)
        const cw = CONTOURS.map((c, i) => (i === 0 ? { ...c, ring: [...c.ring].reverse() } : c))
        const r = makeSheetRecord({ ...base, contours: cw })
        expect(r.contours[0].ring).toEqual([...CONTOURS[0].ring].reverse())
        const strip = (rec) => ({ ...rec, contours: rec.contours.slice(1) })
        expect(strip(r)).toEqual(strip(ccw))
        expect(r.areaMm2).toBe(ccw.areaMm2)
        expect(r.bbox).toEqual(ccw.bbox)
    })
    it('anneau sans point de fermeture : accepté, l anneau stocké est fermé', () => {
        const closed = makeSheetRecord(base)
        const opened = CONTOURS.map((c, i) => (i <= 1 ? { ...c, ring: c.ring.slice(0, -1) } : c))
        const r = makeSheetRecord({ ...base, contours: opened })
        expect(r.contours[0].ring).toEqual(CONTOURS[0].ring)
        expect(r.contours[1].ring).toEqual(CONTOURS[1].ring)
        expect(r.vertexCount).toBe(closed.vertexCount)
        expect(r.areaMm2).toBe(closed.areaMm2)
        expect(r.geometryKey).toBe(closed.geometryKey)
        // L'entrée n'est pas modifiée.
        expect(opened[0].ring).toHaveLength(4)
    })
    it('liste interdite : indice du contour, non entier, doublon et hors plage filtrés', () => {
        const r = makeSheetRecord({ ...base, forbidden: [0, 1.5, '1', 1, 1, 99, -2, NaN, 3] })
        expect(r.forbidden).toEqual([1, 3])
        expect(r.areaMm2).toBe(9500)
    })
    it('zone dans une zone : abandonnée, aire comptée une fois', () => {
        const r = makeSheetRecord({ ...base, forbidden: [1, 2] })
        expect(r.forbidden).toEqual([1])
        expect(r.areaMm2).toBe(10000 - 400)
        expect(engineRings(r).holes).toEqual([CONTOURS[1].ring])
    })
})

describe('scaleContours', () => {
    it('met à l\'échelle anneaux, aire et boîte ; profondeur et parent inchangés', () => {
        const out = scaleContours(CONTOURS, 25.4)
        expect(out).toHaveLength(CONTOURS.length)
        expect(out[1].ring[1]).toEqual([30 * 25.4, 10 * 25.4])
        expect(out[1].areaMm2).toBeCloseTo(400 * 25.4 * 25.4, 6)
        expect(out[1].bbox).toEqual([10 * 25.4, 10 * 25.4, 30 * 25.4, 30 * 25.4])
        expect(out[2].depth).toBe(3)
        expect(out[2].parent).toBe(1)
        // l'aire recalculée sur l'anneau mis à l'échelle concorde
        expect(ringArea(out[0].ring)).toBeCloseTo(out[0].areaMm2, 6)
    })
    it('ne modifie pas l\'entrée', () => {
        const before = JSON.stringify(CONTOURS)
        scaleContours(CONTOURS, 2)
        expect(JSON.stringify(CONTOURS)).toBe(before)
    })
    it('facteur inutilisable ou égal à 1 : le tableau d\'origine', () => {
        for (const f of [1, 0, -2, NaN, Infinity, undefined]) expect(scaleContours(CONTOURS, f)).toBe(CONTOURS)
    })
})
