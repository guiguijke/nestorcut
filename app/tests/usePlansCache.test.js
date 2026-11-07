import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Le catalogue dépend du pays du visiteur : le cache de ce module ne doit rien
// partager côté serveur, et l'hydratation doit reprendre ce que le serveur a
// rendu, sinon les boutons de /plans changent au premier rendu client.
describe('usePlans : cache du catalogue', () => {
    let opts
    beforeEach(() => {
        vi.resetModules()
        vi.stubGlobal('ref', (value) => ({ value }))
        vi.stubGlobal('useFetch', (_url, o) => { opts = o; return {} })
    })

    it('hydratation : le payload du serveur est repris tel quel', async () => {
        const { usePlans } = await import('../composables/usePlans')
        usePlans()
        const data = { standard: { available: true } }
        expect(opts.getCachedData('k', { isHydrating: true, payload: { data: { k: data } } })).toBe(data)
        // Et il reste valable pour la navigation suivante, sans relecture.
        expect(opts.getCachedData('k', { isHydrating: false, payload: { data: {} } })).toBe(data)
    })

    it('sans cache ni payload : le fetch part', async () => {
        const { usePlans } = await import('../composables/usePlans')
        usePlans()
        expect(opts.getCachedData('k', { isHydrating: false, payload: { data: {} } })).toBeUndefined()
    })

    it('côté serveur : rien de partagé entre visiteurs', () => {
        const src = readFileSync(resolve(__dirname, '../composables/usePlans.js'), 'utf8')
        expect(src).toMatch(/if \(import\.meta\.server\) return undefined/)
        const firstUse = src.indexOf('nuxtApp.payload.data')
        expect(src.indexOf('import.meta.server')).toBeLessThan(firstUse)
    })
})
