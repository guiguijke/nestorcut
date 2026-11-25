import { describe, expect, it } from 'vitest'
import { CONVEX_TOL_MM, DENT_TOL_MM, engineInstanceOf, engineSendOf, hullAndPockets, withSwappedCutoff } from '../utils/sheetHull'

// Tôle importée concave : le moteur reçoit enveloppe convexe + poches (voir
// l'en-tête de sheetHull.js). Fonction pure : aucun moteur, aucun Worker.

const shoelace = (p) => {
    let s = 0
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j][0] * p[i][1] - p[i][0] * p[j][1]
    return s / 2
}
const closeRing = (p) => [...p, p[0]]
const disc = (n, r, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)])
/** Partie d'une poche qui est DANS l'enveloppe : la chaîne, avant les 7 points de fermeture extérieure. */
const insidePart = (pocket) => pocket.slice(0, pocket.length - 7)

// Orientation avec tolérance : la lèvre de la poche est colinéaire avec elle-même, le bruit flottant ne doit pas faire un croisement.
const orient = (a, b, c) => {
    const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    const scale = Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - a[0], c[1] - a[1])
    return Math.abs(v) <= 1e-9 * scale ? 0 : Math.sign(v)
}
const crossProper = (a, b, c, d) => orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0
/** Anneau fermé sans arêtes qui se croisent (arêtes voisines exclues). */
function isSimple(ring) {
    const n = ring.length - 1
    for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue
            if (crossProper(ring[i], ring[i + 1], ring[j], ring[j + 1])) return false
        }
    }
    return true
}
function strictlyInside(pt, ring) {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
}

const L_SHAPE = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]]

describe('hullAndPockets — contours convexes : null (instance inchangée)', () => {
    it('rectangle', () => {
        expect(hullAndPockets([[0, 0], [100, 0], [100, 50], [0, 50], [0, 0]])).toBeNull()
    })

    it('disque dense, à nombre impair de côtés, et bruité à la grille 1e-4', () => {
        expect(hullAndPockets(closeRing(disc(720, 100)))).toBeNull()
        expect(hullAndPockets(closeRing(disc(721, 100)))).toBeNull()
        const grid = disc(720, 100).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4])
        expect(hullAndPockets(closeRing(grid))).toBeNull()
    })

    it('disque mis à l’échelle en pouces (grille 1e-4 puis x 25,4)', () => {
        const inch = disc(360, 4).map(([x, y]) => [Math.round(x * 1e4) / 1e4 * 25.4, Math.round(y * 1e4) / 1e4 * 25.4])
        expect(hullAndPockets(closeRing(inch))).toBeNull()
    })

    it('creux jusqu’à 0,005 mm : convexe', () => {
        const d = CONVEX_TOL_MM * 0.9
        const ring = [[0, 0], [50, 0], [100, 0], [100, 100], [50, 100 - d], [0, 100]]
        expect(hullAndPockets(closeRing(ring))).toBeNull()
    })

    it('anneau trop court, ou qui se recoupe : illisible, null', () => {
        expect(hullAndPockets([[0, 0], [1, 0], [0, 0]])).toBeNull()
        expect(hullAndPockets([[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]])).toBeNull()
        expect(hullAndPockets([])).toBeNull()
    })
})

