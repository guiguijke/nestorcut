import { describe, expect, it } from 'vitest'
import {
    edgeReportModel,
    overhangMarginMm,
    viewBoxWithMargin,
    widenSvgDataUri,
    widenSvgViewBox,
} from '../utils/overhangView'

// SVG d'une tôle tel que l'écrit nest-export (svg.rs) : la ligne du rectangle
// est retrouvée par sheetDraw.js (RECT_LINE) sur sa forme exacte.
const RECT = '<rect x="0" y="0" width="1000" height="500" fill="#fff" stroke="#000" stroke-width="1" />'
const SVG = [
    "<?xml version='1.0' encoding='utf-8'?>",
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000mm" height="500mm" viewBox="0 0 1000 500">',
    RECT,
    '<path d="M0 0Z" />',
    '</svg>',
].join('\n')

describe('overhangMarginMm', () => {
    it('max(0, -e) : seul un bord négatif donne une marge', () => {
        expect(overhangMarginMm(-3)).toBe(3)
        expect(overhangMarginMm(0)).toBe(0)
        expect(overhangMarginMm(5)).toBe(0)
        expect(overhangMarginMm(null)).toBe(0)
        expect(overhangMarginMm(undefined)).toBe(0)
        expect(overhangMarginMm('')).toBe(0)
        expect(overhangMarginMm('abc')).toBe(0)
        expect(overhangMarginMm(Number.NaN)).toBe(0)
    })
})

describe('widenSvgViewBox', () => {
    it('marge 0, absente ou invalide : la chaîne est rendue au caractère près', () => {
        for (const m of [0, -1, null, undefined, 'x', Number.NaN]) {
            expect(widenSvgViewBox(SVG, m)).toBe(SVG)
        }
    })

    it('élargit viewBox, width et height, et ne touche pas à la ligne du rectangle', () => {
        const out = widenSvgViewBox(SVG, 10)
        expect(out).toContain('viewBox="-10 -10 1020 520"')
        expect(out).toContain('width="1020mm"')
        expect(out).toContain('height="520mm"')
        expect(out.split('\n')).toContain(RECT)
        // tout le reste est identique
        expect(out.split('\n').filter((l) => !l.startsWith('<svg'))).toEqual(SVG.split('\n').filter((l) => !l.startsWith('<svg')))
    })

    it('en pouces : la marge (mm) est convertie dans l\'unité du viewBox', () => {
        const inch = '<svg xmlns="http://www.w3.org/2000/svg" width="40in" height="20in" viewBox="0 0 40 20"></svg>'
        const out = widenSvgViewBox(inch, 25.4)
        expect(out).toContain('viewBox="-1 -1 42 22"')
        expect(out).toContain('width="42in"')
    })

    it('SVG sans viewBox lisible : rendu tel quel', () => {
        expect(widenSvgViewBox('<svg width="10"></svg>', 5)).toBe('<svg width="10"></svg>')
        expect(widenSvgViewBox('pas un svg', 5)).toBe('pas un svg')
    })
})

describe('widenSvgDataUri', () => {
    const enc = (svg) => `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')}`

    it('marge 0 : la même URI', () => {
        const uri = enc(SVG)
        expect(widenSvgDataUri(uri, 0)).toBe(uri)
    })

    it('élargit une data URI pourcent-encodée', () => {
        const out = widenSvgDataUri(enc(SVG), 4)
        expect(decodeURIComponent(out.slice('data:image/svg+xml,'.length))).toBe(widenSvgViewBox(SVG, 4))
    })

    it('élargit une data URI base64', () => {
        const uri = `data:image/svg+xml;base64,${Buffer.from(SVG, 'utf8').toString('base64')}`
        const out = widenSvgDataUri(uri, 4)
        const text = Buffer.from(out.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8')
        expect(text).toBe(widenSvgViewBox(SVG, 4))
    })

    it('URL blob ou http : inchangée', () => {
        expect(widenSvgDataUri('blob:abc', 4)).toBe('blob:abc')
        expect(widenSvgDataUri('/x.svg', 4)).toBe('/x.svg')
    })
})

describe('viewBoxWithMargin', () => {
    it('marge 0 : le cadre d\'avant', () => {
        expect(viewBoxWithMargin(1000, 500, 0)).toBe('0 0 1000 500')
        expect(viewBoxWithMargin(1000, 500, undefined)).toBe('0 0 1000 500')
    })
    it('marge m : m de chaque côté', () => {
        expect(viewBoxWithMargin(1000, 500, 10)).toBe('-10 -10 1020 520')
    })
})

describe('edgeReportModel', () => {
    it('rapport sans champs de bord : null (pastilles d\'origine)', () => {
        expect(edgeReportModel({ spacingOk: true, smallestGapMm: 2 }, -3)).toBeNull()
        expect(edgeReportModel(null, -3)).toBeNull()
        expect(edgeReportModel({ edgeOk: undefined }, 4)).toBeNull()
    })

    it('bord positif : « au moins x », vert quand edgeOk', () => {
        const m = edgeReportModel({ edgeOk: true, edgeGapMm: 6 }, 5)
        expect(m.edge).toEqual({ ok: true, kind: 'atLeast', valueMm: 5 })
        expect(m.outsideMm).toBeNull()
        expect(edgeReportModel({ edgeOk: false, edgeGapMm: 3 }, 5).edge.ok).toBe(false)
    })

    it('bord négatif : « dépasse de x au plus » ; un dépassement permis n\'est pas « hors tôle »', () => {
        const m = edgeReportModel({ edgeOk: true, edgeGapMm: -3 }, -3)
        expect(m.edge).toEqual({ ok: true, kind: 'overhang', valueMm: 3 })
        expect(m.outsideMm).toBeNull()
    })

    it('« hors tôle de » = dépassement au-delà du permis, tiré de edgeGapMm', () => {
        const m = edgeReportModel({ edgeOk: false, edgeGapMm: -5 }, -3)
        expect(m.outsideMm).toBeCloseTo(2, 9)
        // bord positif : tout dépassement est hors tôle
        expect(edgeReportModel({ edgeOk: false, edgeGapMm: -1.5 }, 4).outsideMm).toBeCloseTo(1.5, 9)
        // sous la tolérance du rapport (0,01 mm) : pas de dépassement
        expect(edgeReportModel({ edgeOk: true, edgeGapMm: -3.005 }, -3).outsideMm).toBeNull()
    })

    it('distance demandée inconnue : pas de pastille de bord, mais edgeOk reste lu', () => {
        const m = edgeReportModel({ edgeOk: true, edgeGapMm: 1 }, undefined)
        expect(m.edge).toBeNull()
        expect(m.outsideMm).toBeNull()
    })
})
