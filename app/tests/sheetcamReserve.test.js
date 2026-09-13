/**
 * Verrous de la réserve d'amorce — lots J3, J4 puis **J4-bis-2**
 * (`docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §8 puis §9.42).
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE FICHIER MET À L'ÉPREUVE, ET POURQUOI IL A CHANGÉ DE FOND EN COMBLE.
 *
 * Les lots J3 et J4 PRÉDISAIENT le point de départ d'un contour à partir de la
 * clé `Start position` et d'une table de coins supposée. Leurs verrous étaient
 * verts et la prémisse était fausse : `Start position` est le coin d'où part
 * la SÉQUENCE de coupe, et le point de départ d'un contour est écrit dans le
 * bloc binaire du `.job`.
 *
 * Le verrou central est donc désormais une MESURE, pas une construction : on
 * prend les fixtures de la série `retro-eng-job` — le DXF `Pièce L`, deux
 * `.job` et les deux `.nc` que SheetCam en a tirés —, on échantillonne les
 * TRAJETS D'AMORCE RÉELS du G-code, et on exige qu'aucun de ces points ne
 * reste dans la zone où NestorCut accepterait de poser une pièce.
 *
 * Quatre types d'amorce sont couverts (None, Arc, Tangent, Perpendicular) par
 * le jeu de longueurs et de types que porte la série ; les deux fixtures
 * commises dans le dépôt portent « None » et « Arc ».
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseSheetCamJob, jobPathRecords } from '../../shared/sheetcamJob'
import {
    ARC_RADIUS_FACTOR,
    DEFAULT_KERF_SAFETY_MM,
    DEFAULT_PIERCE_MARGIN_MM,
    LEAD_ARC,
    LEAD_NONE,
    LEAD_PERPENDICULAR,
    LEAD_TANGENT,
    START_MATCH_TOL_MM,
    biteAtStart,
    convexHull,
    leadPathLocal,
    matchStartsToRings,
    nearestOnRing,
    partWithReserve,
    pierceDisc,
    pointInRing,
    signedArea,
    spacingFromKerf,
} from '../../shared/sheetcamReserve'

const FIX = path.resolve(__dirname, 'fixtures/sheetcam')

// Le dessin de la série, relu sur le G-code : le chemin d'outil est le
// contour décalé de kerf/2 = 0,75, donc le contour extérieur va de (0 ; 0) à
// (180 ; 200) en L, et le trou rectangulaire de (10 ; 90) à (40 ; 190).
const L_OUTER = [[0, 0], [180, 0], [180, 50], [50, 50], [50, 200], [0, 200], [0, 0]]
const L_HOLE = [[10, 90], [40, 90], [40, 190], [10, 190], [10, 90]]
// Le point de départ du trou et celui du contour extérieur, tels que le bloc
// binaire les donne (relatifs au centre de boîte (90 ; 100)).
const HOLE_START = [25, 90]
const OUTER_START = [0, 0]
const KERF = 1.5

const splitLines = (text) => String(text).split('\n').map((line) => line.replace(/\r$/, ''))

/**
 * Les trajets d'amorce d'un `.nc`, échantillonnés.
 *
 * Un trajet commence par `G0X..Y..` (le perçage) + `G0Z3.8` + le plongeon
 * `G1…Z1.5`. On garde le perçage, l'entrée (premier mouvement de coupe) et la
 * sortie (dernier mouvement du trajet), les arcs `G2`/`G3` étant redéveloppés
 * depuis leur centre `I`/`J` — un arc échantillonné par sa corde seulement
 * serait un test plus faible que la réalité.
 */
