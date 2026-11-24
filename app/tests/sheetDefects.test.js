import { describe, expect, it } from 'vitest'
import {
    DEFECT_KINDS,
    circleRing,
    cutInput,
    defectBbox,
    defectRings,
    freeRing,
    makeDefect,
    normalizeCut,
    normalizeDrawn,
    rectRing,
    scaleDrawn,
} from '../utils/sheetDefects'
import {
    bindCut,
    cutKeyOf,
    displayShape,
    engineBinShape,
    engineRings,
    makeSheetRecord as makeRawRecord,
    outlineIndexOf,
    recordZoneCount,
    ringArea,
    ringBbox,
} from '../utils/sheetShape'
import { buildRecord, importErrorOf, thumbModel, ERROR_KEYS } from '../utils/sheetImportModel'
import { DICTS, LOCALES } from '../utils/i18n'

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const contour = (ring, depth, parent) => ({ ring, depth, parent, areaMm2: ringArea(ring), bbox: ringBbox(ring) })
const closed = (r) => r.length > 3 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]

// Tôle 100 x 100 posée en (-37,5 ; 12,25) dans le repère du DXF, une zone interdite 10 x 10.
const OX = -37.5
const OY = 12.25
const sheetContours = () => [
    contour(rect(OX, OY, OX + 100, OY + 100), 1, null),
    contour(rect(-20, 30, -10, 40), 2, 0),
]
// Éclat sur le bord droit : x 90..110 (repère local), y 40..60.
const chipHazard = () => rect(OX + 90, OY + 40, OX + 110, OY + 60)
const chipDefect = () => makeDefect('d1', 'rect', { a: [OX + 90, OY + 40], b: [OX + 110, OY + 60] })
const notched = () => [
    [OX, OY], [OX + 100, OY], [OX + 100, OY + 40], [OX + 90, OY + 40], [OX + 90, OY + 60],
    [OX + 100, OY + 60], [OX + 100, OY + 100], [OX, OY + 100], [OX, OY],
]
const chipCut = () => ({
    ok: true,
    outer: notched(),
    holes: [rect(-20, 30, -10, 40)],
    hazards: [rect(-20, 30, -10, 40), chipHazard()],
    lostPieces: [],
    usableArea: 10000 - 100 - 200,
    pieces: 1,
    lostArea: 0,
    removedArea: 200,
    changed: true,
    repairs: 0,
    maxShift: 0,
})
const base = (extra = {}) => ({
    id: 's1', projectSlug: 'p', name: 'n', sourceFileName: 'f.dxf', sourceUnits: 'mm',
    contours: sheetContours(), outlineIndex: 0, forbidden: [1], addedAt: 5, ...extra,
})
// Comme l'écran : la coupe est liée au dessin dont elle vient (forKey).
const bound = (a) => (a.cut && Array.isArray(a.drawn) && a.drawn.length
    ? { ...a, cut: { ...a.cut, forKey: cutKeyOf(a.contours, a.outlineIndex, a.forbidden, a.drawn) } }
    : a)
const makeSheetRecord = (a) => makeRawRecord(bound(a))
const withChip = (extra = {}) => makeSheetRecord(base({ drawn: [chipDefect()], cut: chipCut(), ...extra }))

