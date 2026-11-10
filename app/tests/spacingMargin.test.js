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
        reportSpaces.push(spec.space)
        return {
            per_sheet: [], totals: null,
            verify: { smallestGapMm: Math.round(gap * 1000) / 1000, spacingOk: gap >= spec.space - 0.01 },
        }
    }),
    geoExportDxfSheet: vi.fn(async () => null),
}))

// Espace réellement transmis au rapport wasm, par appel.
const reportSpaces = []
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

    const reportFor = async (x2) => {
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
            alternatives: [{ rank: 0, seed: 1, solution: { layout: { container_id: 0, placed_items: [t(500), t(x2)] } } }],
        }
        reportSpaces.length = 0
        const arts = await buildAlternativeArtifacts(result, payload)
        return arts[0].report.verify
    }

    it('le rapport reçoit l’espacement INTERNE ; l’écart annoncé = mesuré − marge, jugé contre le demandé', async () => {
        const v = await reportFor(512.12) // interne 2,12 posé exactement
        expect(reportSpaces).toEqual([2.12])
        expect(v.smallestGapMm).toBeCloseTo(2.0, 9)
        expect(v.spacingOk).toBe(true)
    })

    it('un déficit caché par l’écart interne est vu : paire à 2,05 (interne 2,12) -> 1,93, spacingOk faux', async () => {
        const v = await reportFor(512.05)
        expect(v.smallestGapMm).toBeCloseTo(1.93, 9)
        expect(v.spacingOk).toBe(false)
    })

    it('l’écart annoncé n’est jamais négatif à cause de la marge', async () => {
        const v = await reportFor(510.05)
        expect(v.smallestGapMm).toBe(0)
        expect(v.spacingOk).toBe(false)
    })
})

describe('arc peu cintré aplati en peu de segments', () => {
    const flatArcRect = () => {
        const s = 0.056
        const R = (30 * 30 + s * s) / (2 * s)
        const sag = (x) => Math.sqrt(R * R - (x - 30) ** 2) - (R - s)
        return [[0, 0], [60, 0], [60, 30], [40, 30 + sag(40)], [20, 30 + sag(20)], [0, 30], [0, 0]]
    }

    it('6 sommets mais sommets retirés : la réserve d’aplatissement s’ajoute', () => {
        const ring = flatArcRect()
        const { coords } = simplifyPart(ring, [])
        expect(coords.length).toBeLessThan(ring.length)
        const gap = measuredGap(ring, coords)
        expect(gap).toBeGreaterThan(0.04)
        expect(computeSpacingMargin([fileOf(ring)], 2)).toBeCloseTo(Math.min(0.12, 2 * gap + 0.02), 9)
    })

    it('rectangle avec un sommet colinéaire : marge 0', () => {
        const ring = [[0, 0], [20, 0], [40, 0], [40, 20], [0, 20], [0, 0]]
        expect(computeSpacingMargin([fileOf(ring)], 2)).toBe(0)
    })
})

describe('espacement maximal dit à l’utilisateur (panneau de capacité)', () => {
    it('arrondi au centième par défaut, plus de 0.04093972273017499', async () => {
        const { userMaxSpacing } = await import('../composables/localPayloadBuilder')
        expect(userMaxSpacing(0.04093972273017499, 0)).toEqual({ maxSpacingForFitMm: 0.04 })
        expect(userMaxSpacing(2.1396, 0.0996)).toEqual({ maxSpacingForFitMm: 2.04 })
        expect(userMaxSpacing(2.1, 0.1)).toEqual({ maxSpacingForFitMm: 2 })
    })

    it('0 < maximum interne <= marge : 0 mm est un vrai levier (0 passe, marge nulle)', async () => {
        const { userMaxSpacing } = await import('../composables/localPayloadBuilder')
        expect(userMaxSpacing(0.1, 0.12)).toEqual({ maxSpacingForFitMm: 0, maxSpacingZeroFits: true })
        expect(userMaxSpacing(0.12, 0.12)).toEqual({ maxSpacingForFitMm: 0, maxSpacingZeroFits: true })
    })

    it('maximum interne 0 : rien ne tient même sans espacement, pas de levier', async () => {
        const { userMaxSpacing } = await import('../composables/localPayloadBuilder')
        expect(userMaxSpacing(0, 0.12)).toEqual({ maxSpacingForFitMm: 0 })
        expect(userMaxSpacing(0, 0)).toEqual({ maxSpacingForFitMm: 0 })
    })

    it('le refus de capacité d’un disque annonce un maximum arrondi au centième', async () => {
        const files = [{ ...fileOf(disc(50)), count: 400 }]
        let err = null
        try {
            await buildLocalPayload({ files, params: { sheets: [{ width: 1000, height: 1000, count: 1 }], space: 2, alternativesCount: 1 } })
        } catch (e) { err = e }
        expect(err?.message).toBe('capacity_exceeded')
        const v = err.__unfit.maxSpacingForFitMm
        expect(Math.round(v * 100) / 100).toBe(v)
    })
})
