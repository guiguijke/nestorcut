import { describe, it, expect } from 'vitest'
import { buildLiveLayout } from '~/composables/finalizeLocal'

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
})