describe('anneaux de défauts', () => {
    it('DEFECT_KINDS', () => expect(DEFECT_KINDS).toEqual(['free', 'circle', 'rect']))

    it('circleRing : circonscrit, fermé, excès <= 0,02 mm, 24..128 côtés', () => {
        for (const r of [0.5, 5, 50, 500, 5000]) {
            const ring = circleRing(10, -20, r)
            expect(closed(ring)).toBe(true)
            const n = ring.length - 1
            expect(n).toBeGreaterThanOrEqual(24)
            expect(n).toBeLessThanOrEqual(128)
            const radii = ring.map(([x, y]) => Math.hypot(x - 10, y + 20))
            // Tout sommet est au-delà du cercle ; l'arête passe au rayon r (circonscrit).
            expect(Math.min(...radii)).toBeGreaterThanOrEqual(r - 1e-9)
            if (n < 128) expect(Math.max(...radii) - r).toBeLessThanOrEqual(0.02 + 1e-9)
            const mid = [(ring[0][0] + ring[1][0]) / 2 - 10, (ring[0][1] + ring[1][1]) / 2 + 20]
            expect(Math.hypot(...mid)).toBeCloseTo(r, 6)
            expect(ringArea(ring)).toBeGreaterThanOrEqual(Math.PI * r * r - 1e-6)
        }
        expect(circleRing(0, 0, 0.001).length - 1).toBe(24)
        expect(circleRing(0, 0, 1e6).length - 1).toBe(128)
    })

    it('circleRing : null si non fini ou r <= 0', () => {
        expect(circleRing(NaN, 0, 5)).toBeNull()
        expect(circleRing(0, Infinity, 5)).toBeNull()
        expect(circleRing(0, 0, 0)).toBeNull()
        expect(circleRing(0, 0, -3)).toBeNull()
        expect(circleRing(0, 0, NaN)).toBeNull()
    })

    it('rectRing : deux coins dans n\'importe quel ordre, null si un côté < 1e-6', () => {
        expect(rectRing([10, 20], [0, 5])).toEqual(rect(0, 5, 10, 20))
        expect(rectRing([0, 5], [10, 20])).toEqual(rect(0, 5, 10, 20))
        expect(rectRing([0, 0], [10, 1e-7])).toBeNull()
        expect(rectRing([0, 0], [0, 10])).toBeNull()
        expect(rectRing([0, 0], [NaN, 10])).toBeNull()
        expect(rectRing(null, [1, 1])).toBeNull()
    })

    it('freeRing : doublons consécutifs et dernier point répété retirés, fermé', () => {
        const ring = freeRing([[0, 0], [0, 0], [10, 0], [10, 10], [0, 10], [0, 0]])
        expect(ring).toEqual(rect(0, 0, 10, 10).map(([x, y]) => [x, y]).slice(0, 1).concat([[10, 0], [10, 10], [0, 10], [0, 0]]))
        expect(closed(ring)).toBe(true)
        expect(ring).toHaveLength(5)
        expect(freeRing([[0, 0], [1, 1]])).toBeNull()
        expect(freeRing([[0, 0], [0, 0], [1, 1], [1, 1], [0, 0]])).toBeNull()
        expect(freeRing([[0, 0], [1, 1], [NaN, 2]])).toBeNull()
        expect(freeRing('x')).toBeNull()
    })
})

