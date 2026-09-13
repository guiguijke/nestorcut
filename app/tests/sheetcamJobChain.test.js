/**
 * Verrous du lot J4 — LA CHAÎNE ENTIÈRE, d'un `.job` déposé au `.job` rendu.
 *
 * Les trois autres fichiers de verrous du chantier mesurent chacun un maillon
 * (lire/écrire le fichier, convertir une pose, réserver l'amorce). Celui-ci
 * mesure qu'ils sont BRANCHÉS, et il vérifie les deux propriétés qu'aucun
 * maillon ne peut vérifier seul :
 *
 *   1. la réserve d'amorce arrive JUSQU'AU PAYLOAD MOTEUR — le contour part
 *      avec son appendice, le trou avec ses morsures — et pas seulement dans
 *      le module de géométrie ;
 *   2. un projet SANS `.job` ne change en rien. C'est le contrôle négatif du
 *      lot, et il n'est pas décoratif : la réserve s'applique dans la boucle
 *      commune à TOUS les jobs du navigateur.
 *
 * Le non-fait assumé : le solve lui-même n'est pas rejoué ici (il demande le
 * wasm moteur). On entre des poses, comme le lot J2 entre celles de la
 * référence du 11/09.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildLocalPayload } from '../composables/localPayloadBuilder'
import { buildNestedJobs, sheetsFromLayouts } from '../composables/sheetcamJobResult'
import { layoutTransforms, nestedInForLayout } from '../composables/localBridge'
import { parseSheetCamJob, jobSheet } from '../../shared/sheetcamJob'
import { spacingFromKerf, signedArea } from '../../shared/sheetcamReserve'

const FIX = path.resolve(__dirname, 'fixtures/sheetcam')
const SOURCE = parseSheetCamJob(new Uint8Array(fs.readFileSync(path.join(FIX, 'source.job'))))

const circle = (r, n = 64) => Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n
    return [r * Math.cos(a), r * Math.sin(a)]
})
const HOST = [[-50, -50], [50, -50], [50, 50], [-50, 50]]
const HOST_HOLE = circle(35)
const FAN = [[-19.799, 2.8284], [19.799, 2.8284], [19.799, 30.8284], [-19.799, 30.8284]]
const area = (ring) => Math.abs(signedArea(ring))

const SLUG_HOST = 'host-j4.dxf'
const SLUG_FAN = 'fan-j4.dxf'

/**
 * Les réglages de coupe que le `.job` nous apprend, par dessin — forme du lot
 * J4-bis-2 : les POINTS DE DÉPART lus dans le bloc binaire, relatifs au centre
 * de la boîte englobante du dessin, plus le kerf de l'outil.
 *
 * `Piece_Trou` : boîte −50…50 sur les deux axes, donc centre (0 ; 0) ; le
 * contour extérieur part du milieu de son arête gauche, le trou (cercle r 35)
 * de son point à 3 heures.
 * `Piece_Fillx4` : boîte 2,8284…30,8284 en y, donc centre (0 ; 16,8284) ; son
 * contour part du milieu de l'arête gauche.
 */
const LEAD = { leadIn: 5, leadInType: 1, leadOut: 10, leadOutType: 1 }
const CUT_HOST = {
    kerfWidth: 1.5,
    pierceMarginMm: 3,
    origin: [0, 0],
    starts: [
        { offset: [-50, 0], ...LEAD },
        { offset: [35, 0], ...LEAD },
    ],
}
const CUT_FAN = {
    kerfWidth: 1.5,
    pierceMarginMm: 3,
    origin: [0, 16.8284],
    starts: [{ offset: [-19.799, 0], ...LEAD }],
}

const filesFor = (withJob) => [
    {
        slug: SLUG_HOST,
        name: 'Piece_Trou.DXF',
        count: 1,
        rotations: [0, 90, 180, 270],
        parts: [{ coordinates: HOST, holes: [HOST_HOLE], width: 100, height: 100, handles: ['H1'], color: '#7C3AED' }],
        ...(withJob ? { sheetcam: CUT_HOST } : {}),
    },
    {
        slug: SLUG_FAN,
        name: 'Piece_Fillx4.DXF',
        count: 4,
        rotations: [0, 90, 180, 270],
        parts: [{ coordinates: FAN, holes: [], width: 39.598, height: 28, handles: [], color: '#059669' }],
        ...(withJob ? { sheetcam: CUT_FAN } : {}),
    },
]

const PARAMS = {
    sheets: [{ width: 1000, height: 1250, count: 1 }],
    space: 2,
    fillHoles: true,
    addOutShape: false,
    outputUnit: 'mm',
}
const PROFILE = { timeBudgetSec: 13, vcores: 1, maxDirections: 1, level: 'browser' }

