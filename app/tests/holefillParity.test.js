/**
 * §17.3/§17.4 — le hole-fill NAVIGATEUR ne livre jamais une paire sous
 * l'espacement, et il dit la même chose que le Python.
 *
 * La fixture est le cas réel du 2026-09-10 : l'alternative `balanced` d'une
 * démo écartée pour recouvrements mesurés (9 poses dupliquées, 27 paires
 * sous l'espacement, job remboursé). L'état MOTEUR de cette tôle est
 * conforme à 2,0001 mm : la passe seule est en cause. Le Python, dont la
 * distance passe par shapely, refusait déjà ces poses — il est la référence
 * de parité (`workers/nesting/tests/test_holefill_spacing.py` lit la MÊME
 * fixture, et le compte de relocalisations attendu y est écrit).
 *
 * La mesure de ce fichier est DÉLIBÉRÉMENT indépendante du code testé :
 * distance arête↔arête + containment réécrite ici. Mesurer avec la fonction
 * qu'on teste ne prouve rien — c'est exactement ce qui a laissé passer le
 * défaut (la validation et la mesure partageaient la même distance fausse).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { applyHoleFill, materialDistance } from '../composables/localBridge'

const FIXTURE = path.join(
    process.cwd(), 'workers', 'nesting', 'tests', 'fixtures',
    'holefill_parity_20260910.json',
)
const SLACK_MM = 0.01

// ---------------------------------------------------------------- mesure
const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
const ptSeg = (p, a, b) => {
    const abx = b[0] - a[0]
    const aby = b[1] - a[1]
    const l2 = abx * abx + aby * aby
    let t = l2 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2 : 0
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby))
}
const segSeg = (p1, p2, q1, q2) => {
    const o1 = orient(p1, p2, q1)
    const o2 = orient(p1, p2, q2)
    const o3 = orient(q1, q2, p1)
    const o4 = orient(q1, q2, p2)
    if (o1 && o2 && o3 && o4 && (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return 0
    return Math.min(ptSeg(p1, q1, q2), ptSeg(p2, q1, q2), ptSeg(q1, p1, p2), ptSeg(q2, p1, p2))
}
const ringDist = (a, b) => {
    let best = Infinity
    for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
            const d = segSeg(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])
            if (d < best) { best = d; if (best === 0) return 0 }
        }
    }
    return best
}
const inRing = (p, ring) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
            inside = !inside
        }
    }
    return inside
}
/** Distance des MATIÈRES (trous soustraits) — sémantique shapely. */
const matDist = (a, b) => {
    const d = ringDist(a.outer, b.outer)
    if (d <= 0) return 0
    if (inRing(a.outer[0], b.outer)) {
        for (const h of b.holes) if (inRing(a.outer[0], h)) return ringDist(h, a.outer)
        return 0
    }
    if (inRing(b.outer[0], a.outer)) {
        for (const h of a.holes) if (inRing(b.outer[0], h)) return ringDist(h, b.outer)
        return 0
    }
    return d
}
const place = (coords, rotDeg, tx, ty) => {
    const r = (rotDeg * Math.PI) / 180
    const c = Math.cos(r)
    const s = Math.sin(r)
    return coords.map(([x, y]) => [c * x - s * y + tx, s * x + c * y + ty])
}
/** Écart des AABB : minorant EXACT de la distance des anneaux qu'elles
 * contiennent. Pré-filtrer avec ça ne peut pas changer un verdict — et sans
 * lui, 276 poses × distances exactes dépassent le délai de vitest sur un
 * runner lent (CI rouge le 11/09 : `Test timed out in 5000ms`, vert sur le
 * poste : un verrou qui dépend de la vitesse de la machine ne verrouille
 * rien). */
const bbOf = (ring) => {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
    for (const [x, y] of ring) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
    }
    return [x0, y0, x1, y1]
}
const bbGap = (a, b) => {
    const dx = Math.max(0, Math.max(b[0] - a[2], a[0] - b[2]))
    const dy = Math.max(0, Math.max(b[1] - a[3], a[1] - b[3]))
    return dx === 0 && dy === 0 ? 0 : Math.hypot(dx, dy)
}
const measure = (parts, layouts, space) => {
    const byId = new Map(parts.map((p) => [String(p.id), p]))
    const lim = Math.max(0, space - SLACK_MM)
    let under = 0
    let duplicates = 0
    for (const layout of layouts) {
        const mats = []
        const keys = []
        const bbs = []
        for (const pi of layout.placed_items) {
            const part = byId.get(String(pi.item_id))
            const t = pi.transformation
            const outer = place(part.coords, t.rotation, t.translation[0], t.translation[1])
            mats.push({
                outer,
                holes: (part.holes || []).map((h) => place(h, t.rotation, t.translation[0], t.translation[1])),
            })
            bbs.push(bbOf(outer))
            keys.push([pi.item_id, t.rotation, t.translation[0], t.translation[1]].join('|'))
        }
        for (let i = 0; i < mats.length; i++) {
            for (let j = i + 1; j < mats.length; j++) {
                // L'un DANS l'autre a un écart de bbox nul : le pré-filtre ne
                // masque jamais un containment.
                if (lim > 0 && bbGap(bbs[i], bbs[j]) >= lim) continue
                if (matDist(mats[i], mats[j]) < lim) {
                    under++
                    if (keys[i] === keys[j]) duplicates++
                }
            }
        }
    }
    return { under, duplicates }
}