describe('makeDefect, scaleDrawn, defectRings, defectBbox', () => {
    it('makeDefect par genre ; null si invalide', () => {
        const c = makeDefect('c', 'circle', { cx: 5, cy: 6, r: 2 })
        expect(c).toMatchObject({ id: 'c', kind: 'circle', cx: 5, cy: 6, r: 2 })
        expect(closed(c.ring)).toBe(true)
        expect(makeDefect('r', 'rect', { a: [0, 0], b: [2, 3] })).toEqual({ id: 'r', kind: 'rect', ring: rect(0, 0, 2, 3) })
        expect(Object.keys(makeDefect('f', 'free', { points: [[0, 0], [4, 0], [0, 4]] }))).toEqual(['id', 'kind', 'ring'])
        expect(makeDefect('', 'rect', { a: [0, 0], b: [2, 3] })).toBeNull()
        expect(makeDefect('x', 'star', {})).toBeNull()
        expect(makeDefect('x', 'circle', { cx: 0, cy: 0, r: -1 })).toBeNull()
        expect(makeDefect('x', 'free', null)).toBeNull()
    })

    it('scaleDrawn : anneaux et cx, cy, r ; facteur 1 ou mauvais : le même tableau', () => {
        const drawn = [makeDefect('c', 'circle', { cx: 5, cy: 6, r: 2 }), makeDefect('r', 'rect', { a: [0, 0], b: [2, 3] })]
        const s = scaleDrawn(drawn, 25.4)
        expect(s[0]).toMatchObject({ cx: 5 * 25.4, cy: 6 * 25.4, r: 2 * 25.4 })
        expect(s[0].ring[0][0]).toBeCloseTo(drawn[0].ring[0][0] * 25.4, 9)
        expect(s[1].ring).toEqual([[0, 0], [2 * 25.4, 0], [2 * 25.4, 3 * 25.4], [0, 3 * 25.4], [0, 0]])
        expect(s[1]).not.toHaveProperty('cx')
        for (const f of [1, 0, -2, NaN, undefined, '2']) expect(scaleDrawn(drawn, f)).toBe(drawn)
        expect(scaleDrawn(null, 2)).toBeNull()
    })

    it('defectRings et defectBbox', () => {
        const d = makeDefect('r', 'rect', { a: [1, 2], b: [4, 8] })
        expect(defectRings([d, d])).toEqual([d.ring, d.ring])
        expect(defectRings(undefined)).toEqual([])
        expect(defectBbox(d)).toEqual([1, 2, 4, 8])
        expect(defectBbox(null)).toBeNull()
    })

    it('normalizeDrawn : copies simples, absent -> [], invalide -> sheet_bad_defect', () => {
        const d = makeDefect('c', 'circle', { cx: 5, cy: 6, r: 2 })
        const n = normalizeDrawn([d])
        expect(n).toEqual([d])
        expect(n[0]).not.toBe(d)
        expect(n[0].ring).not.toBe(d.ring)
        expect(normalizeDrawn(undefined)).toEqual([])
        expect(normalizeDrawn(null)).toEqual([])
        const bad = [
            'x', [null], [{ ...d, id: '' }], [{ ...d, kind: 'star' }], [{ ...d, ring: [[0, 0], [1, 1]] }],
            [{ ...d, ring: [[0, 0], [1, NaN], [2, 2]] }], [{ ...d, r: 0 }], [{ ...d, cx: NaN }], [d, d],
        ]
        for (const b of bad) expect(() => normalizeDrawn(b)).toThrow('sheet_bad_defect')
    })

    it('cutInput : contour original, zones normalisées, anneaux des défauts', () => {
        const input = cutInput(sheetContours(), 0, [1], [chipDefect()])
        expect(input.outer).toEqual(rect(OX, OY, OX + 100, OY + 100))
        expect(input.holes).toEqual([rect(-20, 30, -10, 40)])
        expect(input.defects).toEqual([chipDefect().ring])
        expect(cutInput(sheetContours(), 0, [], undefined).defects).toEqual([])
        expect(() => cutInput(sheetContours(), 7, [], [])).toThrow('sheet_no_outline')
        expect(() => cutInput(sheetContours(), 0, [], [{ id: 'x' }])).toThrow('sheet_bad_defect')
    })
})

describe('normalizeCut', () => {
    it('copie simple, anneaux fermés', () => {
        const cut = chipCut()
        const n = normalizeCut(cut)
        expect(n).toEqual({
            outer: cut.outer, holes: cut.holes, hazards: cut.hazards, lostPieces: [],
            usableArea: 9700, lostArea: 0, removedArea: 200, pieces: 1,
        })
        expect(n.outer).not.toBe(cut.outer)
        expect(Object.keys(n)).not.toContain('ok')
    })

    it('morceaux perdus : { outer, holes } ; dangers qui partagent des arêtes acceptés', () => {
        const cut = chipCut()
        cut.lostPieces = [{ outer: rect(0, 0, 1, 1), holes: [rect(0.2, 0.2, 0.4, 0.4)] }]
        cut.hazards = [rect(0, 0, 10, 10), rect(10, 0, 20, 10)] // arête commune
        const n = normalizeCut(cut)
        expect(n.lostPieces).toEqual(cut.lostPieces)
        expect(n.hazards).toHaveLength(2)
    })

    it('invalide -> sheet_bad_cut', () => {
        const bad = (patch) => ({ ...chipCut(), ...patch })
        const cases = [
            null, 'x', { ok: false, error: 'sheet_no_usable_area' }, bad({ outer: [[0, 0], [1, 1]] }),
            bad({ outer: undefined }), bad({ holes: 'x' }), bad({ hazards: [[[0, 0], [NaN, 1], [2, 2]]] }),
            bad({ lostPieces: [rect(0, 0, 1, 1)] }), bad({ lostPieces: [{ outer: rect(0, 0, 1, 1), holes: [[[0, 0]]] }] }),
            bad({ usableArea: 0 }), bad({ usableArea: NaN }), bad({ lostArea: -1 }), bad({ removedArea: undefined }),
            bad({ pieces: 0 }),
        ]
        for (const c of cases) expect(() => normalizeCut(c)).toThrow('sheet_bad_cut')
    })
})

