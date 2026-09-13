/**
 * Verrous du lot J3 — réserve d'amorce, disque de perçage, espacement
 * pré-rempli (`docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §8, chantier 3.5 du
 * masterplan).
 *
 * Ce qui est mesuré, et pas seulement affirmé :
 *   - la réserve SORT de la pièce (le disque de perçage est dehors, entier) ;
 *   - elle est LOCALE : l'aire ajoutée est celle de l'appendice, pas celle
 *     d'un anneau d'inflation (qui tuerait la densité — masterplan §3.5) ;
 *   - l'anneau rendu reste SIMPLE (aucune arête neuve ne croise le contour),
 *     et quand il ne peut pas l'être, la réserve est refusée avec sa raison
 *     plutôt que livrée auto-intersectante (piège #2c) ;
 *   - avec la réserve, la distance entre deux pièces voisines placées à
 *     l'espacement est MESURÉE : l'amorce ne perce plus dans la voisine.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseSheetCamJob } from '../../shared/sheetcamJob'
import {
    DEFAULT_KERF_SAFETY_MM,
    DEFAULT_PIERCE_MARGIN_MM,
    START_CORNERS,
    convexHull,
    cornerStartIndices,
    holeWithLeadInReserve,
    inwardAt,
    outwardAt,
    partWithReserve,
    pierceDisc,
    pointInRing,
    predictedStartIndex,
    signedArea,
    spacingFromKerf,
    withLeadInReserve,
} from '../../shared/sheetcamReserve'

const SQUARE = [[0, 0], [100, 0], [100, 100], [0, 100]]
// Un L concave, pour éprouver la bissectrice sur un sommet réflexe.
const L_SHAPE = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]]

const ringArea = (ring) => Math.abs(signedArea(ring))
const minDistanceBetween = (a, b) => {
    // Distance arête↔arête, exacte (AGENTS #55 : sommet→arête ne suffit pas).
    const segDist = (p1, p2, q1, q2) => {
        const pointSeg = (p, a, c) => {
            const vx = c[0] - a[0]
            const vy = c[1] - a[1]
            const l2 = vx * vx + vy * vy
            if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
            let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2
            t = Math.max(0, Math.min(1, t))
            return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy))
        }
        return Math.min(
            pointSeg(p1, q1, q2), pointSeg(p2, q1, q2),
            pointSeg(q1, p1, p2), pointSeg(q2, p1, p2),
        )
    }
    let best = Infinity
    for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) {
            const d = segDist(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])
            if (d < best) best = d
        }
    }
    return best
}

describe('J3 — espacement pré-rempli depuis le kerf', () => {
    it('kerf + 2 × sécurité, la règle 3.10 déjà en production', () => {
        expect(spacingFromKerf(1.5)).toBeCloseTo(1.5 + 2 * DEFAULT_KERF_SAFETY_MM, 12)
        expect(spacingFromKerf(1.5, 0.5)).toBe(2.5)
        expect(spacingFromKerf(0, 0)).toBe(0)
    })

    it('lit le kerf du .job du propriétaire', () => {
        const job = parseSheetCamJob(new Uint8Array(fs.readFileSync(
            path.resolve(__dirname, 'fixtures/sheetcam/source.job'))))
        expect(job.kerfWidth).toBe(1.5)
        expect(spacingFromKerf(job.kerfWidth, 0.25)).toBe(2)
    })

    it('ne remplit RIEN quand le .job ne porte pas de kerf exploitable', () => {
        for (const bad of [null, undefined, '', 'abc', -1, NaN]) {
            expect(spacingFromKerf(bad)).toBeNull()
        }
        expect(spacingFromKerf(1.5, -1)).toBeNull()
    })
})

describe('J3 — le point de départ prédit', () => {
    it('suit le coin désigné par Start position', () => {
        // 0 = bas gauche, 2 = haut droite (table à confirmer en SheetCam).
        expect(START_CORNERS[0]).toBe('bottom-left')
        expect(predictedStartIndex(SQUARE, 0)).toBe(0)   // (0,0)
        expect(predictedStartIndex(SQUARE, 1)).toBe(1)   // (100,0)
        expect(predictedStartIndex(SQUARE, 2)).toBe(2)   // (100,100)
        expect(predictedStartIndex(SQUARE, 3)).toBe(3)   // (0,100)
    })

    it('retombe sur la plus longue arête droite quand le coin est inconnu', () => {
        // Règle par DÉFAUT du masterplan §3.5 — elle ne dépend d'aucune
        // convention SheetCam, donc elle est sûre.
        const ring = [[0, 0], [10, 0], [10, 5], [0, 5]]
        expect(predictedStartIndex(ring, null)).toBe(0) // arête 0→1, 10 mm
        expect(predictedStartIndex([[0, 0], [3, 0], [3, 50], [0, 50]], 99)).toBe(1)
    })

    it('le repli est DISCRIMINANT : un coin absent ne vaut pas le coin 0', () => {
        // Le verrou ci-dessus passait par coïncidence : sur un rectangle
        // 10 × 5, le coin bas gauche ET le début de la plus longue arête
        // donnent tous deux l'index 0, donc il ne distinguait pas les deux
        // règles — et `Number(null) === 0` faisait bel et bien prendre le
        // coin 0. Sur un rectangle 3 × 50 les deux règles DIVERGENT : coin
        // bas gauche = 0, plus longue arête (1→2, 50 mm) = 1.
        const tall = [[0, 0], [3, 0], [3, 50], [0, 50]]
        expect(predictedStartIndex(tall, 0)).toBe(0)          // coin demandé
        expect(predictedStartIndex(tall, null)).toBe(1)       // coin absent ⇒ repli
        expect(predictedStartIndex(tall, undefined)).toBe(1)  // idem
    })

    it('sort du polygone, même sur un sommet réflexe', () => {
        for (const [ring, index] of [[SQUARE, 0], [L_SHAPE, 3]]) {
            const dir = outwardAt(ring, index)
            const p = ring[index]
            const out = [p[0] + dir[0] * 0.5, p[1] + dir[1] * 0.5]
            expect(pointInRing(out, ring)).toBe(false)
        }
        // Le sommet 3 du L EST le sommet réflexe : la bissectrice naïve y
        // pointerait vers l'intérieur.
        expect(pointInRing([40.5, 40.5], L_SHAPE)).toBe(false)
    })
})

describe('J3 — le disque de perçage', () => {
    it('est CIRCONSCRIT : jamais moins que le rayon demandé', () => {
        const disc = pierceDisc([0, 0], 3)
        const radii = disc.map((p) => Math.hypot(p[0], p[1]))
        expect(Math.min(...radii)).toBeGreaterThanOrEqual(3)
        expect(Math.max(...radii)).toBeLessThan(3 * 1.01)
        expect(disc).toHaveLength(32)
    })

    it('a le défaut de 3 mm, à confirmer sur la machine', () => {
        expect(DEFAULT_PIERCE_MARGIN_MM).toBe(3)
    })
})

describe('J3 — la réserve est locale, dehors, et simple', () => {
    const res = withLeadInReserve(SQUARE, { startPosition: 0, leadIn: 5, pierceMarginMm: 3 })

    it('s’applique et garde le contour d’origine autour', () => {
        expect(res.applied).toBe(true)
        expect(res.startIndex).toBe(0)
        // Les trois autres sommets du carré sont intacts.
        for (const p of [[100, 0], [100, 100], [0, 100]]) {
            expect(res.ring.some((q) => q[0] === p[0] && q[1] === p[1])).toBe(true)
        }
    })

    it('met le disque de perçage DEHORS, entier', () => {
        // Le perçage est au début de l'amorce : à 5 mm du contour.
        const d = Math.hypot(res.pierceAt[0] - 0, res.pierceAt[1] - 0)
        expect(d).toBeCloseTo(5, 9)
        expect(pointInRing(res.pierceAt, SQUARE)).toBe(false)
        // Et la MARGE PROMISE (3 mm) est entièrement couverte par l'anneau
        // rendu. On l'échantillonne un cheveu en dedans : les sommets du
        // polygone CIRCONSCRIT, eux, sont SUR le bord, et « dedans » n'a pas
        // de sens sur un bord (lancer de rayon).
        for (const p of pierceDisc(res.pierceAt, 3 * (1 - 1e-9))) {
            expect(pointInRing(p, res.ring)).toBe(true)
        }
    })

    it('est LOCALE : l’aire ajoutée est celle d’un appendice, pas d’un anneau', () => {
        const before = ringArea(SQUARE)
        const after = ringArea(res.ring)
        const added = after - before
        // Un anneau d'inflation de 5+3 mm sur un carré de 100 ajouterait
        // ~4 × 100 × 8 = 3 200 mm². L'appendice en ajoute 238 (MESURÉ), soit
        // 13 fois moins et 2,4 % de la pièce — c'est tout l'enjeu du
        // masterplan §3.5 (« pas d'anneau complet, qui tuerait la densité »).
        expect(added).toBeGreaterThan(0)
        expect(added).toBeCloseTo(238.2, 0)
        expect(added).toBeLessThan(0.03 * before)
        expect(added).toBeLessThan(3200 / 10)
    })

    it('rend un anneau SIMPLE (aucune arête neuve ne croise le contour)', () => {
        const r = res.ring
        const crosses = (a1, a2, b1, b2) => {
            const s = (p, q, o) => Math.sign((q[0] - p[0]) * (o[1] - p[1])
                - (q[1] - p[1]) * (o[0] - p[0]))
            return s(a1, a2, b1) * s(a1, a2, b2) < 0 && s(b1, b2, a1) * s(b1, b2, a2) < 0
        }
        let bad = 0
        for (let i = 0; i < r.length; i++) {
            for (let j = i + 2; j < r.length; j++) {
                if (i === 0 && j === r.length - 1) continue
                if (crosses(r[i], r[(i + 1) % r.length], r[j], r[(j + 1) % r.length])) bad++
            }
        }
        expect(bad).toBe(0)
    })

    it('marche aussi sur une pièce concave', () => {
        const l = withLeadInReserve(L_SHAPE, { startPosition: 1, leadIn: 4, pierceMarginMm: 3 })
        expect(l.applied).toBe(true)
        expect(pointInRing(l.pierceAt, L_SHAPE)).toBe(false)
        expect(ringArea(l.ring) - ringArea(L_SHAPE)).toBeLessThan(120)
    })
})

describe('J3 — la réserve refuse plutôt que de livrer une géométrie fausse', () => {
    it('refuse quand le sommet est avalé par le disque', () => {
        // Amorce plus courte que la marge de perçage : il n'y a plus de
        // sommet à épingler proprement.
        const r = withLeadInReserve(SQUARE, { leadIn: 1, pierceMarginMm: 5 })
        expect(r.applied).toBe(false)
        expect(r.reason).toBe('vertexInsideDisc')
        expect(r.ring).toBe(SQUARE) // l'anneau d'origine, INTACT
    })

    it('refuse quand la réserve traverserait le contour', () => {
        // Un C ouvert à droite. Épinglée sur le sommet RÉFLEXE du fond de la
        // gorge, une amorce assez longue ressort à travers le bras d'en face.
        // (`startIndex` permet d'épingler : un appelant qui SAIT où part
        // l'amorce n'a pas à passer par la prédiction.)
        const C = [[0, 0], [100, 0], [100, 30], [30, 30], [30, 70],
            [100, 70], [100, 100], [0, 100]]
        const ok = withLeadInReserve(C, { startIndex: 3, leadIn: 10, pierceMarginMm: 5 })
        expect(ok.applied).toBe(true) // 10 mm : encore dans la gorge
        const r = withLeadInReserve(C, { startIndex: 3, leadIn: 60, pierceMarginMm: 20 })
        expect(r.applied).toBe(false)
        expect(r.reason).toBe('reserveCrossesContour')
        expect(r.ring).toBe(C)
    })

    it('ne fait rien quand il n’y a rien à réserver', () => {
        const r = withLeadInReserve(SQUARE, { leadIn: 0, pierceMarginMm: 0 })
        expect(r.applied).toBe(false)
        expect(r.reason).toBe('nothingToReserve')
        expect(withLeadInReserve([[0, 0], [1, 1]], { leadIn: 5 }).reason).toBe('ringTooSmall')
    })
})

describe('J3 — l’amorce ne perce plus dans la voisine', () => {
    it('deux carrés à 2 mm : sans réserve le perçage tombe DANS la voisine', () => {
        // Le cas du masterplan §3.5, mesuré. L'amorce part du MILIEU du bord
        // droit (un sommet y est présent : nos anneaux importés en ont
        // partout), donc elle sort à l'horizontale — droit sur la voisine.
        const SPACE = 2
        const a = [[0, 0], [100, 0], [100, 50], [100, 100], [0, 100]]
        const reserved = withLeadInReserve(a, {
            startIndex: 2, leadIn: 5, pierceMarginMm: 3,
        })
        expect(reserved.applied).toBe(true)
        // Le perçage est à 5 mm du bord, à l'horizontale.
        expect(reserved.pierceAt[0]).toBeCloseTo(105, 9)
        expect(reserved.pierceAt[1]).toBeCloseTo(50, 9)

        // 1) AVANT : la voisine est posée à l'espacement du CONTOUR RÉEL.
        const before = a.map((p) => [p[0] + 100 + SPACE, p[1]])
        expect(minDistanceBetween(a, before)).toBeCloseTo(SPACE, 9)
        // Le perçage prédit est DANS la voisine — le défaut, chiffré : il
        // mord de 3,5 mm dans la matière d'à côté.
        expect(pointInRing(reserved.pierceAt, before)).toBe(true)
        expect(105 + 3 - (100 + SPACE)).toBeCloseTo(6, 9)

        // 2) APRÈS : la voisine est posée à l'espacement de la pièce
        //    RÉSERVÉE — c'est elle que le nesting voit.
        const maxX = Math.max(...reserved.ring.map((p) => p[0]))
        const after = a.map((p) => [p[0] + maxX + SPACE, p[1]])
        expect(minDistanceBetween(reserved.ring, after)).toBeGreaterThanOrEqual(SPACE - 1e-9)
        // Et le disque de perçage garde l'espacement lui aussi : il est
        // INCLUS dans la pièce réservée, donc protégé par construction.
        expect(minDistanceBetween(pierceDisc(reserved.pierceAt, 3), after))
            .toBeGreaterThanOrEqual(SPACE - 1e-9)
        expect(pointInRing(reserved.pierceAt, after)).toBe(false)

        // Le prix payé : la voisine s'écarte de l'amorce + le perçage, pas
        // plus (l'appendice est local).
        const cost = maxX - 100
        expect(cost).toBeGreaterThanOrEqual(5 + 3)
        expect(cost).toBeLessThan(5 + 3 + 0.1)
    })
})

describe('J3 — la pièce entière', () => {
    it('réserve le contour, laisse les trous, et dit ce qu’elle a fait', () => {
        const part = {
            coordinates: SQUARE,
            holes: [[[40, 40], [60, 40], [60, 60], [40, 60]]],
            width: 100,
            height: 100,
        }
        const out = partWithReserve(part, { startPosition: 0, leadIn: 5, pierceMarginMm: 3 })
        expect(out.reserve.applied).toBe(true)
        expect(out.reserve.pierceMarginMm).toBe(3)
        expect(out.reserve.leadIn).toBe(5)
        expect(out.width).toBe(100)           // champs additifs préservés
        expect(out.coordinates.length).toBeGreaterThan(SQUARE.length)
        // CE VERROU A CHANGÉ AU LOT J4, et il faut dire pourquoi. Il exigeait
        // `out.holes === part.holes` (« les trous ne bougent pas »), au motif
        // que la place dans un trou était prise par la matière de la pièce.
        // La recette ouverte dans SheetCam le 13/09 a montré le contraire :
        // l'amorce du contour du trou part VERS L'INTÉRIEUR du trou et coupe
        // les pièces qu'on y a nichées. Le trou est donc mordu, lui aussi.
        expect(out.holes).not.toEqual(part.holes)
        expect(out.reserve.holes[0].applied).toBe(true)
        expect(out.reserve.holesDropped).toBe(0)
    })

    it('laisse la pièce intacte quand la réserve est refusée', () => {
        const part = { coordinates: SQUARE, holes: [] }
        const out = partWithReserve(part, { leadIn: 0, pierceMarginMm: 0 })
        expect(out.reserve.applied).toBe(false)
        expect(out.coordinates).toBe(SQUARE)
    })
})

// ---------------------------------------------------------------------------
// Lot J4 — la réserve d'amorce d'un TROU.
//
// Le lot J3 affirmait qu'un trou n'en avait pas besoin. La recette ouverte
// dans SheetCam le 13/09 l'a démenti : l'amorce du contour du trou part vers
// l'intérieur du trou, du côté chute, et coupe les pièces qu'on y a nichées.
// Ce qui est MESURÉ ici, et pas seulement affirmé :
//   - le disque de perçage et tout le couloir d'amorce sortent de la zone
//     libre — c'est la promesse, et elle est vérifiée point par point ;
//   - la morsure coûte 1 % de l'aire du trou, pas 40 % (contrôle chiffré
//     contre la couronne intérieure complète, la solution paresseuse) ;
//   - l'anneau rendu reste SIMPLE, et quand il ne peut pas l'être la réserve
//     est refusée, le trou retiré du nesting, la raison dite ;
//   - la géométrie du trou de la RECETTE (cercle r = 35) sert de cas réel.
// ---------------------------------------------------------------------------

/** Cercle discrétisé — la forme du trou de `Piece_Trou.DXF` (r = 35, centré). */
const circleRing = (r, n = 64, cx = 0, cy = 0) => Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
})
const RECIPE_HOLE = circleRing(35)

