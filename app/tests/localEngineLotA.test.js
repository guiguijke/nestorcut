/**
 * Lot A — le VRAI wasm de public/engine, sur les pannes de petits jobs.
 *
 * Avant le lot, le moteur MOURAIT (panic = "abort" : trap `unreachable`, le
 * calcul entier perdu) sur :
 *   1. le chemin par défaut : réglages d'usine (tôle 1000×2000, espacement 2,
 *      direction left), 2 pièces de 40×40 mm — la bascule J7-a envoie le job en
 *      BPP, les walks réussissent, puis la finition de `merge_alternatives`
 *      recrée une bande de 1,6 mm de large (strip.rs:54) ;
 *   2. une pièce à la cote exacte de la tôle (lbf.rs:74, ou zéro pièce posée
 *      et « invalid type: null, expected f32 » à la fusion) ;
 *   3. la volute du constat de la relecture critique, graines 100 et 101 du pool.
 *
 * Ce test charge le wasm commité, l'initialise avec les octets du fichier, et
 * passe le payload du VRAI `buildLocalPayload`. Il échoue si public/engine n'est
 * pas reconstruit avec les sources du moteur (piège 33b).
 *
 * Le miroir natif (mêmes cas) est dans
 * workers/nesting/engine/crates/nest-engine/tests/{small_job_default_path,
 * exact_fit_refusal}.rs ; le verrou natif ≡ wasm, dans
 * workers/nesting/bench/determinism_lock.py (fixture j7a_defaut).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildLocalPayload } from '../composables/localPayloadBuilder'
import { deriveSeed } from '../composables/localPool'

const root = fileURLToPath(new URL('../../', import.meta.url))
const engineDir = `${root}public/engine/`
const benchDir = `${root}workers/nesting/bench/`

let wasm

beforeAll(async () => {
    wasm = await import(/* @vite-ignore */ pathToFileURL(`${engineDir}nest_wasm.js`).href)
    await wasm.default({ module_or_path: readFileSync(`${engineDir}nest_wasm_bg.wasm`) })
})

const deps = { openHoles: async () => [], pinwheelCapacity: async () => null }
const square = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]

/** Les deux walks du pool (seeds dérivées comme localPool), bornés en travail. */
function playWalks(payload, nWalks) {
    const master = String(payload.engineConfig.prng_seed)
    const runs = []
    for (let w = 0; w < nWalks; w++) {
        const seed = deriveSeed(master, w).toString()
        const cfg = {
            ...payload.engineConfig, n_workers: 1, separator_workers: 1,
            finish_partial_sheet: false, problem: payload.problem, live_events: false,
            time_budget_sec: 3600, sa_max_iterations: 400,
        }
        delete cfg.plateau_patience_sec
        const out = JSON.parse(wasm.run_nesting(JSON.stringify(payload.instance), JSON.stringify(cfg), BigInt(seed)))
        const runSeed = deriveSeed(BigInt(seed), 0).toString()
        for (const alt of out.alternatives) runs.push({ ...alt, seed: runSeed })
    }
    return runs
}

describe('chemin par défaut : 2 × 40×40 mm, réglages d’usine', () => {
    it('le vrai builder envoie le job en BPP, walks puis fusion avec finition ne meurent plus', async () => {
        const files = [{ slug: 'f', name: 'f', count: 2, parts: [{ coords: square(40, 40), holes: [], width: 40, height: 40 }] }]
        const params = { sheets: [{ width: 1000, height: 2000, count: 1 }], space: 2, directions: ['left'], alternativesCount: 1 }
        const { payload } = await buildLocalPayload({ files, params, profile: { timeBudgetSec: 2 } }, deps)
        // La bascule J7-a : bande dégénérée => multi-tôles.
        expect(payload.problem).toBe('bpp')

        const runs = playWalks(payload, 2)
        expect(runs.length).toBe(2)
        const merged = JSON.parse(wasm.merge_alternatives(JSON.stringify({
            problem: payload.problem,
            instance: payload.instance,
            engineConfig: { ...payload.engineConfig, prng_seed: 0, time_budget_sec: 3600, sa_max_iterations: 400, live_events: false },
            runs,
            biases: payload.engineConfig.biases ?? ['left', 'bottom', 'balanced'],
            n_alternatives: payload.engineConfig.n_alternatives ?? 1,
        })))
        const placed = merged.alternatives[0].solution.layouts
            .reduce((n, l) => n + l.placed_items.length, 0)
        expect(placed).toBe(2)
    })

    it('la fixture du verrou de déterminisme passe aussi', () => {
        const input = readFileSync(`${benchDir}fixtures/j7a_defaut/merge_input.json`, 'utf8')
        const merged = JSON.parse(wasm.merge_alternatives(input))
        expect(merged.alternatives.length).toBeGreaterThanOrEqual(1)
        expect(merged.alternatives[0].solution.layouts[0].placed_items).toHaveLength(2)
    })
})