describe('makeSheetRecord sans défaut : l\'enregistrement d\'avant', () => {
    // Valeurs produites par le code de la base 84243b52 (sheetShape.js), figées.
    const FROZEN_KEYS = [
        'slug', 'kind', 'projectSlug', 'name', 'sourceFileName', 'sourceUnits', 'addedAt', 'lastUsedAt',
        'contours', 'outlineIndex', 'forbidden', 'bbox', 'widthMm', 'heightMm', 'areaMm2', 'vertexCount', 'geometryKey',
    ]

    it('mêmes champs, même clé g1-, même aire, aucun champ nouveau', () => {
        const rec = makeSheetRecord(base())
        expect(Object.keys(rec)).toEqual(FROZEN_KEYS)
        expect(rec.geometryKey).toBe('g1-1-ac0d21d9ba9eedab')
        expect(rec.areaMm2).toBe(9900)
        expect(rec.vertexCount).toBe(8)
        expect(rec.outlineIndex).toBe(0)
    })

    it('drawn vide ou absent, cut donné sans défaut : ignoré', () => {
        const ref = makeSheetRecord(base())
        expect(makeSheetRecord(base({ drawn: [] }))).toEqual(ref)
        expect(makeSheetRecord(base({ drawn: null, cut: chipCut() }))).toEqual(ref)
        expect(makeSheetRecord(base({ drawn: [], cut: chipCut() }))).toEqual(ref)
        expect(JSON.stringify(makeSheetRecord(base({ cut: chipCut() })))).toBe(JSON.stringify(ref))
    })

    it('engineBinShape : l\'objet d\'avant, sans clé deliver', () => {
        const shape = engineBinShape(makeSheetRecord(base()))
        expect(shape).toEqual({
            outer: rect(0, 0, 100, 100),
            inner: [[[17.5, 17.75], [27.5, 17.75], [27.5, 27.75], [17.5, 27.75], [17.5, 17.75]]],
            widthMm: 100,
            heightMm: 100,
            usableAreaMm2: 9900,
            perimeterMm: 440,
        })
        expect(Object.keys(shape)).toEqual(['outer', 'inner', 'widthMm', 'heightMm', 'usableAreaMm2', 'perimeterMm'])
        expect(displayShape(shape)).toEqual({ outer: shape.outer, inner: shape.inner })
    })

    it('thumbModel : le dessin d\'avant', () => {
        const t = thumbModel(makeSheetRecord(base()))
        expect(t).toEqual({
            scale: 0.48, tx: 30, ty: 57.88, width: 72, height: 56, viewBox: '0 0 72 56',
            transform: 'matrix(0.48 0 0 -0.48 30 57.88)',
            outlineD: 'M-37.5 12.25L62.5 12.25L62.5 112.25L-37.5 112.25L-37.5 12.25Z',
            zonesD: ['M-20 30L-10 30L-10 40L-20 40L-20 30Z'],
        })
    })

    it('recordZoneCount = zones interdites normalisées', () => {
        expect(recordZoneCount(makeSheetRecord(base()))).toBe(1)
        expect(recordZoneCount(makeSheetRecord(base({ forbidden: [] })))).toBe(0)
    })
})

