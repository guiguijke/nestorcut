/**
 * Tôle illimitée, vue live : pendant la recherche la tôle de chaque rang est
 * DÉDUITE des pièces posées ; la dernière image, elle, porte déjà la tôle exacte
 * de chaque rang (stock d'abord) et la déduction ne la remplace pas. Le calcul
 * du navigateur est joué avec un pool et une finalisation simulés.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
const bin = (id, stock, w, h) => ({ id, stock, cost: id, shape: { type: 'polygon', data: { outer: rect(w, h) } } })
const payload = {
    problem: 'bpp',
    instance: {
        name: 'live',
        bins: [bin(0, 1, 600, 800), bin(1, 999, 1000, 2000)],
        items: [{ id: 0, demand: 2, shape: { type: 'simple_polygon', data: rect(100, 150) } }],
    },
    engineConfig: { prng_seed: '1', n_alternatives: 1 },
    parts: [{ id: 0, count: 2, coords: rect(100, 150), holes: [], rotations: [0] }],
    stockPriority: { unlimitedBins: [1] },
}
/** Une pièce au rang 0, une au rang 1 : [item, rang, rotation, x, y]. */
const items = [[0, 0, 0, 5, 5], [0, 1, 0, 700, 900]]
/** Des boîtes qu'aucune déduction ne rendrait. */
const exact = [[111, 222], [333, 444]]

describe('image finale d\'un calcul à tôle illimitée', () => {
    beforeEach(() => { vi.resetModules() })
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.doUnmock('../composables/localPool')
        vi.doUnmock('../composables/finalizeClient')
    })

    it('la tôle de chaque rang vient de la finalisation, pas de la déduction', async () => {
        vi.stubGlobal('$fetch', vi.fn(async (url) => (url.endsWith('/local-payload') ? structuredClone(payload) : { ok: true })))
        vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0))
        vi.doMock('../composables/localPool', () => ({
            resolvePoolShape: () => ({ walks: 1, concurrency: 1 }),
            runPool: async (_, __, { onLive }) => {
                onLive({ type: 'layout', items, sheets: [[600, 800]] })
                return { ok: true, result: { problem: 'bpp', alternatives: [] } }
            },
        }))
        vi.doMock('../composables/finalizeClient', () => ({
            // Toutes les options écartées : le calcul s'arrête juste après l'image.
            assembleBrowserArtifactsOffThread: async () => ({
                alternatives: [], placed: 0, allAlternativesInvalid: true,
                liveLayout: { stage: 'final', items, sheets: exact, bins: 2 },
            }),
        }))
        const { runLocalJobPrivate } = await import('../composables/localJobPrivate')
        const frames = []
        const res = await runLocalJobPrivate('job-live', { projectSlug: 'p', onLive: (f) => frames.push(f) })
        expect(res).toEqual({ ok: false, error: 'all_alternatives_invalid' })
        const searching = frames.find((f) => f.items && f.stage !== 'final')
        expect(searching.binFormats).toHaveLength(2)
        const final = frames.find((f) => f.stage === 'final')
        expect(final.sheets).toEqual(exact)
        expect('binFormats' in final).toBe(false)
    })
})
