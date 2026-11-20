import { beforeEach, describe, expect, it, vi } from 'vitest'

// Passes qui posent ou déplacent des pièces en traitant la tôle comme un
// rectangle plein : elles ne tournent PAS pour un job qui porte une tôle
// importée (payload.shapedSheets) et tournent toujours pour un job ordinaire.

const spies = vi.hoisted(() => ({
    fillResidualBands: vi.fn(),
    buildGridLayoutsMulti: vi.fn(async () => null),
}))

vi.mock('../composables/geometryClient', () => ({
    geoExportSvgSheet: vi.fn(async () => '<svg/>'),
    geoComputeReport: vi.fn(async () => ({ per_sheet: [], totals: null })),
    geoExportDxfSheet: vi.fn(async () => null),
    geoPinwheelCapacity: vi.fn(async () => ({ rotations: [] })),
}))
vi.mock('../composables/residualClient', async (importOriginal) => ({
    ...(await importOriginal()),
    fillResidualBands: spies.fillResidualBands,
}))
vi.mock('../composables/structureMultiClient', () => ({
    buildGridLayoutsMulti: spies.buildGridLayoutsMulti,
}))

import { assembleBrowserArtifacts } from '../composables/finalizeLocal'
import { buildAlternativeArtifacts } from '../composables/localBridge'

const SQ = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
const BIN = (id) => ({ id, stock: 2, shape: { data: { outer: [[0, 0], [100, 0], [100, 200], [0, 200], [0, 0]] } } })
const place = (x) => ({ item_id: 0, transformation: { rotation: 0, translation: [x, 50] } })

const bppPayload = (extra = {}) => ({
    problem: 'bpp',
    instance: { name: 't', bins: [BIN(0)], items: [{ id: 0, demand: 2 }] },
    engineConfig: { min_item_separation: 2 },
    parts: [{ id: 0, file_slug: 'f0', coords: SQ, holes: [], count: 2 }],
    ...extra,
})
const bppResult = () => ({
    problem: 'bpp',
    alternatives: [{
        rank: 0,
        seed: 1,
        solution: {
            layouts: [
                { container_id: 0, placed_items: [place(20)] },
                { container_id: 0, placed_items: [place(60)] },
            ],
        },
    }],
})
const SHAPED = { shapedSheets: [{ id: 0, usableAreaMm2: 19600, perimeterMm: 680 }] }

beforeEach(() => {
    spies.fillResidualBands.mockClear()
    spies.buildGridLayoutsMulti.mockClear()
})

describe('bandes résiduelles (fillResidualBands + hole-fill qui les suit)', () => {
    it('job ordinaire à deux tôles : la passe tourne', async () => {
        await buildAlternativeArtifacts(bppResult(), bppPayload())
        expect(spies.fillResidualBands).toHaveBeenCalledTimes(1)
    })

    it('job à tôle importée : la passe est sautée', async () => {
        const arts = await buildAlternativeArtifacts(bppResult(), bppPayload(SHAPED))
        expect(spies.fillResidualBands).not.toHaveBeenCalled()
        // Le reste de la finalisation continue : deux tôles, une pièce sur chacune.
        expect(arts[0].containers).toHaveLength(2)
        expect(arts[0].containers[0].transforms).toHaveLength(1)
    })
})

describe('alternative structurelle « grille » BPP (appendBppGrid)', () => {
    it('job ordinaire : la grille est tentée', async () => {
        await assembleBrowserArtifacts({ result: bppResult(), payload: bppPayload(), sources: {}, jobSlug: 'j' })
        expect(spies.buildGridLayoutsMulti).toHaveBeenCalledTimes(1)
    })

    it('job à tôle importée : jamais tentée, la raison est tracée', async () => {
        const out = await assembleBrowserArtifacts({
            result: bppResult(), payload: bppPayload(SHAPED), sources: {}, jobSlug: 'j',
        })
        expect(spies.buildGridLayoutsMulti).not.toHaveBeenCalled()
        expect(out.structMultiDiag).toEqual({ built: false, skipped: 'shaped_sheet' })
        // Aucune alternative « grille » ajoutée aux alternatives moteur.
        expect(out.result.alternatives.some((a) => a.structural)).toBe(false)
    })
})
