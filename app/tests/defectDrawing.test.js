import { describe, expect, it } from 'vitest'
import {
    canAddDefect,
    circleDrag,
    distPx,
    historyPop,
    historyPush,
    historyScale,
    isDrawTool,
    liveSize,
    mmToScreen,
    nearFirst,
    nextDefectId,
    popPoint,
    pushPoint,
    rectDrag,
    screenToMm,
} from '../utils/defectDrawing'
import { fitTransform } from '../utils/sheetImportModel'
import { scaleDrawn, makeDefect } from '../utils/sheetDefects'

const fit = fitTransform([-37.5, 12.25, 62.5, 112.25], 760, 520, 28)

describe('screenToMm', () => {
    it('inverse exactement fitTransform (y flippé), à toute taille de cadre', () => {
        for (const [w, h] of [[760, 520], [300, 900], [1200, 260]]) {
            const f = fitTransform([-37.5, 12.25, 62.5, 112.25], w, h, 28)
            for (const p of [[-37.5, 12.25], [62.5, 112.25], [0, 0], [-80, 140]]) {
                const [sx, sy] = mmToScreen(p, f)
                const back = screenToMm(sx, sy, f)
                expect(back[0]).toBeCloseTo(p[0], 4)
                expect(back[1]).toBeCloseTo(p[1], 4)
            }
        }
    })
    it('le haut de la tôle (y max) est en haut de l\'écran', () => {
        expect(mmToScreen([0, 112.25], fit)[1]).toBeLessThan(mmToScreen([0, 12.25], fit)[1])
    })
})

describe('contour libre', () => {
    const s = fit.scale
    it('ferme près du premier point (12 px) à partir de 3 points seulement', () => {
        const pts = [[0, 0], [10, 0]]
        expect(nearFirst(pts, [0, 0], s)).toBe(false)
        const three = [[0, 0], [10, 0], [10, 10]]
        expect(nearFirst(three, [11 / s, 0], s)).toBe(true)
        expect(nearFirst(three, [13 / s, 0], s)).toBe(false)
    })
    it('abandonne un point à moins de 4 px du précédent (double clic)', () => {
        const a = pushPoint([], [5, 5], s)
        expect(a).toHaveLength(1)
        expect(pushPoint(a, [5 + 2 / s, 5], s)).toBe(a)
        expect(pushPoint(a, [5 + 5 / s, 5], s)).toHaveLength(2)
    })
    it('popPoint retire le dernier point sans toucher l\'original', () => {
        const a = [[0, 0], [1, 1], [2, 2]]
        expect(popPoint(a)).toEqual([[0, 0], [1, 1]])
        expect(a).toHaveLength(3)
    })
})

describe('cercle et rectangle', () => {
    const s = 2
    it('rien sous 3 px de glissé', () => {
        expect(circleDrag([0, 0], [1 / s, 0], s)).toBeNull()
        expect(rectDrag([0, 0], [1 / s, 1 / s], s)).toBeNull()
    })
    it('rayon en mm', () => {
        expect(circleDrag([10, 20], [10 + 5, 20], s)).toEqual({ cx: 10, cy: 20, r: 5 })
        expect(rectDrag([1, 2], [6, 9], s)).toEqual({ a: [1, 2], b: [6, 9] })
    })
    it('taille vivante', () => {
        expect(liveSize('circle', [0, 0], [3, 4])).toEqual({ kind: 'circle', diameter: 10 })
        expect(liveSize('rect', [0, 0], [-20, 12])).toEqual({ kind: 'rect', width: 20, height: 12 })
        expect(liveSize('free', [0, 0], [1, 1])).toBeNull()
        expect(liveSize('circle', null, [1, 1])).toBeNull()
    })
    it('distPx', () => {
        expect(distPx([0, 0], [3, 4], 2)).toBe(10)
    })
})

describe('identifiants et limites', () => {
    it('nextDefectId saute les identifiants pris', () => {
        expect(nextDefectId([])).toBe('d1')
        expect(nextDefectId([{ id: 'd1' }, { id: 'd7' }, { id: 'autre' }])).toBe('d8')
        expect(nextDefectId(undefined)).toBe('d1')
    })
    it('refuse au-delà de 200 zones au total', () => {
        expect(canAddDefect(100, 99)).toBe(true)
        expect(canAddDefect(100, 100)).toBe(false)
        expect(canAddDefect(0, 200)).toBe(false)
    })
    it('outils', () => {
        expect(isDrawTool('pointer')).toBe(false)
        expect(isDrawTool('circle')).toBe(true)
    })
})

describe('historique', () => {
    it('empile, dépile, ne mute jamais', () => {
        const h0 = []
        const h1 = historyPush(h0, ['a'])
        const h2 = historyPush(h1, ['a', 'b'])
        expect(h0).toEqual([])
        expect(h2).toHaveLength(2)
        const { history, snapshot } = historyPop(h2)
        expect(snapshot).toEqual(['a', 'b'])
        expect(history).toEqual([['a']])
        expect(historyPop([])).toEqual({ history: [], snapshot: null })
    })
    it('borne la profondeur', () => {
        let h = []
        for (let i = 0; i < 10; i++) h = historyPush(h, [i], 4)
        expect(h).toEqual([[6], [7], [8], [9]])
    })
    it('suit le réglage pouces : les instantanés sont remis à l\'échelle', () => {
        const d = makeDefect('d1', 'circle', { cx: 10, cy: 10, r: 2 })
        const h = historyScale([[d], []], 25.4, scaleDrawn)
        expect(h[0][0].r).toBeCloseTo(50.8, 6)
        expect(h[1]).toEqual([])
    })
})
