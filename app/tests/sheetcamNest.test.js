/**
 * Verrous du lot J2 (`docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §8) — conversion
 * d'une pose moteur en pose `.job`, et ordre de coupe.
 *
 * Le verrou central n'est pas une tautologie : on entre un jeu de poses
 * MOTEUR propre — t = (50 ; 50) pour les quatre éventails, θ = 0, π/2, π,
 * 3π/2 — et le centre de boîte MESURÉ sur nos anneaux, et il doit en sortir
 * les quatre lignes du fichier que le propriétaire a ouvert dans SheetCam le
 * 11/09.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { jobPathRecords, parseSheetCamJob } from '../../shared/sheetcamJob'
import {
    cutOrder,
    drawingBoxCentre,
    jobPlacement,
    nestedJobsPerSheet,
    nestingDepths,
    normalizeJobAngle,
    writtenRanks,
} from '../../shared/sheetcamNest'

const FIX = path.resolve(__dirname, 'fixtures/sheetcam')
const read = (p) => new Uint8Array(fs.readFileSync(p))
const SOURCE = read(path.join(FIX, 'source.job'))
const X4 = read(path.join(FIX, 'x4-reference.job'))

// Centres de boîte MESURÉS sur les anneaux importés par notre pipeline
// (`build_geometry` sur les deux DXF du moulinet) :
//   Piece_Trou    100 × 100, centré sur l'origine   -> (0 ; 0)
//   Piece_Fillx4  39,598 × 28, PAS centré           -> (0 ; 16,8284)
const C_HOST = [0, 0]
const C_FAN = [0, 16.8284]

// Le pinwheel : le même dessin, posé au centre du trou de l'hôte, tourné
// d'un quart de tour à chaque exemplaire.
const HOST_POSE = { x: 50, y: 50, angle: 0 }
const FAN_POSES = [0, 1, 2, 3].map((k) => ({ x: 50, y: 50, angle: k * Math.PI / 2 }))

// Ce que porte le fichier de référence du 11/09. Ses valeurs sont écrites au
// millième de millimètre (16,828 au lieu de 16,8284 pour le centre de
// boîte) : la tolérance ci-dessous est CELLE DE LA RÉFÉRENCE, pas celle de
// notre calcul — c'est dit au rapport §9.
const REF_TOL_MM = 0.0005

const add = (a, b) => [Number(a[0]) + Number(b[0]), Number(a[1]) + Number(b[1])]

/** Lignes d'un fichier texte, quelle que soit sa fin de ligne (les fixtures
 *  SheetCam sont en CRLF). */
const splitLines = (text) => String(text).split('\n').map((line) => line.replace(/\r$/, ''))

/** `$EXTMIN` / `$EXTMAX` de l'en-tête d'un DXF — les extensions que le
 *  dessin DÉCLARE, sans passer par notre importeur. */
function dxfExtents(text) {
    const lines = splitLines(text).map((line) => line.trim())
    const at = (name) => {
        const i = lines.indexOf(name)
        return [Number(lines[i + 2]), Number(lines[i + 4])]
    }
    return [at('$EXTMIN'), at('$EXTMAX')]
}

/**
 * Les points de départ des contours d'un `.nc`.
 *
 * Un trajet commence par un `G0X..Y..` (le perçage) suivi de la descente
 * `G0Z3.8` puis du plongeon `G1…Z1.5`. `leadMoves` mouvements plus loin, la
 * torche est SUR le contour : c'est le point de départ. Les fichiers de la
 * série portent une amorce d'entrée d'un seul mouvement (arc, tangente ou
 * perpendiculaire) ; `leadMoves = 0` pour le type « None », qui perce
 * directement sur le contour.
 */
