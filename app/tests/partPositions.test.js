import { describe, expect, it } from 'vitest'
import {
    csvCell,
    fixedDecimals,
    positionsCsv,
    safeNameCell,
    sheetCentre,
    storedCentre,
} from '../utils/partPositions'

// Lot positions : lignes (fichier, X, Y, diamètre) d'une tôle et leur CSV.
// Module pur : aucune E/S, aucun wasm.

const ring = (cx, cy, r, n = 72, a0 = 0) => {
    const pts = Array.from({ length: n }, (_, k) => {
        const a = a0 + (2 * Math.PI * k) / n
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    })
    pts.push(pts[0])
    return pts
}
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]

describe('fixedDecimals / csvCell / safeNameCell', () => {
    it('décimales fixes, jamais -0.0000, jamais d\'exposant', () => {
        expect(fixedDecimals(-0.00001, 4)).toBe('0.0000')
        expect(fixedDecimals(-0, 4)).toBe('0.0000')
        expect(fixedDecimals(1e-9, 4)).toBe('0.0000')
        expect(fixedDecimals(12.5, 4)).toBe('12.5000')
        expect(fixedDecimals(-76.5, 4)).toBe('-76.5000')
        expect(fixedDecimals(0.00004, 5)).toBe('0.00004')
        expect(fixedDecimals(1e21, 2)).toBe('1000000000000000000000.00')
        expect(fixedDecimals(1e-7, 4)).not.toMatch(/e/)
    })

    it('csvCell : guillemets seulement si nécessaire (règle de l\'export du rapport)', () => {
        expect(csvCell('abc')).toBe('abc')
        expect(csvCell('a,b')).toBe('"a,b"')
        expect(csvCell('a"b')).toBe('"a""b"')
        expect(csvCell('a\nb')).toBe('"a\nb"')
        expect(csvCell(12)).toBe('12')
    })

    it('un nom qui commence comme une formule est précédé d\'une apostrophe', () => {
        for (const n of ['=cmd', '+1', '-2', '@x', '\tA', '\rB']) expect(safeNameCell(n)).toBe(`'${n}`)
        expect(safeNameCell('plaque.dxf')).toBe('plaque.dxf')
        expect(safeNameCell('a=b')).toBe('a=b')
    })
})

describe('centre de la tôle', () => {
    // Le lecteur aplatit un disque en un polygone à nombre de côtés IMPAIR
    // (195 pour un disque de 153 mm) : sa boîte n'est pas centrée sur le cercle.
    const oddDisc = (n, r, dx = 0, dy = 0) => {
        const pts = ring(r, r, r, n).map((p) => [p[0] + dx, p[1] + dy])
        const x0 = Math.min(...pts.map((p) => p[0]))
        const y0 = Math.min(...pts.map((p) => p[1]))
        const moved = pts.map((p) => [p[0] - x0, p[1] - y0])
        return {
            outline: moved,
            box: [Math.max(...moved.map((p) => p[0])), Math.max(...moved.map((p) => p[1]))],
            centre: [r + dx - x0, r + dy - y0],
        }
    }

    it('disque : le vrai centre du cercle, pas celui de la boîte du polygone', () => {
        for (const [n, r] of [[195, 76.5], [75, 11.25], [861, 1500], [72, 100]]) {
            const d = oddDisc(n, r)
            const c = sheetCentre(d.box, d.outline)
            expect(Math.hypot(c[0] - d.centre[0], c[1] - d.centre[1])).toBeLessThan(1e-6)
        }
        const d = oddDisc(195, 76.5)
        expect(Math.hypot(d.box[0] / 2 - d.centre[0], d.box[1] / 2 - d.centre[1])).toBeGreaterThan(0.004)
    })

    it('rectangle, forme quelconque, disque à méplat, contour illisible : centre de la boîte', () => {
        expect(sheetCentre([200, 100])).toEqual([100, 50])
        expect(sheetCentre([200, 100], rect(0, 0, 200, 100))).toEqual([100, 50])
        expect(sheetCentre([200, 100], [[0, 0], [NaN, 1], [2, 2]])).toEqual([100, 50])
        expect(sheetCentre([200, 100], 'x')).toEqual([100, 50])
        // Méplat : les sommets restants sont sur le cercle, mais le repère dessiné à
        // l'écran est au centre de la boîte : le zéro aussi.
        const full = ring(76.5, 76.5, 76.5, 360).slice(0, -1)
        const flat = full.filter((p) => p[1] > 5)
        const y0 = Math.min(...flat.map((p) => p[1]))
        const moved = flat.map((p) => [p[0], p[1] - y0])
        const box = [153, Math.max(...moved.map((p) => p[1]))]
        expect(sheetCentre(box, [...moved, moved[0]])).toEqual([box[0] / 2, box[1] / 2])
    })

    it('disque lu avec l’interrupteur pouces (tessellé à 0,25 mm) : centré quand même', () => {
        // Contour tessellé à 0,254 mm de flèche : boîte décentrée de bien plus de
        // 0,02 mm ; le cercle ajusté, lui, reste exact.
        for (const [n, r] of [[39, 76.5], [37, 38.25], [17, 25.4], [63, 100]]) {
            const d = oddDisc(n, r)
            const off = Math.hypot(d.box[0] / 2 - d.centre[0], d.box[1] / 2 - d.centre[1])
            const c = sheetCentre(d.box, d.outline)
            expect(Math.hypot(c[0] - d.centre[0], c[1] - d.centre[1])).toBeLessThan(1e-6)
            expect(off).toBeGreaterThanOrEqual(0)
        }
        const coarse = oddDisc(39, 76.5, 0.07, 0.03)
        expect(Math.hypot(coarse.box[0] / 2 - coarse.centre[0], coarse.box[1] / 2 - coarse.centre[1])).toBeGreaterThan(0.02)
        const c = sheetCentre(coarse.box, coarse.outline)
        expect(Math.hypot(c[0] - coarse.centre[0], c[1] - coarse.centre[1])).toBeLessThan(1e-6)
    })

    it('méplats : le disque à méplat de 38° (wafer 100 mm) garde le centre de la boîte', () => {
        const full = ring(50, 50, 50, 720).slice(0, -1)
        const cut = 50 - 50 * Math.cos((38 * Math.PI) / 180 / 2) // profondeur du méplat de 38°
        const flat = full.filter((p) => p[1] > cut)
        const y0 = Math.min(...flat.map((p) => p[1]))
        const moved = flat.map((p) => [p[0], p[1] - y0])
        const box = [Math.max(...moved.map((p) => p[0])), Math.max(...moved.map((p) => p[1]))]
        expect(sheetCentre(box, [...moved, moved[0]])).toEqual([box[0] / 2, box[1] / 2])
    })

    it('storedCentre : le centre gardé, sinon celui de la boîte, sinon rien', () => {
        expect(storedCentre([76.5, 76.4], [153, 153])).toEqual([76.5, 76.4])
        expect(storedCentre(undefined, [153, 100])).toEqual([76.5, 50])
        expect(storedCentre([NaN, 1], [10, 20])).toEqual([5, 10])
        expect(storedCentre(null, null)).toBeNull()
        expect(storedCentre(null, [1])).toBeNull()
    })
})