function ncLeadSamples(text, { hasLead = true } = {}) {
    const lines = splitLines(text).map((line) => line.trim())
    const paths = []
    let cur = null
    for (let i = 0; i < lines.length; i++) {
        const g0 = /^G0X(-?[\d.]+)Y(-?[\d.]+)$/.exec(lines[i])
        if (g0 && lines[i + 1] === 'G0Z3.8') {
            cur = { pierce: [Number(g0[1]), Number(g0[2])], moves: [] }
            paths.push(cur)
            continue
        }
        if (!cur) continue
        if (/^G0Z10/.test(lines[i])) { cur = null; continue }
        const mv = /^G([0123])X(-?[\d.]+)Y(-?[\d.]+)(?:I(-?[\d.]+)J(-?[\d.]+))?/.exec(lines[i])
        if (mv) {
            cur.moves.push({
                to: [Number(mv[2]), Number(mv[3])],
                ij: mv[4] === undefined ? null : [Number(mv[4]), Number(mv[5])],
                cw: mv[1] === '2',
            })
        }
    }
    const arc = (from, move) => {
        const c = [from[0] + move.ij[0], from[1] + move.ij[1]]
        const r = Math.hypot(from[0] - c[0], from[1] - c[1])
        const a0 = Math.atan2(from[1] - c[1], from[0] - c[0])
        const a1 = Math.atan2(move.to[1] - c[1], move.to[0] - c[0])
        let da = a1 - a0
        if (move.cw) { while (da > 0) da -= 2 * Math.PI } else { while (da < 0) da += 2 * Math.PI }
        const out = []
        for (let k = 0; k <= 6; k++) {
            const a = a0 + (da * k) / 6
            out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)])
        }
        return out
    }
    return paths.map((p) => {
        const pts = [p.pierce]
        // TYPE « NONE » : il n'y a NI amorce d'entrée NI amorce de sortie — la
        // torche perce sur le contour et le quitte sur le contour. Les
        // mouvements voisins sont donc du CONTOUR, pas de l'amorce, et les
        // échantillonner ferait échouer le verrou sur des points que la
        // réserve n'a aucune raison d'exclure.
        if (!hasLead) return pts
        // Le premier mouvement est le plongeon (même XY) ; le deuxième est
        // l'amorce d'entrée.
        const first = p.moves[1]
        if (first) pts.push(...(first.ij ? arc(p.pierce, first) : [first.to]))
        const last = p.moves[p.moves.length - 1]
        const prev = p.moves[p.moves.length - 2]
        if (last && prev) pts.push(...(last.ij ? arc(prev.to, last) : [last.to]))
        return pts
    })
}

describe('J4-bis-2 — la règle d’espacement d’un `.job`', () => {
    it('2 × kerf + sécurité, la règle du 13/09 (§9.40)', () => {
        // La bande de kerf est centrée sur le chemin d'outil, lui-même à
        // kerf/2 du contour : elle déborde d'un KERF ENTIER hors de la pièce.
        expect(DEFAULT_KERF_SAFETY_MM).toBe(1)
        expect(spacingFromKerf(1.5)).toBe(4)
        expect(spacingFromKerf(1.5, 0.5)).toBe(3.5)
        expect(spacingFromKerf(0, 0)).toBe(0)
    })

    it('lit le kerf du `.job` de la série', () => {
        const job = parseSheetCamJob(new Uint8Array(
            fs.readFileSync(path.join(FIX, 'piece-l-none-default.job')),
        ))
        expect(job.kerfWidth).toBe(1.5)
        expect(spacingFromKerf(job.kerfWidth)).toBe(4)
    })

    it('ne remplit RIEN quand le `.job` ne porte pas de kerf exploitable', () => {
        for (const bad of [null, undefined, '', 'abc', NaN, -1]) {
            expect(spacingFromKerf(bad)).toBeNull()
        }
        expect(spacingFromKerf(1.5, -1)).toBeNull()
    })
})