describe('makeSheetRecord avec défauts', () => {
    it('champs : drawn, cut, aire de la coupe, cadre de l\'original, clé g2-', () => {
        const rec = withChip()
        expect(rec.drawn).toEqual([chipDefect()])
        expect(rec.cut).toEqual({ ...normalizeCut(chipCut()), forKey: rec.geometryKey })
        expect(rec.areaMm2).toBe(9700)
        expect(rec.bbox).toEqual([OX, OY, OX + 100, OY + 100])
        expect(rec.widthMm).toBe(100)
        expect(rec.heightMm).toBe(100)
        expect(rec.geometryKey.startsWith('g2-')).toBe(true)
        expect(rec.geometryKey).not.toBe(makeSheetRecord(base()).geometryKey)
        expect(rec.kind).toBe('sheet')
    })

    it('cut obligatoire : sheet_cut_missing ; coupe illisible : sheet_bad_cut ; défaut invalide : sheet_bad_defect', () => {
        expect(() => makeSheetRecord(base({ drawn: [chipDefect()] }))).toThrow('sheet_cut_missing')
        expect(() => makeSheetRecord(base({ drawn: [chipDefect()], cut: null }))).toThrow('sheet_cut_missing')
        expect(() => makeSheetRecord(base({ drawn: [chipDefect()], cut: { ok: true } }))).toThrow('sheet_bad_cut')
        expect(() => makeSheetRecord(base({ drawn: [{ id: 'x' }], cut: chipCut() }))).toThrow('sheet_bad_defect')
    })

    it('coupe d\'un autre dessin : jamais enregistrée (défaut ajouté ou déplacé après la coupe)', () => {
        const moved = makeDefect('d1', 'rect', { a: [OX + 90, OY + 41], b: [OX + 110, OY + 61] })
        const d2 = makeDefect('d2', 'rect', { a: [OX + 10, OY + 10], b: [OX + 20, OY + 20] })
        const cut = bindCut(chipCut(), sheetContours(), 0, [1], [chipDefect()])
        expect(cut.forKey).toBe(cutKeyOf(sheetContours(), 0, [1], [chipDefect()]))
        expect(makeRawRecord(base({ drawn: [chipDefect()], cut })).geometryKey).toBe(cut.forKey)
        for (const extra of [
            { drawn: [chipDefect(), d2], cut },
            { drawn: [moved], cut },
            { drawn: [chipDefect()], forbidden: [], cut },
            { drawn: [chipDefect()], cut: chipCut() },
        ]) expect(() => makeRawRecord(base(extra))).toThrow('sheet_cut_missing')
        expect(() => bindCut({ ok: false, error: 'sheet_cut_failed' }, sheetContours(), 0, [1], [chipDefect()]))
            .toThrow('sheet_bad_cut')
    })

    it('la clé change avec / sans défaut et quand un défaut bouge ; pas avec l\'ordre', () => {
        const a = withChip().geometryKey
        const moved = makeDefect('d1', 'rect', { a: [OX + 90, OY + 41], b: [OX + 110, OY + 61] })
        const b = makeSheetRecord(base({ drawn: [moved], cut: chipCut() })).geometryKey
        expect(a).not.toBe(b)
        expect(withChip().geometryKey).toBe(a)
        const d2 = makeDefect('d2', 'rect', { a: [OX + 10, OY + 10], b: [OX + 20, OY + 20] })
        const k1 = makeSheetRecord(base({ drawn: [chipDefect(), d2], cut: chipCut() })).geometryKey
        const k2 = makeSheetRecord(base({ drawn: [d2, chipDefect()], cut: chipCut() })).geometryKey
        expect(k1).toBe(k2)
    })

    it('pilule empoisonnée : outlineIndex -1, vrai indice dans outlineIndexV2', () => {
        const rec = withChip()
        expect(rec.outlineIndex).toBe(-1)
        expect(rec.outlineIndexV2).toBe(0)
        expect(outlineIndexOf(rec)).toBe(0)
        expect(outlineIndexOf(makeSheetRecord(base()))).toBe(0)
        expect(outlineIndexOf({ outlineIndex: 3 })).toBe(3)
        expect(outlineIndexOf({ outlineIndex: -1, outlineIndexV2: 1.5 })).toBe(-1)
        expect(outlineIndexOf(null)).toBeUndefined()
        // L'ancienne formule (outlineIndex lu tel quel, base 84243b52) ne trouve plus de contour : refus bruyant.
        const oldOutline = rec.contours[rec.outlineIndex]
        expect(oldOutline).toBeUndefined()
        const oldEngineBinShape = (record) => {
            const outer = record.contours[record.outlineIndex]?.ring
            const box = outer ? ringBbox(outer) : null
            if (!box) throw new Error('sheet_shape_missing')
        }
        expect(() => oldEngineBinShape(rec)).toThrow('sheet_shape_missing')
        // La nouvelle lit l'indice V2.
        expect(engineRings(rec).outer).toEqual(rec.contours[0].ring)
    })

    it('limites : sommets (original + dangers, ou coupe), zones (dangers, trous, zones + défauts)', () => {
        const many = (n) => {
            const pts = Array.from({ length: n }, (_, i) => [1000 + i, 1000 + (i % 2)])
            return [...pts, pts[0]]
        }
        // 4 + 5000 sommets de dangers > 5000
        const heavy = { ...chipCut(), hazards: [many(5000)] }
        expect(() => makeSheetRecord(base({ drawn: [chipDefect()], cut: heavy }))).toThrow('sheet_too_many_vertices')
        // la coupe seule dépasse
        const heavyCut = { ...chipCut(), holes: [many(5000)] }
        expect(() => makeSheetRecord(base({ drawn: [chipDefect()], cut: heavyCut }))).toThrow('sheet_too_many_vertices')
        // pile 5000 : passe (original 4 + dangers 4996)
        expect(withChip({ cut: { ...chipCut(), hazards: [many(4996)] } }).vertexCount).toBe(5000)
        const tiny = (i) => rect(i, 0, i + 0.5, 0.5)
        const lots = (n) => Array.from({ length: n }, (_, i) => tiny(i))
        expect(() => withChip({ cut: { ...chipCut(), hazards: lots(201) } })).toThrow('sheet_too_many_zones')
        expect(() => withChip({ cut: { ...chipCut(), holes: lots(201) } })).toThrow('sheet_too_many_zones')
        expect(withChip({ cut: { ...chipCut(), hazards: lots(200) } }).geometryKey).toMatch(/^g2-/)
        // zones interdites normalisées + défauts > 200
        const forb = Array.from({ length: 150 }, (_, i) => contour(rect(-30 + (i % 50) * 0.1, 20 + Math.floor(i / 50), -29.95 + (i % 50) * 0.1, 20.5 + Math.floor(i / 50)), 2, 0))
        const contours = [sheetContours()[0], ...forb]
        const drawn = Array.from({ length: 51 }, (_, i) => makeDefect(`d${i}`, 'rect', { a: [i, 60], b: [i + 0.5, 60.5] }))
        const fi = forb.map((_, i) => i + 1)
        expect(() => makeSheetRecord(base({ contours, forbidden: fi, drawn, cut: chipCut() }))).toThrow('sheet_too_many_zones')
        expect(makeSheetRecord(base({ contours, forbidden: fi, drawn: drawn.slice(0, 50), cut: chipCut() })).kind).toBe('sheet')
    })

    it('recordZoneCount = zones normalisées + défauts', () => {
        expect(recordZoneCount(withChip())).toBe(2)
    })
})