/** Nombre de croisements PROPRES entre arêtes non adjacentes. */
const selfCrossings = (ring) => {
    const n = ring.length
    const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    const crosses = (p1, p2, p3, p4) => {
        const d1 = d(p3, p4, p1); const d2 = d(p3, p4, p2)
        const d3 = d(p1, p2, p3); const d4 = d(p1, p2, p4)
        return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
            && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
    }
    let bad = 0
    for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue
            if (crosses(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) bad++
        }
    }
    return bad
}

describe('J4 — la réserve d’amorce d’un TROU', () => {
    const leadIn = 5
    const margin = 3

    it('sort le perçage ET tout le couloir d’amorce de la zone libre', () => {
        const out = holeWithLeadInReserve(RECIPE_HOLE, { leadIn, pierceMarginMm: margin })
        expect(out.applied).toBe(true)
        expect(out.bites).toBe(4)

        for (const centre of out.pierceAt) {
            // Le disque est CIRCONSCRIT : on le teste juste en deçà de son
            // rayon pour ne pas mesurer la tangence, qui est le cas normal.
            const disc = pierceDisc(centre, margin - 1e-6)
            const inside = disc.filter((p) => pointInRing(p, out.ring)).length
            expect(inside).toBe(0)

            // Et le couloir : du bord du trou jusqu'au centre de perçage.
            const edge = [centre[0] * 35 / Math.hypot(...centre), centre[1] * 35 / Math.hypot(...centre)]
            for (let t = 0; t <= 1; t += 0.02) {
                const p = [edge[0] + (centre[0] - edge[0]) * t, edge[1] + (centre[1] - edge[1]) * t]
                expect(pointInRing(p, out.ring)).toBe(false)
            }
        }
    })

    it('coûte 1 % du trou, pas 40 % : la morsure contre la couronne', () => {
        // Le contrôle qui justifie la FORME. Une couronne intérieure de
        // largeur `amorce + perçage` serait sûre elle aussi, et dix fois plus
        // chère — c'est le repli qu'on a refusé.
        const before = ringArea(RECIPE_HOLE)
        const one = holeWithLeadInReserve(RECIPE_HOLE, {
            leadIn, pierceMarginMm: margin, startPosition: 0, startPositionConfirmed: true,
        })
        const four = holeWithLeadInReserve(RECIPE_HOLE, { leadIn, pierceMarginMm: margin })
        const costOne = 1 - ringArea(one.ring) / before
        const costFour = 1 - ringArea(four.ring) / before
        const couronne = 1 - (Math.PI * (35 - leadIn - margin) ** 2) / before

        expect(one.bites).toBe(1)
        expect(costOne).toBeLessThan(0.02)      // ≈ 1,1 %
        expect(costFour).toBeLessThan(0.06)     // ≈ 4,6 %
        expect(couronne).toBeGreaterThan(0.35)  // ≈ 40 %
        expect(costFour).toBeLessThan(couronne / 5)
    })

    it('rend un anneau SIMPLE, et l’aire BAISSE', () => {
        // Contrôle négatif du défaut de conception écarté : retourner
        // simplement la direction de l'appendice J3 faisait MONTER l'aire
        // (3 842 → 3 868 mm²), preuve que le tour ré-enfermait la zone.
        const out = holeWithLeadInReserve(RECIPE_HOLE, { leadIn, pierceMarginMm: margin })
        expect(selfCrossings(out.ring)).toBe(0)
        expect(ringArea(out.ring)).toBeLessThan(ringArea(RECIPE_HOLE))
    })

    it('les quatre candidats ne dépendent d’aucune table non confirmée', () => {
        // La correspondance `Start position` → coin n'est pas mesurée sur la
        // machine : on réserve les quatre coins, donc la réserve est juste
        // quelle que soit la table.
        const corners = cornerStartIndices(RECIPE_HOLE)
        expect(corners).toHaveLength(4)
        expect(new Set(corners).size).toBe(4)
        for (const k of [0, 1, 2, 3]) {
            expect(corners).toContain(predictedStartIndex(RECIPE_HOLE, k))
        }
    })

    it('tient pour TOUTE longueur d’amorce, zéro compris (lot J4-bis)', () => {
        // Mes verrous d'origine n'essayaient QUE `amorce = 5`. À `amorce = 0`
        // — une opération sans amorce, `Lead in type = 0`, cas réel — la
        // morsure était doublement fausse : elle refusait d'abord
        // (`mouthInsideDisc`, les deux lèvres de la bouche tombant dans le
        // disque centré sur le bord), et le trou entier sortait du nesting ;
        // et quand on élargissait la bouche, elle s'appliquait en
        // n'excluant RIEN — l'aire du trou MONTAIT de 2,1 % et les 32 sommets
        // du disque restaient dans la zone libre. S'appliquer sans exclure
        // est pire qu'un refus.
        //
        // Ce que le balayage mesure, pour chaque longueur : l'aire BAISSE,
        // l'anneau reste simple, et la moitié INTÉRIEURE du disque réel de la
        // torche — celui centré à `amorce` du bord, pas celui qu'on dessine —
        // est entièrement hors de la zone libre.
        const before = ringArea(RECIPE_HOLE)
        for (const lead of [0, 0.5, 1, 2, 3, 5, 8]) {
            const out = holeWithLeadInReserve(RECIPE_HOLE, { leadIn: lead, pierceMarginMm: margin })
            expect(out.applied, `amorce ${lead}`).toBe(true)
            expect(ringArea(out.ring), `amorce ${lead} : l'aire doit BAISSER`)
                .toBeLessThan(before)
            expect(selfCrossings(out.ring), `amorce ${lead}`).toBe(0)
            for (const centre of out.pierceAt) {
                // Le disque RÉEL : centré à `lead` du bord, sur le rayon qui
                // porte la morsure.
                const d = Math.hypot(...centre)
                const edge = [centre[0] * 35 / d, centre[1] * 35 / d]
                const real = [edge[0] * (1 - lead / 35), edge[1] * (1 - lead / 35)]
                for (const p of pierceDisc(real, margin - 1e-6)) {
                    // Seule la moitié intérieure au trou nous concerne :
                    // l'autre est dans la matière de l'hôte.
                    if (Math.hypot(...p) >= 35) continue
                    expect(pointInRing(p, out.ring), `amorce ${lead}`).toBe(false)
                }
            }
        }
    })

    it('refuse plutôt que d’inventer : trou trop petit, anneau intact', () => {
        const tiny = circleRing(3, 24)
        const out = holeWithLeadInReserve(tiny, { leadIn, pierceMarginMm: margin })
        expect(out.applied).toBe(false)
        expect(out.reason).toBeTruthy()
        expect(out.ring).toBe(tiny)        // l'anneau d'ENTRÉE, pas une copie
        expect(out.bites).toBe(0)
    })

    it('sans amorce ni perçage déclarés, le trou reste entier', () => {
        const out = holeWithLeadInReserve(RECIPE_HOLE, { leadIn: 0, pierceMarginMm: 0 })
        expect(out.applied).toBe(false)
        expect(out.reason).toBe('nothingToReserve')
        expect(out.ring).toBe(RECIPE_HOLE)
    })

    it('un trou dont la réserve est refusée est RETIRÉ du nesting', () => {
        // La dégradation sûre : plutôt que de nicher dans un trou dont on ne
        // sait pas où passe l'amorce, on n'y niche pas du tout — et on le dit.
        const part = {
            coordinates: [[-50, -50], [50, -50], [50, 50], [-50, 50]],
            holes: [RECIPE_HOLE, circleRing(3, 24)],
        }
        const out = partWithReserve(part, { startPosition: 0, leadIn, pierceMarginMm: margin })
        expect(out.holes).toHaveLength(1)
        expect(out.reserve.holesDropped).toBe(1)
        expect(out.reserve.holes[1].dropped).toBe(true)
        expect(out.reserve.holes[1].reason).toBeTruthy()
        // Le contour extérieur, lui, a bien reçu son appendice J3.
        expect(out.reserve.applied).toBe(true)
    })

    it('la réserve rend l’anneau dans la MÊME convention de fermeture', () => {
        // LE VERROU LE PLUS CHER DU LOT, et il ne ressemble à rien.
        //
        // Le calcul interne travaille sur des anneaux OUVERTS ; tout le reste
        // du pipeline les attend FERMÉS (point de fermeture dupliqué). La
        // validation physique du rapport wasm balaie ses arêtes par
        // `for i in 0..ring.len() - 1` : sur un anneau ouvert l'arête de
        // fermeture n'existe pas pour elle, et son test d'appartenance
        // devient FAUX — elle déclare des contenances qui n'existent pas,
        // donc des chevauchements qui n'existent pas.
        //
        // Mesuré le 13/09 dans le navigateur : le lot rendait des anneaux
        // ouverts et le job 1 hôte + 4 éventails partait en « toutes les
        // options rejetées par la validation physique », alors que la mesure
        // arête↔arête des mêmes poses donnait 3,501 mm pour 3,500 exigés.
        // A/B : `Lead in=0` ⇒ aboutit ; réserve sur l'hôte seul ⇒ aboutit ;
        // réserve sur les quatre éventails ⇒ refusé. Le défaut dormait depuis
        // le lot J3, qui n'avait aucun appelant.
        const closed = (r) => r.length > 1
            && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]
        const SQ_CLOSED = [...SQUARE, [SQUARE[0][0], SQUARE[0][1]]]
        const HOLE_CLOSED = [...RECIPE_HOLE, [RECIPE_HOLE[0][0], RECIPE_HOLE[0][1]]]
        const opts = { startPosition: 0, leadIn, pierceMarginMm: margin }

        // Entrée FERMÉE ⇒ sortie FERMÉE, contour comme trou.
        const outer = withLeadInReserve(SQ_CLOSED, opts)
        expect(outer.applied).toBe(true)
        expect(closed(outer.ring)).toBe(true)
        const hole = holeWithLeadInReserve(HOLE_CLOSED, opts)
        expect(hole.applied).toBe(true)
        expect(closed(hole.ring)).toBe(true)

        // Et la pièce entière, qui est ce que le nesting consomme.
        const part = partWithReserve(
            { coordinates: SQ_CLOSED, holes: [HOLE_CLOSED] }, opts,
        )
        expect(closed(part.coordinates)).toBe(true)
        expect(closed(part.holes[0])).toBe(true)

        // Entrée OUVERTE ⇒ sortie OUVERTE : on ne CHOISIT pas une convention,
        // on rend celle qu'on a reçue.
        expect(closed(withLeadInReserve(SQUARE, opts).ring)).toBe(false)
        expect(closed(holeWithLeadInReserve(RECIPE_HOLE, opts).ring)).toBe(false)

        // Le point de fermeture ne doit pas être compté comme un sommet de
        // plus par la géométrie : l'aire ne bouge pas.
        expect(ringArea(outer.ring)).toBeCloseTo(ringArea(withLeadInReserve(SQUARE, opts).ring), 9)
    })

    it('la direction entrante est bien l’opposée de la sortante', () => {
        for (const [ring, index] of [[SQUARE, 0], [L_SHAPE, 3]]) {
            const out = outwardAt(ring, index)
            const inw = inwardAt(ring, index)
            expect(inw[0]).toBeCloseTo(-out[0], 12)
            expect(inw[1]).toBeCloseTo(-out[1], 12)
        }
    })
})

describe('J3 — briques', () => {
    it('convexHull est déterministe et rend un tour convexe', () => {
        const hull = convexHull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]])
        expect(hull).toHaveLength(4)
        expect(signedArea(hull)).toBeGreaterThan(0)
        expect(convexHull([[0, 0], [1, 1]])).toHaveLength(2)
    })

    it('signedArea et pointInRing disent le sens et le dedans', () => {
        expect(signedArea(SQUARE)).toBe(10000)
        expect(signedArea(SQUARE.slice().reverse())).toBe(-10000)
        expect(pointInRing([50, 50], SQUARE)).toBe(true)
        expect(pointInRing([150, 50], SQUARE)).toBe(false)
        // Fermeture dupliquée tolérée (nos anneaux en portent une).
        expect(signedArea([...SQUARE, [0, 0]])).toBe(10000)
    })
})
