/**
 * Verrous du lot J4 — un `.job` SheetCam PAR TÔLE depuis un résultat de
 * nesting navigateur (`docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §8, point 4 de
 * la consigne).
 *
 * Ce qui est MESURÉ ici, et pas seulement affirmé :
 *
 *   - le fichier rendu a LA STRUCTURE DE LA RECETTE que le propriétaire a
 *     ouverte dans SheetCam : `Count` juste, `Optimisation=3`, une section
 *     `copyOf` par exemplaire supplémentaire, `[OpOrder]` qui sort les pièces
 *     nichées AVANT leur hôte, les chemins absolus masqués, le bloc binaire
 *     intact À L'OCTET PRÈS ;
 *   - les poses sont calculées sur les anneaux RÉELS, pas sur les anneaux
 *     réservés — le contrôle chiffre l'écart qu'aurait produit l'erreur ;
 *   - un dessin qui n'est pas dans le `.job` fait REFUSER le fichier, au lieu
 *     d'en livrer un amputé en silence (règle 5 de l'étude : on ne peut pas
 *     inventer une pièce, sa géométrie n'est pas dans le bloc binaire) ;
 *   - les index `nestedIn` sont PAR TÔLE (piège AGENTS #52).
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { jobPathRecords, parseSheetCamJob } from '../../shared/sheetcamJob'
import { buildNestedJobs, jobCoversPlacedFiles, jobRanksByDrawing } from '../composables/sheetcamJobResult'
import { partWithReserve } from '../../shared/sheetcamReserve'

const FIX = path.resolve(__dirname, 'fixtures/sheetcam')
const read = (p) => new Uint8Array(fs.readFileSync(p))
const SOURCE = parseSheetCamJob(read(path.join(FIX, 'source.job')))

// La géométrie des deux dessins du moulinet, telle que notre pipeline
// l'importe (mesurée au lot J2) : l'hôte est un carré 100 × 100 centré sur
// l'origine avec un trou circulaire r = 35 ; l'éventail vit de x ∈ [−19,799 ;
// 19,799] et de y ∈ [2,8284 ; 30,8284] — il n'est PAS centré à l'origine.
const circle = (r, n = 64) => Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n
    return [r * Math.cos(a), r * Math.sin(a)]
})
const HOST = [[-50, -50], [50, -50], [50, 50], [-50, 50]]
const HOST_HOLE = circle(35)
const FAN = [[-19.799, 2.8284], [19.799, 2.8284], [19.799, 30.8284], [-19.799, 30.8284]]

const SLUG_HOST = 'piece-trou'
const SLUG_FAN = 'piece-fillx4'
const NAMES = { [SLUG_HOST]: 'Piece_Trou.DXF', [SLUG_FAN]: 'Piece_Fillx4.DXF' }
const RINGS = { [SLUG_HOST]: [HOST, HOST_HOLE], [SLUG_FAN]: [FAN] }

/** La tôle de la recette : l'hôte posé en (50 ; 50), quatre éventails nichés
 *  dans son trou, chacun tourné d'un quart de tour de plus. */
const recipeSheet = () => [
    { fileSlug: SLUG_HOST, pose: { x: 50, y: 50, angle: 0 }, nestedIn: null },
    ...[0, 1, 2, 3].map((k) => ({
        fileSlug: SLUG_FAN,
        pose: { x: 50, y: 50, angle: (k * Math.PI) / 2 },
        nestedIn: 0,
    })),
]