describe('J4-bis-2 — la géométrie des amorces, contre le G-code', () => {
    it('les quatre formes sont celles mesurées sur les `.nc`', () => {
        // Repère local (t = sens de coupe, n = vers la chute), longueur 5.
        expect(leadPathLocal(LEAD_NONE, 5, -1).far).toEqual([0, 0])
        expect(leadPathLocal(LEAD_PERPENDICULAR, 5, -1).far).toEqual([0, 5])
        // Arc : quart de cercle de rayon 0,64 × L, du perçage (−r ; r).
        const r = ARC_RADIUS_FACTOR * 5
        const arcIn = leadPathLocal(LEAD_ARC, 5, -1).far
        expect(arcIn[0]).toBeCloseTo(-r, 9)
        expect(arcIn[1]).toBeCloseTo(r, 9)
        const arcOut = leadPathLocal(LEAD_ARC, 10, +1).far
        expect(arcOut[0]).toBeCloseTo(ARC_RADIUS_FACTOR * 10, 9)
        // Tangente : l'ÉVENTAIL complet, de 0° à 22,5° vers la chute — la
        // règle qui choisit l'angle n'est pas mesurée (0° sur un coin, 22,5°
        // à l'entrée au milieu d'une arête, 11,25° à la sortie), on réserve
        // donc les deux extrêmes plutôt que de parier.
        const tan = leadPathLocal(LEAD_TANGENT, 5, -1)
        expect(tan.points).toHaveLength(3)
        expect(tan.points[1]).toEqual([-5, 0])
        expect(tan.points[2][0]).toBeCloseTo(-5 * Math.cos(Math.PI / 8), 9)
        expect(tan.points[2][1]).toBeCloseTo(5 * Math.sin(Math.PI / 8), 9)
    })

    it('reproduit le perçage du G-code au micron (trou, amorce en arc)', () => {
        // `Pièce L`, trou rectangulaire, kerf 1,5, amorce en arc de 5 :
        // SheetCam perce en (28,200 ; 93,950). C'est le chiffre du `.nc`.
        const res = biteAtStart(L_HOLE, {
            start: HOLE_START,
            scrapInside: true,
            leadIn: 5,
            leadInType: LEAD_ARC,
            leadOut: 10,
            leadOutType: LEAD_ARC,
            kerf: KERF,
            pierceMarginMm: 3,
        })
        expect(res.applied).toBe(true)
        expect(res.pierceAt[0]).toBeCloseTo(28.2, 6)
        expect(res.pierceAt[1]).toBeCloseTo(93.95, 6)
    })

    it('reproduit le perçage du G-code au micron (extérieur, perpendiculaire)', () => {
        // Départ au COIN (0 ; 0), coupe vers +x, chute vers −y : le perçage
        // du `.nc` est en (0 ; −5,75) = −(5 + kerf/2) sur y.
        const res = biteAtStart(L_OUTER, {
            start: OUTER_START,
            scrapInside: false,
            leadIn: 5,
            leadInType: LEAD_PERPENDICULAR,
            leadOut: 10,
            leadOutType: LEAD_PERPENDICULAR,
            kerf: KERF,
            pierceMarginMm: 3,
        })
        expect(res.applied).toBe(true)
        expect(res.pierceAt[0]).toBeCloseTo(0, 6)
        expect(res.pierceAt[1]).toBeCloseTo(-5.75, 6)
    })
})