describe('engineBinShape avec défauts', () => {
    it('éclat sur le bord droit, dessin décalé : moteur = carré plein + danger qui dépasse ; livré = contour entaillé ; boîte 100 x 100', () => {
        const shape = engineBinShape(withChip())
        expect(shape.outer).toEqual(rect(0, 0, 100, 100))
        expect(shape.inner).toEqual([
            rect(17.5, 17.75, 27.5, 27.75),
            rect(90, 40, 110, 60),
        ])
        expect(shape.widthMm).toBe(100)
        expect(shape.heightMm).toBe(100)
        expect(shape.usableAreaMm2).toBe(9700)
        expect(shape.deliver.outer).toEqual([
            [0, 0], [100, 0], [100, 40], [90, 40], [90, 60], [100, 60], [100, 100], [0, 100], [0, 0],
        ])
        expect(shape.deliver.inner).toEqual([rect(17.5, 17.75, 27.5, 27.75)])
        const per = (r) => r.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - r[i][0], p[1] - r[i][1]), 0)
        expect(shape.perimeterMm).toBeCloseTo(per(shape.deliver.outer) + per(shape.deliver.inner[0]), 9)
        expect(Object.keys(shape)).toEqual(['outer', 'inner', 'widthMm', 'heightMm', 'usableAreaMm2', 'perimeterMm', 'deliver'])
        expect(displayShape(shape)).toBe(shape.deliver)
    })

    it('un éclat qui enlève tout un bord : le zéro et la boîte restent ceux du contour ORIGINAL', () => {
        const cut = {
            ...chipCut(),
            outer: rect(OX, OY, OX + 90, OY + 100),
            hazards: [rect(OX + 90, OY - 10, OX + 110, OY + 110)],
            holes: [],
            usableArea: 9000,
        }
        const d = makeDefect('d1', 'rect', { a: [OX + 90, OY - 10], b: [OX + 110, OY + 110] })
        const rec = makeSheetRecord(base({ forbidden: [], drawn: [d], cut }))
        const shape = engineBinShape(rec)
        expect(shape.widthMm).toBe(100)
        expect(shape.heightMm).toBe(100)
        expect(shape.outer).toEqual(rect(0, 0, 100, 100))
        expect(shape.deliver.outer).toEqual(rect(0, 0, 90, 100))
        expect(shape.inner).toEqual([rect(90, -10, 110, 110)])
        expect(shape.deliver.inner).toEqual([])
    })

    it('défaut à l\'intérieur : le danger est un trou du moteur et de la coupe', () => {
        const hole = rect(OX + 40, OY + 40, OX + 50, OY + 50)
        const d = makeDefect('d1', 'rect', { a: [OX + 40, OY + 40], b: [OX + 50, OY + 50] })
        const cut = {
            ...chipCut(), outer: rect(OX, OY, OX + 100, OY + 100), holes: [rect(-20, 30, -10, 40), hole],
            hazards: [rect(-20, 30, -10, 40), hole], usableArea: 9800, removedArea: 0,
        }
        const shape = engineBinShape(makeSheetRecord(base({ drawn: [d], cut })))
        expect(shape.inner).toHaveLength(2)
        expect(shape.deliver.inner).toHaveLength(2)
        expect(shape.deliver.outer).toEqual(shape.outer)
        expect(shape.usableAreaMm2).toBe(9800)
    })

    it('tôle coupée en deux : les morceaux perdus sont des dangers du moteur', () => {
        const lost = rect(OX + 60, OY, OX + 100, OY + 100)
        const band = rect(OX + 50, OY - 5, OX + 60, OY + 105)
        const cut = {
            ...chipCut(), outer: rect(OX, OY, OX + 50, OY + 100), holes: [],
            hazards: [band, lost], lostPieces: [{ outer: lost, holes: [] }],
            usableArea: 5000, pieces: 2, lostArea: 4000, removedArea: 1000,
        }
        const d = makeDefect('d1', 'rect', { a: [OX + 50, OY - 5], b: [OX + 60, OY + 105] })
        const shape = engineBinShape(makeSheetRecord(base({ forbidden: [], drawn: [d], cut })))
        expect(shape.inner).toEqual([rect(50, -5, 60, 105), rect(60, 0, 100, 100)])
        expect(shape.deliver.outer).toEqual(rect(0, 0, 50, 100))
        expect(shape.usableAreaMm2).toBe(5000)
    })

    it('un danger dégénéré après translation est abandonné', () => {
        const cut = { ...chipCut(), hazards: [chipHazard(), rect(0, 0, 1e-6, 1e-6)] }
        // 1e-6 x 1e-6 : aire 1e-12 <= 1e-9 -> dégénéré
        expect(engineBinShape(withChip({ cut })).inner).toHaveLength(1)
    })

    it('coupe absente ou illisible dans l\'enregistrement : sheet_shape_missing, jamais la tôle non coupée', () => {
        const rec = withChip()
        for (const cut of [undefined, null, {}, { ...rec.cut, usableArea: 0 }, { ...rec.cut, outer: [[0, 0]] }]) {
            expect(() => engineBinShape({ ...rec, cut })).toThrow('sheet_shape_missing')
        }
        expect(() => engineBinShape({ ...rec, drawn: [{ id: 'x' }] })).toThrow('sheet_shape_missing')
        // Enregistrement retouché (défaut déplacé, zone rendue) sans nouvelle coupe : refus aussi.
        const moved = makeDefect('d1', 'rect', { a: [OX + 90, OY + 41], b: [OX + 110, OY + 61] })
        expect(() => engineBinShape({ ...rec, drawn: [moved] })).toThrow('sheet_shape_missing')
        expect(() => engineBinShape({ ...rec, forbidden: [] })).toThrow('sheet_shape_missing')
    })
})