describe('positionsCsv', () => {
    const headers = { sheet: 'Tôle', part: 'Pièce', x: 'X', y: 'Y', diameter: 'Diamètre', rotation: 'Rotation' }
    const sheets = [
        { sheet: 1, box: [153, 153], rows: [
            { fileSlug: 'a', x: 76.5, y: 76.5, d: 17, rot: null },
            { fileSlug: 'b', x: 100.123456, y: 20, d: null, rot: 90 },
        ] },
        { sheet: 2, box: [200, 100], rows: [{ fileSlug: 'c', x: 100, y: 50, d: 22.5, rot: null }] },
    ]
    const nameOf = (s) => ({ a: 'rond 17.dxf', b: 'plaque, "b".dxf', c: '=HYPERLINK("x")' }[s])
    const lines = (csv) => csv.slice(1).split('\r\n')

    it('BOM, CRLF, virgule, point décimal, 4 décimales en mm, en-têtes avec l\'unité', () => {
        const csv = positionsCsv({ sheets, unit: 'mm', nameOf, headers })
        expect(csv.charCodeAt(0)).toBe(0xFEFF)
        expect(csv).not.toMatch(/[^\r]\n/)
        expect(lines(csv)).toEqual([
            'Tôle,Pièce,X (mm),Y (mm),Diamètre (mm),Rotation (deg)',
            '1,rond 17.dxf,76.5000,76.5000,17.0000,',
            '1,"plaque, ""b"".dxf",100.1235,20.0000,,90.0000',
            `2,"'=HYPERLINK(""x"")",100.0000,50.0000,22.5000,`,
        ])
    })

    it('origine au centre : (w/2, h/2) de CHAQUE tôle ; jamais « -0.0000 »', () => {
        const csv = positionsCsv({ sheets, origin: 'center', unit: 'mm', nameOf, headers })
        const l = lines(csv)
        expect(l[1]).toBe('1,rond 17.dxf,0.0000,0.0000,17.0000,')
        expect(l[2]).toBe('1,"plaque, ""b"".dxf",23.6235,-56.5000,,90.0000')
        expect(l[3].startsWith('2,')).toBe(true)
        expect(l[3]).toContain(',0.0000,0.0000,22.5000,')
        expect(csv).not.toMatch(/-0\.0+(,|\r|$)/)
    })

    it('origine au centre : le centre GARDÉ de la tôle passe devant celui de sa boîte', () => {
        const one = [{ ...sheets[0], center: [76.4, 76.6] }]
        expect(lines(positionsCsv({ sheets: one, origin: 'center', nameOf, headers }))[1])
            .toBe('1,rond 17.dxf,0.1000,-0.1000,17.0000,')
        expect(lines(positionsCsv({ sheets: one, nameOf, headers }))[1])
            .toBe('1,rond 17.dxf,76.5000,76.5000,17.0000,')
    })

    it('pouces : 5 décimales, unité in dans les en-têtes, centre calculé en mm puis converti', () => {
        const csv = positionsCsv({ sheets: [sheets[0]], origin: 'center', unit: 'inch', nameOf, headers })
        const l = lines(csv)
        expect(l[0]).toBe('Tôle,Pièce,X (in),Y (in),Diamètre (in),Rotation (deg)')
        expect(l[1]).toBe(`1,rond 17.dxf,0.00000,0.00000,${(17 / 25.4).toFixed(5)},`)
        expect(l[2]).toContain(`,${((100.123456 - 76.5) / 25.4).toFixed(5)},`)
    })

    it('nom absent : repli sur le slug ; en-têtes par défaut en anglais', () => {
        const csv = positionsCsv({ sheets: [sheets[0]], nameOf: () => null })
        expect(lines(csv)[0]).toBe('Sheet,Part,X (mm),Y (mm),Diameter (mm),Rotation (deg)')
        expect(lines(csv)[1].startsWith('1,a,')).toBe(true)
    })
})