describe('J4-bis-2 — LE verrou : le trajet réel ne traverse plus la zone utile', () => {
    // Les deux fixtures commises, avec le type d'amorce que chacune déclare.
    const CASES = [
        ['piece-l-none-default', LEAD_NONE],
        ['piece-l-45deg', LEAD_ARC],
    ]

    for (const [name, type] of CASES) {
        it(`${name} : chaque point du trajet d’amorce est réservé`, () => {
            const job = parseSheetCamJob(new Uint8Array(
                fs.readFileSync(path.join(FIX, `${name}.job`)),
            ))
            const op = job.parts[0].operations[0]
            expect(op.leadInType).toBe(type)

            // Le `.nc` est en coordonnées MONDE. Pour le fichier « + 45deg »
            // la pièce y est TOURNÉE : on ramène chaque point dans le repère
            // du dessin par l'inverse de la pose (`XPos, YPos, Angle`, la
            // formule du lot J2 vérifiée dans `sheetcamNest.test.js`). Le
            // fichier droit n'a rien à ramener.
            const p0 = job.parts[0]
            const c0 = [90, 100]
            const toDrawing = (w) => {
                const a = p0.angle // SheetCam tourne le dessin de −Angle
                const dx = w[0] - p0.xPos
                const dy = w[1] - p0.yPos
                return [
                    c0[0] + dx * Math.cos(a) - dy * Math.sin(a),
                    c0[1] + dx * Math.sin(a) + dy * Math.cos(a),
                ]
            }
            const samples = ncLeadSamples(
                fs.readFileSync(path.join(FIX, `${name}.nc`), 'latin1'),
                { hasLead: type !== LEAD_NONE },
            ).map((pts) => pts.map(toDrawing))

            const common = {
                leadIn: op.leadIn,
                leadInType: op.leadInType,
                leadOut: op.leadOut,
                leadOutType: op.leadOutType,
                kerf: job.kerfWidth,
                pierceMarginMm: DEFAULT_PIERCE_MARGIN_MM,
            }
            const hole = biteAtStart(L_HOLE, { start: HOLE_START, scrapInside: true, ...common })
            const outer = biteAtStart(L_OUTER, { start: OUTER_START, scrapInside: false, ...common })
            expect(hole.applied).toBe(true)
            expect(outer.applied).toBe(true)

            // Le `.nc` sort dans l'ORDRE DE COUPE : trou rectangulaire,
            // fuseau, puis contour extérieur (`order` = 0, 1, 2).
            let checked = 0
            for (const p of samples[0]) {
                expect(pointInRing(p, hole.ring)).toBe(false)
                checked += 1
            }
            for (const p of samples[2]) {
                expect(pointInRing(p, outer.ring)).toBe(true)
                checked += 1
            }
            expect(checked).toBeGreaterThanOrEqual(type === LEAD_NONE ? 2 : 18)
        })
    }

    it('CONTRÔLE NÉGATIF : sans réserve, le trajet EST dans la zone utile', () => {
        // Sans ce contrôle, le verrou ci-dessus pourrait passer sur une
        // réserve qui n'exclut rien — c'est exactement le défaut « amorce 0 »
        // du lot J4-bis (l'aire MONTAIT de 2,1 % et 32 sommets du disque de
        // perçage restaient libres).
        const samples = ncLeadSamples(
            fs.readFileSync(path.join(FIX, 'piece-l-none-default.nc'), 'latin1'),
            { hasLead: false },
        )
        const dedans = samples[0].filter((p) => pointInRing(p, L_HOLE)).length
        expect(dedans).toBeGreaterThan(0)
    })

    it('et l’aire de la zone libre BAISSE, celle de la pièce MONTE', () => {
        const common = {
            leadIn: 5, leadInType: LEAD_ARC, leadOut: 10, leadOutType: LEAD_ARC,
            kerf: KERF, pierceMarginMm: 3,
        }
        const hole = biteAtStart(L_HOLE, { start: HOLE_START, scrapInside: true, ...common })
        const outer = biteAtStart(L_OUTER, { start: OUTER_START, scrapInside: false, ...common })
        const a = (r) => Math.abs(signedArea(r))
        // Le prix mesuré : 3,6 % du trou, 0,6 % de la pièce. À comparer aux
        // 40 % qu'aurait coûté une couronne intérieure complète de largeur
        // `amorce + perçage` (§9 de l'étude).
        expect(a(hole.ring)).toBeLessThan(a(L_HOLE))
        expect((a(L_HOLE) - a(hole.ring)) / a(L_HOLE)).toBeLessThan(0.08)
        expect(a(outer.ring)).toBeGreaterThan(a(L_OUTER))
        expect((a(outer.ring) - a(L_OUTER)) / a(L_OUTER)).toBeLessThan(0.03)
    })

    it('rend un anneau SIMPLE, dans la MÊME convention de fermeture', () => {
        // Piège AGENTS #5c : un anneau ouvert fait mentir `nest-report`, qui
        // déclare alors des chevauchements qui n'existent pas — la recette du
        // 13/09 est partie en refus pour cela.
        const closed = (r) => r.length > 1
            && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]
        const common = {
            leadIn: 5, leadInType: LEAD_ARC, leadOut: 10, leadOutType: LEAD_ARC,
            kerf: KERF, pierceMarginMm: 3,
        }
        const hole = biteAtStart(L_HOLE, { start: HOLE_START, scrapInside: true, ...common })
        expect(closed(L_HOLE)).toBe(true)
        expect(closed(hole.ring)).toBe(true)

        const openHole = L_HOLE.slice(0, -1)
        const openRes = biteAtStart(openHole, { start: HOLE_START, scrapInside: true, ...common })
        expect(closed(openRes.ring)).toBe(false)

        // Simple : aucune arête ne croise une autre.
        const r = hole.ring.slice(0, -1)
        const cross = (a1, a2, b1, b2) => {
            const c = (u, v) => u[0] * v[1] - u[1] * v[0]
            const s = (u, v) => [u[0] - v[0], u[1] - v[1]]
            const d1 = c(s(a2, a1), s(b1, a1))
            const d2 = c(s(a2, a1), s(b2, a1))
            const d3 = c(s(b2, b1), s(a1, b1))
            const d4 = c(s(b2, b1), s(a2, b1))
            return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
                && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
        }
        for (let i = 0; i < r.length; i++) {
            for (let j = i + 2; j < r.length; j++) {
                if (i === 0 && j === r.length - 1) continue
                expect(cross(r[i], r[(i + 1) % r.length], r[j], r[(j + 1) % r.length])).toBe(false)
            }
        }
    })
})