describe('pièce à la cote exacte : refus lisible, jamais un trap', () => {
    const cfg = (extra = {}) => JSON.stringify({
        time_budget_sec: 2, prng_seed: 7, n_alternatives: 1, poly_simpl_tolerance: 0.001,
        min_item_separation: 2, narrow_concavity_cutoff: null, live_events: false,
        n_workers: 1, separator_workers: 1, plateau_patience_sec: 1, biases: ['left'], ...extra,
    })
    const item = (ring, rots = [0, 90, 180, 270]) => ({
        id: 0, demand: 1, allowed_orientations: rots, shape: { type: 'simple_polygon', data: ring },
    })
    const bin = (w, h) => ({ id: 0, stock: 1, cost: 1, zones: [], shape: { type: 'simple_polygon', data: square(w, h) } })

    it('SPP : h = 996,0 sur 1000, espacement 2, une orientation', () => {
        const instance = { name: 'exact', strip_height: 1000, items: [item(square(100, 996), [0])] }
        expect(() => wasm.run_nesting(JSON.stringify(instance), cfg({ max_strip_width: 1000 }), 1n))
            .toThrowError(/^item_unplaceable:0:/)
    })

    it('SPP : à 995,99 le job aboutit (témoin)', () => {
        const instance = { name: 'presque', strip_height: 1000, items: [item(square(100, 995.99), [0])] }
        const out = JSON.parse(wasm.run_nesting(JSON.stringify(instance), cfg({ max_strip_width: 1000 }), 1n))
        expect(out.alternatives.length).toBe(1)
    })

    it('BPP : 996×1996 sur 1000×2000, espacement 2', () => {
        const instance = { name: 'exact-bpp', items: [item(square(996, 1996))], bins: [bin(1000, 2000)] }
        expect(() => wasm.run_nesting(JSON.stringify(instance), cfg(), 1n))
            .toThrowError(/^item_unplaceable:0:/)
    })

    it('BPP : 3000×1500 sur 3000×1500, espacement 0', () => {
        const instance = { name: 'exact-bpp0', items: [item(square(3000, 1500))], bins: [bin(3000, 1500)] }
        expect(() => wasm.run_nesting(JSON.stringify(instance), cfg({ min_item_separation: 0 }), 1n))
            .toThrowError(/^item_unplaceable:0:/)
    })

    it('la fusion refuse de la même façon quand les walks ont posé zéro pièce', () => {
        // Un walk BPP qui n'a rien posé (le moteur du lot A lui-même refuse
        // avant, c'est la seconde ligne de défense). Sa densité est 0 : avant
        // le lot elle sortait 0/0 = NaN, donc `null`, et cette fusion mourait
        // sur « invalid type: null, expected f32 ».
        const instance = { name: 'm', items: [item(square(996, 1996))], bins: [bin(1000, 2000)] }
        const run = {
            seed: '1', bias: 'left', iterations: 3, cost: 0, density: 0,
            cost_detail: { unplaced: 1, bin_cost: 0, remnant: 0, falkenauer: 0 },
            solution: { cost: 0, density: 0, layouts: [], run_time_sec: 0 },
        }
        expect(() => wasm.merge_alternatives(JSON.stringify({
            problem: 'bpp', instance, engineConfig: JSON.parse(cfg({ prng_seed: 0 })),
            runs: [run], biases: ['left'], n_alternatives: 1,
        }))).toThrowError(/item_unplaceable:0:/)
    })
})

describe('volute du constat de la relecture critique', () => {
    it('graines 100 et 101 du pool : une solution, plus de trap', () => {
        const instance = readFileSync(`${root}workers/nesting/engine/fixtures/volute_lbf_instance.json`, 'utf8')
        for (const seed of [100n, 101n]) {
            const cfg = JSON.stringify({
                time_budget_sec: 2, n_alternatives: 1, poly_simpl_tolerance: 0.001,
                min_item_separation: 2, narrow_concavity_cutoff: [0.01, 0.01], live_events: false,
                n_workers: 1, separator_workers: 1, plateau_patience_sec: 1,
                max_strip_width: 1000, biases: ['left'], finish_partial_sheet: false,
            })
            const out = JSON.parse(wasm.run_nesting(instance, cfg, seed))
            expect(out.alternatives.length, `graine ${seed}`).toBe(1)
        }
    })
})
