import { describe, expect, it } from 'vitest'
import { buildPartRefs, cutStats, labelPoint, parseSheetSvg, ringsBox, svgTextFromDataUri } from '~~/app/utils/sheetSvgReport'

// SVG au format de svg.rs (build_colored_sheet_svg) + éléments ajoutés par
// withSheetShapeSvg pour une tôle importée (contour, zone interdite : sans transform).
const SVG = [
    "<?xml version='1.0' encoding='utf-8'?>",
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000mm" height="1000mm" viewBox="0 0 1000 1000">',
    '<path d="M0 1000 L1000 1000 L1000 0 L0 0 Z" fill="#FFFFFF" stroke="#3B82F6" stroke-width="3" stroke-linejoin="round" fill-rule="evenodd" />',
    '<defs><pattern id="nc-zone-hatch-0" patternUnits="userSpaceOnUse" width="20" height="20"><line x1="0" y1="0" x2="0" y2="20" stroke="#DC2626" stroke-width="1" /></pattern></defs>',
    '<path d="M10 10 L60 10 L60 60 L10 60 Z" fill="#DC2626" fill-opacity="0.18" stroke="none" fill-rule="evenodd" />',
    '<path d="M0 0 100 0 100 100 0 100Z" transform="translate(200 800) scale(1 -1) rotate(90)" fill="#2563EB" fill-opacity="0.35" fill-rule="evenodd" stroke="#2563EB" stroke-width="2" />',
    '<path d="M0 0 200 0 200 200 0 200Z M50 50 150 50 150 150 50 150Z" transform="translate(300 500) scale(1 -1) rotate(0)" fill="#16a34a" fill-opacity="0.35" fill-rule="evenodd" stroke="#16a34a" stroke-width="2" />',
    '</svg>',
].join('\n')

const near = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('parseSheetSvg', () => {
    const r = parseSheetSvg(SVG)

    it('taille de la tôle et nombre de pièces (contour et zones ignorés)', () => {
        expect(r.widthMm).toBe(1000)
        expect(r.heightMm).toBe(1000)
        expect(r.parts).toHaveLength(2)
    })

    it('carré tourné de 90 degrés : coordonnées transformées', () => {
        const ring = r.parts[0].rings[0]
        const want = [[200, 800], [200, 700], [100, 700], [100, 800]]
        ring.forEach((p, i) => {
            near(p[0], want[i][0])
            near(p[1], want[i][1])
        })
        expect(r.parts[0].color).toBe('#2563EB')
    })

    it('pièce à trou : deux anneaux, y retourné, couleur normalisée', () => {
        const [outer, hole] = r.parts[1].rings
        expect(ringsBox([outer])).toEqual({ minX: 300, minY: 300, maxX: 500, maxY: 500 })
        expect(ringsBox([hole])).toEqual({ minX: 350, minY: 350, maxX: 450, maxY: 450 })
        expect(r.parts[1].color).toBe('#16A34A')
    })

    it('unité in : ×25,4', () => {
        const s = '<svg width="10in" height="5in" viewBox="0 0 10 5"><path d="M0 0 1 0 1 1 0 1Z" transform="translate(1 1) scale(1 -1) rotate(0)" fill="#112233"/></svg>'
        const p = parseSheetSvg(s)
        near(p.widthMm, 254)
        near(p.heightMm, 127)
        near(p.parts[0].rings[0][0][0], 25.4)
        near(p.parts[0].rings[0][2][0], 50.8)
        near(p.parts[0].rings[0][2][1], 0)
    })

    it('SVG illisible : null, jamais d exception', () => {
        expect(parseSheetSvg('')).toBeNull()
        expect(parseSheetSvg('pas du svg')).toBeNull()
        expect(parseSheetSvg('<svg width="10mm"')).toBeNull()
        expect(parseSheetSvg('<svg width="10mm" height="5mm"></svg>')).toBeNull()
        expect(parseSheetSvg(null)).toBeNull()
        expect(parseSheetSvg(undefined)).toBeNull()
        expect(parseSheetSvg(42)).toBeNull()
    })

    it('chemin avec commande non gérée : pièce ignorée, le reste lu', () => {
        const s = '<svg width="10mm" height="10mm" viewBox="0 0 10 10"><path d="M0 0 C1 1 2 2 3 3Z" transform="translate(0 0)"/><path d="M0 0 1 0 1 1Z" transform="translate(0 10) scale(1 -1) rotate(0)"/></svg>'
        expect(parseSheetSvg(s).parts).toHaveLength(1)
    })
})

