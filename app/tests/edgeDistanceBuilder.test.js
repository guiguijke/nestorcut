import { describe, expect, it, vi } from 'vitest'
import { buildLocalPayload, computeSpacingMargin, f32AtOrBelow } from '../composables/localPayloadBuilder'
import { edgeAppliedFields } from '../composables/localJobPrivate'
import { capacityReport } from '../composables/capacityClient'
import { makeSheetRecord, ringArea, ringBbox } from '../utils/sheetShape'

// Distance au bord (lot du 26/11/2026), constructeur de charge navigateur.
// Le moteur reçoit une tôle décalée de d = e − s ; d = 0 (bord vide ou égal à
// l'espacement) : payload IDENTIQUE au bit près, aucune clé de plus.

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const profile = { timeBudgetSec: 13, vcores: 1, maxDirections: 1, level: 'browser' }
const part = (w, h) => ({ coordinates: rect(0, 0, w, h), holes: [], handles: ['A'], color: null, width: w, height: h })
const fileOf = (count, w = 100, h = 60, slug = 'a.dxf', name = 'Pièce A.dxf') => ({
    slug, name, count, rotations: [0, 90], parts: [part(w, h)],
})
/** Disque (pièce courbe) : la marge de courbes est > 0. */
const discFile = (count = 4) => {
    const ring = Array.from({ length: 72 }, (_, k) => {
        const a = (k * 2 * Math.PI) / 72
        return [50 + 50 * Math.cos(a), 50 + 50 * Math.sin(a)]
    })
    ring.push(ring[0])
    return { slug: 'disc.dxf', name: 'disc.dxf', count, rotations: [0, 90], parts: [{ coordinates: ring, holes: [], handles: [], color: null }] }
}

const build = (params, { files = [fileOf(6)], deps = {} } = {}) => buildLocalPayload(
    { files, params: { directions: ['left'], alternativesCount: 1, ...params }, profile },
    deps,
)

const bpp = { sheets: [{ width: 1000, height: 2000, count: 3 }], space: 2, directions: null }
const spp = { sheets: [{ width: 1000, height: 2000, count: 1 }], space: 2 }

describe('identité : bord non réglé ou égal à l’espacement = payload d’avant', () => {
    for (const [label, params] of [['multi-tôles', bpp], ['bande', spp]]) {
        it(`${label} : vide, null, undefined, '' et e = s donnent le MÊME payload et la même graine`, async () => {
            const ref = await build(params)
            for (const edgeDistance of [undefined, null, '', 2, 2.0000000001]) {
                const got = await build({ ...params, edgeDistance })
                expect(got.payload).toEqual(ref.payload)
                expect(JSON.stringify(got.payload)).toBe(JSON.stringify(ref.payload))
                expect(got.seed).toBe(ref.seed)
                expect(got.itemMap).toEqual(ref.itemMap)
                for (const k of ['requestedEdge', 'edgeShift', 'sheetFrames']) expect(k in got.payload).toBe(false)
            }
        })
    }

    it('pièce courbe : e = s (demandés) reste l’identité, la marge de courbes ne crée pas de décalage', async () => {
        const files = [discFile()]
        expect(computeSpacingMargin(files, 2)).toBeGreaterThan(0)
        const ref = await build(spp, { files })
        const got = await build({ ...spp, edgeDistance: 2 }, { files })
        expect(JSON.stringify(got.payload)).toBe(JSON.stringify(ref.payload))
    })

    it('tôle importée, e = s : offsetRing n’est jamais appelé', async () => {
        const offsetRing = vi.fn()
        const record = shapedRecord()
        const deps = { getSheetRecord: async () => record, offsetRing }
        const sheets = [{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }]
        const ref = await build({ sheets, space: 2 }, { files: [fileOf(3, 10, 10)], deps })
        const got = await build({ sheets, space: 2, edgeDistance: 2 }, { files: [fileOf(3, 10, 10)], deps })
        expect(JSON.stringify(got.payload)).toBe(JSON.stringify(ref.payload))
        expect(offsetRing).not.toHaveBeenCalled()
    })
})

