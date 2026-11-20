/**
 * Déduction du format de chaque tôle dans une frame live
 * (app/utils/liveSheetFormats.js).
 *
 * Une frame live donne le RANG de la tôle, pas son format : on le déduit des
 * pièces posées (contour, zones interdites, stock, rotation).
 */
import { describe, it, expect } from 'vitest'
import { inferLiveFormats, liveFormatFields } from '../utils/liveSheetFormats.js'
import { livePaneShape, liveShapeFields } from '../utils/sheetDraw.js'
import { livePaneLayout } from '../utils/sheetView.js'

const rectRing = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
const circle = (cx, cy, r, n) => {
    const out = []
    for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n
        out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
    out.push([...out[0]])
    return out
}
const bin = (id, outer, inner, stock = 1) => ({
    id,
    cost: 1,
    stock,
    shape: { type: 'polygon', data: inner ? { outer, inner } : { outer } },
})
const square = (id, s) => ({ id, coords: rectRing(s, s), holes: [] })

// Disque Ø1000 (256 côtés, centre 500,500) et tôle libre 950x523 à encoche.
const disc = () => circle(500, 500, 500, 256)
const freeForm = () => [
    [0, 0], [950, 0], [950, 523], [600, 523], [600, 300], [400, 300], [400, 523], [0, 523], [0, 0],
]
const parts = [square(1, 20)]

describe('inferLiveFormats : cas observé (disque + forme libre)', () => {
    it('rang 0 = forme libre, rang 1 = disque', () => {
        const bins = [bin('disc', disc()), bin('free', freeForm())]
        const items = [
            [1, 0, 0, 5, 5], // coin de la boîte du disque, hors cercle
            [1, 1, 0, 480, 700], // au-dessus de 523 : hors forme libre
        ]
        const r = inferLiveFormats({ bins, items, parts })
        expect(r.binFormats).toEqual([1, 0])
        expect(r.sheets[0]).toEqual([950, 523])
        expect(r.sheets[1][0]).toBeCloseTo(1000, 6)
        expect(r.sheets[1][1]).toBeCloseTo(1000, 6)
    })
})

describe('inferLiveFormats : rang ambigu et hint', () => {
    const bins = [bin('disc', disc()), bin('free', freeForm())]
    const items = [[1, 0, 0, 480, 200]] // tient dans les deux

    it('la plus petite aire utile gagne', () => {
        expect(inferLiveFormats({ bins, items, parts }).binFormats).toEqual([1])
    })
    it('le hint du format qui tient aussi gagne', () => {
        expect(inferLiveFormats({ bins, items, parts, hint: [0] }).binFormats).toEqual([0])
    })
    it('un hint vers un format qui ne tient plus est ignoré', () => {
        const only = [[1, 0, 0, 480, 700]] // disque seulement
        expect(inferLiveFormats({ bins, items: only, parts, hint: [1] }).binFormats).toEqual([0])
    })
})

describe('inferLiveFormats : stock', () => {
    const small = () => rectRing(500, 500)
    const big = () => rectRing(1000, 1000)
    const items = [[1, 0, 0, 10, 10], [1, 1, 0, 20, 20]]

    it('stock 1 : le second rang prend l\'autre format', () => {
        const bins = [bin('big', big(), null, 1), bin('small', small(), null, 1)]
        expect(inferLiveFormats({ bins, items, parts }).binFormats).toEqual([1, 0])
    })
    it('stock 2 : les deux rangs prennent le petit', () => {
        const bins = [bin('big', big(), null, 1), bin('small', small(), null, 2)]
        expect(inferLiveFormats({ bins, items, parts }).binFormats).toEqual([1, 1])
    })
    it('un rang qui ne tient que dans le petit force le grand pour l\'autre', () => {
        const bins = [bin('big', big(), null, 1), bin('small', small(), null, 1)]
        const its = [[1, 0, 0, 10, 10], [1, 1, 0, 10, 10]]
        // rang 1 plus loin : tient dans les deux ; rang 0 idem -> [1,0]
        expect(inferLiveFormats({ bins, items: its, parts }).binFormats).toEqual([1, 0])
        const its2 = [[1, 0, 0, 10, 10], [1, 1, 0, 700, 700]] // rang 1 : grand seulement
        expect(inferLiveFormats({ bins, items: its2, parts }).binFormats).toEqual([1, 0])
        const its3 = [[1, 0, 0, 700, 700], [1, 1, 0, 10, 10]] // rang 0 : grand seulement
        expect(inferLiveFormats({ bins, items: its3, parts }).binFormats).toEqual([0, 1])
    })
})

