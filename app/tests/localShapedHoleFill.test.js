import { describe, expect, it } from 'vitest'
import { applyHoleFill, decorateLiveLayout, materialDistance, sheetShapesForLayouts } from '../composables/localBridge'

// Tôle importée : le hole-fill ne déplace jamais une pièce sur une zone
// interdite de SA tôle (ni hors de son contour). Scénario du relecteur :
// tôle 400 x 300, zone 135..165 en x et y, cadre 280 x 280 à trou 200 x 200
// posé en (142,142) (la zone est DANS son trou), un filler 20 x 20 libre.

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const FRAME = { id: 0, coords: rect(-140, -140, 140, 140), holes: [rect(-100, -100, 100, 100)], count: 1, rotations: [0, 90, 180, 270] }
const filler = (id = 1, n = 1) => ({ id, coords: rect(-10, -10, 10, 10), holes: [], count: n, rotations: [0, 90, 180, 270] })
const t = (id, x, y, rot = 0) => ({ item_id: id, transformation: { rotation: rot, translation: [x, y] } })
const zoneRing = rect(135, 135, 165, 165)
const shapedPayload = (inner = [zoneRing], extraBins = []) => ({
    shapedSheets: [{ id: 0, usableAreaMm2: 100000, perimeterMm: 1400 }],
    instance: { bins: [{ id: 0, shape: { type: 'polygon', data: { outer: rect(0, 0, 400, 300), inner } } }, ...extraBins] },
})
const freshLayouts = (n = 1) => [{
    container_id: 0,
    placed_items: [t(0, 142, 142), ...Array.from({ length: n }, (_, i) => t(1 + i, 340, 40 + 30 * i))],
}]
const poseOf = (layouts, itemId) => layouts[0].placed_items.find((p) => p.item_id === itemId).transformation.translation

/** Distance exacte (matière) d'un filler posé à la zone, mesure indépendante du filtre testé. */
const distToZone = (pose) => materialDistance(
    { outer: rect(pose[0] - 10, pose[1] - 10, pose[0] + 10, pose[1] + 10), holes: [] },
    { outer: zoneRing, holes: [] },
)

describe('applyHoleFill — tôle importée : jamais sur une zone interdite', () => {
    it('job ordinaire : le filler est déplacé dans le trou, exactement comme avant', () => {
        const layouts = freshLayouts()
        const n = applyHoleFill([FRAME, filler()], layouts, 2)
        expect(n).toBe(1)
        expect(poseOf(layouts, 1)).not.toEqual([340, 40])
        // Même appel avec sheetShapes = null explicite : identique bit à bit.
        const again = freshLayouts()
        applyHoleFill([FRAME, filler()], again, 2, null, null)
        expect(poseOf(again, 1)).toEqual(poseOf(layouts, 1))
        // La pose ordinaire est bien sur la zone (c'est le défaut que le job ordinaire n'a pas à éviter).
        expect(distToZone(poseOf(layouts, 1))).toBeLessThan(2)
    })

    it('tôle importée : le filler reste où le moteur l\'a posé (trou sauté)', () => {
        const layouts = freshLayouts()
        const shapes = sheetShapesForLayouts(shapedPayload(), layouts)
        expect(applyHoleFill([FRAME, filler()], layouts, 2, null, shapes)).toBe(0)
        expect(poseOf(layouts, 1)).toEqual([340, 40])
    })

    it('espacement 0 : seul le recouvrement d\'aire est une violation', () => {
        const layouts = freshLayouts()
        const shapes = sheetShapesForLayouts(shapedPayload(), layouts)
        applyHoleFill([FRAME, filler()], layouts, 0, null, shapes)
        expect(poseOf(layouts, 1)).toEqual([340, 40])
    })

    it('zone petite dans un coin du trou : les poses qui l\'évitent restent permises, aucune ne la touche', () => {
        const small = rect(48, 48, 58, 58)
        const inner = [small]
        const parts = [FRAME, filler(1, 4)]
        const plain = freshLayouts(4)
        const nPlain = applyHoleFill(parts, plain, 2)
        const layouts = freshLayouts(4)
        const shapes = sheetShapesForLayouts(shapedPayload(inner), layouts)
        const n = applyHoleFill([FRAME, filler(1, 4)], layouts, 2, null, shapes)
        for (let id = 1; id <= 4; id++) {
            const [x, y] = poseOf(layouts, id)
            const d = materialDistance(
                { outer: rect(x - 10, y - 10, x + 10, y + 10), holes: [] }, { outer: small, holes: [] },
            )
            expect(d, `filler ${id}`).toBeGreaterThanOrEqual(2 - 0.01)
        }
        expect(n).toBe(nPlain)
        expect(n).toBeGreaterThan(0)
        expect(poseOf(layouts, 1)).toEqual(poseOf(plain, 1))
    })

    it('identité de tôle : la zone est celle du FORMAT du layout (container_id), pas de l\'index', () => {
        // Bin 0 = rectangle ordinaire, bin 1 = tôle importée à zone. Le layout
        // (index 0) est posé sur le format 1 : il doit être gardé par la zone du bin 1.
        const payload = shapedPayload([zoneRing], [])
        payload.instance.bins = [
            { id: 0, shape: { type: 'polygon', data: { outer: rect(0, 0, 400, 300) } } },
            { id: 1, shape: { type: 'polygon', data: { outer: rect(0, 0, 400, 300), inner: [zoneRing] } } },
        ]
        payload.shapedSheets = [{ id: 1, usableAreaMm2: 100000, perimeterMm: 1400 }]
        const layouts = freshLayouts()
        layouts[0].container_id = 1
        const shapes = sheetShapesForLayouts(payload, layouts)
        expect(shapes[0].inner).toEqual([zoneRing])
        applyHoleFill([FRAME, filler()], layouts, 2, null, shapes)
        expect(poseOf(layouts, 1)).toEqual([340, 40])
        // Même pose sur le format 0 (rectangle) : aucune forme, le trou est rempli.
        const onPlain = freshLayouts()
        const shapesPlain = sheetShapesForLayouts(payload, onPlain)
        expect(shapesPlain[0]).toBeNull()
        expect(applyHoleFill([FRAME, filler()], onPlain, 2, null, shapesPlain)).toBe(1)
    })

    it('sans shapedSheets : aucune forme', () => {
        expect(sheetShapesForLayouts({ instance: { bins: [] } }, freshLayouts())).toBeNull()
    })
})