describe('tôle rectangulaire : la tôle moteur vaut (W − 2d) × (H − 2d)', () => {
    it('bord 10 à espacement 2 : d = 8, conteneurs 984 × 1984, repère réel 1000 × 2000', async () => {
        const ref = await build(bpp)
        const { payload, seed } = await build({ ...bpp, edgeDistance: 10 })
        expect(payload.problem).toBe('bpp')
        expect(payload.edgeShift).toBe(8)
        expect(payload.requestedEdge).toBe(10)
        expect(payload.instance.bins[0].shape.data.outer).toEqual(rect(0, 0, 984, 1984))
        expect(payload.sheetFrames).toEqual([{ width: 1000, height: 2000 }])
        // L'espacement entre pièces reste s (min_item_separation inchangé).
        expect(payload.engineConfig.min_item_separation).toBe(ref.payload.engineConfig.min_item_separation)
        expect(seed).not.toBe(ref.seed)
    })

    it('bord −5 à espacement 2 : d = −7, conteneurs 1014 × 2014', async () => {
        const { payload } = await build({ ...bpp, edgeDistance: -5 })
        expect(payload.edgeShift).toBe(-7)
        expect(payload.requestedEdge).toBe(-5)
        expect(payload.instance.bins[0].shape.data.outer).toEqual(rect(0, 0, 1014, 2014))
        expect(payload.sheetFrames).toEqual([{ width: 1000, height: 2000 }])
    })

    it('plusieurs formats et un format vide : sheetFrames suit les conteneurs moteur (formats filtrés)', async () => {
        const sheets = [{ width: 1500, height: 1000, count: 1 }, { width: 800, height: 800, count: 0 }, { width: 2000, height: 1200, count: 2 }]
        const { payload } = await build({ sheets, space: 2, edgeDistance: 5 })
        expect(payload.instance.bins.map((b) => b.shape.data.outer[2])).toEqual([[1494, 994], [1994, 1194]])
        expect(payload.sheetFrames).toEqual([{ width: 1500, height: 1000 }, { width: 2000, height: 1200 }])
        expect(payload.containerMapBack).toEqual([[0, 0], [1, 2]])
    })

    it('pièce courbe : d = e − s des valeurs DEMANDÉES (la marge s’annule)', async () => {
        const files = [discFile()]
        const { payload } = await build({ ...bpp, edgeDistance: 10 }, { files })
        expect(payload.engineConfig.min_item_separation).toBeGreaterThan(2)
        expect(payload.edgeShift).toBe(8)
        expect(payload.instance.bins[0].shape.data.outer).toEqual(rect(0, 0, 984, 1984))
    })
})

describe('mode bande : hauteur H − 2d, largeur maximale W − 2d', () => {
    it('bord 10 : strip_height 1984, max_strip_width 984, un seul repère réel', async () => {
        const { payload } = await build({ ...spp, edgeDistance: 10 })
        expect(payload.problem).toBe('spp')
        expect(payload.instance.strip_height).toBe(1984)
        expect(payload.engineConfig.max_strip_width).toBe(984)
        expect(payload.sheetFrames).toEqual([{ width: 1000, height: 2000 }])
        expect(payload.edgeShift).toBe(8)
    })

    it('bord −5 : strip_height 2014, max_strip_width 1014', async () => {
        const { payload } = await build({ ...spp, edgeDistance: -5 })
        expect(payload.instance.strip_height).toBe(2014)
        expect(payload.engineConfig.max_strip_width).toBe(1014)
    })
})

