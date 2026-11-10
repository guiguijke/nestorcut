import { describe, it, expect } from 'vitest'
import { buildLiveLayout } from '~/composables/finalizeLocal'
import { decorateLiveLayout } from '~/composables/localBridge'

// La frame finale de la vue en direct porte la densité mesurée du résultat
// (pièces / tôles), pas la densité brute du moteur (pièces / bande).
describe('buildLiveLayout : densité', () => {
    const payload = { problem: 'spp', sheets: [{ width: 1000, height: 2000 }] }
    const alt = { solution: { density: 0.94, layouts: [{ placed_items: [] }] }, density: 0.94 }

    it('reprend la densité mesurée passée, jamais celle du moteur', () => {
        const live = buildLiveLayout({ problem: 'spp' }, payload, alt, 0.111)
        expect(live.density).toBeCloseTo(0.111, 9)
    })

    it('sans densité mesurée : aucun chiffre', () => {
        const live = buildLiveLayout({ problem: 'spp' }, payload, alt)
        expect(live.density).toBeNull()
    })

    // La frame finale repasse par decorateLiveLayout : ses `sheets` ne citent
    // qu'un format, le recalcul donnerait la première tôle × le nombre de tôles.
    it('la décoration garde la densité du résultat, même avec plusieurs formats', () => {
        const bpp = { problem: 'bpp', parts: [
            { id: 0, shape: { data: { outer: [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]] } } },
        ] }
        const bppAlt = { solution: { layouts: [
            { placed_items: [{ item_id: 0, transformation: { rotation: 0, translation: [0, 0] } }] },
            { placed_items: [{ item_id: 0, transformation: { rotation: 0, translation: [0, 0] } }] },
        ] } }
        const measured = buildLiveLayout({ problem: 'bpp' }, bpp, bppAlt, 0.296)
        expect(measured.densityMeasured).toBe(true)
        expect(decorateLiveLayout(measured, bpp).density).toBeCloseTo(0.296, 9)
        const none = buildLiveLayout({ problem: 'bpp' }, bpp, bppAlt)
        expect(decorateLiveLayout(none, bpp).density).toBeNull()
    })
})
