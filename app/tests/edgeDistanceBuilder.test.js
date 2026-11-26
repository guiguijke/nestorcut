import { describe, expect, it, vi } from 'vitest'
import { buildLocalPayload, computeSpacingMargin } from '../composables/localPayloadBuilder'
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
        expect(err.__edge).toEqual({ maxEdgeMm: 50 })
        const ok = await build({ ...bpp, edgeDistance: err.__edge.maxEdgeMm }, { files })
        expect(ok.payload.edgeShift).toBe(48)
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
        expect(Number.isFinite(err1.__edge.maxEdgeMm)).toBe(true)

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
        expect(err.__edge).toEqual({ maxEdgeMm: 5 })
    })
})