describe('refus avant tout calcul lourd', () => {
    it('surplomb plus grand que la moitié de la plus petite pièce : edge_overhang_too_large, avec la valeur qui passe', async () => {
        const files = [fileOf(2, 100, 60), fileOf(2, 20, 9, 'b.dxf', 'Petite.dxf')]
        const openHoles = vi.fn()
        const err = await build({ ...bpp, edgeDistance: -5 }, { files, deps: { openHoles } }).catch((e) => e)
        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('edge_overhang_too_large')
        expect(err.__edge).toEqual({ maxOverhangMm: 4.5, part: 'Petite.dxf' })
        expect(openHoles).not.toHaveBeenCalled()
        // À la limite exacte : accepté.
        const ok = await build({ ...bpp, edgeDistance: -4.5 }, { files })
        expect(ok.payload.edgeShift).toBe(-6.5)
    })

    it('tôle moteur vide : edge_too_large', async () => {
        const err = await build({ ...bpp, edgeDistance: 600 }).catch((e) => e)
        expect(err.message).toBe('edge_too_large')
        expect(err.__edge.maxEdgeMm).toBeGreaterThan(0)
    })

    it('pièce qui tenait à l’espacement et plus au bord demandé : edge_too_large, maxEdgeMm passe', async () => {
        const files = [fileOf(1, 900, 1900)]
        const err = await build({ ...bpp, edgeDistance: 60 }, { files }).catch((e) => e)
        expect(err.message).toBe('edge_too_large')
        // Sans rotation : (1000 − 900) / 2 = 50 et (2000 − 1900) / 2 = 50 ; tournée,
        // elle ne tient pas. La valeur annoncée passe.
        // Borne exacte 50 ; annoncée un peu dessous (le moteur refuse l'ajustement exact).
        expect(err.__edge).toEqual({ maxEdgeMm: 49.98 })
        const ok = await build({ ...bpp, edgeDistance: err.__edge.maxEdgeMm }, { files })
        expect(ok.payload.edgeShift).toBeCloseTo(47.98, 9)
    })

    it('pièce trop grande même sans bord : le refus d’avant (part_too_large), pas un refus de bord', async () => {
        const files = [fileOf(1, 2100, 100)]
        const err = await build({ ...bpp, edgeDistance: 10 }, { files }).catch((e) => e)
        expect(err.__tooLarge).toBeTruthy()
        expect(err.__edge).toBeUndefined()
    })

    it('bord négatif : une pièce plus large que la tôle peut passer (elle dépasse)', async () => {
        const files = [fileOf(1, 1005, 2001)]
        const refused = await build(bpp, { files }).catch((e) => e)
        expect(refused.__tooLarge).toBeTruthy()
        const { payload } = await build({ ...bpp, edgeDistance: -5 }, { files })
        expect(payload.instance.bins[0].shape.data.outer[2]).toEqual([1014, 2014])
    })
})

describe('levier « espacement max » du refus de capacité : à BORD FIXE', () => {
    it('le levier vient des vraies tôles avec l’option edge, pas de la tôle moteur', async () => {
        const files = [fileOf(400, 100, 100)]
        const params = { sheets: [{ width: 1000, height: 1000, count: 2 }], space: 2, edgeDistance: 10 }
        const err = await build(params, { files }).catch((e) => e)
        expect(err.message).toBe('capacity_exceeded')
        const parts = [{ coords: rect(0, 0, 100, 100), count: 400 }]
        const fixed = capacityReport(parts, [{ width: 1000, height: 1000, count: 2 }], 2, { edge: 10 })
        expect(err.__unfit.maxSpacingForFitMm ?? 0).toBe(fixed.maxSpacingForFitMm)
        // Ratio et tôles nécessaires : ceux de la tôle MOTEUR (miroir du moteur).
        const engine = capacityReport(parts, [{ width: 984, height: 984, count: 2 }], 2)
        expect(err.__unfit.ratio).toBe(engine.ratio)
    })
})

// ---------------------------------------------------------------------------
// Tôle importée : contour décalé par offsetRing, zones translatées, non décalées
// ---------------------------------------------------------------------------

const SHEET_ID = 'sheet-lx2k9f0a-ab12cd'
const contour = (ring, depth, parent) => ({ ring, depth, parent, areaMm2: ringArea(ring), bbox: ringBbox(ring) })
/** Tôle 100 x 200 en (1000, 500), zone interdite 20 x 20 à (20, 20) ; `edgeZone` :
 * une seconde zone près du bord droit (94..99 en x). */
function shapedRecord({ edgeZone = false } = {}) {
    const contours = [
        contour(rect(1000, 500, 1100, 700), 1, null),
        contour(rect(1020, 520, 1040, 540), 2, 0),
        ...(edgeZone ? [contour(rect(1094, 600, 1099, 610), 2, 0)] : []),
    ]
    return makeSheetRecord({
        id: SHEET_ID, projectSlug: 'p', name: 'Tôle', sourceFileName: 's.dxf', sourceUnits: 'mm',
        contours, outlineIndex: 0, forbidden: edgeZone ? [1, 2] : [1], addedAt: 1,
    })
}
/** offsetRing exact pour un rectangle (coins vifs vers l'intérieur ; vers
 * l'extérieur, le rectangle élargi suffit au test du câblage). */
function rectOffset(calls) {
    return async (ring, distanceMm) => {
        calls.push({ ring, distanceMm })
        const xs = ring.map((p) => p[0])
        const ys = ring.map((p) => p[1])
        const t = distanceMm
        return { ring: rect(Math.min(...xs) - t, Math.min(...ys) - t, Math.max(...xs) + t, Math.max(...ys) + t), pieces: 1, lostAreaMm2: 0 }
    }
}
const shapedSheets = [{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }]