describe('J4 — la structure du `.job` rendu est celle de la recette', () => {
    it('Count, copyOf, Optimisation=3, chemins masqués, binaire intact', () => {
        const files = buildNestedJobs(SOURCE, {
            sheets: [recipeSheet()],
            ringsByFileSlug: RINGS,
            fileNamesBySlug: NAMES,
            baseName: 'recette',
        })
        expect(files).toHaveLength(1)
        expect(files[0].fileName).toBe('recette_tole1.job')

        const out = parseSheetCamJob(files[0].bytes)
        expect(out.count).toBe(5)
        expect(out.optimisation).toBe(3)     // « manual, keep parts together »
        // Un original par dessin, puis les copies — comme la référence.
        expect(out.parts.map((p) => p.copyOf)).toEqual([-1, -1, 1, 1, 1])
        expect(out.parts.map((p) => p.drawingName))
            .toEqual(['Piece_Trou.DXF', 'Piece_Fillx4.DXF', 'Piece_Fillx4.DXF',
                'Piece_Fillx4.DXF', 'Piece_Fillx4.DXF'])

        // Règle 9 : un `.job` déposé chez nous porte le chemin absolu du
        // disque de l'utilisateur. Il ne ressort pas.
        for (const p of out.parts) {
            expect(p.drawingFile).not.toMatch(/[\\/]/)
        }

        // Le bloc binaire est la géométrie en cache des dessins : recopié,
        // jamais décodé, jamais réordonné (règle 6).
        expect(Array.from(out.binary)).toEqual(Array.from(SOURCE.binary))
    })

    it('`ranks` donne le rang ÉCRIT, pas celui du dessin', () => {
        // La confusion a coûté une mesure fausse au lot J4-bis :
        // `placements[i].part` est le rang du DESSIN d'origine (0 ou 1 ici),
        // celui que le bloc binaire indexe ; `ranks[i]` est le rang de la
        // SECTION écrite (0 à 4). Les quatre éventails partagent le même
        // dessin et ont quatre rangs écrits distincts.
        const files = buildNestedJobs(SOURCE, {
            sheets: [recipeSheet()],
            ringsByFileSlug: RINGS,
            fileNamesBySlug: NAMES,
        })
        expect(files[0].placements.map((p) => p.part)).toEqual([0, 1, 1, 1, 1])
        expect(files[0].ranks).toEqual([0, 1, 2, 3, 4])
        // Et l'ordre de coupe parle en rangs ÉCRITS.
        expect(files[0].order.map((o) => o[0]).sort((a, b) => a - b))
            .toEqual([0, 1, 2, 3, 4])
    })

    it('[OpOrder] sort les pièces nichées AVANT leur hôte', () => {
        // C'est la règle 8 de l'étude, et ce n'est pas cosmétique : couper le
        // contour extérieur de l'hôte avant les pièces logées dans son trou
        // libère la pièce, qui bouge sous la torche.
        const files = buildNestedJobs(SOURCE, {
            sheets: [recipeSheet()],
            ringsByFileSlug: RINGS,
            fileNamesBySlug: NAMES,
        })
        // Rangs écrits : l'hôte garde 0, l'éventail original garde 1, ses
        // copies prennent 2, 3, 4.
        expect(files[0].order).toEqual([[1, 0], [2, 0], [3, 0], [4, 0], [0, 0]])
    })

    it('un `.job` par tôle, chacun ne portant que SES pièces', () => {
        const files = buildNestedJobs(SOURCE, {
            sheets: [
                [{ fileSlug: SLUG_HOST, pose: { x: 50, y: 50, angle: 0 }, nestedIn: null }],
                [{ fileSlug: SLUG_FAN, pose: { x: 200, y: 200, angle: 0 }, nestedIn: null }],
            ],
            ringsByFileSlug: RINGS,
            fileNamesBySlug: NAMES,
            baseName: 'deux',
        })
        expect(files.map((f) => f.fileName)).toEqual(['deux_tole1.job', 'deux_tole2.job'])
        const first = parseSheetCamJob(files[0].bytes).parts
        const second = parseSheetCamJob(files[1].bytes).parts
        // Le format ne porte qu'une `[Work]` : une tôle = un fichier, et les
        // pièces de l'autre tôle y sont DÉSACTIVÉES, pas supprimées (leur
        // géométrie est liée au bloc binaire par le rang, règle 6).
        expect([first[0].enabled, first[1].enabled]).toEqual([true, false])
        expect([second[0].enabled, second[1].enabled]).toEqual([false, true])
    })
})