describe('inferLiveFormats : zone interdite', () => {
    const bins = [
        bin('plain', circle(500, 500, 500, 128)),
        bin('zoned', circle(500, 500, 500, 128), [circle(500, 500, 100, 64)]),
    ]
    it('une pièce au centre : le format SANS zone', () => {
        const r = inferLiveFormats({ bins, items: [[1, 0, 0, 490, 490]], parts })
        expect(r.binFormats).toEqual([0])
    })
    it('pièces hors zone : ambigu, la plus petite aire utile (avec zone)', () => {
        const r = inferLiveFormats({ bins, items: [[1, 0, 0, 100, 480], [1, 0, 0, 800, 480]], parts })
        expect(r.binFormats).toEqual([1])
    })
})

describe('inferLiveFormats : rectangle et tôle importée', () => {
    it('format rectangle et format en L dans le même job', () => {
        const L = [[0, 0], [600, 0], [600, 200], [300, 200], [300, 600], [0, 600], [0, 0]]
        const bins = [bin('rect', rectRing(1000, 500)), bin('L', L)]
        const items = [
            [1, 0, 0, 100, 550], // seulement le L
            [1, 1, 0, 800, 100], // seulement le rectangle
        ]
        const r = inferLiveFormats({ bins, items, parts })
        expect(r.binFormats).toEqual([1, 0])
        expect(r.sheets).toEqual([[600, 600], [1000, 500]])
    })
})

describe('inferLiveFormats : rang qui ne tient nulle part', () => {
    it('-1 et taille héritée ; les autres rangs restent déduits', () => {
        const bins = [bin('disc', disc()), bin('free', freeForm())]
        const items = [
            [1, 0, 0, 5000, 5000],
            [1, 1, 0, 480, 700],
            [1, 3, 0, 9000, 9000],
        ]
        const r = inferLiveFormats({ bins, items, parts })
        expect(r.binFormats).toEqual([-1, 0, -1, -1])
        expect(r.sheets[0][0]).toBeCloseTo(1000, 6)
        expect(r.sheets[2]).toEqual([950, 523]) // bins[min(2,1)]
        expect(r.sheets[3]).toEqual([950, 523])
    })
})

describe('inferLiveFormats : rotation', () => {
    const bar = { id: 7, coords: [[0, 0], [100, 0], [100, 10], [0, 10], [0, 0]], holes: [] }
    it('quart de tour : valeur calculée à la main', () => {
        // (x,y) -> (-y,x) puis +(50,0) : x 40..50, y 0..100 -> tient dans 60x120 seulement
        const bins = [bin('wide', rectRing(120, 60)), bin('tall', rectRing(60, 120))]
        const r = inferLiveFormats({ bins, items: [[7, 0, 90, 50, 0]], parts: [bar] })
        expect(r.binFormats).toEqual([1])
        const r0 = inferLiveFormats({ bins, items: [[7, 0, 0, 10, 10]], parts: [bar] })
        expect(r0.binFormats).toEqual([0])
    })
    it('37,5 degrés : tient seulement dans la tôle de 70 de haut', () => {
        // Sens trigonométrique : y de 0 à 100*sin + 10*cos = 68,8 ; sens inverse : y < 0.
        const bins = [bin('p60', rectRing(100, 60)), bin('p70', rectRing(100, 70))]
        const r = inferLiveFormats({ bins, items: [[7, 0, 37.5, 10, 0]], parts: [bar] })
        expect(r.binFormats).toEqual([1])
        const inv = inferLiveFormats({ bins, items: [[7, 0, -37.5, 10, 0]], parts: [bar] })
        expect(inv.binFormats).toEqual([-1])
    })
})

describe('inferLiveFormats : entrées dégradées', () => {
    const bins2 = [bin('a', rectRing(100, 100)), bin('b', rectRing(200, 200))]
    it('null sans rien à déduire', () => {
        expect(inferLiveFormats({ bins: [bin('a', rectRing(100, 100))], items: [[1, 0, 0, 1, 1]], parts })).toBeNull()
        expect(inferLiveFormats({ bins: [], items: [[1, 0, 0, 1, 1]], parts })).toBeNull()
        expect(inferLiveFormats({ bins: bins2, items: [], parts })).toBeNull()
        expect(inferLiveFormats({ bins: bins2, items: null, parts })).toBeNull()
        expect(inferLiveFormats()).toBeNull()
        expect(inferLiveFormats({})).toBeNull()
    })
    it('entrées mal formées ignorées, pièces inconnues ignorées, jamais de throw', () => {
        const items = [null, 3, [1], [1, -1, 0, 0, 0], [1, 0.5, 0, 0, 0], [1, 0, 'x', 0, 0], [99, 0, 0, 1, 1], [1, 0, 0, 10, 10]]
        let r
        expect(() => { r = inferLiveFormats({ bins: bins2, items, parts }) }).not.toThrow()
        expect(r.binFormats).toEqual([0])
        expect(inferLiveFormats({ bins: bins2, items: [[99, 0, 0, 1, 1]], parts })).toBeNull()
        expect(() => inferLiveFormats({ bins: [{}, { shape: 3 }], items: [[1, 0, 0, 1, 1]], parts })).not.toThrow()
        expect(() => inferLiveFormats({ bins: bins2, items: [[1, 0, 0, 1, 1]], parts: [{ id: 1, coords: 'x' }] })).not.toThrow()
    })
    it('rangs sans pièce : -1 et taille héritée', () => {
        const r = inferLiveFormats({ bins: bins2, items: [[1, 2, 0, 10, 10]], parts })
        expect(r.binFormats).toEqual([-1, -1, 0])
        expect(r.sheets).toEqual([[100, 100], [200, 200], [100, 100]])
    })
})