describe('tôle importée : contour EXTÉRIEUR décalé de −d, zones gardées et translatées', () => {
    it('bord 10, espacement 2 : offsetRing(contour réel, −8), anneaux translatés de (−8, −8)', async () => {
        const calls = []
        const record = shapedRecord()
        const deps = { getSheetRecord: async () => record, offsetRing: rectOffset(calls) }
        const { payload } = await build({ sheets: shapedSheets, space: 2, edgeDistance: 10 }, { files: [fileOf(3, 10, 10)], deps })
        expect(calls).toHaveLength(1)
        expect(calls[0].distanceMm).toBe(-8)
        expect(calls[0].ring).toEqual(rect(0, 0, 100, 200))
        const bin = payload.instance.bins[0]
        // Rentré de 8 : (8, 8)–(92, 192), puis translaté de (−8, −8).
        expect(bin.shape.data.outer).toEqual(rect(0, 0, 84, 184))
        // Zone NON décalée, seulement translatée.
        expect(bin.shape.data.inner).toEqual([rect(12, 12, 32, 32)])
        // Repère réel : contour d'origine et zones d'origine ; forme livrée et aires réelles.
        expect(payload.sheetFrames).toEqual([{ width: 100, height: 200, outer: rect(0, 0, 100, 200), inner: [rect(20, 20, 40, 40)] }])
        expect(payload.shapedSheets).toEqual([{ id: 0, usableAreaMm2: 19600, perimeterMm: 680 }])
        expect(payload.edgeShift).toBe(8)
    })

    it('bord 10 : une zone entièrement dans la bande du bord est abandonnée côté moteur, gardée au repère réel', async () => {
        const calls = []
        const record = shapedRecord({ edgeZone: true })
        const deps = { getSheetRecord: async () => record, offsetRing: rectOffset(calls) }
        const { payload } = await build({ sheets: shapedSheets, space: 2, edgeDistance: 10 }, { files: [fileOf(3, 10, 10)], deps })
        expect(payload.instance.bins[0].shape.data.inner).toEqual([rect(12, 12, 32, 32)])
        expect(payload.sheetFrames[0].inner).toEqual([rect(20, 20, 40, 40), rect(94, 100, 99, 110)])
    })

    it('bord −5 : décalage vers l’extérieur (+7), conteneur agrandi, zones translatées de (+7, +7)', async () => {
        const calls = []
        const record = shapedRecord({ edgeZone: true })
        const deps = { getSheetRecord: async () => record, offsetRing: rectOffset(calls) }
        const { payload } = await build({ sheets: shapedSheets, space: 2, edgeDistance: -5 }, { files: [fileOf(3, 10, 10)], deps })
        expect(calls[0].distanceMm).toBe(7)
        const bin = payload.instance.bins[0]
        expect(bin.shape.data.outer).toEqual(rect(0, 0, 114, 214))
        expect(bin.shape.data.inner).toEqual([rect(27, 27, 47, 47), rect(101, 107, 106, 117)])
    })

    it('échec du décalage : refus edge_offset_failed, jamais de repli sur le contour non décalé', async () => {
        const record = shapedRecord()
        const boom = async () => { throw Object.assign(new Error('offset_too_complex'), { code: 'offset_too_complex' }) }
        const err = await build({ sheets: shapedSheets, space: 2, edgeDistance: 10 },
            { files: [fileOf(3, 10, 10)], deps: { getSheetRecord: async () => record, offsetRing: boom } }).catch((e) => e)
        expect(err.message).toBe('edge_offset_failed')
        expect(err.__edge).toEqual({ reason: 'offset_too_complex' })

        // Contour rentré qui disparaît (offset_empty, ou anneau vide) : un bord
        // trop grand pour cette tôle — refus edge_too_large, jamais de repli.
        const vanished = async () => { throw Object.assign(new Error('offset_empty'), { code: 'offset_empty' }) }
        const err1 = await build({ sheets: shapedSheets, space: 2, edgeDistance: 10 },
            { files: [fileOf(3, 10, 10)], deps: { getSheetRecord: async () => record, offsetRing: vanished } }).catch((e) => e)
        expect(err1.message).toBe('edge_too_large')
        // Tôle importée : aucun chiffre (le contrôle de tenue n'y est qu'approché).
        expect(err1.__edge).toEqual({})

        const empty = async () => ({ ring: [], pieces: 0, lostAreaMm2: 0 })
        const err2 = await build({ sheets: shapedSheets, space: 2, edgeDistance: 10 },
            { files: [fileOf(3, 10, 10)], deps: { getSheetRecord: async () => record, offsetRing: empty } }).catch((e) => e)
        expect(err2.message).toBe('edge_too_large')

        // Vers l'extérieur (bord négatif), un résultat vide reste un échec du décalage.
        const err3 = await build({ sheets: shapedSheets, space: 2, edgeDistance: -1 },
            { files: [fileOf(3, 10, 10)], deps: { getSheetRecord: async () => record, offsetRing: vanished } }).catch((e) => e)
        expect(err3.message).toBe('edge_offset_failed')
        expect(err3.__edge).toEqual({ reason: 'offset_empty' })

        const missing = await build({ sheets: shapedSheets, space: 2, edgeDistance: 10 },
            { files: [fileOf(3, 10, 10)], deps: { getSheetRecord: async () => record } }).catch((e) => e)
        expect(missing.message).toBe('edge_offset_failed')
    })

    it('repli du décalage vers l’intérieur (distance appliquée plus courte) : refus', async () => {
        const record = shapedRecord()
        const short = async (ring) => ({ ring: rect(7, 7, 93, 193), pieces: 1, lostAreaMm2: 0, appliedDistanceMm: -7 })
        const err = await build({ sheets: shapedSheets, space: 2, edgeDistance: 10 },
            { files: [fileOf(3, 10, 10)], deps: { getSheetRecord: async () => record, offsetRing: short } }).catch((e) => e)
        expect(err.message).toBe('edge_offset_failed')
        expect(err.__edge.reason).toBe('offset_short')
    })

    it('contour rentré coupé en morceaux : le plus grand est gardé, l’aire perdue est dite', async () => {
        const record = shapedRecord()
        const split = async () => ({ ring: rect(8, 8, 92, 150), pieces: 2, lostAreaMm2: 1234 })
        const { payload } = await build({ sheets: shapedSheets, space: 2, edgeDistance: 10 },
            { files: [fileOf(3, 10, 10)], deps: { getSheetRecord: async () => record, offsetRing: split } })
        expect(payload.sheetFrames[0].offsetLostAreaMm2).toBe(1234)
        expect(payload.instance.bins[0].shape.data.outer).toEqual(rect(0, 0, 84, 142))
    })

    it('la garde « la pièce tient » lit le contour MOTEUR : 90 mm tient à l’espacement, pas à 10 mm du bord', async () => {
        const record = shapedRecord()
        const deps = { getSheetRecord: async () => record, offsetRing: rectOffset([]) }
        const files = [fileOf(1, 90, 90)]
        await expect(build({ sheets: shapedSheets, space: 2 }, { files, deps })).resolves.toBeTruthy()
        const err = await build({ sheets: shapedSheets, space: 2, edgeDistance: 10 }, { files, deps }).catch((e) => e)
        expect(err.message).toBe('edge_too_large')
        expect(err.__edge).toEqual({})
    })
})

