import { describe, expect, it } from 'vitest'
import { FIT_RELAX_MM, partMayFitSheet } from '../utils/partFit'

// partMayFitSheet : « la pièce peut tenir » — faux SEULEMENT si c'est prouvé impossible.

const circle = (cx, cy, r, n = 256) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)])
const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
const R4 = [0, 90, 180, 270]

describe('partMayFitSheet — disque de 153 mm', () => {
    const disc = circle(76.5, 76.5, 76.5)

    it('carré de 150 : refusé (diagonale 212 > 153), même à espacement 0,5', () => {
        expect(partMayFitSheet(rect(150, 150), disc, 0.5, R4)).toBe(false)
    })

    it('carré de 100 : tient ; 108 tient à espacement 0 (diagonale 152,7) mais pas à 1', () => {
        expect(partMayFitSheet(rect(100, 100), disc, 0, R4)).toBe(true)
        expect(partMayFitSheet(rect(108, 108), disc, 0, R4)).toBe(true)
        expect(partMayFitSheet(rect(108, 108), disc, 1, R4)).toBe(false)
    })
})

describe('partMayFitSheet — tôle rectangulaire : la règle w + 2s <= W', () => {
    const sheet = rect(100, 50)

    it('à la limite : passe ; au-delà du relâchement : refusée', () => {
        expect(partMayFitSheet(rect(96, 46), sheet, 2, [0])).toBe(true)
        // 96,5 : 0,5 mm de trop, plus que le relâchement de FIT_RELAX_MM
        expect(0.5).toBeGreaterThan(FIT_RELAX_MM)
        expect(partMayFitSheet(rect(96.5, 46), sheet, 2, [0])).toBe(false)
    })

    it('la rotation permise décide : 46 × 96 ne tient qu\'à 90 degrés', () => {
        expect(partMayFitSheet(rect(46, 96), sheet, 2, [0])).toBe(false)
        expect(partMayFitSheet(rect(46, 96), sheet, 2, R4)).toBe(true)
        expect(partMayFitSheet(rect(46, 96), sheet, 2, [90])).toBe(true)
    })
})

describe('partMayFitSheet — rotations libres et signe', () => {
    it('une barre 200 × 10 sur 150 × 150 ne passe qu\'avec 45 degrés listés', () => {
        const bar = rect(200, 10)
        expect(partMayFitSheet(bar, rect(150, 150), 0, [0])).toBe(false)
        expect(partMayFitSheet(bar, rect(150, 150), 0, [0, 45])).toBe(true)
        expect(partMayFitSheet(bar, rect(150, 150), 0, [0, 90, 180, 270])).toBe(false)
    })

    it('le signe de rotation ne change rien : +a et -a donnent la même réponse', () => {
        // Lame dans un triangle rectangle : tourner de +a ou de -a donne la même réponse.
        const tri = [[0, 0], [100, 0], [0, 100], [0, 0]]
        const slab = [[0, 0], [60, 0], [60, 8], [0, 8], [0, 0]]
        for (const a of [20, 45, 70]) {
            expect(partMayFitSheet(slab, tri, 0, [a])).toBe(partMayFitSheet(slab, tri, 0, [-a]))
        }
        expect(partMayFitSheet(slab, tri, 0, [45])).toBe(true)
    })
})

describe('partMayFitSheet — jamais de faux refus', () => {
    it('dégénéré ou illisible : vrai', () => {
        expect(partMayFitSheet([[0, 0], [10, 0]], rect(5, 5), 0, [0])).toBe(true)
        expect(partMayFitSheet(rect(500, 500), [[0, 0], [1, 1]], 0, [0])).toBe(true)
        expect(partMayFitSheet(null, rect(5, 5), 0, [0])).toBe(true)
        expect(partMayFitSheet(rect(500, 500), rect(5, 5), 0, [Number.NaN])).toBe(true)
        expect(partMayFitSheet([[0, 0], [Number.NaN, 4], [3, 3]], rect(5, 5), 0, [0])).toBe(true)
        expect(partMayFitSheet(rect(500, 500), [[0, 0], [10, 0], [Number.NaN, 4]], 0, [0])).toBe(true)
    })

    it('liste de rotations vide ou absente : 0 seul', () => {
        expect(partMayFitSheet(rect(46, 96), rect(100, 50), 0, [])).toBe(false)
        expect(partMayFitSheet(rect(46, 96), rect(100, 50), 0, undefined)).toBe(false)
        expect(partMayFitSheet(rect(46, 40), rect(100, 50), 0, undefined)).toBe(true)
    })

    it('pièces posées par construction dans une tôle en L : jamais refusées (2000 tirages)', () => {
        let seed = 7
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
        const sheet = [[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300], [0, 0]]
        for (let k = 0; k < 2000; k++) {
            const s = rnd() * 3
            // triangle de sommets pris dans la bande basse de la L (dans la tôle, à s près)
            const pts = []
            while (pts.length < 3) {
                const x = rnd() * 300
                const y = rnd() * 100
                if (x > s && y > s && x < 300 - s && y < 100 - s) pts.push([x, y])
            }
            const c = pts.reduce((a, p) => [a[0] + p[0] / 3, a[1] + p[1] / 3], [0, 0])
            const centred = pts.map(([x, y]) => [x - c[0], y - c[1]])
            expect(partMayFitSheet(centred, sheet, s, [0])).toBe(true)
        }
    })

    it('pièces convexes posées après rotation permise dans une tôle convexe ou concave construite autour d\'elles', () => {
        let seed = 11
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
        for (let k = 0; k < 1500; k++) {
            const n = 3 + Math.floor(rnd() * 6)
            const part = Array.from({ length: n }, () => [rnd() * 80 - 40, rnd() * 80 - 40])
            const ang = [0, 90, 180, 270, 37, 45][Math.floor(rnd() * 6)] * (rnd() < 0.5 ? 1 : -1)
            const r = (ang * Math.PI) / 180
            const placed = part.map(([x, y]) => [Math.cos(r) * x - Math.sin(r) * y + 200, Math.sin(r) * x + Math.cos(r) * y + 150])
            const s = rnd() * 4
            // tôle : la boîte des pièces posées agrandie de s, plus une encoche qui ne touche pas la pièce
            const xs = placed.map((p) => p[0])
            const ys = placed.map((p) => p[1])
            const x0 = Math.min(...xs) - s - 0.2
            const x1 = Math.max(...xs) + s + 0.2
            const y0 = Math.min(...ys) - s - 0.2
            const y1 = Math.max(...ys) + s + 0.2
            const sheet = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
            expect(partMayFitSheet(part, sheet, s, [Math.abs(ang)]), `n=${n} ang=${ang} s=${s}`).toBe(true)
        }
    })
})

describe('partMayFitSheet — coût', () => {
    it('tôle de 4096 sommets : 300 pièces qui tiennent vite, une pièce impossible sur 360 angles vite', () => {
        const big = circle(0, 0, 500, 4096)
        const rots = Array.from({ length: 360 }, (_, i) => i)
        const small = Array.from({ length: 300 }, (_, i) => circle(0, 0, 10 + i / 10, 64))
        const t0 = performance.now()
        for (const p of small) expect(partMayFitSheet(p, big, 2, rots)).toBe(true)
        const typical = performance.now() - t0
        const t1 = performance.now()
        expect(partMayFitSheet(circle(0, 0, 600, 64), big, 2, rots)).toBe(false)
        const worst = performance.now() - t1
        // Marge large : on vérifie l'ordre de grandeur, pas la machine.
        expect(typical).toBeLessThan(2000)
        expect(worst).toBeLessThan(500)
    })
})