const loadFixture = () => {
    const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    return {
        space: Number(fx.space),
        expected: fx.attendu,
        parts: fx.parts.map((p) => ({
            id: Number(p.id),
            coords: p.coords.map((c) => [c[0], c[1]]),
            holes: (p.holes || []).map((h) => h.map((c) => [c[0], c[1]])),
            rotations: [0, 90, 180, 270],
            count: 0,
        })),
        layouts: JSON.parse(JSON.stringify(fx.layouts)),
    }
}

describe('applyHoleFill — espacement tenu sur la tôle (§17.3)', () => {
    it('cas réel du 10/09 : aucune paire sous l’espacement, aucun doublon', () => {
        const { parts, layouts, space } = loadFixture()
        expect(measure(parts, layouts, space)).toEqual({ under: 0, duplicates: 0 })
        const diag = {}
        applyHoleFill(parts, layouts, space, diag)
        const after = measure(parts, layouts, space)
        expect(after, `post-pass=${JSON.stringify(diag)}`).toEqual({ under: 0, duplicates: 0 })
    }, 30000)

    it('cas réel du 10/09 : même compte de relocalisations que le Python', () => {
        const { parts, layouts, space, expected } = loadFixture()
        // L'ancienne version en acceptait 13, toutes illégales (sa distance
        // sommet→segment rendait 4,2477 mm sur une paire mesurée à 0,0).
        expect(applyHoleFill(parts, layouts, space)).toBe(expected.relocalisations)
    }, 30000)

    it('chemin multi-relocalisations : les poses de la même passe se voient', () => {
        const hole = [[-30, -30], [30, -30], [30, 30], [-30, 30], [-30, -30]]
        const host = {
            id: 0,
            coords: [[-60, -60], [60, -60], [60, 60], [-60, 60], [-60, -60]],
            holes: [hole],
            rotations: [0],
            count: 1,
        }
        const fill = {
            id: 1,
            coords: [[-8, -8], [8, -8], [8, 8], [-8, 8], [-8, -8]],
            holes: [],
            rotations: [0, 90, 180, 270],
            count: 2,
        }
        const layouts = [{ placed_items: [
            { item_id: 0, transformation: { rotation: 0, translation: [500, 500] } },
            { item_id: 1, transformation: { rotation: 0, translation: [200, 200] } },
            { item_id: 1, transformation: { rotation: 0, translation: [240, 200] } },
        ] }]
        const parts = [host, fill]
        applyHoleFill(parts, layouts, 2)
        expect(measure(parts, layouts, 2)).toEqual({ under: 0, duplicates: 0 })
    })
})

describe('materialDistance — la distance ne doit pas mentir (piège #55)', () => {
    const sq = (side, x, y) => [[x, y], [x + side, y], [x + side, y + side], [x, y + side]]

    it('deux carrés côte à côte : l’écart exact', () => {
        expect(materialDistance(
            { outer: sq(40, 0, 0), holes: [] },
            { outer: sq(40, 42.5, 0), holes: [] },
        )).toBeCloseTo(2.5, 6)
    })

    it('un polygone DANS l’autre : 0, pas la distance de ses sommets au bord', () => {
        // Le cas du 10/09 : une pièce de 60 × 70 posée dans une pièce de
        // 300 × 150. L'ancienne distance sommet→segment rendait 4,2477 mm.
        const big = { outer: [[44, 2576], [344, 2576], [344, 2726], [44, 2726]], holes: [] }
        const small = { outer: [[318, 2588], [378, 2588], [378, 2658], [318, 2658]], holes: [] }
        expect(materialDistance(big, small)).toBe(0)
    })

    it('arêtes qui se croisent en leur milieu, aucun sommet dedans : 0', () => {
        const horizontal = { outer: [[0, 45], [100, 45], [100, 55], [0, 55]], holes: [] }
        const vertical = { outer: [[45, 0], [55, 0], [55, 100], [45, 100]], holes: [] }
        expect(materialDistance(horizontal, vertical)).toBe(0)
    })

    it('pièce nichée dans un TROU : mesurée contre l’anneau du trou (piège #4)', () => {
        const host = {
            outer: [[0, 0], [100, 0], [100, 100], [0, 100]],
            holes: [[[20, 20], [80, 20], [80, 80], [20, 80]]],
        }
        const fan = { outer: sq(40, 30, 30), holes: [] }
        expect(materialDistance(host, fan)).toBeCloseTo(10, 6)
    })
})