// ---------------------------------------------------------------------------
// Relecture du 27/11/2026
// ---------------------------------------------------------------------------

describe('rectangle et bande : longueurs moteur arrondies PAR DÉFAUT au flottant 32 bits', () => {
    const below = (v, limit) => {
        expect(Math.fround(v)).toBe(v)
        expect(v).toBeLessThanOrEqual(limit)
        // Le flottant 32 bits suivant dépasserait la limite.
        const next = new Float32Array([v])
        new Int32Array(next.buffer)[0] += v >= 0 ? 1 : -1
        expect(next[0]).toBeGreaterThan(limit)
    }

    it('f32AtOrBelow : exact si représentable, sinon le flottant juste en dessous', () => {
        expect(f32AtOrBelow(984)).toBe(984)
        below(f32AtOrBelow(3002.6), 3002.6)
        below(f32AtOrBelow(984.1), 984.1)
        expect(f32AtOrBelow(-7.3)).toBeLessThanOrEqual(-7.3)
        expect(Math.fround(f32AtOrBelow(-7.3))).toBe(f32AtOrBelow(-7.3))
        expect(Math.fround(3002.6)).toBeGreaterThan(3002.6) // le piège : fround arrondit au plus proche
    })

    it('multi-tôles 1000,1 × 500,3, bord 10 : conteneur ≤ W − 2d et H − 2d, jamais au-dessus', async () => {
        const { payload } = await build({ sheets: [{ width: 1000.1, height: 500.3, count: 2 }], space: 2, directions: null, edgeDistance: 10 })
        const [w, h] = payload.instance.bins[0].shape.data.outer[2]
        below(w, 1000.1 - 16)
        below(h, 500.3 - 16)
        expect(payload.sheetFrames).toEqual([{ width: 1000.1, height: 500.3 }])
    })

    it('maximum annoncé : un centième de moins quand l’arrondi f32 refuserait la borne exacte', async () => {
        // 1000,3 − 900,3 = 100 : borne exacte 50, mais à d = 48 la largeur moteur
        // 904,3 devient 904,29998 en f32 et la pièce (900,3 + 2 × 2) ne tient plus.
        const files = [fileOf(1, 900.3, 1900)]
        const sheets = [{ width: 1000.3, height: 2000, count: 3 }]
        const err = await build({ sheets, space: 2, directions: null, edgeDistance: 60 }, { files }).catch((e) => e)
        expect(err.message).toBe('edge_too_large')
        // Borne exacte 50 : annoncée 49,98 (marge sous l'ajustement exact), qui
        // couvre aussi l'arrondi f32 de la largeur moteur.
        expect(err.__edge).toEqual({ maxEdgeMm: 49.98 })
        const ok = await build({ sheets, space: 2, directions: null, edgeDistance: 49.98 }, { files })
        expect(ok.payload.edgeShift).toBeCloseTo(47.98, 9)
        const at50 = await build({ sheets, space: 2, directions: null, edgeDistance: 50 }, { files }).catch((e) => e)
        expect(at50.message).toBe('edge_too_large')
    })

    it('bande 1000,1 × 2000,3, bord −5,15 : strip_height et max_strip_width arrondis par défaut', async () => {
        const { payload } = await build({ sheets: [{ width: 1000.1, height: 2000.3, count: 1 }], space: 2, edgeDistance: -5.15 })
        expect(payload.problem).toBe('spp')
        below(payload.instance.strip_height, 2000.3 + 2 * 7.15)
        below(payload.engineConfig.max_strip_width, 1000.1 + 2 * 7.15)
    })
})