// Le canal capillaire (piege #2) est le chemin MOTEUR : il ouvre le contour
// externe vers le trou pour que jagua, qui ne connait pas les pieces a trous,
// puisse y poser. Ce n'est pas ce qu'on mesure ici, et il demande le wasm —
// on le stubbe en rendant le contour tel quel. `payload.parts[].holes`, lui,
// porte les trous BRUTS : c'est la que la morsure se voit.
const stubDeps = {
    openHoles: async (coords, holes) => ({ ring: coords, channels_opened: holes?.length || 0 }),
    pinwheelCapacity: async (ring, coords, spaceMm, allowed) => ({ rotations: allowed || [0, 90, 180, 270] }),
}
const build = (files) => buildLocalPayload({ files, params: PARAMS, profile: PROFILE }, stubDeps)

describe('J4 — la réserve d’amorce arrive jusqu’au payload moteur', () => {
    it('le contour GROSSIT et le trou RÉTRÉCIT, chiffres à l’appui', async () => {
        const sans = await build(filesFor(false))
        const avec = await build(filesFor(true))

        const hostSans = sans.payload.parts.find((p) => p.file_slug === SLUG_HOST)
        const hostAvec = avec.payload.parts.find((p) => p.file_slug === SLUG_HOST)

        // Le contour extérieur reçoit l'appendice du lot J3 : il grossit, et
        // il porte des sommets en plus.
        expect(area(hostAvec.coords)).toBeGreaterThan(area(hostSans.coords))
        expect(hostAvec.coords.length).toBeGreaterThan(hostSans.coords.length)

        // Le trou reçoit les morsures du lot J4 : sa zone libre rétrécit —
        // c'est exactement la place que SheetCam va brûler pour amorcer, et
        // que le remplissage de trous ne doit plus proposer.
        const trouSans = area(hostSans.holes[0])
        const trouAvec = area(hostAvec.holes[0])
        expect(trouAvec).toBeLessThan(trouSans)
        const perte = 1 - trouAvec / trouSans
        // UNE morsure, au point de départ LU (lot J4-bis-2) — et non plus
        // quatre coins candidats pariés sur une table qui n'existe pas
        // (§9.42). Elle couvre l'amorce d'entrée, celle de sortie ET le
        // perçage, kerf compris. Mesuré sur ce trou (cercle r 35, amorce 5,
        // sortie 10, kerf 1,5 ⇒ perçage 3) : 3,06 % de l'aire du trou, bouche
        // de 10,19 mm — contre 2,74 % et 9,38 mm avec l'ancienne bande d'un
        // demi-kerf (§9.51 : la bande passe à ± kerf). La couronne intérieure
        // complète, elle, aurait coûté 40 %.
        expect(perte).toBeGreaterThan(0.02)
        expect(perte).toBeLessThan(0.04)

        // Et la pièce sans trou reçoit elle aussi son appendice.
        const fanSans = sans.payload.parts.find((p) => p.file_slug === SLUG_FAN)
        const fanAvec = avec.payload.parts.find((p) => p.file_slug === SLUG_FAN)
        expect(area(fanAvec.coords)).toBeGreaterThan(area(fanSans.coords))

        // Les constats voyagent jusqu'au payload, pour la fiche.
        expect(avec.payload.leadInReserve).toHaveLength(2)
        expect(avec.payload.leadInReserve.every((n) => n.applied)).toBe(true)
        expect(avec.payload.leadInReserve[0].holesDropped).toBe(0)
    })

    it('CONTRÔLE NÉGATIF — un projet sans `.job` est inchangé, au champ près', async () => {
        // La réserve s'applique dans la boucle commune à TOUS les jobs du
        // navigateur : si elle fuyait, elle fuirait ici. Le payload doit être
        // rigoureusement identique, et le champ de constats ABSENT (pas vide,
        // absent : les anciens records se relisent sans lui).
        const a = await build(filesFor(false))
        const b = await build(filesFor(false))
        expect(a.payload).toEqual(b.payload)
        expect('leadInReserve' in a.payload).toBe(false)
        expect(a.seed).toBe(b.seed)
    })

    it('la réserve CHANGE le seed déterministe, et c’est voulu', async () => {
        // Le seed est calculé sur l'INSTANCE (géométrie + espacement +
        // budget), pas sur la config (piège AGENTS #17). Réserver change la
        // géométrie, donc le seed : deux jobs qui ne coupent pas la même
        // chose ne doivent pas se prétendre le même calcul.
        const sans = await build(filesFor(false))
        const avec = await build(filesFor(true))
        expect(avec.seed).not.toBe(sans.seed)
        expect(typeof avec.seed).toBe('string')   // 63 bits, piège #16b
    })
})