function ncStarts(text, leadMoves = 1) {
    const lines = splitLines(text).map((line) => line.trim())
    const out = []
    for (let i = 0; i < lines.length - 2; i++) {
        if (!/^G0X(-?[\d.]+)Y(-?[\d.]+)$/.test(lines[i])) continue
        if (lines[i + 1] !== 'G0Z3.8') continue
        const at = i + 2 + leadMoves
        const m = /^G[0123]X(-?[\d.]+)Y(-?[\d.]+)/.exec(lines[at] || '')
        if (m) out.push([Number(m[1]), Number(m[2])])
    }
    return out
}


describe('J2 — la règle 3, contre le fichier du 11/09', () => {
    const refParts = parseSheetCamJob(X4).parts

    it('rend les quatre poses de l’éventail', () => {
        const got = FAN_POSES.map((pose) => jobPlacement(pose, C_FAN))
        const want = refParts.slice(1).map((p) => ({ x: p.xPos, y: p.yPos, a: p.angle }))
        expect(want).toHaveLength(4)
        got.forEach((g, k) => {
            expect(g.xPos).toBeCloseTo(want[k].x, 3)
            expect(g.yPos).toBeCloseTo(want[k].y, 3)
            expect(Math.abs(g.xPos - want[k].x)).toBeLessThan(REF_TOL_MM)
            expect(Math.abs(g.yPos - want[k].y)).toBeLessThan(REF_TOL_MM)
            // Angle = −θ, en radians horaires.
            expect(g.angle).toBeCloseTo(want[k].a, 12)
        })
    })

    it('rend la pose de l’hôte', () => {
        const g = jobPlacement(HOST_POSE, C_HOST)
        expect([g.xPos, g.yPos]).toEqual([50, 50])
        expect(g.angle).toBe(-0)
    })

    it('la pose du fichier « + 45deg », reconstruite à 1 mm près (lot J4-bis-2)', () => {
        // LE VERROU QUI MANQUAIT AU LOT J4, ET QUI DIT POURQUOI IL A ÉCHOUÉ.
        //
        // Tout ce que ce test lit vient des fixtures : les extensions du
        // dessin (en-tête `$EXTMIN`/`$EXTMAX` du DXF), la pose (`XPos`,
        // `YPos`, `Angle` du `.job`), les points de départ des trois contours
        // (bloc binaire du même `.job`) et les trois perçages du G-code que
        // SheetCam a produit pour CE fichier. Rien n'est écrit à la main.
        //
        // Un point du dessin, exprimé par son écart `offset` au centre de la
        // boîte englobante, atterrit dans le monde en
        //     (XPos, YPos) + R(−Angle) · offset
        // — SheetCam tourne le dessin AUTOUR de (XPos, YPos), sens horaire
        // pour un `Angle` positif. C'est la formule du lot J2.
        const jobBytes = read(path.join(FIX, 'piece-l-45deg.job'))
        const job = parseSheetCamJob(jobBytes)
        const part = job.parts[0]
        expect(part.angle).toBeCloseTo(Math.PI / 4, 6)

        const [[minX, minY], [maxX, maxY]] = dxfExtents(
            fs.readFileSync(path.join(FIX, 'piece-l.dxf'), 'latin1'),
        )
        const c0 = [(minX + maxX) / 2, (minY + maxY) / 2]
        expect(c0).toEqual([90, 100])

        const theta = -part.angle
        const rot = (p) => [
            p[0] * Math.cos(theta) - p[1] * Math.sin(theta),
            p[0] * Math.sin(theta) + p[1] * Math.cos(theta),
        ]
        const records = jobPathRecords(job.binary)
        expect(records).toHaveLength(1)
        // Les enregistrements sont dans l'ordre du DESSIN (rectangle,
        // extérieur, fuseau) ; le G-code, lui, sort dans l'ORDRE DE COUPE, que
        // porte le champ `order` (0, 2, 1 ici : les trous d'abord). On les
        // remet dans le même ordre pour les comparer un à un.
        const starts = records[0].paths
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((r) => r.start)
        expect(starts).toHaveLength(3)

        // La pose MOTEUR qui a produit ce fichier, retrouvée par l'inverse de
        // `jobPlacement` : c'est bien elle qu'on met à l'épreuve.
        const pose = {
            x: part.xPos - rot(c0)[0],
            y: part.yPos - rot(c0)[1],
            angle: theta,
        }
        const written = jobPlacement(pose, c0)
        expect(written.xPos).toBeCloseTo(part.xPos, 9)
        expect(written.yPos).toBeCloseTo(part.yPos, 9)

        // Le fichier porte une amorce en ARC (type 1) : un mouvement après le
        // plongeon, la torche est sur le contour.
        const gcode = ncStarts(fs.readFileSync(path.join(FIX, 'piece-l-45deg.nc'), 'latin1'), 1)
        expect(gcode).toHaveLength(3)

        // Le G-code coupe sur le chemin DÉCALÉ de kerf/2 (kerf 1,5) : l'écart
        // attendu est 0,75 mm, pas zéro. La consigne demande ≤ 1 mm.
        const ecarts = starts.map((offset, k) => {
            const world = [
                pose.x + rot(add(c0, offset))[0],
                pose.y + rot(add(c0, offset))[1],
            ]
            return Math.hypot(world[0] - gcode[k][0], world[1] - gcode[k][1])
        })
        // La consigne demande ≤ 1 mm ; la mesure donne 0,750 pile sur les
        // trois, c'est-à-dire kerf/2 exactement. On verrouille la mesure, pas
        // la consigne.
        for (const e of ecarts) expect(e).toBeCloseTo(0.75, 3)

        // CONTRÔLE NÉGATIF — la formule du lot J4 (« centre de la boîte du
        // dessin TOURNÉ »), reproduite ici pour MESURER son erreur. Elle est
        // fausse de plus de 40 mm sur ce fichier ; c'est le NO-GO du §9.42.
        // Elle n'existe plus dans `shared/` : ce bloc est la seule trace.
        const placedBoxCentreJ4 = (rings, t) => {
            const xs = []
            const ys = []
            for (const ring of rings) {
                for (const p of ring) {
                    xs.push(p[0] * Math.cos(t) - p[1] * Math.sin(t))
                    ys.push(p[0] * Math.sin(t) + p[1] * Math.cos(t))
                }
            }
            return [
                (Math.min(...xs) + Math.max(...xs)) / 2,
                (Math.min(...ys) + Math.max(...ys)) / 2,
            ]
        }
        // Le contour extérieur du dessin de la fixture (un L), le seul anneau
        // dont la boîte gouverne : ses six sommets se relisent sur le chemin
        // du G-code, décalé de 0,75.
        const L = [[0, 0], [180, 0], [180, 50], [50, 50], [50, 200], [0, 200]]
        const poseJ4 = {
            x: part.xPos - placedBoxCentreJ4([L], theta)[0],
            y: part.yPos - placedBoxCentreJ4([L], theta)[1],
        }
        const ecartsJ4 = starts.map((offset, k) => {
            const world = [
                poseJ4.x + rot(add(c0, offset))[0],
                poseJ4.y + rot(add(c0, offset))[1],
            ]
            return Math.hypot(world[0] - gcode[k][0], world[1] - gcode[k][1])
        })
        for (const e of ecartsJ4) expect(e).toBeGreaterThan(40)

        // Et les deux formules COÏNCIDENT aux quarts de tour : c'est pour cela
        // que la référence du 11/09, le harnais et tous les verrous du lot J4
        // sont restés verts alors que la pose à 45° était fausse de 45 mm.
        for (const deg of [0, 90, 180, 270]) {
            const t = (deg * Math.PI) / 180
            const a = jobPlacement({ x: 0, y: 0, angle: t }, drawingBoxCentre([{ coordinates: L, holes: [] }]))
            const c = placedBoxCentreJ4([L], t)
            expect(Math.hypot(a.xPos - c[0], a.yPos - c[1])).toBeCloseTo(0, 9)
        }
    })

    it('le miroir du `.job` est `x’ = 2·XPos − x` (mesuré, jamais écrit par nous)', () => {
        // `HRef = 1` : la série porte un fichier miroir dont le bloc binaire
        // est INCHANGÉ — le point de départ est en coordonnées locales, la
        // pose seule le reflète. On ne produit jamais de miroir ; ce verrou
        // garde la règle lisible pour le jour où on lira un fichier entrant.
        const job = parseSheetCamJob(read(path.join(FIX, 'piece-l-none-default.job')))
        expect(job.parts[0].hRef).toBe(0)
        const mirror = (xPos, x) => 2 * xPos - x
        expect(mirror(90, 25)).toBe(155)
    })

    it('le centre de boîte n’est pas décoratif : sans lui, 33,7 mm d’erreur', () => {
        // À 180°, une pièce non centrée à l'origine se décale de R(θ)·c − c.
        const withCentre = jobPlacement(FAN_POSES[2], C_FAN)
        const withoutCentre = jobPlacement(FAN_POSES[2], [0, 0])
        expect(Math.abs(withCentre.yPos - withoutCentre.yPos)).toBeCloseTo(16.8284, 4)
        // Et la pose fausse tombe à 16,8 mm de la référence, pas à 0,4 µm.
        expect(Math.abs(withoutCentre.yPos - refParts[3].yPos)).toBeGreaterThan(16)
    })

    it('ramène l’angle dans l’intervalle que SheetCam écrit lui-même (J4)', () => {
        // Le défaut relevé sur la recette du 13/09 : `Angle=-6.283`, c'est-
        // à-dire −2π, pour un θ = 2π émis par le moteur — un tour complet,
        // donc l'identité. Un fichier propre écrit −0.
        expect(Object.is(normalizeJobAngle(-2 * Math.PI), -0)).toBe(true)
        expect(Object.is(jobPlacement({ x: 0, y: 0, angle: 2 * Math.PI }, [0, 0]).angle, -0))
            .toBe(true)

        // L'INTERVALLE EST MESURÉ, PAS CHOISI. La référence posée à la main
        // dans SheetCam porte −0, −π/2, −π, −3π/2 : SheetCam garde un tour
        // négatif complet, il ne réduit pas dans (−π, π]. Normaliser dans
        // (−π, π] récrirait −4,712 en +1,571 et ferait diverger notre
        // écriture de la référence — ce verrou l'interdit.
        for (const a of refParts.slice(1).map((p) => p.angle)) {
            expect(normalizeJobAngle(a)).toBe(a)
        }
        expect(refParts[4].angle).toBeCloseTo(-3 * Math.PI / 2, 9)
        expect(normalizeJobAngle(refParts[4].angle)).toBeLessThan(-Math.PI)

        // Et sur tout ce que le moteur produit normalement — θ ∈ [0, 2π) —
        // la fonction est l'IDENTITÉ, signe du zéro compris.
        for (let k = 0; k < 360; k++) {
            const theta = (2 * Math.PI * k) / 360
            expect(Object.is(normalizeJobAngle(-theta), -theta)).toBe(true)
        }
    })

    it('garde le zéro NÉGATIF de l’angle nul', () => {
        // La référence porte `Angle=-0` sur le premier exemplaire.
        expect(Object.is(jobPlacement(FAN_POSES[0], C_FAN).angle, -0)).toBe(true)
        // Et la lecture le rend tel quel : `Number('-0')` est -0, donc le
        // signe traverse aussi le SENS LECTURE du lot J1 — l'aller-retour
        // d'un fichier de référence ne perd pas l'octet.
        expect(Object.is(refParts[1].angle, -0)).toBe(true)
    })

    it('mesure le centre de boîte sur les anneaux, trous compris', () => {
        const parts = [{
            coordinates: [[0, 2.8284], [39.598, 2.8284], [39.598, 30.8284], [0, 30.8284]],
            holes: [[[10, 10], [12, 10], [12, 12], [10, 12]]],
        }]
        // Le dessin de l'éventail vit de x ∈ [−19,799 ; 19,799] : ici on
        // vérifie la FORMULE, sur un rectangle équivalent en y.
        const [, cy] = drawingBoxCentre(parts)
        expect(cy).toBeCloseTo(16.8284, 6)
        expect(() => drawingBoxCentre([])).toThrow(/emptyDrawing/)
    })
})