describe('surplomb maximal : par PIÈCE physique, au plus petit sur les rotations permises (R2)', () => {
    it('bloc : la pièce fine du bloc limite, pas la boîte du bloc', async () => {
        const block = {
            slug: 'bloc.dxf', name: 'Bloc.dxf', count: 1, rotations: [0, 90],
            parts: [
                { coordinates: rect(0, 0, 100, 60), holes: [], handles: ['A'], color: null },
                { coordinates: rect(0, 80, 100, 86), holes: [], handles: ['B'], color: null },
            ],
        }
        const err = await build({ ...bpp, edgeDistance: -4 }, { files: [block] }).catch((e) => e)
        expect(err.message).toBe('edge_overhang_too_large')
        expect(err.__edge).toEqual({ maxOverhangMm: 3, part: 'Bloc.dxf' })
        const ok = await build({ ...bpp, edgeDistance: -3 }, { files: [block] })
        expect(ok.payload.edgeShift).toBe(-5)
    })

    it('barre dessinée à 45° avec 8 rotations : la boîte tournée (fine) limite, pas la boîte d’origine', async () => {
        const c = Math.SQRT1_2
        const L = 100
        const t = 4
        const bar = [[0, 0], [L * c, L * c], [L * c - t * c, L * c + t * c], [-t * c, t * c], [0, 0]]
        const file = {
            slug: 'barre.dxf', name: 'Barre.dxf', count: 1, rotations: [0, 45, 90, 135, 180, 225, 270, 315],
            parts: [{ coordinates: bar, holes: [], handles: ['A'], color: null }],
        }
        // Boîte d'origine ≈ 73,5 × 73,5 : l'ancien plafond (≈ 36,7) laissait passer −10.
        const err = await build({ ...bpp, edgeDistance: -10 }, { files: [file] }).catch((e) => e)
        expect(err.message).toBe('edge_overhang_too_large')
        expect(err.__edge.part).toBe('Barre.dxf')
        expect(err.__edge.maxOverhangMm).toBeGreaterThanOrEqual(1.9)
        expect(err.__edge.maxOverhangMm).toBeLessThanOrEqual(2)
        // La valeur annoncée passe.
        const ok = await build({ ...bpp, edgeDistance: -err.__edge.maxOverhangMm }, { files: [file] })
        expect(ok.payload.edgeShift).toBeLessThan(0)
    })
})

