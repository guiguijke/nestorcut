/**
 * Constructeur de payload et quantité illimitée : conteneurs moteur (stock
 * d'abord, coûts, ids), retour des formats (`containerMapBack`), tôles importées
 * et distance au bord, choix bande / multi-tôles ; et sans tôle illimitée, le
 * payload d'avant à l'octet.
 */
import { describe, expect, it } from 'vitest'
import { buildLocalPayload } from '../composables/localPayloadBuilder'
import { makeSheetRecord, ringArea, ringBbox } from '../utils/sheetShape'

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const box = (w, h) => rect(0, 0, w, h)
const fileOf = (count, w = 100, h = 100, slug = 'a.dxf') => ({
    slug, name: slug, count, rotations: [0, 90], parts: [{ coordinates: box(w, h), holes: [], handles: ['2F'] }],
})
const sheet = (width, height, count, extra = {}) => ({ width, height, count, ...extra })
const open = (width, height, extra = {}) => sheet(width, height, 1, { unlimited: true, ...extra })

const build = (sheets, { files = [fileOf(5)], deps, ...params } = {}) =>
    buildLocalPayload(
        { files, params: { sheets, space: 2, ...params }, profile: { timeBudgetSec: 2 } },
        deps || {},
    )
const binsOf = (payload) => payload.instance.bins.map((b) => [b.id, b.stock, b.cost, b.shape.data.outer[2]])

describe('stock et tôles illimitées : les conteneurs moteur', () => {
    it('stock devant (première tôle gratuite, reste à 1), illimitées après et plus chères que tout le stock', async () => {
        const { payload } = await build([
            open(1000, 2000),
            sheet(1500, 3000, 2),
            sheet(600, 800, 1),
            open(1500, 3000),
        ])
        expect(payload.problem).toBe('bpp')
        // Quantité effective : (1000 − 3) / 2 = 498. T = 1 (le « reste » du 1500 × 3000).
        expect(binsOf(payload)).toEqual([
            [0, 1, 0, [1500, 3000]],
            [1, 1, 1, [1500, 3000]],
            [2, 1, 0, [600, 800]],
            [3, 498, 2 * 100, [1000, 2000]],
            [4, 498, 2 * 225, [1500, 3000]],
        ])
        expect(payload.containerMapBack).toEqual([[0, 1], [1, 1], [2, 2], [3, 0], [4, 3]])
        expect(payload.stockPriority).toEqual({ unlimitedBins: [3, 4] })
    })

    it('un format vide du stock est filtré, ids consécutifs', async () => {
        const { payload } = await build([sheet(600, 800, 0), open(1000, 2000), sheet(700, 900, 1)])
        expect(binsOf(payload)).toEqual([
            [0, 1, 0, [700, 900]],
            [1, 999, 100, [1000, 2000]],
        ])
        expect(payload.containerMapBack).toEqual([[0, 2], [1, 1]])
        expect(payload.stockPriority).toEqual({ unlimitedBins: [1] })
    })

    it('la quantité effective ne dépend pas du nombre de pièces ni de la quantité saisie', async () => {
        for (const [parts, typed] of [[1, 1], [400, 1], [1, 0], [1, 5000]]) {
            const { payload } = await build(
                [sheet(600, 800, 7), { width: 1000, height: 2000, count: typed, unlimited: true }],
                { files: [fileOf(parts, 20, 20)] },
            )
            expect(payload.instance.bins.at(-1).stock).toBe(993)
        }
    })

    it('stock égal à la borne : l\'illimitée reçoit quand même une tôle', async () => {
        const { payload } = await build([sheet(600, 800, 1000), open(1000, 2000)])
        expect(binsOf(payload)).toEqual([
            [0, 1, 0, [600, 800]],
            [1, 999, 1, [600, 800]],
            [2, 1, 1000 * 100, [1000, 2000]],
        ])
        expect(payload.stockPriority).toEqual({ unlimitedBins: [2] })
    })
})

describe('illimitées seules : les conteneurs et les coûts d\'avant', () => {
    it('deux illimitées : même payload qu\'avec 500 tôles chacune, plus la clé stockPriority', async () => {
        const a = await build([open(1000, 2000), open(1500, 3000)])
        const b = await build([sheet(1000, 2000, 500), sheet(1500, 3000, 500)])
        const { stockPriority, ...rest } = a.payload
        expect(stockPriority).toEqual({ unlimitedBins: [0, 1] })
        expect(JSON.stringify(rest)).toBe(JSON.stringify(b.payload))
        expect(a.seed).toBe(b.seed)
        expect(binsOf(a.payload).map((x) => x[2])).toEqual([100, 225])
        expect(a.payload.containerMapBack).toBeUndefined()
    })

    // Une illimitée seule n'est jamais « de stock 1 » : comme un grand nombre.
    it.each([
        ['toutes directions : multi-tôles', ['left', 'bottom'], 'bpp'],
        ['gauche seule : bande', ['left'], 'spp'],
    ])('une seule illimitée, %s', async (_label, directions, problem) => {
        const a = await build([open(1000, 2000)], { directions })
        const b = await build([sheet(1000, 2000, 1000)], { directions })
        expect(a.payload.problem).toBe(problem)
        const { stockPriority, ...rest } = a.payload
        expect(stockPriority).toEqual({ unlimitedBins: [0] })
        expect(JSON.stringify(rest)).toBe(JSON.stringify(b.payload))
    })

    it('témoin : la même tôle en quantité 1 fait une bande dans toutes les directions', async () => {
        const one = await build([sheet(1000, 2000, 1)], { directions: ['left', 'bottom'] })
        expect(one.payload.problem).toBe('spp')
    })
})