describe('inferLiveFormats : performance (pire cas synthétique)', () => {
    it('2000 pièces, 10 formats de 5000 sommets, 200 zones chacun', () => {
        const zoneCentres = []
        for (let i = 0; i < 20; i++) for (let j = 0; j < 10; j++) zoneCentres.push([300 + i * 100, 300 + j * 100])
        const bins = []
        for (let k = 0; k < 10; k++) {
            const zones = zoneCentres.map(([x, y]) => circle(x, y, 5, 8))
            bins.push(bin(`f${k}`, circle(2000, 2000, 2000 + k * 10, 5000), zones))
        }
        const part = { id: 1, coords: circle(0, 0, 8, 12), holes: [] }
        const items = []
        for (let n = 0; n < 2000; n++) {
            const rank = n % 4
            const gx = n % 40; const gy = Math.floor(n / 40) % 25
            items.push([1, rank, (n * 15) % 360, 325 + gx * 45, 325 + gy * 45 + (gx % 2) * 3])
        }
        const t0 = performance.now()
        const r = inferLiveFormats({ bins, items, parts: [part] })
        const t1 = performance.now()
        inferLiveFormats({ bins, items, parts: [part] })
        const t2 = performance.now()
        // eslint-disable-next-line no-console
        console.log(`liveSheetFormats pire cas : 1er appel ${(t1 - t0).toFixed(1)} ms, appel à chaud ${(t2 - t1).toFixed(1)} ms`)
        expect(r.binFormats.length).toBe(4)
        expect(t1 - t0).toBeLessThan(150)
    })
})

// Branchement dans la frame live (localJobPrivate) : les mêmes champs que la
// frame finale, pour que la vue dessine chaque tôle avec SA forme dès le début.
describe('liveFormatFields : champs ajoutés à une frame live', () => {
    const shapedBins = () => [bin('disc', disc()), bin('free', freeForm())]
    const payloadOf = (bins, shapedIds) => ({
        instance: { bins },
        parts,
        ...(shapedIds ? { shapedSheets: shapedIds.map((id) => ({ id, usableAreaMm2: 1, perimeterMm: 1 })) } : {}),
    })
    const items = [[1, 0, 0, 5, 5], [1, 1, 0, 480, 700]]

    it('deux formats importés : format et boîte de chaque rang', () => {
        const f = liveFormatFields(payloadOf(shapedBins(), ['disc', 'free']), items, new Map(), 0)
        expect(f.binFormats).toEqual([1, 0])
        expect(f.sheets[0]).toEqual([950, 523])
    })

    it("job sans tôle importée, ou à un seul format : rien n'est ajouté", () => {
        expect(liveFormatFields(payloadOf(shapedBins(), null), items, new Map(), 0)).toEqual({})
        expect(liveFormatFields(payloadOf([bin('disc', disc())], ['disc']), items, new Map(), 0)).toEqual({})
        expect(liveFormatFields(null, items)).toEqual({})
    })

    it("le choix reste stable par walk : le dernier choix sert d'indice à la frame suivante", () => {
        const hints = new Map()
        const payload = payloadOf(shapedBins(), ['disc', 'free'])
        liveFormatFields(payload, items, hints, 3)
        expect(hints.get(3)).toEqual([1, 0])
        expect(hints.has(0)).toBe(false)
    })

    it('la vue dessine alors la forme de chaque rang (au lieu du rectangle)', () => {
        const payload = payloadOf(shapedBins(), ['disc', 'free'])
        const frame = { items, ...liveFormatFields(payload, items, new Map(), 0), ...liveShapeFields(payload) }
        const { panes } = livePaneLayout(frame.sheets, [0, 1], 6)
        const s0 = livePaneShape(frame, panes[0])
        const s1 = livePaneShape(frame, panes[1])
        expect(s0).toBeTruthy()
        expect(s1).toBeTruthy()
        expect([s0.w, s0.h]).toEqual([950, 523])
        expect(s1.w).toBeCloseTo(1000, 6)
        // Sans les champs déduits : le format d'un rang est inconnu, rectangle.
        const bare = { items, ...liveShapeFields(payload) }
        expect(livePaneShape(bare, panes[0])).toBeNull()
    })
})