describe('svgTextFromDataUri', () => {
    it('décode une data URI encodeURIComponent (svgToDataUri)', () => {
        const uri = `data:image/svg+xml,${encodeURIComponent(SVG).replace(/'/g, '%27').replace(/"/g, '%22')}`
        expect(svgTextFromDataUri(uri)).toBe(SVG)
        expect(parseSheetSvg(svgTextFromDataUri(uri)).parts).toHaveLength(2)
    })
    it('base64 et charset', () => {
        const b64 = Buffer.from(SVG, 'utf8').toString('base64')
        expect(svgTextFromDataUri(`data:image/svg+xml;base64,${b64}`)).toBe(SVG)
        expect(svgTextFromDataUri(`data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg/>')}`)).toBe('<svg/>')
    })
    it('autre chose : null', () => {
        expect(svgTextFromDataUri('https://x/y.svg')).toBeNull()
        expect(svgTextFromDataUri('data:image/png;base64,AAAA')).toBeNull()
        expect(svgTextFromDataUri(null)).toBeNull()
        expect(svgTextFromDataUri('data:image/svg+xml,%E0%A4%A')).toBeNull()
    })
})

describe('cutStats', () => {
    it('somme des périmètres de tous les anneaux, un amorçage par anneau', () => {
        const { parts } = parseSheetSvg(SVG)
        const s = cutStats(parts)
        near(s.cutLengthMm, 400 + 800 + 400)
        expect(s.pierceCount).toBe(3)
    })
    it('vide', () => {
        expect(cutStats([])).toEqual({ cutLengthMm: 0, pierceCount: 0 })
        expect(cutStats(null)).toEqual({ cutLengthMm: 0, pierceCount: 0 })
    })
})

describe('labelPoint', () => {
    it('anneau avec trou : le point est dans la matière, loin du trou', () => {
        const { parts } = parseSheetSvg(SVG)
        const [x, y] = labelPoint(parts[1].rings)
        expect(x).toBeGreaterThan(300)
        expect(x).toBeLessThan(500)
        expect(y).toBeGreaterThan(300)
        expect(y).toBeLessThan(500)
        const inHole = x > 350 && x < 450 && y > 350 && y < 450
        expect(inHole).toBe(false)
        // Distance au bord le plus proche : proche du maximum possible (25 mm de large de couronne).
        const dEdge = Math.min(x - 300, 500 - x, y - 300, 500 - y, ...(x > 350 && x < 450 ? [Math.abs(y - 350), Math.abs(y - 450)] : []), ...(y > 350 && y < 450 ? [Math.abs(x - 350), Math.abs(x - 450)] : []))
        expect(dEdge).toBeGreaterThan(25 - 4)
    })
    it('carré plein : proche du centre', () => {
        const [x, y] = labelPoint([[[0, 0], [100, 0], [100, 100], [0, 100]]])
        expect(Math.abs(x - 50)).toBeLessThan(3)
        expect(Math.abs(y - 50)).toBeLessThan(3)
    })
    it('forme en L : point dans la matière', () => {
        const L = [[0, 0], [100, 0], [100, 20], [20, 20], [20, 100], [0, 100]]
        const [x, y] = labelPoint([L])
        const inside = (x >= 0 && x <= 100 && y >= 0 && y <= 20) || (x >= 0 && x <= 20 && y >= 0 && y <= 100)
        expect(inside).toBe(true)
    })
    it('dégénéré : repli sur le centre de la boîte, vide sans exception', () => {
        expect(labelPoint([[[0, 0], [10, 0]]])).toEqual([5, 0])
        expect(labelPoint([])).toEqual([0, 0])
    })
})

describe('buildPartRefs', () => {
    it('numéros par ordre de première apparition, communs à toutes les tôles', () => {
        const { refOf, perSheet } = buildPartRefs([['b', 'a', 'b', 'c'], ['c', 'a', 'd'], null, ['d']])
        expect([...refOf]).toEqual([['b', 1], ['a', 2], ['c', 3], ['d', 4]])
        expect(perSheet[0]).toEqual([{ ref: 1, slug: 'b', count: 2 }, { ref: 2, slug: 'a', count: 1 }, { ref: 3, slug: 'c', count: 1 }])
        expect(perSheet[1]).toEqual([{ ref: 2, slug: 'a', count: 1 }, { ref: 3, slug: 'c', count: 1 }, { ref: 4, slug: 'd', count: 1 }])
        expect(perSheet[2]).toBeNull()
        expect(perSheet[3]).toEqual([{ ref: 4, slug: 'd', count: 1 }])
    })
    it('entrée vide', () => {
        expect(buildPartRefs([]).perSheet).toEqual([])
        expect(buildPartRefs(undefined).refOf.size).toBe(0)
    })
})
