import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toTrackData, trackEvent } from '../utils/track'

// d8 (02/11) : /api/track rejette (400) toute valeur `data` qui n'est pas une
// chaîne. Le client convertit donc tout avant l'envoi, en un seul endroit.

describe('toTrackData', () => {
    it('convertit booléens, nombres et objets en chaînes ; écarte null et undefined', () => {
        expect(toTrackData({ a: true, b: 3, c: null, d: 'ok', e: { x: 1 }, f: undefined, g: false, h: 0 })).toEqual({
            a: 'true',
            b: '3',
            d: 'ok',
            e: '{"x":1}',
            g: 'false',
            h: '0',
        })
    })

    it('tronque chaque valeur à 500 caractères', () => {
        const out = toTrackData({ long: 'x'.repeat(600), exact: 'y'.repeat(500) })
        expect(out.long).toHaveLength(500)
        expect(out.exact).toHaveLength(500)
        // Un objet sérialisé est tronqué comme une chaîne.
        expect(toTrackData({ big: { s: 'z'.repeat(800) } }).big).toHaveLength(500)
    })

    it('sans argument ou avec null : objet vide', () => {
        expect(toTrackData()).toEqual({})
        expect(toTrackData(null)).toEqual({})
    })

    it('toutes les valeurs rendues sont des chaînes', () => {
        const out = toTrackData({ n: 1, b: true, o: { k: [1, 2] }, s: 's' })
        for (const value of Object.values(out)) expect(typeof value).toBe('string')
    })
})

describe('trackEvent', () => {
    beforeEach(() => {
        globalThis.$fetch = vi.fn(async () => ({}))
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
        delete globalThis.$fetch
        vi.restoreAllMocks()
    })

    it('envoie un corps { action, data } dont toutes les valeurs sont des chaînes', async () => {
        await trackEvent('x', { a: true, b: 3, c: null, d: 'ok', e: { x: 1 } })
        expect(globalThis.$fetch).toHaveBeenCalledTimes(1)
        const [url, options] = globalThis.$fetch.mock.calls[0]
        expect(url).toBe('/api/track')
        expect(options.method).toBe('POST')
        expect(options.body).toEqual({ action: 'x', data: { a: 'true', b: '3', d: 'ok', e: '{"x":1}' } })
    })

    it('une valeur de 600 caractères part tronquée à 500', async () => {
        await trackEvent('x', { long: 'a'.repeat(600) })
        expect(globalThis.$fetch.mock.calls[0][1].body.data.long).toHaveLength(500)
    })

    it('sans données : data vaut un objet vide', async () => {
        await trackEvent('page_view')
        expect(globalThis.$fetch.mock.calls[0][1].body).toEqual({ action: 'page_view', data: {} })
    })

    it('un $fetch qui rejette ne lève aucune exception', async () => {
        globalThis.$fetch = vi.fn(async () => {
            throw new Error('réseau')
        })
        await expect(trackEvent('x', { a: 1 })).resolves.toBeUndefined()
        expect(console.warn).toHaveBeenCalled()
    })

    it('une donnée non sérialisable (référence circulaire) ne lève pas non plus, rien n’est envoyé', async () => {
        const loop = {}
        loop.self = loop
        await expect(trackEvent('x', { loop })).resolves.toBeUndefined()
        expect(globalThis.$fetch).not.toHaveBeenCalled()
        expect(console.warn).toHaveBeenCalled()
    })
})