describe('J4-ter — « amorces croisées autorisées » (`allowOverlappingLeads`)', () => {
    it('n’applique AUCUNE réserve, et le dit', async () => {
        // L'échappatoire d'atelier : la tôle est chère, les chutes ne valent
        // rien, l'opérateur assume que les amorces se croisent. Ce qui serait
        // fautif, c'est de ne rien réserver EN SILENCE — le constat porte sa
        // raison, avec son libellé EN et FR.
        const libre = filesFor(true).map((f) => ({
            ...f,
            sheetcam: { ...f.sheetcam, allowOverlappingLeads: true },
        }))
        const sans = await build(filesFor(false))
        const avec = await build(libre)

        const hostSans = sans.payload.parts.find((p) => p.file_slug === SLUG_HOST)
        const hostAvec = avec.payload.parts.find((p) => p.file_slug === SLUG_HOST)
        // Géométrie STRICTEMENT identique à celle d'un projet sans `.job`.
        expect(area(hostAvec.coords)).toBeCloseTo(area(hostSans.coords), 9)
        expect(area(hostAvec.holes[0])).toBeCloseTo(area(hostSans.holes[0]), 9)
        // Et le constat existe, avec sa raison.
        expect(avec.payload.leadInReserve).toHaveLength(2)
        expect(avec.payload.leadInReserve.every((n) => n.applied === false)).toBe(true)
        expect(avec.payload.leadInReserve[0].reason).toBe('leadsAllowedToOverlap')
    })
})

describe('J4 — du `.job` déposé au `.job` rendu', () => {
    it('les réglages pré-remplis se lisent dans le fichier, pas ailleurs', async () => {
        // Point 2 de la consigne : espacement depuis le kerf de l'outil,
        // tôle depuis `[Work]`. Aucune valeur inventée.
        expect(SOURCE.kerfWidth).toBe(1.5)
        expect(spacingFromKerf(SOURCE.kerfWidth)).toBe(4)   // 2 × kerf + 1 (§9.40)
        expect(jobSheet(SOURCE)).toEqual({ width: 1000, height: 1250 })
    })

    it('un layout livré ressort en `.job`, ordre de coupe compris', async () => {
        const { payload } = await build(filesFor(true))
        const partsById = new Map(payload.parts.map((p) => [String(p.id), p]))
        const hostId = payload.parts.find((p) => p.file_slug === SLUG_HOST).id
        const fanId = payload.parts.find((p) => p.file_slug === SLUG_FAN).id

        // Un layout comme le moteur le rend : l'hôte posé, quatre éventails
        // dans son trou, chacun tourné d'un quart de tour de plus.
        const layout = {
            placed_items: [
                { item_id: hostId, transformation: { rotation: 0, translation: [500, 500] } },
                ...[0, 90, 180, 270].map((deg) => ({
                    item_id: fanId,
                    transformation: { rotation: deg, translation: [500, 500] },
                })),
            ],
        }
        const sheets = sheetsFromLayouts([layout], partsById, { layoutTransforms, nestedInForLayout })
        expect(sheets).toHaveLength(1)
        expect(sheets[0]).toHaveLength(5)

        // Les quatre éventails sont reconnus comme NICHÉS dans l'hôte, et
        // l'hôte ne l'est dans personne.
        expect(sheets[0][0].nestedIn).toBeNull()
        expect(sheets[0].slice(1).map((p) => p.nestedIn)).toEqual([0, 0, 0, 0])

        const files = buildNestedJobs(SOURCE, {
            sheets,
            ringsByFileSlug: { [SLUG_HOST]: [HOST, HOST_HOLE], [SLUG_FAN]: [FAN] },
            fileNamesBySlug: { [SLUG_HOST]: 'Piece_Trou.DXF', [SLUG_FAN]: 'Piece_Fillx4.DXF' },
            baseName: 'chaine',
        })
        expect(files).toHaveLength(1)
        expect(files[0].fileName).toBe('chaine_tole1.job')

        const out = parseSheetCamJob(files[0].bytes)
        expect(out.count).toBe(5)
        expect(out.optimisation).toBe(3)
        // Les nichées d'abord, l'hôte en dernier (règle 8 de l'étude).
        expect(files[0].order.at(-1)).toEqual([0, 0])
        expect(files[0].order.slice(0, 4).map((o) => o[0]).sort()).toEqual([1, 2, 3, 4])

        // LE POINT QUI COMPTE : les poses sont calculées sur les anneaux
        // RÉELS, donc l'éventail à θ = 0 se pose au centre de boîte du vrai
        // dessin (0 ; 16,8284) translaté — pas décalé par l'appendice.
        const fanPlacement = files[0].placements.find((p) => p.part === 1)
        expect(fanPlacement.xPos).toBeCloseTo(500, 6)
        expect(fanPlacement.yPos).toBeCloseTo(500 + 16.8284, 4)

        // Et aucun angle ne sort de l'intervalle de SheetCam.
        for (const p of files[0].placements) {
            expect(p.angle).toBeLessThanOrEqual(0)
            expect(p.angle).toBeGreaterThan(-2 * Math.PI)
        }
    })
})