describe('J4 — re-nester un `.job` DÉJÀ nesté', () => {
    // Le cas que personne n'avait mesuré : le fichier d'entrée porte déjà des
    // copies. Avant ce lot, on écrivait des sections NEUVES par-dessus — un
    // job de 5 pièces (1 hôte + 1 éventail + 3 `copyOf`) re-nesté en 5 pièces
    // ressortait avec 8 sections, les 3 copies d'origine restant ACTIVES à
    // leur ANCIENNE pose. SheetCam aurait coupé trois pièces fantômes.
    // Mesuré au harnais navigateur : `Count=8`, `[OpOrder]` sautant 2, 3, 4.
    const X4 = parseSheetCamJob(read(path.join(FIX, 'x4-reference.job')))

    it('réutilise les sections de copie au lieu d’en empiler', () => {
        expect(X4.parts).toHaveLength(5)
        expect(X4.parts.filter((p) => p.copyOf >= 0)).toHaveLength(3)

        const files = buildNestedJobs(X4, {
            sheets: [recipeSheet()],
            ringsByFileSlug: RINGS,
            fileNamesBySlug: NAMES,
            baseName: 'renest',
        })
        const out = parseSheetCamJob(files[0].bytes)

        // 5 pièces demandées ⇒ 5 sections, pas 8.
        expect(out.parts).toHaveLength(5)
        expect(out.count).toBe(5)
        expect(out.parts.map((p) => p.copyOf)).toEqual([-1, -1, 1, 1, 1])
        // Toutes actives : aucune copie orpheline laissée allumée.
        expect(out.parts.every((p) => p.enabled)).toBe(true)
        // Et l'ordre de coupe désigne bien ces cinq rangs-là.
        expect(files[0].order.map((o) => o[0]).sort()).toEqual([0, 1, 2, 3, 4])
    })

    it('une copie en trop est DÉSACTIVÉE, jamais laissée à son ancienne pose', () => {
        // Deux pièces posées seulement : les deux copies restantes sortent
        // du job. On ne les supprime pas — leur rang appartient à la
        // numérotation du fichier — on les éteint.
        const files = buildNestedJobs(X4, {
            sheets: [recipeSheet().slice(0, 3)],
            ringsByFileSlug: RINGS,
            fileNamesBySlug: NAMES,
        })
        const out = parseSheetCamJob(files[0].bytes)
        expect(out.parts).toHaveLength(5)
        const enabled = out.parts.filter((p) => p.enabled)
        expect(enabled).toHaveLength(3)
        expect(files[0].order.map((o) => o[0]).sort()).toEqual([0, 1, 2])
    })
})

describe('J4 — les poses se calculent sur les anneaux RÉELS', () => {
    it('la réserve d’amorce ne déplace AUCUNE pose', () => {
        // La réserve ajoute au contour une bosse qui couvre l'amorce, sa
        // sortie et le perçage. Si elle entrait dans le calcul du centre de
        // boîte, chaque pose se décalerait — ce contrôle chiffre de combien.
        // Le point de départ est celui qu'un `.job` donnerait : le milieu de
        // l'arête gauche de l'éventail.
        const reserved = partWithReserve(
            { coordinates: FAN, holes: [] },
            {
                starts: [{
                    point: [-19.799, 16.8284],
                    leadIn: 5, leadInType: 1, leadOut: 10, leadOutType: 1,
                }],
                kerf: 1.5,
                pierceMarginMm: 3,
            },
        )
        expect(reserved.reserve.applied).toBe(true)

        const sheet = recipeSheet()
        const vrai = buildNestedJobs(SOURCE, {
            sheets: [sheet], ringsByFileSlug: RINGS, fileNamesBySlug: NAMES,
        })[0].placements
        const faux = buildNestedJobs(SOURCE, {
            sheets: [sheet],
            ringsByFileSlug: { ...RINGS, [SLUG_FAN]: [reserved.coordinates] },
            fileNamesBySlug: NAMES,
        })[0].placements

        // Les éventails (rangs 1 à 4) bougeraient de plusieurs millimètres.
        const ecarts = vrai.slice(1).map((p, k) => Math.hypot(
            p.xPos - faux[k + 1].xPos, p.yPos - faux[k + 1].yPos,
        ))
        expect(Math.max(...ecarts)).toBeGreaterThan(2)
        // Et la pose correcte est bien celle de la référence du 11/09 :
        // l'éventail à θ = 0 se pose au centre de boîte translaté.
        expect(vrai[1].xPos).toBeCloseTo(50, 9)
        expect(vrai[1].yPos).toBeCloseTo(50 + 16.8284, 4)
    })
})

