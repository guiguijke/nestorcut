import { describe, expect, it } from 'vitest'
import { idlePaneModel } from '../utils/idlePanes'

const formatSize = (w, h) => `${Math.round(w * 10) / 10} mm × ${Math.round(h * 10) / 10} mm`

describe('idlePaneModel : un panneau par type de tôle', () => {
    it('une tôle rectangulaire : un panneau, libellé de taille, rien d\'autre', () => {
        const m = idlePaneModel([{ width: '1000', height: '2000', count: '1' }], { formatSize })
        expect(m.panes).toHaveLength(1)
        expect(m.panes[0]).toMatchObject({ w: 1000, h: 2000, shapeId: null, dx: 0, viewW: 2000, viewH: 1000 })
        expect(m.panes[0].landscape).toBe('translate(2000 0) rotate(90)')
        expect(m.panes[0].label).toBe('1000 mm × 2000 mm')
        expect(m.truncated).toBe(0)
    })

    it('disque + contour 950 x 523 : deux panneaux côte à côte, noms et tailles propres', () => {
        const m = idlePaneModel(
            [
                { width: '999.99', height: '999.995', count: '1', shapeId: 'a', name: 'Ø 1000 mm' },
                { width: '950', height: '523', count: '2', shapeId: 'b', name: '' },
            ],
            { formatSize }
        )
        expect(m.panes.map((p) => p.index)).toEqual([0, 1])
        expect(m.panes[0].label).toBe('Ø 1000 mm')
        expect(m.panes[0].shapeId).toBe('a')
        expect(m.panes[0].landscape).toBe('') // disque quasi carré : pas pivoté
        expect(m.panes[1].label).toBe('950 mm × 523 mm × 2')
        expect(m.panes[1].dx).toBeGreaterThan(m.panes[0].viewW)
        expect(m.totalW).toBeCloseTo(m.panes[1].dx + m.panes[1].viewW, 6)
        expect(m.totalH).toBeCloseTo(999.995, 3)
    })

    it('quantité 0 : non dessinée ; toutes à 0 : la première reste', () => {
        const some = idlePaneModel(
            [{ width: 100, height: 50, count: 0 }, { width: 300, height: 200, count: 1 }],
            { formatSize }
        )
        expect(some.panes.map((p) => p.index)).toEqual([1])
        const none = idlePaneModel([{ width: 100, height: 50, count: 0 }, { width: 300, height: 200, count: 0 }], { formatSize })
        expect(none.panes.map((p) => p.index)).toEqual([0])
    })

    it('plafond de 6 comme la vue live : le reste compte dans truncated', () => {
        const sheets = Array.from({ length: 10 }, (_, i) => ({ width: 100 + i, height: 50, count: 1 }))
        const m = idlePaneModel(sheets, { formatSize })
        expect(m.panes).toHaveLength(6)
        expect(m.truncated).toBe(4)
    })

    it('liste vide : tôle par défaut', () => {
        const m = idlePaneModel([], { formatSize })
        expect(m.panes).toHaveLength(1)
        expect(m.panes[0]).toMatchObject({ w: 1000, h: 2000 })
    })
})