describe('hullAndPockets — contours concaves', () => {
    it('L : enveloppe fermée de 5 sommets, une poche fermée à l’extérieur', () => {
        const r = hullAndPockets(closeRing(L_SHAPE))
        expect(r.outer).toEqual([[0, 0], [100, 0], [100, 40], [40, 100], [0, 100], [0, 0]])
        expect(r.pockets).toHaveLength(1)
        const pocket = r.pockets[0]
        expect(pocket[0]).toEqual([100, 40])
        expect(pocket[2]).toEqual([40, 100])
        expect(pocket[pocket.length - 1]).toEqual(pocket[0])
        // La chaîne est le triangle du creux ; la lèvre et le drapeau sont de l'autre côté de l'arête de pont.
        expect(Math.abs(shoelace(insidePart(pocket)))).toBeCloseTo(1800, 6)
        expect(isSimple(pocket)).toBe(true)
    })

    it('anneau ouvert ou fermé : même résultat', () => {
        expect(hullAndPockets(L_SHAPE)).toEqual(hullAndPockets(closeRing(L_SHAPE)))
    })

    it('anneau horaire : même résultat que l’anneau antihoraire', () => {
        const ccw = hullAndPockets(closeRing(L_SHAPE))
        const cw = hullAndPockets(closeRing([...L_SHAPE].reverse()))
        expect(cw).not.toBeNull()
        expect(cw.pockets).toHaveLength(1)
        expect(shoelace(cw.outer)).toBeCloseTo(shoelace(ccw.outer), 9)
        expect(Math.abs(shoelace(insidePart(cw.pockets[0])))).toBeCloseTo(1800, 6)
    })

    it('poche qui commence à l’indice 0 du contour', () => {
        const ring = [[40, 40], [40, 100], [0, 100], [0, 0], [100, 0], [100, 40]]
        const r = hullAndPockets(closeRing(ring))
        expect(r.pockets).toHaveLength(1)
        expect(Math.abs(shoelace(insidePart(r.pockets[0])))).toBeCloseTo(1800, 6)
        expect(shoelace(r.outer)).toBeCloseTo(shoelace(closeRing(L_SHAPE)) + 1800, 6)
    })

    it('U : une poche à quatre sommets', () => {
        const u = [[0, 0], [100, 0], [100, 100], [70, 100], [70, 30], [30, 30], [30, 100], [0, 100]]
        const r = hullAndPockets(closeRing(u))
        expect(r.pockets).toHaveLength(1)
        expect(Math.abs(shoelace(insidePart(r.pockets[0])))).toBeCloseTo(40 * 70, 6)
        expect(isSimple(r.pockets[0])).toBe(true)
    })

    it('encoche étroite : poche valide même très fine', () => {
        const ring = [[0, 0], [100, 0], [100, 100], [50.05, 100], [50.05, 20], [49.95, 20], [49.95, 100], [0, 100]]
        const r = hullAndPockets(closeRing(ring))
        expect(r.pockets).toHaveLength(1)
        expect(isSimple(r.pockets[0])).toBe(true)
    })

    it('sommets alignés sur l’arête de l’enveloppe : pas de poche, et la chaîne est coupée', () => {
        const ring = [[0, 0], [50, 0], [100, 0], [100, 100], [60, 100], [60, 60], [40, 60], [40, 100], [20, 100], [0, 100]]
        const r = hullAndPockets(closeRing(ring))
        expect(r.pockets).toHaveLength(1)
        expect(r.outer).toHaveLength(5) // 4 coins + fermeture : les sommets alignés quittent l'enveloppe
    })

    it('plusieurs encoches sur une même arête : une poche chacune', () => {
        const ring = [[0, 0], [100, 0], [100, 100], [85, 100], [85, 70], [75, 70], [75, 100], [55, 100], [55, 60], [45, 60], [45, 100], [25, 100], [25, 80], [15, 80], [15, 100], [0, 100]]
        const r = hullAndPockets(closeRing(ring))
        expect(r.pockets).toHaveLength(3)
        for (const p of r.pockets) expect(isSimple(p)).toBe(true)
    })

    it('identité d’aire : enveloppe moins parties intérieures des poches = tôle', () => {
        const r = hullAndPockets(closeRing(L_SHAPE))
        const parts = r.pockets.reduce((q, p) => q + Math.abs(shoelace(insidePart(p))), 0)
        expect(shoelace(r.outer) - parts).toBeCloseTo(Math.abs(shoelace(L_SHAPE)), 6)
    })

    it('ne modifie pas son entrée', () => {
        const ring = closeRing(L_SHAPE.map((p) => [...p]))
        const snap = JSON.stringify(ring)
        hullAndPockets(ring)
        hullAndPockets([...ring].reverse())
        expect(JSON.stringify(ring)).toBe(snap)
    })
})

