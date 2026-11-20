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

// Image finale de la page projet : chaque tôle à SA taille. Avec la seule
// boîte du premier format, une tôle 800 x 800 placée après une 500 x 500 était
// dessinée en 500 x 500 et ses pièces coupées.
describe('buildLiveLayout : boîte de chaque tôle', () => {
    const rect = (w, h) => ({ shape: { type: 'polygon', data: { outer: [[0, 0], [w, 0], [w, h], [0, h], [0, 0]] } } })
    const pose = { item_id: 0, transformation: { rotation: 0, translation: [10, 10] } }

    it('deux formats rectangulaires : une boîte par tôle, dans l\'ordre des tôles', () => {
        const payload = { problem: 'bpp', instance: { bins: [rect(500, 500), rect(800, 800)] } }
        const alt = { solution: { layouts: [
            { container_id: 1, placed_items: [pose] },
            { container_id: 0, placed_items: [pose] },
            { container_id: 1, placed_items: [pose] },
        ] } }
        const live = buildLiveLayout({ problem: 'bpp' }, payload, alt, 0.5)
        expect(live.sheets).toEqual([[800, 800], [500, 500], [800, 800]])
        // Pas de forme à dessiner : aucun champ de tôle importée.
        expect(live.binFormats).toBeUndefined()
    })

    it('un seul format : frame inchangée, une seule boîte', () => {
        const payload = { problem: 'bpp', instance: { bins: [rect(1000, 2000)] } }
        const alt = { solution: { layouts: [
            { container_id: 0, placed_items: [pose] },
            { container_id: 0, placed_items: [pose] },
        ] } }
        const live = buildLiveLayout({ problem: 'bpp' }, payload, alt, 0.5)
        expect(live.sheets).toEqual([[1000, 2000]])
        expect(live.binFormats).toBeUndefined()
    })
})
