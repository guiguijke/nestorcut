/**
 * Bandes résiduelles avec une tôle illimitée : la donneuse est choisie parmi les
 * tôles illimitées, et une pièce d'une tôle du stock ne part jamais sur une neuve.
 * Chaque cas a son témoin sans `stockPriority` (le comportement d'avant).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fillResidualBands } from '../composables/residualClient'

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
const QUARTERS = [0, 90, 180, 270]
const PARTS = [
    // Ancre (pièce à trou : jamais déplacée par la passe).
    { id: 0, coords: rect(100, 100), holes: [[[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]]], rotations: QUARTERS },
    { id: 1, coords: rect(40, 40), holes: [], rotations: QUARTERS },
    // Grosse pièce libre : aucune bande d'une tôle 500 × 500 ancrée ne la reçoit.
    { id: 2, coords: rect(396, 396), holes: [], rotations: QUARTERS },
]
const binOf = (id, side) => ({ id, stock: 5, shape: { data: { outer: rect(side, side) } } })
/** Tôle du stock 500 × 500 (conteneur 0), tôle neuve 1000 × 1000 (conteneur 1). */
const payloadOf = (priority) => ({
    problem: 'bpp',
    instance: { bins: [binOf(0, 500), binOf(1, 1000)] },
    ...(priority ? { stockPriority: { unlimitedBins: [1] } } : {}),
})

const pose = (item_id, x, y) => ({ item_id, transformation: { rotation: 0, translation: [x, y] } })
const smalls = (n, x0, y0, cols = 10) => Array.from({ length: n }, (_, k) =>
    pose(1, x0 + 45 * (k % cols), y0 + 45 * Math.floor(k / cols)))
const count = (layout, id) => layout.placed_items.filter((p) => p.item_id === id).length
const sheetOf = (layouts, containerId) => layouts.find((l) => l.container_id === containerId)

beforeAll(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('choix de la donneuse', () => {
    // La tôle du stock est la MOINS remplie : la donneuse d'avant.
    const layouts = () => [
        { container_id: 1, placed_items: [pose(0, 2, 2), ...smalls(120, 110, 2)] },
        { container_id: 0, placed_items: [pose(0, 2, 2), ...smalls(4, 110, 2)] },
    ]

    it('témoin sans tôle illimitée : la tôle la moins remplie donne ses pièces', () => {
        const l = layouts()
        expect(fillResidualBands(PARTS, l, 2, payloadOf(false), {})).toBeGreaterThan(0)
        expect(count(sheetOf(l, 0), 1)).toBe(0)
        expect(count(sheetOf(l, 1), 1)).toBe(124)
    })

    it('avec tôle illimitée : la neuve donne, le stock reçoit et ne perd rien', () => {
        const l = layouts()
        const own = [...l[1].placed_items]
        expect(fillResidualBands(PARTS, l, 2, payloadOf(true), {})).toBeGreaterThan(0)
        const stock = sheetOf(l, 0)
        expect(count(stock, 1)).toBeGreaterThan(40)
        expect(count(sheetOf(l, 1), 1)).toBeLessThan(120)
        expect(count(stock, 1) + count(sheetOf(l, 1), 1)).toBe(124)
        for (const p of own) expect(stock.placed_items).toContain(p)
    })

    it('aucune tôle illimitée posée : la règle d\'avant entre tôles du stock', () => {
        const l = layouts()
        const payload = { ...payloadOf(false), stockPriority: { unlimitedBins: [7] } }
        fillResidualBands(PARTS, l, 2, payload, {})
        expect(count(sheetOf(l, 0), 1)).toBe(0)
    })

    it('le stock reçoit avant les autres tôles neuves', () => {
        const l = [
            { container_id: 1, placed_items: [pose(0, 2, 2), ...smalls(60, 110, 2)] },
            { container_id: 1, placed_items: [pose(0, 2, 2), ...smalls(20, 110, 2)] },
            { container_id: 0, placed_items: [pose(0, 2, 2), ...smalls(4, 110, 2)] },
        ]
        fillResidualBands(PARTS, l, 2, payloadOf(true), {})
        // Les 20 pièces de la donneuse vont toutes sur le stock, aucune sur l'autre neuve.
        expect(count(sheetOf(l, 0), 1)).toBe(24)
        expect(count(l.find((x) => x.container_id === 1 && count(x, 1) >= 60), 1)).toBe(60)
    })
})

describe('une pièce du stock ne part jamais sur une neuve', () => {
    const layouts = () => [
        { container_id: 0, placed_items: [pose(0, 2, 2), pose(2, 103, 103)] },
        { container_id: 1, placed_items: [pose(0, 2, 2), ...smalls(4, 600, 600)] },
    ]

    it('témoin sans tôle illimitée : la grosse pièce passe sur l\'autre tôle', () => {
        const l = layouts()
        fillResidualBands(PARTS, l, 2, payloadOf(false), {})
        expect(count(sheetOf(l, 1), 2)).toBe(1)
    })

    it('avec tôle illimitée : elle reste sur sa tôle du stock', () => {
        const l = layouts()
        const stats = {}
        fillResidualBands(PARTS, l, 2, payloadOf(true), stats)
        expect(count(sheetOf(l, 0), 2)).toBe(1)
        expect(count(sheetOf(l, 1), 2)).toBe(0)
        const total = l.reduce((n, x) => n + x.placed_items.length, 0)
        expect(total).toBe(7)
    })
})