describe('hullAndPockets — constantes de sécurité', () => {
    // Plaque 1000 x 500 dont le bord bas (y = 0, dehors en bas) porte les points donnés.
    const plate = (...bottom) => closeRing([[0, 0], ...bottom, [1000, 0], [1000, 500], [0, 500]])

    it('creux de 0,006 mm : concave (0,005 ne l’est pas)', () => {
        expect(hullAndPockets(plate([500, 0.006]))?.pockets).toHaveLength(1)
        expect(hullAndPockets(plate([500, 0.005]))).toBeNull()
    })

    it('dans un contour concave, une encoche de 0,002 mm reste une poche, une de 0,0009 est ignorée', () => {
        const deep = [[200, 0], [200, 10], [210, 10], [210, 0]]
        expect(hullAndPockets(plate(...deep, [700, 0.002])).pockets).toHaveLength(2)
        expect(hullAndPockets(plate(...deep, [700, 0.0009])).pockets).toHaveLength(1)
    })

    it('fermeture : lèvre à 0,1 mm, drapeau de demi-côté max(0,2 mm, taille / 400)', () => {
        for (const [size, half] of [[10, 0.2], [80, 0.2], [400, 1]]) {
            const { pockets } = hullAndPockets(plate([300, 0], [300, 20], [300 + size, 20], [300 + size, 0]))
            const closing = pockets[0].slice(-7)
            const ys = [...new Set(closing.map(([, y]) => Math.round(y * 1e6) / 1e6))].sort((p, q) => p - q)
            const f = Math.max(0.2, Math.max(size, 20) / 400)
            expect(f).toBeCloseTo(half, 9)
            expect(ys).toEqual([-(0.1 + 2 * f), -0.1, 0].map((v) => expect.closeTo(v, 5)))
            const xs = closing.map(([x]) => x)
            expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(Math.max(size, 2 * f), 5)
        }
    })

    it('bouche de quelques microns aux lèvres décalées : poche simple, rien dans la tôle', () => {
        // Rainure en dessous : bouche 0,002 mm, lèvre droite 0,0009 mm plus haut, 0,2 mm de
        // matière au-dessus du corps de 400 mm. Fermée selon a -> b, le drapeau entrait dans la tôle.
        const ring = plate([500, 0], [500, 0.2], [300, 0.2], [300, 50], [700, 50], [700, 0.2], [500.002, 0.2], [500.002, 0.0009])
        const { pockets } = hullAndPockets(ring)
        expect(pockets).toHaveLength(1)
        expect(isSimple(pockets[0])).toBe(true)
        for (const pt of pockets[0].slice(-7, -1)) expect(strictlyInside(pt, ring)).toBe(false)
    })

    it('anneau horaire OUVERT : l’entrée n’est pas retournée', () => {
        const ring = [...L_SHAPE].reverse()
        const before = JSON.stringify(ring)
        hullAndPockets(ring)
        expect(JSON.stringify(ring)).toBe(before)
    })
})

