import { afterEach, describe, expect, it, vi } from 'vitest'
import { yieldForPaint } from '../composables/localJobPrivate'

// Constat du 26/11 : un calcul fini côté moteur restait « en recherche » tant
// que l'onglet (ou le panneau) était caché, parce que la finalisation attendait
// deux requestAnimationFrame que le navigateur suspend. Plus jamais d'attente
// sans fin.
afterEach(() => vi.unstubAllGlobals())

describe('yieldForPaint', () => {
    it('onglet caché : aucune attente', async () => {
        const raf = vi.fn()
        vi.stubGlobal('requestAnimationFrame', raf)
        vi.stubGlobal('document', { visibilityState: 'hidden' })
        await yieldForPaint()
        expect(raf).not.toHaveBeenCalled()
    })
    it('images suspendues sans onglet caché : rend la main après le délai', async () => {
        vi.stubGlobal('requestAnimationFrame', vi.fn()) // ne rappelle jamais
        vi.stubGlobal('document', { visibilityState: 'visible' })
        const t0 = Date.now()
        await yieldForPaint(50)
        expect(Date.now() - t0).toBeGreaterThanOrEqual(40)
    })
    it('onglet visible : attend deux images', async () => {
        const calls = []
        vi.stubGlobal('requestAnimationFrame', (cb) => { calls.push(cb); setTimeout(cb, 0) })
        vi.stubGlobal('document', { visibilityState: 'visible' })
        await yieldForPaint(5000)
        expect(calls).toHaveLength(2)
    })
    it('sans requestAnimationFrame (serveur, tests) : rien', async () => {
        await expect(yieldForPaint()).resolves.toBeUndefined()
    })
})
