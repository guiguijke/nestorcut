import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Distance au bord : les refus du constructeur gardent leur PROPRE code et leur
// détail jusqu'à la page (chemin local-fail, comme `strip_height`), et le
// registre garde le détail après l'éviction des champs lourds.

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]

describe('runLocalJobPrivate : refus « distance au bord » du constructeur', () => {
    beforeEach(() => { vi.resetModules() })
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.doUnmock('../composables/localFilesStore')
        vi.doUnmock('../composables/geometryClient')
    })

    async function runWith(params) {
        const calls = []
        vi.stubGlobal('$fetch', vi.fn(async (url, opts) => {
            calls.push({ url, body: opts?.body })
            if (url.endsWith('/local-payload')) {
                return {
                    mode: 'client-built',
                    files: [{ slug: 'petite', count: 2, rotations: [0, 90] }],
                    params,
                    localConfig: { timeBudgetSec: 2, walks: 1 },
                }
            }
            return { ok: true }
        }))
        vi.doMock('../composables/localFilesStore', () => ({
            getLocalFile: async (slug) => ({
                slug, name: 'Petite pièce.dxf', dxfBytes: new Uint8Array([1]),
                parts: [{ coordinates: rect(0, 0, 20, 8), holes: [], handles: ['A'], color: null }],
            }),
        }))
        vi.doMock('../composables/geometryClient', () => ({
            geoOpenHoles: vi.fn(), geoPinwheelCapacity: vi.fn(), geoOffsetRing: vi.fn(),
        }))
        const { runLocalJobPrivate } = await import('../composables/localJobPrivate')
        const res = await runLocalJobPrivate('job-edge', { projectSlug: 'p' })
        return { res, calls }
    }

    it('surplomb trop grand : code edge_overhang_too_large, détail chiffré, local-fail avec le code', async () => {
        const { res, calls } = await runWith({ sheets: [{ width: 500, height: 500, count: 1 }], space: 2, edgeDistance: -5 })
        expect(res).toEqual({
            ok: false,
            error: 'edge_overhang_too_large',
            edgeDetail: { maxOverhangMm: 4, part: 'Petite pièce.dxf' },
        })
        const fail = calls.find((c) => c.url.endsWith('/local-fail'))
        expect(fail.body.error).toBe('edge_overhang_too_large')
    })

    it('bord trop grand pour la tôle : edge_too_large et la valeur qui passerait', async () => {
        const { res } = await runWith({ sheets: [{ width: 60, height: 60, count: 1 }], space: 2, edgeDistance: 25 })
        expect(res.ok).toBe(false)
        expect(res.error).toBe('edge_too_large')
        // Pièce 20 × 8 : min((60 − 20) / 2, (60 − 8) / 2) = 20.
        expect(res.edgeDetail).toEqual({ maxEdgeMm: 20 })
    })
})

describe('localSolverRegistry : le détail du refus de bord reste pour la page', () => {
    beforeEach(() => { vi.resetModules() })

    it('edgeDetail gardé avec le code', async () => {
        const mod = await import('../composables/localSolverRegistry')
        mod.configureSolver({
            run: async () => ({ ok: false, error: 'edge_too_large', edgeDetail: { maxEdgeMm: 12.5 } }),
            cancel: async () => {},
        })
        mod.ensureJob({ slug: 'je', itemMap: [] }, { projectSlug: 'pe', maxConcurrent: 1 })
        await new Promise((r) => setTimeout(r, 30))
        expect(mod.progressFor('pe')).toMatchObject({ phase: 'error', error: 'edge_too_large', edgeDetail: { maxEdgeMm: 12.5 } })
    })
})