describe('J4-bis-2 — l’appariement point de départ ↔ contour', () => {
    it('apparie chaque point au contour qui le porte', () => {
        const rings = [
            { ring: L_OUTER, scrapInside: false },
            { ring: L_HOLE, scrapInside: true },
        ]
        const { perRing, unmatched } = matchStartsToRings([
            { point: HOLE_START }, { point: OUTER_START },
        ], rings)
        expect(unmatched).toHaveLength(0)
        expect(perRing[0]).toHaveLength(1)
        expect(perRing[1]).toHaveLength(1)
        expect(perRing[1][0].point).toEqual(HOLE_START)
    })

    it('nomme ce qui ne tombe sur AUCUN contour plutôt que de le forcer', () => {
        const rings = [{ ring: L_OUTER, scrapInside: false }]
        const { perRing, unmatched } = matchStartsToRings([{ point: [1000, 1000] }], rings)
        expect(perRing[0]).toHaveLength(0)
        expect(unmatched).toHaveLength(1)
        expect(unmatched[0].distanceMm).toBeGreaterThan(START_MATCH_TOL_MM)
    })

    it('la tolérance laisse passer la simplification du pipeline', () => {
        // `NEST_SIMPLIFY_MM` vaut 0,05 : un point lu à 0,01 de son contour
        // d'origine reste apparié après simplification, avec dix fois la marge.
        expect(START_MATCH_TOL_MM).toBe(0.5)
        expect(nearestOnRing([25, 90.04], L_HOLE).d).toBeCloseTo(0.04, 9)
    })

    it('les points de la série tombent SUR leurs contours', () => {
        // Deux des trois contours du dessin sont ici (le fuseau est une
        // ellipse, hors de ce fichier) ; les deux points lus doivent tomber
        // sur eux à la tolérance près.
        const job = parseSheetCamJob(new Uint8Array(
            fs.readFileSync(path.join(FIX, 'piece-l-none-default.job')),
        ))
        const c0 = [90, 100]
        const starts = jobPathRecords(job.binary)[0].paths
            .map((p) => [c0[0] + p.start[0], c0[1] + p.start[1]])
        expect(nearestOnRing(starts[0], L_HOLE).d).toBeLessThan(0.01)
        expect(nearestOnRing(starts[1], L_OUTER).d).toBeLessThan(0.01)
    })
})