describe('hullAndPockets — propriété sur des étoiles aléatoires', () => {
    // mulberry32 : suite fixe, le test ne dépend pas du hasard.
    const rng = (seed) => () => {
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const star = (rand, n) => {
        const angles = Array.from({ length: n }, () => rand() * 2 * Math.PI).sort((a, b) => a - b)
        return angles.map((a) => {
            const r = 30 + rand() * 70
            return [r * Math.cos(a), r * Math.sin(a)]
        })
    }

    it('200 étoiles : identité d’aire, poches simples, aucun sommet de poche dans la tôle', () => {
        const rand = rng(20261125)
        let concave = 0
        for (let k = 0; k < 200; k++) {
            const ring = closeRing(star(rand, 5 + Math.floor(rand() * 40)))
            const r = hullAndPockets(ring)
            if (!r) continue
            concave++
            const area = Math.abs(shoelace(ring))
            const parts = r.pockets.reduce((q, p) => q + Math.abs(shoelace(insidePart(p))), 0)
            const perimeter = ring.reduce((q, p, i) => (i ? q + Math.hypot(p[0] - ring[i - 1][0], p[1] - ring[i - 1][1]) : q), 0)
            expect(Math.abs(shoelace(r.outer) - parts - area)).toBeLessThanOrEqual(2 * DENT_TOL_MM * perimeter + 1e-9 * area)
            const own = new Set(ring.map(([x, y]) => `${x},${y}`))
            for (const p of r.pockets) {
                expect(isSimple(p)).toBe(true)
                for (const v of p) {
                    if (own.has(`${v[0]},${v[1]}`)) continue // sommet du contour : sur le bord
                    expect(strictlyInside(v, ring)).toBe(false)
                }
            }
        }
        expect(concave).toBeGreaterThan(150)
    })
})

describe('engineInstanceOf / engineSendOf', () => {
    const bin = (id, outer, extra = {}) => ({ id, cost: 1, stock: 1, shape: { type: 'polygon', data: { outer, ...extra } } })
    const RECT = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]
    const payloadOf = (bins, shaped) => ({
        problem: 'bpp',
        instance: { name: 't', items: [{ id: 0, demand: 1 }], bins },
        engineConfig: { narrow_concavity_cutoff: [0.01, 0.01] },
        ...(shaped ? { shapedSheets: shaped.map((id) => ({ id })) } : {}),
    })

    it('même référence sans tôle concave : rectangle, tôle convexe, job mixte, pas de bins', () => {
        const rect = payloadOf([bin(0, RECT)])
        expect(engineInstanceOf(rect)).toBe(rect.instance)
        const convex = payloadOf([bin(0, RECT)], [0])
        expect(engineInstanceOf(convex)).toBe(convex.instance)
        const mixed = payloadOf([bin(0, RECT), bin(1, closeRing(disc(90, 50)))], [1])
        expect(engineInstanceOf(mixed)).toBe(mixed.instance)
        const spp = { instance: { strip_height: 1000, items: [] } }
        expect(engineInstanceOf(spp)).toBe(spp.instance)
        expect(engineInstanceOf({ instance: 5 })).toBe(5)
        expect(engineInstanceOf(undefined)).toBeUndefined()
    })

    it('un bin concave qui n’est pas dans shapedSheets n’est pas touché', () => {
        const p = payloadOf([bin(0, closeRing(L_SHAPE))], [])
        expect(engineInstanceOf(p)).toBe(p.instance)
    })

    it('tôle concave : copie, enveloppe en outer, poches après les inner existants, rien de muté', () => {
        const hazard = [[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]
        const p = payloadOf([bin(0, closeRing(L_SHAPE), { inner: [hazard] })], [0])
        const snap = JSON.stringify(p)
        const inst = engineInstanceOf(p)
        expect(inst).not.toBe(p.instance)
        expect(JSON.stringify(p)).toBe(snap)
        const d = inst.bins[0].shape.data
        expect(d.outer).toEqual([[0, 0], [100, 0], [100, 40], [40, 100], [0, 100], [0, 0]])
        expect(d.inner).toHaveLength(2)
        expect(d.inner[0]).toBe(hazard)
        expect(inst.items).toBe(p.instance.items)
        expect(inst.bins[0].cost).toBe(1)
    })

    it('job mixte rectangle + concave : seul le bin concave change', () => {
        const p = payloadOf([bin(0, RECT), bin(1, closeRing(L_SHAPE))], [1])
        const inst = engineInstanceOf(p)
        expect(inst.bins[0]).toBe(p.instance.bins[0])
        expect(inst.bins[1]).not.toBe(p.instance.bins[1])
        expect(inst.bins[1].shape.data.inner).toHaveLength(1)
    })

    it('engineSendOf : calculé une fois par payload', () => {
        const p = payloadOf([bin(0, closeRing(L_SHAPE))], [0])
        const a = engineSendOf(p)
        expect(a.swapped).toBe(true)
        expect(engineSendOf(p)).toBe(a)
        expect(engineSendOf(p).instance).toBe(a.instance)
        const q = payloadOf([bin(0, RECT)])
        expect(engineSendOf(q)).toMatchObject({ instance: q.instance, swapped: false })
    })

    it('seuls les bins listés dans shapedSheets sont regardés', () => {
        const instance = { bins: [
            { id: 0, shape: { type: 'polygon', data: { outer: closeRing(L_SHAPE), inner: [] } } },
            { id: 1, shape: { type: 'polygon', data: { outer: closeRing(disc(64, 50)), inner: [] } } },
        ] }
        const payload = { instance, shapedSheets: [{ id: 1 }] }
        expect(engineInstanceOf(payload)).toBe(instance)
    })

    it('engineSendOf : une instance remplacée sur le même payload est recalculée', () => {
        const bins = [{ id: 0, shape: { type: 'polygon', data: { outer: closeRing(disc(64, 50)), inner: [] } } }]
        const payload = { instance: { bins, items: [{ id: 0, demand: 5 }] }, shapedSheets: [{ id: 0 }] }
        expect(engineSendOf(payload).instance.items[0].demand).toBe(5)
        payload.instance = { bins, items: [{ id: 0, demand: 7 }] }
        expect(engineSendOf(payload)).toMatchObject({ instance: payload.instance, swapped: false })
        expect(engineSendOf(payload).instance.items[0].demand).toBe(7)
    })

    it('withSwappedCutoff : config inchangée (même objet) sauf substitution', () => {
        const cfg = { narrow_concavity_cutoff: [0.01, 0.01], a: 1 }
        expect(withSwappedCutoff(cfg, false)).toBe(cfg)
        expect(withSwappedCutoff(cfg, true)).toEqual({ narrow_concavity_cutoff: null, a: 1 })
        expect(cfg.narrow_concavity_cutoff).toEqual([0.01, 0.01])
    })
})