// Tôle à cavité à bouche étroite sur le bord bas : contour concave.
const KEY = [[0, 0], [59.5, 0], [59.5, 5], [56, 5], [56, 13], [64, 13], [64, 5], [60.5, 5], [60.5, 0], [110, 0], [110, 400], [0, 400], [0, 0]]
const KEY_ID = 'sheet-lx2k9f0a-key001'
const keyRecord = () => makeSheetRecord({
    id: KEY_ID, projectSlug: 'p', name: 'Chute', sourceFileName: 'c.dxf', sourceUnits: 'mm',
    contours: [contour(KEY, 1, null)], outlineIndex: 0, forbidden: [], addedAt: 1,
})
const keySheets = [{ width: 110, height: 400, count: 1, shapeId: KEY_ID }]
const VOID_E = rect(58, 7, 62, 11) // vide du décalage du bord demandé |e|
const VOID_D_IN = rect(59, 8, 61, 10) // vide du décalage moteur, contenu dans VOID_E
const VOID_D_OUT = rect(80, 200, 84, 204) // vide du décalage moteur, ailleurs

/** offsetRing de test : boîte agrandie, vides choisis par distance. */
function voidOffset(calls, voidsByDistance, applied = null) {
    return async (ring, distanceMm, opts) => {
        calls.push({ distanceMm, opts })
        const xs = ring.map((p) => p[0])
        const ys = ring.map((p) => p[1])
        const t = distanceMm
        return {
            ring: rect(Math.min(...xs) - t, Math.min(...ys) - t, Math.max(...xs) + t, Math.max(...ys) + t),
            pieces: 1,
            lostAreaMm2: 0,
            appliedDistanceMm: applied ?? distanceMm,
            voids: opts?.keepVoids ? (voidsByDistance[distanceMm] || []) : [],
        }
    }
}

describe('tôle importée, décalage vers l’extérieur : les vides enfermés deviennent des zones (R3)', () => {
    it('bord −3, espacement 2 : vides du décalage moteur (+5) ET du bord demandé (+3), translatés de (5, 5)', async () => {
        const calls = []
        const deps = { getSheetRecord: async () => keyRecord(), offsetRing: voidOffset(calls, { 5: [VOID_D_IN, VOID_D_OUT], 3: [VOID_E] }) }
        const { payload } = await build({ sheets: keySheets, space: 2, edgeDistance: -3 }, { files: [fileOf(2, 10, 10)], deps })
        expect(calls).toEqual([
            { distanceMm: 5, opts: { keepVoids: true } },
            { distanceMm: 3, opts: { keepVoids: true } },
        ])
        const move = (r) => r.map(([x, y]) => [x + 5, y + 5])
        // Le vide moteur contenu dans le vide du bord demandé n'est pas repris.
        expect(payload.instance.bins[0].shape.data.inner).toEqual([move(VOID_E), move(VOID_D_OUT)])
        // Repère réel : le vrai contour, sans zone ajoutée.
        expect(payload.sheetFrames[0].inner).toEqual([])
        expect('edgeAppliedMm' in payload).toBe(false)
    })

    it('bord 1 < espacement 2 (d = −1) : un seul décalage, avec les vides ; plus de refus offset_enclosed_void', async () => {
        const calls = []
        const deps = { getSheetRecord: async () => keyRecord(), offsetRing: voidOffset(calls, { 1: [VOID_D_OUT] }) }
        const { payload } = await build({ sheets: keySheets, space: 2, edgeDistance: 1 }, { files: [fileOf(2, 10, 10)], deps })
        expect(calls).toEqual([{ distanceMm: 1, opts: { keepVoids: true } }])
        expect(payload.instance.bins[0].shape.data.inner).toEqual([VOID_D_OUT.map(([x, y]) => [x + 1, y + 1])])
    })

    it('contour convexe, bord −5 : aucun vide possible, pas de second décalage', async () => {
        const calls = []
        const deps = { getSheetRecord: async () => shapedRecord(), offsetRing: voidOffset(calls, {}) }
        await build({ sheets: shapedSheets, space: 2, edgeDistance: -5 }, { files: [fileOf(3, 10, 10)], deps })
        expect(calls).toEqual([{ distanceMm: 7, opts: { keepVoids: true } }])
    })

    it('vers l’intérieur (bord 3, d = 1) : appel inchangé, sans option', async () => {
        const calls = []
        const deps = { getSheetRecord: async () => keyRecord(), offsetRing: voidOffset(calls, {}) }
        await build({ sheets: keySheets, space: 2, edgeDistance: 3 }, { files: [fileOf(2, 10, 10)], deps })
        expect(calls).toEqual([{ distanceMm: -1, opts: undefined }])
    })

    it('échec du décalage du bord demandé : edge_offset_failed, jamais de repli', async () => {
        const deps = {
            getSheetRecord: async () => keyRecord(),
            offsetRing: async (ring, distanceMm, opts) => {
                if (distanceMm === 3) throw Object.assign(new Error('offset_too_complex'), { code: 'offset_too_complex' })
                return voidOffset([], {})(ring, distanceMm, opts)
            },
        }
        const err = await build({ sheets: keySheets, space: 2, edgeDistance: -3 }, { files: [fileOf(2, 10, 10)], deps }).catch((e) => e)
        expect(err.message).toBe('edge_offset_failed')
        expect(err.__edge).toEqual({ reason: 'offset_too_complex' })
    })
})