describe('decorateLiveLayout — tôle importée', () => {
    const live = (payload) => decorateLiveLayout({
        items: [[0, 0, 0, 142, 142], [1, 0, 0, 340, 40]],
        sheets: [[400, 300]],
    }, { ...payload, problem: 'bpp', parts: [FRAME, filler()], engineConfig: { min_item_separation: 2 }, hasHoles: true })
    const fillerOf = (out) => out.items.find((it) => it[0] === 1)

    it('job ordinaire : la frame live voit le filler déplacé', () => {
        const out = live({})
        expect(out.holesFilled).toBe(1)
        expect(fillerOf(out).slice(3)).not.toEqual([340, 40])
    })

    it('tôle importée : la frame live garde le filler hors de la zone', () => {
        const out = live(shapedPayload())
        expect(out.holesFilled).toBe(0)
        expect(fillerOf(out).slice(3)).toEqual([340, 40])
    })

    // Dans une frame live, le champ `bin` est le RANG de la tôle, pas son
    // format (bpp/mod.rs::layout_event).
    it('un seul format importé, deuxième tôle du stock (rang 1) : gardée par la même forme', () => {
        const out = decorateLiveLayout({
            items: [[0, 1, 0, 142, 142], [1, 1, 0, 340, 40]], sheets: [[400, 300]],
        }, { ...shapedPayload(), problem: 'bpp', parts: [FRAME, filler()], engineConfig: { min_item_separation: 2 }, hasHoles: true })
        expect(out.holesFilled).toBe(0)
        expect(out.items.find((it) => it[0] === 1).slice(3)).toEqual([340, 40])
    })

    it('deux formats dont un importé : le format d\'une tôle est inconnu, pas de hole-fill sur l\'aperçu', () => {
        const twoFormats = (rank) => {
            const payload = shapedPayload()
            payload.instance.bins = [
                { id: 0, shape: { type: 'polygon', data: { outer: rect(0, 0, 400, 300) } } },
                { id: 1, shape: { type: 'polygon', data: { outer: rect(0, 0, 400, 300), inner: [zoneRing] } } },
            ]
            payload.shapedSheets = [{ id: 1, usableAreaMm2: 100000, perimeterMm: 1400 }]
            return decorateLiveLayout({
                items: [[0, rank, 0, 142, 142], [1, rank, 0, 340, 40]], sheets: [[400, 300]],
            }, { ...payload, problem: 'bpp', parts: [FRAME, filler()], engineConfig: { min_item_separation: 2 }, hasHoles: true })
        }
        // Rang 0 alors que la tôle est peut-être du format importé (id 1) :
        // lire bins[0], un rectangle, posait le filler sur la zone.
        for (const rank of [0, 1]) {
            const out = twoFormats(rank)
            expect(out.holesFilled).toBe(0)
            expect(out.items.find((it) => it[0] === 1).slice(3)).toEqual([340, 40])
        }
    })
})
