import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runPool } from '../composables/localPool'
import { runInWorker } from '../composables/localCompute'

// Tôle concave : les walks ET la fusion reçoivent l'instance substituée
// (enveloppe + poches) et narrow_concavity_cutoff null ; tout le reste part
// comme avant, même référence. Worker simulé, jamais de vrai wasm.

class MockWorker {
    constructor() {
        this.messages = []
        MockWorker.instances.push(this)
    }

    postMessage(msg) {
        this.messages.push(msg)
        queueMicrotask(() => {
            if (msg.op === 'merge') {
                this.onmessage?.({ data: { id: msg.id, jobSlug: msg.jobSlug, ok: true, result: JSON.stringify({ problem: 'bpp', alternatives: [] }) } })
                return
            }
            this.onmessage?.({
                data: {
                    ok: true,
                    jobSlug: msg.jobSlug,
                    result: { problem: 'bpp', sol_instance: {}, alternatives: [{ rank: 0, seed: 1, bias: 'left', evaluations: 1, density: 0.5, solution: { layouts: [] } }] },
                    memory: { pagesBefore: 1, pagesAfter: 2 },
                },
            })
        })
    }

    terminate() {}
}
MockWorker.instances = []

beforeEach(() => {
    MockWorker.instances = []
    vi.stubGlobal('Worker', MockWorker)
})
afterEach(() => vi.unstubAllGlobals())