describe('décalage vers l’extérieur raccourci : le bord effectivement tenu est dit (R5)', () => {
    it('bord 1,95 à espacement 2 (d = −0,05), distance appliquée 0 : edgeAppliedMm = 2, record', async () => {
        const deps = { getSheetRecord: async () => shapedRecord(), offsetRing: voidOffset([], {}, 0) }
        const { payload } = await build({ sheets: shapedSheets, space: 2, edgeDistance: 1.95 }, { files: [fileOf(3, 10, 10)], deps })
        expect(payload.edgeShift).toBeCloseTo(-0.05, 12)
        expect(payload.edgeAppliedMm).toBe(2)
        expect(edgeAppliedFields(payload)).toEqual({ edgeAppliedMm: 2 })
    })

    it('distance appliquée partielle : espacement − appliquée', async () => {
        const deps = { getSheetRecord: async () => shapedRecord(), offsetRing: voidOffset([], {}, 4) }
        const { payload } = await build({ sheets: shapedSheets, space: 2, edgeDistance: -3 }, { files: [fileOf(3, 10, 10)], deps })
        expect(payload.edgeAppliedMm).toBe(-2)
    })

    it('décalage complet, ou écart sous 1e-6 mm : aucune clé ; payload sans bord : rien au record', async () => {
        const exact = { getSheetRecord: async () => shapedRecord(), offsetRing: voidOffset([], {}) }
        const a = await build({ sheets: shapedSheets, space: 2, edgeDistance: -3 }, { files: [fileOf(3, 10, 10)], deps: exact })
        expect('edgeAppliedMm' in a.payload).toBe(false)
        expect(edgeAppliedFields(a.payload)).toEqual({})
        const tiny = { getSheetRecord: async () => shapedRecord(), offsetRing: voidOffset([], {}, 5 - 5e-7) }
        const b = await build({ sheets: shapedSheets, space: 2, edgeDistance: -3 }, { files: [fileOf(3, 10, 10)], deps: tiny })
        expect('edgeAppliedMm' in b.payload).toBe(false)
        const plain = await build(bpp)
        expect(edgeAppliedFields(plain.payload)).toEqual({})
        expect(edgeAppliedFields({ edgeAppliedMm: 2 })).toEqual({})
    })
})

describe('bord maximal annoncé d’une tôle importée (R4)', () => {
    it('aucune valeur sûre (la pièce ne tient même pas à l’espacement) : refus sans chiffre', async () => {
        const deps = { getSheetRecord: async () => shapedRecord(), offsetRing: rectOffset([]) }
        const err = await build({ sheets: shapedSheets, space: 2, edgeDistance: 60 }, { files: [fileOf(1, 150, 150)], deps }).catch((e) => e)
        expect(err.message).toBe('edge_too_large')
        expect(err.__edge).toEqual({})
    })

    it('contour rentré qui disparaît : refus sans chiffre, une valeur plus petite se construit', async () => {
        const deps = { getSheetRecord: async () => shapedRecord(), offsetRing: rectOffset([]) }
        const files = [fileOf(1, 60, 60)]
        // d = 58 : la tôle 100 × 200 n'existe plus.
        const err = await build({ sheets: shapedSheets, space: 2, edgeDistance: 60 }, { files, deps }).catch((e) => e)
        expect(err.message).toBe('edge_too_large')
        // Tôle importée : aucun chiffre ; une valeur sous la borne (100 − 60) / 2
        // = 20 se construit.
        expect(err.__edge).toEqual({})
        const ok = await build({ sheets: shapedSheets, space: 2, edgeDistance: 19.9 }, { files, deps })
        expect(ok.payload.edgeShift).toBeCloseTo(17.9, 9)
    })
})