describe('J4 — refuser plutôt que livrer un fichier amputé', () => {
    it('un dessin absent du `.job` fait refuser, avec son nom', () => {
        // Règle 5 : on ne peut pas inventer une pièce hors de SheetCam, sa
        // géométrie n'est pas dans le bloc binaire (« Layer 0 not found »).
        expect(() => buildNestedJobs(SOURCE, {
            sheets: [[{ fileSlug: 'un-dxf-depose-a-part', pose: { x: 0, y: 0, angle: 0 }, nestedIn: null }]],
            ringsByFileSlug: { 'un-dxf-depose-a-part': [FAN] },
            fileNamesBySlug: { 'un-dxf-depose-a-part': 'Autre.dxf' },
        })).toThrow(/drawingNotInJob/)
    })

    it('la couverture se CONSTATE avant, et nomme ce qui manque', () => {
        const ok = jobCoversPlacedFiles(SOURCE, NAMES, [SLUG_HOST, SLUG_FAN])
        expect(ok).toEqual({ ok: true, missing: [] })

        const ko = jobCoversPlacedFiles(
            SOURCE,
            { ...NAMES, autre: 'Autre.dxf' },
            [SLUG_HOST, 'autre'],
        )
        expect(ko.ok).toBe(false)
        expect(ko.missing).toEqual(['Autre.dxf'])
    })

    it('les rangs de dessin ignorent les copies', () => {
        // Une copie n'a pas de géométrie propre : seul l'original en a une
        // dans le bloc binaire.
        const x4 = parseSheetCamJob(read(path.join(FIX, 'x4-reference.job')))
        const ranks = jobRanksByDrawing(x4)
        expect([...ranks.entries()]).toEqual([
            ['Piece_Trou.DXF', 0],
            ['Piece_Fillx4.DXF', 1],
        ])
    })

    it('un `nestedIn` incohérent est refusé, jamais bouclé', () => {
        const sheet = recipeSheet()
        sheet[1].nestedIn = 99
        expect(() => buildNestedJobs(SOURCE, {
            sheets: [sheet], ringsByFileSlug: RINGS, fileNamesBySlug: NAMES,
        })).toThrow(/nestingCycle/)
    })
})