describe('J2 — ordre de coupe', () => {
    it('nichées d’abord, par profondeur décroissante, puis les hôtes', () => {
        // 0 = hôte à plat ; 1, 2 = nichées dans 0 ; 3 = nichée dans 1.
        const items = [
            { part: 0, nestedIn: null },
            { part: 1, nestedIn: 0 },
            { part: 1, nestedIn: 0 },
            { part: 1, nestedIn: 1 },
        ]
        expect(nestingDepths(items)).toEqual([0, 1, 1, 2])
        expect(cutOrder(items)).toEqual([[3, 0], [1, 0], [2, 0], [0, 0]])
    })

    it('groupe les pièces d’un même hôte', () => {
        const items = [
            { part: 0, nestedIn: null },   // hôte A
            { part: 0, nestedIn: null },   // hôte B
            { part: 1, nestedIn: 0 },      // dans A
            { part: 1, nestedIn: 1 },      // dans B
            { part: 1, nestedIn: 0 },      // dans A
        ]
        // Les deux pièces de A se suivent, puis celle de B, puis les hôtes.
        expect(cutOrder(items)).toEqual([[2, 0], [4, 0], [3, 0], [0, 0], [1, 0]])
    })

    it('rend l’ordre du fichier de référence pour le moulinet', () => {
        const items = [
            { part: 0, nestedIn: null },
            { part: 1, nestedIn: 0 },
            { part: 1, nestedIn: 0 },
            { part: 1, nestedIn: 0 },
            { part: 1, nestedIn: 0 },
        ]
        // Op000000=1,0 … Op000004=0,0 : les quatre éventails, puis l'hôte.
        expect(cutOrder(items)).toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [0, 0]])
    })

    it('refuse une chaîne d’imbrication circulaire', () => {
        expect(() => nestingDepths([
            { part: 0, nestedIn: 1 },
            { part: 1, nestedIn: 0 },
        ])).toThrow(/nestingCycle/)
        expect(() => nestingDepths([{ part: 0, nestedIn: 7 }])).toThrow(/nestingCycle/)
    })

    it('respecte l’opération demandée par exemplaire', () => {
        const items = [{ part: 0, op: 1, nestedIn: null }, { part: 1, op: 2, nestedIn: 0 }]
        expect(cutOrder(items)).toEqual([[1, 2], [0, 1]])
    })
})

