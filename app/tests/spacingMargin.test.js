// Espacement tenu sur les vraies courbes : l'espacement INTERNE (envoyé au
// moteur) = espacement DEMANDÉ + marge mesurée ; tout ce qui est dit à
// l'utilisateur se juge contre le DEMANDÉ.
import { describe, expect, it, vi } from 'vitest'
import { buildLocalPayload, simplifyPart, computeSpacingMargin } from '../composables/localPayloadBuilder'

vi.mock('../composables/geometryClient', () => ({
    geoExportSvgSheet: vi.fn(async () => '<svg/>'),
    // Bouchon du rapport wasm : spacingOk = écart minimal >= space - 0,01
    // (même règle que nest-report::verify_layout), écart lu sur les poses.
    geoComputeReport: vi.fn(async (spec) => {
        const xs = spec.containers[0].transforms.map((t) => t.x).sort((a, b) => a - b)
        const gap = xs[1] - xs[0] - 10
        return { per_sheet: [], totals: null, verify: { spacingOk: gap >= spec.space - 0.01, gap } }
    }),
    geoExportDxfSheet: vi.fn(async () => null),
}))

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
const disc = (r, n = 160) => {
    const pts = []
    for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n
        pts.push([r * Math.cos(a), r * Math.sin(a)])
    }
    pts.push([...pts[0]])
    return pts
}
const fileOf = (coordinates) => ({
    slug: 'a.dxf', name: 'a.dxf', count: 2, rotations: [0, 90],
    parts: [{ coordinates, holes: [], handles: ['A'], color: null }],
})
const paramsOf = (space) => ({ sheets: [{ width: 1000, height: 1000, count: 1 }], space, alternativesCount: 1 })

// Écart mesuré indépendamment : plus grande distance sommet d'origine -> anneau simplifié.
const segDist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const L = dx * dx + dy * dy
    const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
const measuredGap = (orig, simp) => {
    let g = 0
    for (const p of orig) {
        let d = Infinity
        for (let i = 0; i < simp.length - 1; i++) d = Math.min(d, segDist(p, simp[i], simp[i + 1]))
        g = Math.max(g, d)
    }
    return g
}

describe('marge d’espacement', () => {
    it('rectangles : marge 0, le moteur porte exactement 2 comme avant', async () => {
        const { payload } = await buildLocalPayload({ files: [fileOf(rect(40, 20))], params: paramsOf(2) })
        expect(payload.engineConfig.min_item_separation).toBe(2)
        expect(payload.requestedSpace).toBe(2)
        expect(computeSpacingMargin([fileOf(rect(40, 20))], 2)).toBe(0)
    })

    it('disque r=50 aplati à 0,01 puis simplifié à 0,05 : 2 × écart + 0,02, plafonné à 0,12', () => {
        const ring = disc(50)
        const { coords } = simplifyPart(ring, [])
        const gap = measuredGap(ring, coords)
        expect(gap).toBeGreaterThan(0)
        const margin = computeSpacingMargin([fileOf(ring)], 2)
        expect(margin).toBeGreaterThan(0)
        expect(margin).toBeLessThanOrEqual(0.12)
        expect(margin).toBeCloseTo(Math.min(0.12, 2 * gap + 0.02), 9)
    })

    it('espacement demandé 0 : marge 0, min_item_separation null comme avant', async () => {
        expect(computeSpacingMargin([fileOf(disc(50))], 0)).toBe(0)
        const { payload } = await buildLocalPayload({ files: [fileOf(disc(50))], params: paramsOf(0) })
        expect(payload.engineConfig.min_item_separation).toBeNull()
        expect(payload.requestedSpace).toBe(0)
    })

    it('le payload d’un disque porte demandé 2 et interne 2 + marge', async () => {
        const { payload } = await buildLocalPayload({ files: [fileOf(disc(50))], params: paramsOf(2) })
        expect(payload.requestedSpace).toBe(2)
        expect(payload.engineConfig.min_item_separation).toBeCloseTo(2 + computeSpacingMargin([fileOf(disc(50))], 2), 12)
    })

    it('le rapport de vérification juge contre le DEMANDÉ : paire à 2,05, demandé 2, interne 2,12', async () => {
        const { buildAlternativeArtifacts } = await import('../composables/localBridge')
        const sq = [[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]]
        const payload = {
            problem: 'spp',
            instance: { strip_height: 1000, items: [{ id: 0, demand: 2 }] },
            engineConfig: { max_strip_width: 1000, min_item_separation: 2.12 },
            requestedSpace: 2,
            parts: [{ id: 0, file_slug: 'f0', coords: sq, holes: [], count: 2 }],
        }
        const t = (x) => ({ item_id: 0, transformation: { rotation: 0, translation: [x, 500] } })
        const result = {
            problem: 'spp',
            alternatives: [{ rank: 0, seed: 1, solution: { layout: { container_id: 0, placed_items: [t(500), t(512.05)] } } }],
        }
        const arts = await buildAlternativeArtifacts(result, payload)
        expect(arts[0].report.verify.spacingOk).toBe(true)
    })
})
