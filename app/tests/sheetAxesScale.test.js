import { describe, expect, it } from 'vitest'
import { axesMarkSizes, axesMinScale, sheetAxesDisplay } from '../utils/sheetView'

// Repère X/Y : minima en mm réduits sur une petite tôle (disque de 153 mm).
const marks = (w, h) => {
    const ax = sheetAxesDisplay(w, h)
    return { ...axesMarkSizes(ax.len, ax.k), inset: ax.origin.x, k: ax.k, len: ax.len }
}

describe('échelle des minima du repère', () => {
    it('1000 x 2000 : valeurs exactes d hier', () => {
        expect(axesMinScale(2000, 1000)).toBe(1)
        // len = min(max(180, 110), 280) = 180
        const a = marks(1000, 2000)
        expect(a.k).toBe(1)
        expect(a.len).toBeCloseTo(180, 10)
        expect(a.font).toBeCloseTo(180 * 0.22, 10)
        expect(a.dot).toBeCloseTo(180 * 0.032, 10)
        expect(a.gap).toBeCloseTo(180 * 0.08, 10)
        expect(a.inset).toBeCloseTo(1000 * 0.014, 10)
    })

    it('200 x 3000 : minima absolus d hier (font 16, dot 5, gap 8, inset 10)', () => {
        const a = marks(200, 3000)
        expect(a.k).toBe(1)
        expect(a.len).toBeCloseTo(56, 10)
        expect(a.font).toBeCloseTo(Math.max(56 * 0.22, 16), 10)
        expect(a.dot).toBe(5)
        expect(a.gap).toBe(8)
        expect(a.inset).toBe(10)
    })

    it('disque de 153 mm : marques proportionnelles', () => {
        const a = marks(153, 153)
        const k = 153 / 700
        expect(a.k).toBeCloseTo(k, 10)
        expect(a.font).toBeCloseTo(6.0588, 3)
        // 0,032 x len = 0,881 est sous le minimum réduit 5 x k = 1,093
        expect(a.dot).toBeCloseTo(5 * k, 6)
        expect(a.gap).toBeCloseTo(27.54 * 0.08, 6)
        expect(a.inset).toBeCloseTo(10 * k, 6)
        // plus rien de la taille d hier
        expect(a.font).toBeLessThan(8)
        expect(a.inset).toBeLessThan(3)
    })

    it('continu autour de 700 mm : pas de saut', () => {
        expect(axesMinScale(700, 300)).toBe(1)
        expect(axesMinScale(699, 300)).toBeLessThan(1)
        expect(axesMinScale(699, 300)).toBeGreaterThan(0.99)
    })
})
