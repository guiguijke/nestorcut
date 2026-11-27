import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Retour du propriétaire (27/11) : « Imbriquer dans les trous » coché, et
// l'option GRILLE, montrée en premier, posait les petites pièces en rangées
// à côté des hôtes, trous vides. La grille remplit ses rangées d'abord et ne
// se sert des trous que pour le surplus : sur une grande tôle, jamais. Elle
// n'est plus proposée quand elle met dans les trous moins de pièces que le
// plan des trous (vrai rapport wasm, vrai chemin assembleBrowserArtifacts).

const BUNDLE_JS = path.resolve(__dirname, '../../public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.resolve(__dirname, '../../public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null }))

vi.mock('../composables/geometryClient', () => ({
    geoExportSvgSheet: vi.fn(async (spec) => glue.mod.export_svg_sheet(JSON.stringify(spec))),
    geoExportDxfSheet: vi.fn(async () => { throw new Error('pas de source dans ce test') }),
    geoPinwheelCapacity: vi.fn(async () => ({ rotations: [] })),
    geoComputeReport: vi.fn(async (spec) => JSON.parse(glue.mod.compute_report(JSON.stringify(spec)))),
}))

import { assembleBrowserArtifacts, plannedHoleFills } from '../composables/finalizeLocal'

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
})

const ringOf = (cx, cy, r, n = 64) => {
    const pts = Array.from({ length: n }, (_, k) => {
        const a = (2 * Math.PI * k) / n
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    })
    pts.push(pts[0])
    return pts
}
const square = (s) => [[0, 0], [s, 0], [s, s], [0, s], [0, 0]]
// Hôte : carré de 40 percé d'un trou rond de rayon 15 (centre 20 ; 20) ;
// petite pièce : carré de 8, une par trou.
const parts = [
    { id: 0, file_slug: 'hote', handles: ['H'], coords: square(40), holes: [ringOf(20, 20, 15)], count: 2, color: '#2563EB', rotations: [0] },
    { id: 1, file_slug: 'petite', handles: ['P'], coords: square(8), holes: [], count: 2, color: '#16A34A', rotations: [0] },
]
const place = (id, x, y) => ({ item_id: id, transformation: { rotation: 0, translation: [x, y] } })
const RECT = [[0, 0], [400, 0], [400, 300], [0, 300], [0, 0]]
const payloadOf = (opts = {}) => ({
    problem: 'bpp',
    instance: {
        name: 't',
        bins: [{ id: 0, cost: 1, stock: 1, shape: { type: 'polygon', data: { outer: RECT } } }],
        // Instance RÉDUITE : les petites pièces sont retirées (elles vont aux trous).
        items: [{ id: 0, demand: 2 }],
    },
    engineConfig: { min_item_separation: 2 },
    requestedSpace: 2,
    fillHoles: true,
    hasHoles: true,
    // Plan compressé « moulinet centré » : une petite pièce (rotation 0) au
    // centre du trou de chaque hôte.
    meta: { host: 0, fill: 1, slots: [1, 1], ringRotations: [[0]], idMap: [0] },
    parts,
    ...opts,
})
// Option du moteur : les deux hôtes (ids réduits) ; l'expansion met les petites
// pièces dans les trous. Option GRILLE (autonome, ids d'origine) : hôtes en
// rangée, petites pièces À CÔTÉ, trous vides.
const engineAlt = () => ({ rank: 0, seed: 1, bias: 'left', solution: { layouts: [{ container_id: 0, placed_items: [place(0, 10, 10), place(0, 60, 10)] }] } })
const gridAlt = () => ({
    rank: 0, seed: null, bias: null, structural: true, selfContained: true,
    solution: { layouts: [{ container_id: 0, placed_items: [place(0, 10, 10), place(0, 60, 10), place(1, 120, 10), place(1, 140, 10)] }] },
})

describe('« Imbriquer dans les trous » : pas d\'option grille aux trous vides', () => {
    it('plannedHoleFills : forme compressée, packs, option décochée, sans plan', () => {
        expect(plannedHoleFills(payloadOf())).toBe(2)
        expect(plannedHoleFills(payloadOf({ meta: { packs: [{ hostId: 0, fills: [{}, {}] }, { hostId: 0, fills: [{}] }], idMap: [0] } }))).toBe(3)
        expect(plannedHoleFills(payloadOf({ fillHoles: false }))).toBe(0)
        expect(plannedHoleFills(payloadOf({ meta: undefined }))).toBe(0)
    })

    it('la grille qui laisse les petites pièces hors des trous est écartée ; l\'option du moteur reste', async () => {
        const result = { problem: 'bpp', alternatives: [gridAlt(), engineAlt()] }
        const out = await assembleBrowserArtifacts({ result, payload: payloadOf(), sources: {}, jobSlug: 'job', withPositions: false })
        const reasons = out.localDiscarded.map((d) => d.reason)
        expect(reasons).toContain('holes_unused')
        expect(out.localDiscarded.find((d) => d.reason === 'holes_unused')).toMatchObject({ planned: 2, filled: 0 })
        expect(out.allAlternativesInvalid).toBe(false)
        expect(out.alternatives).toHaveLength(1)
        expect(out.alternatives[0].strategy).not.toBe('grid')
        // L'option gardée met bien les deux petites pièces dans les trous.
        expect(out.alternatives[0].report.holesFilled).toBe(2)
    })

    it('option décochée : la grille reste proposée (comportement d\'avant)', async () => {
        const payload = payloadOf({ fillHoles: false, meta: undefined, instance: { name: 't', bins: payloadOf().instance.bins, items: [{ id: 0, demand: 2 }, { id: 1, demand: 2 }] } })
        const result = { problem: 'bpp', alternatives: [gridAlt()] }
        const out = await assembleBrowserArtifacts({ result, payload, sources: {}, jobSlug: 'job', withPositions: false })
        expect(out.localDiscarded.map((d) => d.reason)).not.toContain('holes_unused')
        expect(out.alternatives).toHaveLength(1)
    })

    it('une grille qui met les petites pièces dans les trous reste proposée', async () => {
        // Petite pièce posée au centre du trou : (20 − 4 ; 20 − 4) dans l'hôte.
        const inHoles = () => ({
            ...gridAlt(),
            solution: { layouts: [{ container_id: 0, placed_items: [place(0, 10, 10), place(0, 60, 10), place(1, 26, 26), place(1, 76, 26)] }] },
        })
        const result = { problem: 'bpp', alternatives: [inHoles()] }
        const out = await assembleBrowserArtifacts({ result, payload: payloadOf(), sources: {}, jobSlug: 'job', withPositions: false })
        expect(out.localDiscarded.map((d) => d.reason)).not.toContain('holes_unused')
        expect(out.alternatives).toHaveLength(1)
    })
})