describe('J2 — rangs écrits et fichier par tôle', () => {
    const job = parseSheetCamJob(SOURCE)

    it('le premier exemplaire garde le rang de son original', () => {
        const items = [
            { part: 0 }, { part: 1 }, { part: 1 }, { part: 1 }, { part: 1 },
        ]
        // 2 originaux dans le .job source : les copies prennent 2, 3, 4.
        expect(writtenRanks(job, items)).toEqual([0, 1, 2, 3, 4])
    })

    it('numérote les copies dessin par dessin, comme l’écrivain', () => {
        const items = [{ part: 1 }, { part: 0 }, { part: 1 }, { part: 0 }]
        // Dessin 1 vu en premier : rangs 1 puis 2 ; dessin 0 : rangs 0 puis 3.
        expect(writtenRanks(job, items)).toEqual([1, 0, 2, 3])
    })

    it('produit le fichier du moulinet depuis des poses MOTEUR', () => {
        const [sheet] = nestedJobsPerSheet(job, {
            sheets: [[
                { part: 0, pose: HOST_POSE, nestedIn: null },
                ...FAN_POSES.map((pose) => ({ part: 1, pose, nestedIn: 0 })),
            ]],
            centres: { 0: C_HOST, 1: C_FAN },
        })
        expect(sheet.sheet).toBe(1)
        expect(sheet.order).toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [0, 0]])

        const written = parseSheetCamJob(sheet.bytes)
        expect(written.count).toBe(5)
        expect(written.optimisation).toBe(3)
        expect(written.parts.map((p) => p.copyOf)).toEqual([-1, -1, 1, 1, 1])
        // Les poses, à la précision de la référence.
        const ref = parseSheetCamJob(X4).parts
        written.parts.forEach((p, k) => {
            expect(Math.abs(p.xPos - ref[k].xPos)).toBeLessThan(0.0005)
            expect(Math.abs(p.yPos - ref[k].yPos)).toBeLessThan(0.0005)
            expect(p.angle).toBeCloseTo(ref[k].angle, 12)
        })
        // Chemins masqués : le fichier rendu à l'utilisateur ne porte pas le
        // chemin absolu de son disque (règle 9).
        expect(written.parts.map((p) => p.drawingFile))
            .toEqual(['Piece_Trou.DXF', 'Piece_Fillx4.DXF', 'Piece_Fillx4.DXF',
                'Piece_Fillx4.DXF', 'Piece_Fillx4.DXF'])
    })

    it('deux tôles = deux fichiers (v1)', () => {
        const files = nestedJobsPerSheet(job, {
            sheets: [
                [{ part: 0, pose: { x: 50, y: 50, angle: 0 }, nestedIn: null }],
                [{ part: 1, pose: { x: 100, y: 200, angle: 0 }, nestedIn: null }],
            ],
            centres: { 0: C_HOST, 1: C_FAN },
        })
        expect(files.map((f) => f.sheet)).toEqual([1, 2])
        // Chaque fichier ne porte QUE les pièces de sa tôle : l'autre pièce
        // est désactivée, jamais supprimée (son rang porte le bloc binaire).
        const first = parseSheetCamJob(files[0].bytes).parts
        expect([first[0].enabled, first[1].enabled]).toEqual([true, false])
        const second = parseSheetCamJob(files[1].bytes).parts
        expect([second[0].enabled, second[1].enabled]).toEqual([false, true])
    })

    it('refuse ce qui n’a pas de sens plutôt que de deviner', () => {
        expect(() => nestedJobsPerSheet(job, { sheets: [] })).toThrow(/noSheets/)
        expect(() => nestedJobsPerSheet(job, { sheets: [[]] })).toThrow(/emptySheet/)
        expect(() => nestedJobsPerSheet(job, {
            sheets: [[{ part: 1, pose: HOST_POSE }]], centres: {},
        })).toThrow(/missingCentre/)
    })
})

describe('J2/J3 — portabilité du module', () => {
    it('se charge en Node NU, sans bundler', async () => {
        // Vite devine l'extension d'un import relatif, Node non : un
        // `from './sheetcamJob'` passait les tests et cassait tout appel
        // hors bundler (script serveur, outil de recette, plugin Nitro).
        // Défaut trouvé par le vérificateur au lot J2, corrigé au lot J3.
        const { execFileSync } = await import('node:child_process')
        const url = new URL('../../shared/sheetcamNest.js', import.meta.url)
        const code = `import('${url.href}')`
            + `.then((m) => { if (typeof m.jobPlacement !== 'function') process.exit(3) })`
            + `.catch(() => process.exit(2))`
        // Pas de --experimental-*, pas de loader : le Node du poste, nu.
        execFileSync(process.execPath, ['--input-type=module', '-e', code], {
            stdio: 'pipe',
        })
    })
})
