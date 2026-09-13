/**
 * Lot J4 — `nestedIn` : QUI est posé dans le trou de QUI, tôle par tôle.
 *
 * Ce que mesure ce fichier, et pourquoi aucun de ces verrous n'est vide :
 *
 *  1. Le cas POSITIF : des pièces réellement logées dans le trou d'un hôte
 *     sont désignées, et `cutOrder` (`shared/sheetcamNest.js`) les sort
 *     AVANT leur hôte — c'est la raison d'être du champ, couper le contour
 *     extérieur de l'hôte d'abord libère la pièce nichée, qui bouge.
 *  2. Le CONTRÔLE NÉGATIF, sans lequel le premier ne prouve rien : une tôle
 *     où rien n'est niché doit rendre `null` PARTOUT — y compris pour l'hôte
 *     lui-même, dont le centroïde d'aire tombe dans SON PROPRE trou dès
 *     qu'il est en couronne.
 *  3. Le cas qui DISTINGUE (piège AGENTS #52 : en BPP les tôles partagent le
 *     repère de coordonnées) : des pièces nichées sur la tôle 2 et des
 *     pièces libres sur la tôle 1 aux MÊMES coordonnées. Un classement poolé
 *     à travers les layouts déclarerait la libre de la tôle 1 nichée.
 *  4. La profondeur 2 (J-085 : une pièce dans le trou d'une pièce elle-même
 *     nichée) et son piège concentrique : le centroïde de l'HÔTE tombe dans
 *     le trou de la pièce qu'il héberge. Un critère « centroïde dans un
 *     trou » nu inverserait la relation ; le verrou vérifie que la chaîne
 *     part bien du plus profond et que `nestingDepths` — qui JETTE sur un
 *     cycle — l'accepte.
 *  5. Le branchement : le champ arrive bien sur `containers[k].nestedIn`,
 *     ALIGNÉ index par index sur `containers[k].transforms`, à la sortie de
 *     `buildAlternativeArtifacts` (le bundle wasm est bouchonné : ce qui est
 *     mesuré ici est la plomberie, pas le rapport).
 */
import { describe, expect, it, vi } from 'vitest'
import { cutOrder, nestingDepths } from '../../shared/sheetcamNest'
import { nestedInForLayout } from '../composables/localBridge'

// ------------------------------------------------------------- géométrie
// Carrés centrés sur l'origine : l'emboîtement se lit à l'œil.
//   HOST   100 × 100, trou 60 × 60   (aire trou 3600)
//   MIDDLE  40 × 40,  trou 20 × 20   (aire extérieure 1600, trou 400)
//   SMALL    6 × 6                   (aire 36)
//   FREE    20 × 20                  (aire 400)
const square = (side) => {
    const h = side / 2
    return [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]]
}
const HOST = { id: 0, coords: square(100), holes: [square(60)], count: 1 }
const MIDDLE = { id: 1, coords: square(40), holes: [square(20)], count: 1 }
const SMALL = { id: 2, coords: square(6), holes: [], count: 1 }
const FREE = { id: 3, coords: square(20), holes: [], count: 4 }

const partsById = (parts) => new Map(parts.map((p) => [String(p.id), p]))
const t = (id, x, y, rot = 0) => ({
    item_id: id,
    transformation: { rotation: rot, translation: [x, y] },
})