describe('J4-ter — NestorCut ÉCRIT le point de départ, et lève le drapeau', () => {
    /** Les points du cache, par dessin, dans la forme que porte la fiche. */
    const startsFromJob = (job) => {
        const blocks = jobPathRecords(job.binary)
        const bySlug = {}
        const names = ['Piece_Trou.DXF', 'Piece_Fillx4.DXF']
        names.forEach((name, blockIndex) => {
            const slug = Object.keys(NAMES).find((s) => NAMES[s] === name)
            bySlug[slug] = {
                blockIndex,
                starts: blocks[blockIndex].paths.map((p, pathIndex) => ({
                    pathIndex, offset: p.start,
                })),
            }
        })
        return bySlug
    }

    it('le point écrit est celui où la réserve a été posée, `moved` levé', () => {
        // POURQUOI CE LOT EXISTE (§9.50). Un point `moved = false` du cache
        // est une INDICATION, pas une garantie : SheetCam le RECALCULE à
        // l'ouverture — mesuré en rouvrant et re-sauvegardant le fichier du
        // propriétaire, le point du trou passe d'un bout du cercle à l'autre.
        // Réserver au point lu et laisser SheetCam en choisir un autre, c'est
        // le défaut de la recette sous une autre forme.
        const before = jobPathRecords(SOURCE.binary)
        expect(before[0].paths.every((p) => p.moved)).toBe(false)

        const [file] = buildNestedJobs(SOURCE, {
            sheets: [recipeSheet()],
            ringsByFileSlug: RINGS,
            fileNamesBySlug: NAMES,
            startsByFileSlug: startsFromJob(SOURCE),
        })
        const out = parseSheetCamJob(file.bytes)
        const after = jobPathRecords(out.binary)

        // L'hôte a deux contours chez nous (carré + trou) et TROIS chemins
        // dans le cache : le troisième est l'entité POINT de son DXF, qui ne
        // tombe sur aucun contour. On n'écrit QUE pour les deux premiers —
        // figer un point qu'on ne modélise pas serait un pari.
        const host = after[0].paths
        const written = host.filter((p) => p.moved)
        expect(written).toHaveLength(2)
        // Et les points écrits sont INCHANGÉS : c'est bien là qu'on a réservé.
        host.forEach((p, k) => {
            expect(p.start[0]).toBeCloseTo(before[0].paths[k].start[0], 12)
            expect(p.start[1]).toBeCloseTo(before[0].paths[k].start[1], 12)
        })
    })

    it('le reste du cache binaire ne bouge PAS d’un octet', () => {
        const [file] = buildNestedJobs(SOURCE, {
            sheets: [recipeSheet()],
            ringsByFileSlug: RINGS,
            fileNamesBySlug: NAMES,
            startsByFileSlug: startsFromJob(SOURCE),
        })
        const out = parseSheetCamJob(file.bytes)
        expect(out.binary.length).toBe(SOURCE.binary.length)

        // Les seuls octets qui changent sont les drapeaux « déplacé ». On a
        // réécrit les MÊMES coordonnées, donc les doubles sont identiques ;
        // ce verrou dit que rien d'autre n'a été touché — le cache de
        // géométrie de SheetCam reste le sien.
        const bougés = []
        for (let i = 0; i < out.binary.length; i++) {
            if (out.binary[i] !== SOURCE.binary[i]) bougés.push(i)
        }
        const drapeaux = jobPathRecords(SOURCE.binary)
            .flatMap((d) => d.paths.map((p) => p.at.moved))
        expect(bougés.every((i) => drapeaux.includes(i))).toBe(true)
        expect(bougés.length).toBeGreaterThan(0)
    })

    it('CONTRÔLE NÉGATIF : sans les points, le binaire est intact', () => {
        // C'est le comportement d'avant le lot, et il doit rester atteignable :
        // un appelant qui ne fournit pas les points recopie le cache tel quel.
        const [file] = buildNestedJobs(SOURCE, {
            sheets: [recipeSheet()],
            ringsByFileSlug: RINGS,
            fileNamesBySlug: NAMES,
        })
        const out = parseSheetCamJob(file.bytes)
        expect(Array.from(out.binary)).toEqual(Array.from(SOURCE.binary))
    })

    it('un chemin sans contour chez nous n’est JAMAIS figé', () => {
        // L'éventail a UN contour et DEUX chemins dans le cache (le second est
        // son entité POINT, sous la pièce). Un seul drapeau doit se lever.
        const [file] = buildNestedJobs(SOURCE, {
            sheets: [recipeSheet()],
            ringsByFileSlug: RINGS,
            fileNamesBySlug: NAMES,
            startsByFileSlug: startsFromJob(SOURCE),
        })
        const after = jobPathRecords(parseSheetCamJob(file.bytes).binary)
        expect(after[1].paths.filter((p) => p.moved)).toHaveLength(1)
    })
})