describe('sans tôle illimitée : le payload d\'avant, à l\'octet', () => {
    const cases = [
        ['multi-formats avec un format vide', [sheet(600, 800, 0), sheet(1000, 2000, 3), sheet(700, 900, 1)], {}],
        ['bande', [sheet(1000, 500, 1)], {}],
        ['distance au bord', [sheet(600, 800, 2), sheet(1000, 2000, 3)], { edgeDistance: 10 }],
    ]
    it.each(cases)('%s : clé absente, `false` ou `undefined`, même payload, même graine', async (_l, sheets, params) => {
        const files = [fileOf(30, 120, 80)]
        const base = await build(sheets, { files, ...params })
        for (const unlimited of [false, undefined, 'true']) {
            const other = await build(sheets.map((s) => ({ ...s, unlimited })), { files, ...params })
            expect(JSON.stringify(other.payload)).toBe(JSON.stringify(base.payload))
            expect(other.seed).toBe(base.seed)
            expect(JSON.stringify(other.itemMap)).toBe(JSON.stringify(base.itemMap))
        }
        expect(JSON.stringify(base.payload)).not.toContain('stockPriority')
        expect(JSON.stringify(base.payload)).not.toContain('unlimited')
    })
})

describe('tôle importée et distance au bord', () => {
    const SHEET_ID = 'sheet-lx2k9f0a-ab12cd'
    const contour = (ring, depth, parent) => ({ ring, depth, parent, areaMm2: ringArea(ring), bbox: ringBbox(ring) })
    const record = makeSheetRecord({
        id: SHEET_ID,
        projectSlug: 'p',
        name: 'Chute',
        sourceFileName: 'chute.dxf',
        sourceUnits: 'mm',
        contours: [contour(rect(1000, 500, 1400, 900), 1, null), contour(rect(1020, 520, 1040, 540), 2, 0)],
        outlineIndex: 0,
        forbidden: [1],
        addedAt: 1,
    })
    const deps = { getSheetRecord: async () => record }

    it('stock importé en deux entrées : coûts sur l\'aire utile, chaque entrée est une tôle importée', async () => {
        const { payload } = await build(
            [sheet(400, 400, 3, { shapeId: SHEET_ID }), open(1000, 2000), open(400, 400, { shapeId: SHEET_ID })],
            { deps },
        )
        const usable = 400 * 400 - 20 * 20
        // Deux illimitées : (1000 − 3) / 2 = 498 ; T = 2.
        expect(payload.instance.bins.map((b) => [b.id, b.stock, b.cost])).toEqual([
            [0, 1, 0],
            [1, 2, 1],
            [2, 498, 3 * Math.round((1000 * 2000) / usable * 100)],
            [3, 498, 3 * 100],
        ])
        expect(payload.shapedSheets.map((s) => s.id)).toEqual([0, 1, 3])
        for (const s of payload.shapedSheets) expect(s.usableAreaMm2).toBe(usable)
        expect(payload.stockPriority).toEqual({ unlimitedBins: [2, 3] })
    })

    it('distance au bord : un repère réel par conteneur moteur, dans l\'ordre des conteneurs', async () => {
        const { payload } = await build([open(1000, 2000), sheet(600, 800, 2)], { edgeDistance: 10 })
        expect(payload.edgeShift).toBe(8)
        expect(binsOf(payload)).toEqual([
            [0, 1, 0, [584, 784]],
            [1, 1, 1, [584, 784]],
            [2, 998, 2 * 100, [984, 1984]],
        ])
        expect(payload.sheetFrames).toEqual([
            { width: 600, height: 800 }, { width: 600, height: 800 }, { width: 1000, height: 2000 },
        ])
        expect(payload.containerMapBack).toEqual([[0, 1], [1, 1], [2, 0]])
    })

    it('bande à une seule illimitée et distance au bord : clé présente, un seul repère', async () => {
        const { payload } = await build([open(1000, 500)], { edgeDistance: 10, directions: ['left'] })
        expect(payload.problem).toBe('spp')
        expect(payload.sheetFrames).toEqual([{ width: 1000, height: 500 }])
        expect(payload.stockPriority).toEqual({ unlimitedBins: [0] })
    })
})