describe('nestedInForLayout — la tôle dit qui niche dans qui', () => {
    it('pièces réellement nichées : l’hôte est désigné, index DANS LA TÔLE', () => {
        // Deux hôtes, un filler dans chacun, posés en alternance — l'index
        // rendu doit être celui de l'hôte de CE filler, pas du premier venu.
        const layout = {
            placed_items: [
                t(HOST.id, 200, 200), t(FREE.id, 200, 200),
                t(HOST.id, 600, 200), t(FREE.id, 600, 200),
            ],
        }
        expect(nestedInForLayout(layout, partsById([HOST, FREE])))
            .toEqual([null, 0, null, 2])
    })

    it('CONTRÔLE NÉGATIF : rien de niché ⇒ null partout (l’hôte compris)', () => {
        // Les deux FREE sont posées à plat, loin du trou ; et HOST, en
        // couronne, a son propre centroïde dans sa découpe — il ne doit pas
        // se déclarer niché en lui-même.
        const layout = {
            placed_items: [t(HOST.id, 200, 200), t(FREE.id, 500, 200), t(FREE.id, 560, 200)],
        }
        const nested = nestedInForLayout(layout, partsById([HOST, FREE]))
        expect(nested).toEqual([null, null, null])
        // Et le corollaire côté lot J2 : aucune profondeur, donc l'ordre de
        // coupe reste l'ordre d'écriture (rien à sortir en premier).
        const items = nested.map((n) => ({ part: 0, op: 0, nestedIn: n }))
        expect(nestingDepths(items)).toEqual([0, 0, 0])
        expect(cutOrder(items)).toEqual([[0, 0], [1, 0], [2, 0]])
    })

    it('piège #52 : la libre de la tôle 1 aux coordonnées du trou de la tôle 2', () => {
        // Tôle 1 : AUCUN hôte, deux pièces libres — dont une exactement en
        // (500, 500). Tôle 2 : un hôte en (500, 500) et sa pièce nichée au
        // même point. Les deux layouts partagent le repère : seul le scope
        // par tôle empêche de déclarer la libre de la tôle 1 nichée.
        const sheet1 = { placed_items: [t(FREE.id, 500, 500), t(FREE.id, 700, 500)] }
        const sheet2 = { placed_items: [t(HOST.id, 500, 500), t(FREE.id, 500, 500)] }
        const by = partsById([HOST, FREE])
        expect(nestedInForLayout(sheet1, by)).toEqual([null, null])
        expect(nestedInForLayout(sheet2, by)).toEqual([null, 0])
    })

    it('profondeur 2 : la chaîne désigne le trou le PLUS INTÉRIEUR', () => {
        // SMALL est dans le trou de MIDDLE, lui-même dans le trou de HOST :
        // le centroïde de SMALL est dans LES DEUX trous. Et le centroïde de
        // HOST tombe dans le trou de MIDDLE (cas concentrique) sans que HOST
        // devienne pour autant le niché.
        const layout = {
            placed_items: [t(HOST.id, 500, 500), t(MIDDLE.id, 500, 500), t(SMALL.id, 500, 500)],
        }
        const nested = nestedInForLayout(layout, partsById([HOST, MIDDLE, SMALL]))
        expect(nested).toEqual([null, 0, 1])

        const items = nested.map((n) => ({ part: 0, op: 0, nestedIn: n }))
        expect(nestingDepths(items)).toEqual([0, 1, 2]) // ne jette pas : pas de cycle
        // Du plus profond au plus superficiel : SMALL, MIDDLE, puis HOST.
        expect(cutOrder(items)).toEqual([[2, 0], [1, 0], [0, 0]])
    })

    it('ordre de coupe : chaque nichée sort AVANT son hôte', () => {
        // Les hôtes sont écrits AVANT leurs nichées (l'ordre naturel des
        // `placed_items`) : sans `nestedIn`, `cutOrder` les laisserait dans
        // cet ordre et la torche couperait l'hôte en premier.
        const layout = {
            placed_items: [
                t(HOST.id, 200, 200), t(HOST.id, 600, 200),
                t(FREE.id, 200, 200), t(FREE.id, 600, 200),
            ],
        }
        const nested = nestedInForLayout(layout, partsById([HOST, FREE]))
        expect(nested).toEqual([null, null, 0, 1])
        const order = cutOrder(nested.map((n) => ({ part: 0, op: 0, nestedIn: n })))
            .map(([index]) => index)
        expect(order).toEqual([2, 3, 0, 1])
        for (let i = 0; i < nested.length; i++) {
            if (nested[i] == null) continue
            expect(order.indexOf(i)).toBeLessThan(order.indexOf(nested[i]))
        }
    })

    it('entrées dégénérées : jamais de throw, jamais de nichage inventé', () => {
        expect(nestedInForLayout(null, partsById([HOST]))).toEqual([])
        expect(nestedInForLayout({ placed_items: [] }, partsById([HOST]))).toEqual([])
        // Pièce absente du payload : trou nu, pas de crash.
        expect(nestedInForLayout({ placed_items: [t(99, 0, 0)] }, partsById([HOST])))
            .toEqual([null])
    })
})

// --------------------------------------------------------- branchement
// Le bundle géométrie (wasm) est bouchonné : `buildAlternativeArtifacts`
// l'appelle pour le SVG et le rapport, qui ne sont pas l'objet du verrou.
vi.mock('../composables/geometryClient', () => ({
    geoExportSvgSheet: vi.fn(async () => '<svg/>'),
    geoComputeReport: vi.fn(async () => ({ per_sheet: [], totals: null })),
    geoExportDxfSheet: vi.fn(async () => null),
}))

describe('buildAlternativeArtifacts — `nestedIn` arrive sur le container', () => {
    it('un tableau aligné index par index sur `transforms`', async () => {
        const { buildAlternativeArtifacts } = await import('../composables/localBridge')
        const payload = {
            problem: 'spp',
            instance: {
                strip_height: 1000,
                items: [{ id: 0, demand: 1 }, { id: 1, demand: 1 }, { id: 2, demand: 1 }],
            },
            engineConfig: { max_strip_width: 1000, min_item_separation: 2 },
            parts: [HOST, MIDDLE, SMALL].map((p) => ({ ...p, file_slug: `f${p.id}` })),
        }
        const result = {
            problem: 'spp',
            alternatives: [{
                rank: 0,
                seed: 1,
                solution: {
                    layout: {
                        container_id: 0,
                        placed_items: [
                            t(HOST.id, 500, 500), t(MIDDLE.id, 500, 500), t(SMALL.id, 500, 500),
                        ],
                    },
                },
            }],
        }
        const arts = await buildAlternativeArtifacts(result, payload)
        expect(arts).toHaveLength(1)
        const container = arts[0].containers[0]
        expect(container.nestedIn).toHaveLength(container.transforms.length)
        expect(container.nestedIn).toEqual([null, 0, 1])
    })
})