describe('J4-bis-2 — la pièce entière, et ce qu’elle refuse', () => {
    const part = { coordinates: L_OUTER, holes: [L_HOLE] }
    const starts = [
        { point: OUTER_START, leadIn: 5, leadInType: LEAD_ARC, leadOut: 10, leadOutType: LEAD_ARC },
        { point: HOLE_START, leadIn: 5, leadInType: LEAD_ARC, leadOut: 10, leadOutType: LEAD_ARC },
    ]

    it('réserve le contour ET le trou, et dit ce qu’elle a fait', () => {
        const out = partWithReserve(part, { starts, kerf: KERF, pierceMarginMm: 3 })
        expect(out.reserve.applied).toBe(true)
        expect(out.reserve.unmatched).toBe(0)
        expect(out.holes).toHaveLength(1)
        expect(out.reserve.holes[0]).toMatchObject({ applied: true, dropped: false, bites: 1 })
        expect(out.reserve.holesDropped).toBe(0)
        expect(Math.abs(signedArea(out.holes[0]))).toBeLessThan(Math.abs(signedArea(L_HOLE)))
    })

    it('un trou dont le point n’est pas lu SORT du nesting, et c’est dit', () => {
        // C'est la dégradation sûre : nicher dans un trou dont on ne sait pas
        // où passe l'amorce, c'est livrer le défaut de la recette du 13/09.
        const out = partWithReserve(part, {
            starts: [starts[0]],
            kerf: KERF,
            pierceMarginMm: 3,
        })
        expect(out.holes).toHaveLength(0)
        expect(out.reserve.holesDropped).toBe(1)
        expect(out.reserve.holes[0]).toMatchObject({ dropped: true, reason: 'startNotRead' })
        // Le contour extérieur, lui, est bien réservé.
        expect(out.reserve.applied).toBe(true)
    })

    it('sans AUCUN point lu, rien n’est réservé et rien n’est inventé', () => {
        const out = partWithReserve(part, { starts: [], kerf: KERF, pierceMarginMm: 3 })
        expect(out.reserve.applied).toBe(false)
        expect(out.reserve.reason).toBe('startNotRead')
        expect(out.coordinates).toBe(L_OUTER)
        expect(out.holes).toHaveLength(0)
    })

    it('un point hors de tout contour est COMPTÉ, pas avalé', () => {
        const out = partWithReserve(part, {
            starts: [...starts, { point: [900, 900], leadIn: 5, leadInType: LEAD_ARC }],
            kerf: KERF,
            pierceMarginMm: 3,
        })
        expect(out.reserve.unmatched).toBe(1)
        expect(out.reserve.starts).toBe(3)
    })

    it('refuse plutôt que d’inventer : trou plus petit que l’amorce', () => {
        const small = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]
        const res = biteAtStart(small, {
            start: [2, 0],
            scrapInside: true,
            leadIn: 5,
            leadInType: LEAD_ARC,
            leadOut: 10,
            leadOutType: LEAD_ARC,
            kerf: KERF,
            pierceMarginMm: 3,
        })
        expect(res.applied).toBe(false)
        expect(res.ring).toBe(small)
        expect(['holeTooSmall', 'mouthInsideEnvelope', 'reserveCrossesContour'])
            .toContain(res.reason)
    })

    it('ne réserve rien quand il n’y a rien à réserver', () => {
        const res = biteAtStart(L_HOLE, {
            start: HOLE_START, scrapInside: true,
            leadIn: 0, leadInType: LEAD_NONE, leadOut: 0, leadOutType: LEAD_NONE,
            kerf: 0, pierceMarginMm: 0,
        })
        expect(res.applied).toBe(false)
        expect(res.reason).toBe('nothingToReserve')
    })

    it('amorce 0 avec perçage 3 : la morsure s’applique (défaut du lot J4-bis)', () => {
        // Une opération sans amorce (`Lead in type = 0`) perce SUR le contour.
        // Le lot J4 refusait alors la morsure et le trou sortait entièrement
        // du nesting, pour une raison purement géométrique et sans rien
        // afficher. Ici elle s'applique, et elle exclut vraiment.
        const res = biteAtStart(L_HOLE, {
            start: HOLE_START, scrapInside: true,
            leadIn: 0, leadInType: LEAD_NONE, leadOut: 0, leadOutType: LEAD_NONE,
            kerf: KERF, pierceMarginMm: 3,
        })
        expect(res.applied).toBe(true)
        expect(Math.abs(signedArea(res.ring))).toBeLessThan(Math.abs(signedArea(L_HOLE)))
        // Le disque de perçage RÉEL (rayon 3 pile autour du point de perçage,
        // côté chute) ne doit plus toucher la zone libre. On l'échantillonne
        // sur le vrai cercle, pas avec `pierceDisc` : celui-ci rend le 32-gone
        // CIRCONSCRIT, dont les sommets sont exactement ceux qui ont servi à
        // bâtir l'enveloppe — ils tombent SUR le bord de l'anneau mordu, où un
        // lancer de rayon ne tranche pas.
        // Rayon 2,999 et non 3 : le 32-gone est CIRCONSCRIT, donc le cercle de
        // rayon 3 lui est tangent en 32 points — des points exactement SUR le
        // bord de l'anneau mordu, où un lancer de rayon ne tranche pas. Ce
        // qu'on vérifie est donc l'intérieur du disque promis, strictement.
        const circle = []
        for (let k = 0; k < 64; k++) {
            const a = (2 * Math.PI * k) / 64
            circle.push([25 + 2.999 * Math.cos(a), 90.75 + 2.999 * Math.sin(a)])
        }
        expect(circle.filter((p) => pointInRing(p, res.ring))).toHaveLength(0)
        // CONTRÔLE : sur l'anneau d'ORIGINE, la moitié du cercle est libre.
        expect(circle.filter((p) => pointInRing(p, L_HOLE)).length).toBeGreaterThan(20)
    })
})

