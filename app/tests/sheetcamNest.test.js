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
import { parseSheetCamJob } from '../../shared/sheetcamJob'
import {
    cutOrder,
    drawingBoxCentre,
    jobPlacement,
    nestedJobsPerSheet,
    nestingDepths,
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

    it('le centre de boîte n’est pas décoratif : sans lui, 33,7 mm d’erreur', () => {
        // À 180°, une pièce non centrée à l'origine se décale de R(θ)·c − c.
        const withCentre = jobPlacement(FAN_POSES[2], C_FAN)
        const withoutCentre = jobPlacement(FAN_POSES[2], [0, 0])
        expect(Math.abs(withCentre.yPos - withoutCentre.yPos)).toBeCloseTo(16.8284, 4)
        // Et la pose fausse tombe à 16,8 mm de la référence, pas à 0,4 µm.
        expect(Math.abs(withoutCentre.yPos - refParts[3].yPos)).toBeGreaterThan(16)
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
