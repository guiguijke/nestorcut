/**
 * Règles partagées des tôles à quantité illimitée (`utils/sheetStock.js`) :
 * lecture selon le projet, quantité effective, recette de coût des conteneurs
 * moteur, tri « stock d'abord », ordre des options affichées.
 */
import { describe, expect, it } from 'vitest'
import {
    deliveredScore,
    effectiveSheets,
    sheetsForProject,
    sortStockFirst,
    stockPriorityBins,
    unlimitedLayoutTest,
    unlimitedQuantity,
} from '../utils/sheetStock'
import { MAX_SHEETS_PER_JOB } from '../../shared/constants/payment.constants'

const row = (count, extra = {}) => ({ width: '1000', height: '2000', count, ...extra })
const open = (count = '1') => row(count, { unlimited: true })

describe('lecture selon le projet', () => {
    it('projet « Cet appareil » : les lignes telles quelles', () => {
        const rows = [row('2'), open()]
        expect(sheetsForProject(rows, true)).toBe(rows)
    })

    it('autre projet : la clé est retirée, la quantité saisie reste', () => {
        const rows = [row('2'), open('7')]
        const out = sheetsForProject(rows, false)
        expect(out).toEqual([row('2'), row('7')])
        expect('unlimited' in out[1]).toBe(false)
        expect(rows[1].unlimited).toBe(true)
    })

    it('aucune illimitée : la même liste, projet local ou non', () => {
        const rows = [row('2'), row('3')]
        expect(sheetsForProject(rows, false)).toBe(rows)
        expect(effectiveSheets(rows)).toBe(rows)
    })

    it('seul `true` compte', () => {
        const rows = [row('2', { unlimited: false }), row('3', { unlimited: 'true' })]
        expect(unlimitedQuantity(rows)).toBe(0)
        expect(effectiveSheets(rows)).toBe(rows)
    })
})

describe('quantité effective', () => {
    it('la borne moins le stock, partagée entre les illimitées (partie entière)', () => {
        expect(unlimitedQuantity([open()])).toBe(MAX_SHEETS_PER_JOB)
        expect(unlimitedQuantity([row('2'), open()])).toBe(998)
        expect(unlimitedQuantity([open(), row(2), row('1'), open()])).toBe(498)
    })

    it('au moins une, même quand le stock prend la borne ; les quantités illisibles du stock comptent 0', () => {
        expect(unlimitedQuantity([row('1000'), open()])).toBe(1)
        expect(unlimitedQuantity([row('4000'), open(), open()])).toBe(1)
        expect(unlimitedQuantity([row(''), row('-3'), row('abc'), open()])).toBe(1000)
    })

    it('la quantité saisie d\'une illimitée n\'est jamais lue', () => {
        for (const typed of ['', '0', '1', '5000', 'abc']) {
            expect(effectiveSheets([row('2'), open(typed)]).map((s) => s.count)).toEqual(['2', '998'])
        }
    })
})

describe('conteneurs moteur : stock d\'abord, illimitées plus chères que tout le stock', () => {
    const f = (formatId, count, unlimited, area) => ({ formatId, count, unlimited, area })

    it('la recette : première tôle gratuite, le reste à 1, illimitées à (T + 1) × c', () => {
        const bins = stockPriorityBins([
            f(0, 10, true, 4_500_000),
            f(1, 3, false, 4_500_000),
            f(2, 1, false, 480_000),
            f(3, 10, true, 2_000_000),
        ])
        // T = 2 (les deux « reste » du format 1) ; c : 225 et 100.
        expect(bins.map((b) => [b.formatId, b.count, b.cost])).toEqual([
            [1, 1, 0],
            [1, 2, 1],
            [2, 1, 0],
            [0, 10, 3 * 225],
            [3, 10, 3 * 100],
        ])
    })

    it('stock de tôles uniques : T = 0, l\'illimitée coûte c', () => {
        expect(stockPriorityBins([f(0, 1, false, 250_000), f(1, 999, true, 2_000_000)]).map((b) => b.cost))
            .toEqual([0, 100])
    })

    it('sans stock ou sans illimitée : recette sans objet', () => {
        expect(stockPriorityBins([f(0, 10, true, 1), f(1, 10, true, 2)])).toBeNull()
        expect(stockPriorityBins([f(0, 2, false, 1), f(1, 1, false, 2)])).toBeNull()
    })
})

describe('tri des tôles posées', () => {
    const l = (container_id, tag) => ({ container_id, tag })
    const payload = { instance: { bins: [] }, stockPriority: { unlimitedBins: [2, 3] } }

    it('stable, en place : le stock d\'abord ; rend l\'ancien rang de chaque nouveau', () => {
        const layouts = [l(3, 'a'), l(1, 'b'), l(2, 'c'), l(0, 'd'), l(1, 'e')]
        const same = layouts
        const order = sortStockFirst(layouts, unlimitedLayoutTest(payload))
        expect(layouts).toBe(same)
        expect(layouts.map((x) => x.tag)).toEqual(['b', 'd', 'e', 'a', 'c'])
        expect(order).toEqual([1, 3, 4, 0, 2])
    })

    it('en bande, l\'unique conteneur est le 0, quel que soit le container_id écrit par le moteur', () => {
        const strip = (ids) => unlimitedLayoutTest({ instance: { strip_height: 10 }, stockPriority: { unlimitedBins: ids } })
        expect(strip([0])({ container_id: 1129054434 })).toBe(true)
        expect(strip([])({ container_id: 0 })).toBe(false)
    })

    it('payload sans tôle illimitée : null', () => {
        expect(unlimitedLayoutTest({ instance: {} })).toBeNull()
        expect(unlimitedLayoutTest(null)).toBeNull()
    })
})

describe('le score d\'une option livrée', () => {
    const payload = {
        instance: { bins: [{ cost: 0 }, { cost: 1 }, { cost: 200 }] }, stockPriority: { unlimitedBins: [2] },
    }
    const row = (supply, partsAreaMm2, partCount = 1) => ({ supply, partsAreaMm2, partCount })

    it('le rapport dit l\'origine et l\'aire, la solution le conteneur (coût des neuves)', () => {
        const report = { unplaced: 2, sheets: [row('stock', 500), row('stock', 250), row('new', 900), row('new', 100)] }
        const solution = { layouts: [{ container_id: 1 }, { container_id: 0 }, { container_id: 2 }, { container_id: 2 }] }
        expect(deliveredScore(report, solution, payload)).toEqual({ unplaced: 2, newCost: 400, stockArea: 750, stockSheets: 2 })
    })

    it('en bande, une tôle à prévoir vaut 1', () => {
        const strip = { instance: { strip_height: 10 }, stockPriority: { unlimitedBins: [0] } }
        expect(deliveredScore({ unplaced: 0, sheets: [row('new', 10)] }, { layout: {} }, strip))
            .toEqual({ unplaced: 0, newCost: 1, stockArea: 0, stockSheets: 0 })
    })

    it('rapport sans origine : null', () => {
        expect(deliveredScore({ sheets: [{ partCount: 1 }] }, { layouts: [] }, payload)).toBeNull()
        expect(deliveredScore(null, null, payload)).toBeNull()
    })
})