describe('briques géométriques', () => {
    it('le disque de perçage est CIRCONSCRIT : jamais moins que le rayon', () => {
        const disc = pierceDisc([0, 0], 3)
        expect(disc).toHaveLength(32)
        for (const p of disc) expect(Math.hypot(p[0], p[1])).toBeGreaterThanOrEqual(3)
        // Le milieu de chaque arête touche le cercle demandé, pas moins.
        for (let i = 0; i < disc.length; i++) {
            const q = disc[(i + 1) % disc.length]
            const mid = [(disc[i][0] + q[0]) / 2, (disc[i][1] + q[1]) / 2]
            expect(Math.hypot(mid[0], mid[1])).toBeCloseTo(3, 9)
        }
    })

    it('le rayon de perçage par défaut reste 3 mm, à confirmer sur la machine', () => {
        expect(DEFAULT_PIERCE_MARGIN_MM).toBe(3)
    })

    it('convexHull est déterministe et rend un tour convexe', () => {
        const pts = [[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]]
        const a = convexHull(pts)
        const b = convexHull(pts.slice().reverse())
        expect(a).toEqual(b)
        expect(a).toHaveLength(4)
    })

    it('signedArea et pointInRing disent le sens et le dedans', () => {
        const ccw = [[0, 0], [10, 0], [10, 10], [0, 10]]
        expect(signedArea(ccw)).toBeGreaterThan(0)
        expect(signedArea(ccw.slice().reverse())).toBeLessThan(0)
        expect(pointInRing([5, 5], ccw)).toBe(true)
        expect(pointInRing([15, 5], ccw)).toBe(false)
    })
})