const RECT = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]
const L_SHAPE = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100], [0, 0]]
const HAZARD = [[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]
const octagon = Array.from({ length: 8 }, (_, i) => [50 + 50 * Math.cos((Math.PI * i) / 4), 50 + 50 * Math.sin((Math.PI * i) / 4)])
const bin = (id, outer, inner) => ({ id, cost: 1, stock: 1, shape: { type: 'polygon', data: inner ? { outer, inner } : { outer } } })

function payloadOf(bins, shaped) {
    return {
        problem: 'bpp',
        instance: { name: 't', items: [{ id: 0, demand: 1 }], bins },
        engineConfig: { time_budget_sec: 13, prng_seed: '42', n_alternatives: 3, narrow_concavity_cutoff: [0.01, 0.01], biases: ['left', 'bottom', 'balanced'] },
        parts: [],
        walks: 3,
        ...(shaped ? { shapedSheets: shaped.map((id) => ({ id, usableAreaMm2: 1, perimeterMm: 1 })) } : {}),
    }
}

async function run(payload) {
    await runPool('job-hull', payload)
    const solves = MockWorker.instances.flatMap((w) => w.messages.filter((m) => m.op !== 'merge'))
    const merges = MockWorker.instances.flatMap((w) => w.messages.filter((m) => m.op === 'merge')).map((m) => m.merge)
    return { solves, merges }
}

describe('localPool — tôle concave : instance substituée aux walks et à la fusion', () => {
    it('chaque walk et la fusion reçoivent la même instance substituée, cutoff null', async () => {
        const payload = payloadOf([bin(0, L_SHAPE)], [0])
        const snap = JSON.stringify(payload)
        const { solves, merges } = await run(payload)
        expect(solves).toHaveLength(3)
        expect(merges).toHaveLength(1)
        const swapped = solves[0].instance
        expect(swapped).not.toBe(payload.instance)
        for (const m of solves) {
            expect(m.instance).toBe(swapped)
            expect(m.engineConfig.narrow_concavity_cutoff).toBeNull()
            expect(m.engineConfig.n_workers).toBe(1)
        }
        expect(merges[0].instance).toBe(swapped)
        expect(merges[0].engineConfig.narrow_concavity_cutoff).toBeNull()
        expect(merges[0].engineConfig.finish_partial_sheet).toBe(false)
        const d = swapped.bins[0].shape.data
        expect(d.outer).toEqual([[0, 0], [100, 0], [100, 40], [40, 100], [0, 100], [0, 0]])
        expect(d.inner).toHaveLength(1)
        // Rien n'est muté : le rapport et le badge lisent payload.instance.bins.
        expect(JSON.stringify(payload)).toBe(snap)
        expect(payload.engineConfig.narrow_concavity_cutoff).toEqual([0.01, 0.01])
    })

    it('défauts dessinés : les hazards restent dans inner, les poches viennent après', async () => {
        const payload = payloadOf([bin(0, L_SHAPE, [HAZARD])], [0])
        const { solves } = await run(payload)
        const inner = solves[0].instance.bins[0].shape.data.inner
        expect(inner).toHaveLength(2)
        expect(inner[0]).toEqual(HAZARD)
    })

    it('job mixte rectangle + concave : seul le bin concave est substitué', async () => {
        const payload = payloadOf([bin(0, RECT), bin(1, L_SHAPE)], [1])
        const { solves, merges } = await run(payload)
        for (const inst of [solves[0].instance, merges[0].instance]) {
            expect(inst.bins[0]).toBe(payload.instance.bins[0])
            expect(inst.bins[1].shape.data.inner).toHaveLength(1)
        }
    })
})

describe('localPool — sans tôle concave : message identique à aujourd’hui', () => {
    const cases = {
        'tôle convexe': () => payloadOf([bin(0, [...octagon, octagon[0]])], [0]),
        'job rectangulaire': () => payloadOf([bin(0, RECT)]),
        'job mixte sans tôle concave': () => payloadOf([bin(0, RECT), bin(1, [...octagon, octagon[0]])], [1]),
        'bin concave hors shapedSheets': () => payloadOf([bin(0, L_SHAPE)], []),
    }
    for (const [name, make] of Object.entries(cases)) {
        it(name, async () => {
            const payload = make()
            const hasShaped = Array.isArray(payload.shapedSheets) && payload.shapedSheets.length > 0
            const { solves, merges } = await run(payload)
            for (const [w, m] of solves.entries()) {
                expect(m.instance).toBe(payload.instance)
                expect(m.engineConfig.narrow_concavity_cutoff).toEqual([0.01, 0.01])
                expect(Object.keys(m.engineConfig).sort()).toEqual(
                    Object.keys({ ...payload.engineConfig, n_workers: 1, separator_workers: 1, finish_partial_sheet: false }).sort(),
                )
                expect(w).toBeLessThan(3)
            }
            expect(merges[0].instance).toBe(payload.instance)
            expect(merges[0].engineConfig).toEqual({ ...payload.engineConfig, prng_seed: 0, ...(hasShaped ? { finish_partial_sheet: false } : {}) })
        })
    }
})

describe('localCompute.runInWorker — tôle concave', () => {
    const posted = []
    beforeEach(() => {
        posted.length = 0
        vi.stubGlobal('Worker', class {
            postMessage(msg) {
                posted.push(msg)
                queueMicrotask(() => this.onmessage?.({ data: { jobSlug: msg.jobSlug, ok: true, result: {} } }))
            }

            terminate() {}
        })
    })

    it('instance substituée et cutoff null', async () => {
        const payload = payloadOf([bin(0, L_SHAPE)], [0])
        await runInWorker('j-concave', payload)
        expect(posted[0].instance).not.toBe(payload.instance)
        expect(posted[0].instance.bins[0].shape.data.inner).toHaveLength(1)
        expect(posted[0].engineConfig.narrow_concavity_cutoff).toBeNull()
        expect(posted[0].engineConfig.finish_partial_sheet).toBe(false)
    })

    it('tôle convexe : même instance, config comme avant', async () => {
        const payload = payloadOf([bin(0, [...octagon, octagon[0]])], [0])
        await runInWorker('j-convex', payload)
        expect(posted[0].instance).toBe(payload.instance)
        expect(posted[0].engineConfig).toEqual({ ...payload.engineConfig, finish_partial_sheet: false })
    })

    it('job rectangulaire : la config passe sans modification', async () => {
        const payload = payloadOf([bin(0, RECT)])
        await runInWorker('j-rect', payload)
        expect(posted[0].instance).toBe(payload.instance)
        expect(posted[0].engineConfig).toBe(payload.engineConfig)
    })
})