describe('vignette, erreurs, buildRecord', () => {
    it('thumbModel : contour coupé et trous, dans le cadre du contour original', () => {
        const rec = withChip()
        const t = thumbModel(rec)
        const plain = thumbModel(makeSheetRecord(base()))
        expect(t.transform).toBe(plain.transform)
        expect(t.outlineD).toBe('M-37.5 12.25L62.5 12.25L62.5 52.25L52.5 52.25L52.5 72.25L62.5 72.25L62.5 112.25L-37.5 112.25L-37.5 12.25Z')
        expect(t.zonesD).toEqual(['M-20 30L-10 30L-10 40L-20 40L-20 30Z'])
    })

    it('importErrorOf : les nouveaux codes', () => {
        for (const code of ['sheet_bad_defect', 'sheet_bad_cut', 'sheet_cut_missing', 'sheet_cut_failed',
            'sheet_cut_too_complex', 'sheet_cut_time_budget', 'sheet_cut_bad_input']) {
            expect(importErrorOf(new Error(code)).key).toBe('sheetImport.err.cut')
            expect(importErrorOf(code).key).toBe(ERROR_KEYS.cut)
        }
        expect(importErrorOf(new Error('sheet_no_usable_area')).key).toBe('sheetImport.err.nothingLeft')
        expect(importErrorOf('sheet_too_many_vertices').key).toBe(ERROR_KEYS.tooManyVertices)
        expect(importErrorOf('sheet_too_many_zones').key).toBe(ERROR_KEYS.tooManyZones)
    })

    it('les deux clés existent dans les six langues, espace insécable avant : ; ? ! % en français', () => {
        expect(LOCALES.length).toBe(6)
        for (const l of LOCALES) {
            for (const k of ['sheetImport.err.cut', 'sheetImport.err.nothingLeft']) {
                expect(typeof DICTS[l][k], `${l} ${k}`).toBe('string')
                expect(DICTS[l][k].length).toBeGreaterThan(10)
            }
        }
        for (const k of ['sheetImport.err.cut', 'sheetImport.err.nothingLeft']) {
            expect(DICTS.fr[k]).not.toMatch(/[^ ][:;?!%]/)
        }
    })

    it('buildRecord : passe drawn et cut en copies simples ; sans défaut, l\'enregistrement d\'avant', () => {
        const args = { slug: 's1', projectSlug: 'p', name: 'n', sourceFileName: 'f.dxf', sourceUnits: 'mm', contours: sheetContours(), outlineIndex: 0, forbidden: [1], now: 5 }
        const out = buildRecord(bound({ ...args, drawn: [chipDefect()], cut: chipCut() }))
        expect(out.record.outlineIndex).toBe(-1)
        expect(out.record.drawn).toEqual([chipDefect()])
        expect(JSON.parse(JSON.stringify(out.record))).toEqual(out.record)
        expect(buildRecord(args).record).toEqual(makeSheetRecord(base()))
        expect(buildRecord({ ...args, drawn: [chipDefect()] }).error).toBe('sheetImport.err.cut')
        expect(buildRecord({ ...args, drawn: [], cut: chipCut() }).record).toEqual(makeSheetRecord(base()))
    })
})
