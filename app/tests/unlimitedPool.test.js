/**
 * Tôle illimitée dans le pool : le choix entre les recherches (le même avant la
 * fusion et quand elle échoue), les deux recettes de coût du stock réparties
 * entre les walks, et la fusion refaite quand la garde d'embouchure du moteur
 * retire des pièces. Runs fabriqués, workers simulés. Sans tôle illimitée, les
 * messages envoyés sont ceux d'avant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runPool } from '../composables/localPool'
import { compareStockScores, preferStockRuns, runScorer, walkInstance } from '../utils/sheetStock'

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
const bin = (id, stock, cost, w, h) => ({ id, stock, cost, shape: { type: 'polygon', data: { outer: rect(w, h) } } })
const item = (id, demand, w, h) => ({ id, demand, shape: { type: 'simple_polygon', data: rect(w, h) } })
/** Une chute 600 × 800 en deux entrées (première tôle à 0, reste à 1), puis la
 * tôle illimitée (conteneur 2) ; une grande pièce et trente petites. */
const payloadOf = ({ priority = true, biases = ['left'], bins = true } = {}) => ({
    problem: 'bpp',
    instance: {
        name: 't',
        ...(bins
            ? { bins: [bin(0, 1, 0, 600, 800), bin(1, 1, 1, 600, 800), bin(2, 998, 200, 1000, 2000)] }
            : { strip_height: 10 }),
        items: [item(0, 1, 900, 1400), item(1, 30, 100, 150)],
    },
    engineConfig: { prng_seed: '42', n_alternatives: 1, biases },
    parts: [],
    ...(priority ? { stockPriority: { unlimitedBins: [2] } } : {}),
})

const placed = (id, n) => Array.from({ length: n }, () => ({ item_id: id }))
/** Un run : `sheets` = [conteneur, grandes, petites] par tôle posée. */
const run = (tag, sheets, { unplaced = 0, remnant = 0, bias = 'left', cost, judged = true } = {}) => {
    const costs = [0, 1, 200]
    return {
        tag,
        bias,
        seed: 1,
        ...(judged ? {
            cost_detail: {
                unplaced, bin_cost: cost ?? sheets.reduce((n, [id]) => n + costs[id], 0), remnant, falkenauer: 0,
            },
        } : {}),
        solution: {
            layouts: sheets.map(([container_id, big, small]) => ({
                container_id, placed_items: [...placed(0, big), ...placed(1, small)],
            })),
        },
    }
}
const tags = (runs) => runs.map((r) => r.tag)
const chosen = (runs, payload = payloadOf()) => tags(preferStockRuns(runs, payload))

describe('le choix entre deux recherches', () => {
    const score = (unplaced, newCost, stockArea, stockSheets) => ({ unplaced, newCost, stockArea, stockSheets })

    it('pièces non posées, puis coût des neuves, puis aire sur le stock, puis tôles du stock', () => {
        const ordered = [
            score(0, 200, 900, 1), score(0, 200, 900, 2), score(0, 200, 100, 1), score(0, 400, 5000, 1), score(1, 0, 9000, 1),
        ]
        expect([...ordered].reverse().sort(compareStockScores)).toEqual(ordered)
    })

    it('des aires à moins d\'un mm² près sont égales', () => {
        expect(compareStockScores(score(0, 0, 1000, 1), score(0, 0, 1000.4, 2))).toBeLessThan(0)
        expect(compareStockScores(score(0, 0, 1002, 2), score(0, 0, 1000, 1))).toBeLessThan(0)
    })

    it('lu sur un run : seules les tôles qui portent des pièces comptent', () => {
        const s = runScorer(payloadOf())(run('r', [[0, 0, 2], [1, 0, 0], [2, 1, 28]]))
        expect(s).toEqual({ unplaced: 0, newCost: 200, stockArea: 30_000, stockSheets: 1 })
    })
})

describe('preferStockRuns', () => {
    it('à neuves égales, le stock le mieux servi, pas la plus grande chute libre', () => {
        const runs = [
            run('peu-servi', [[0, 0, 1], [2, 1, 29]], { remnant: 0.9 }),
            run('servi', [[0, 0, 25], [2, 1, 5]], { remnant: 0.1 }),
        ]
        expect(chosen(runs)).toEqual(['servi'])
    })

    it('à aire égale, le moins de tôles du stock', () => {
        const runs = [run('deux', [[0, 0, 20], [1, 1, 10]]), run('une', [[0, 1, 30]])]
        expect(chosen(runs)).toEqual(['une'])
    })

    it('une tôle à prévoir de moins passe avant un stock mieux servi', () => {
        const runs = [
            run('deux-neuves', [[0, 0, 28], [2, 1, 0], [2, 0, 2]]),
            run('une-neuve', [[0, 0, 1], [2, 1, 29]]),
        ]
        expect(chosen(runs)).toEqual(['une-neuve'])
    })

    it('les pièces non posées passent avant tout', () => {
        const runs = [run('partiel', [[0, 0, 5]], { unplaced: 26 }), run('complet', [[2, 1, 30]])]
        expect(chosen(runs)).toEqual(['complet'])
    })

    it('chaque sens garde les siens', () => {
        const runs = [
            run('l-servi', [[0, 0, 25], [2, 1, 5]], { bias: 'left' }),
            run('l-peu', [[0, 0, 2], [2, 1, 28]], { bias: 'left' }),
            run('b-peu', [[0, 0, 2], [2, 1, 28]], { bias: 'bottom' }),
            run('b-moins', [[2, 1, 30]], { bias: 'bottom' }),
        ]
        expect(chosen(runs, payloadOf({ biases: ['left', 'bottom'] }))).toEqual(['l-servi', 'b-peu'])
    })

    it('à égalité complète, tous restent, comparés par le seul coût des neuves', () => {
        const runs = [run('recette-1', [[1, 0, 25], [2, 1, 5]]), run('recette-2', [[1, 0, 25], [2, 1, 5]], { cost: 200 })]
        const out = preferStockRuns(runs, payloadOf())
        expect(tags(out)).toEqual(['recette-1', 'recette-2'])
        expect(out.map((r) => r.cost_detail.bin_cost)).toEqual([200, 200])
        // Les runs reçus ne sont pas réécrits (le chemin dégradé les relit).
        expect(runs[0].cost_detail.bin_cost).toBe(201)
    })

    it('un run sans cost_detail reste', () => {
        const runs = [run('juge', [[0, 0, 25], [2, 1, 5]]), run('sans', [[2, 1, 30]], { judged: false })]
        expect(chosen(runs)).toEqual(['juge', 'sans'])
    })

    it('sans tôle illimitée, ou en bande : la liste elle-même', () => {
        const runs = [run('a', [[2, 1, 30]]), run('b', [[0, 0, 25], [2, 1, 5]])]
        expect(preferStockRuns(runs, payloadOf({ priority: false }))).toBe(runs)
        expect(preferStockRuns(runs, payloadOf({ bins: false }))).toBe(runs)
    })
})

describe('les deux recettes de coût', () => {
    const ranks = (classes) => {
        const payload = payloadOf()
        return Array.from({ length: 8 }, (_, w) => (
            walkInstance(payload.instance, payload, w, classes) === payload.instance ? 1 : 2))
    }

    it('par tranches d\'un walk par sens : chaque sens reçoit les deux', () => {
        expect(ranks(1)).toEqual([1, 2, 1, 2, 1, 2, 1, 2])
        expect(ranks(2)).toEqual([1, 1, 2, 2, 1, 1, 2, 2])
        expect(ranks(3)).toEqual([1, 1, 1, 2, 2, 2, 1, 1])
    })

    it('la seconde : tout le stock à 0, les neuves au même coût, le payload intact', () => {
        const payload = payloadOf()
        const second = walkInstance(payload.instance, payload, 1, 1)
        expect(second.bins.map((b) => [b.id, b.stock, b.cost])).toEqual([[0, 1, 0], [1, 1, 0], [2, 998, 200]])
        expect(second.items).toBe(payload.instance.items)
        expect(payload.instance.bins.map((b) => b.cost)).toEqual([0, 1, 200])
    })

    it('rien à changer : l\'instance elle-même', () => {
        for (const payload of [payloadOf({ priority: false }), payloadOf({ bins: false })]) {
            expect(walkInstance(payload.instance, payload, 1, 1)).toBe(payload.instance)
        }
        const flat = payloadOf()
        flat.instance.bins[1].cost = 0
        expect(walkInstance(flat.instance, flat, 1, 1)).toBe(flat.instance)
    })
})

describe('le pool', () => {
    class MockWorker {
        constructor() { MockWorker.instances.push(this) }

        postMessage(msg) { queueMicrotask(() => MockWorker.respond(this, msg)) }

        terminate() {}
    }
    /** Trois walks : le moins servi a la plus grande chute libre. */
    const WALKS = () => [
        run('peu-servi', [[0, 0, 1], [2, 1, 29]], { remnant: 0.9 }),
        run('servi', [[0, 0, 25], [2, 1, 5]], { remnant: 0.1 }),
        run('cher', [[0, 0, 25], [2, 1, 4], [2, 0, 1]], { remnant: 0.5 }),
    ]
    let merges
    let walkMessages
    /** `replies` : une réponse par fusion (`false` : échec), la dernière répétée. */
    const script = (replies = [[]], walks = WALKS) => {
        merges = []
        walkMessages = []
        MockWorker.instances = []
        MockWorker.respond = (worker, msg) => {
            if (msg.op === 'merge') {
                const reply = replies[Math.min(merges.length, replies.length - 1)]
                merges.push(msg.merge)
                worker.onmessage({ data: reply
                    ? { id: msg.id, jobSlug: msg.jobSlug, ok: true, result: JSON.stringify({ problem: 'bpp', alternatives: reply }) }
                    : { id: msg.id, jobSlug: msg.jobSlug, ok: false, error: 'unreachable' } })
                return
            }
            walkMessages.push(msg)
            const w = MockWorker.instances.indexOf(worker)
            worker.onmessage({ data: { ok: true, jobSlug: msg.jobSlug, result: { problem: 'bpp', alternatives: [walks()[w % walks().length]] } } })
        }
    }
    /** Une option fusionnée à qui il manque `unplaced` pièces. */
    const short = (unplaced) => run(`court-${unplaced}`, [[0, 0, 25], [2, 1, 5 - unplaced]], { unplaced })

    beforeEach(() => {
        vi.stubGlobal('Worker', MockWorker)
        vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('huit walks, trois sens : chaque sens reçoit les deux recettes', async () => {
        script()
        await runPool('job-recettes', payloadOf({ biases: ['left', 'bottom', 'balanced'] }), { walks: 8 })
        const seen = new Map()
        for (const msg of walkMessages) {
            const bias = msg.engineConfig.biases[0]
            seen.set(bias, new Set([...(seen.get(bias) || []), msg.instance.bins[1].cost]))
            expect(msg.instance.bins[2].cost).toBe(200)
        }
        expect([...seen.values()].map((s) => [...s].sort())).toEqual([[0, 1], [0, 1], [0, 1]])
    })

    it('sans tôle illimitée : chaque walk reçoit l\'instance elle-même, la fusion tous les runs tels quels', async () => {
        script()
        const payload = payloadOf({ priority: false })
        await runPool('job-avant', payload, { walks: 3 })
        expect(walkMessages).toHaveLength(3)
        for (const msg of walkMessages) expect(msg.instance).toBe(payload.instance)
        expect(merges[0].runs.map((r) => [r.tag, r.cost_detail.bin_cost])).toEqual([['peu-servi', 200], ['servi', 200], ['cher', 400]])
    })

    it('la fusion ne reçoit que les runs retenus, sur l\'instance de la première recette', async () => {
        script()
        const payload = payloadOf()
        await runPool('job-stock', payload, { walks: 3 })
        expect(tags(merges[0].runs)).toEqual(['servi'])
        expect(merges[0].instance).toBe(payload.instance)
    })

    it('fusion en échec : le walk livré suit le même choix', async () => {
        script([false])
        const out = await runPool('job-degrade', payloadOf(), { walks: 3 })
        expect(out.result.alternatives.map((a) => a.tag)).toEqual(['servi'])
        expect(out.result.degraded).toEqual({ reason: 'merge_failed', walk: 1 })
    })

    it('fusion en échec : le coût d\'une tôle du stock ne compte pas', async () => {
        const walks = () => [
            run('moins-servi', [[0, 0, 24], [2, 1, 6]], { remnant: 0.9 }),
            run('deux-tiers', [[0, 0, 10], [1, 0, 15], [2, 1, 5]], { remnant: 0.1 }),
        ]
        script([false], walks)
        const out = await runPool('job-degrade-cout', payloadOf(), { walks: 2 })
        expect(out.result.alternatives.map((a) => a.tag)).toEqual(['deux-tiers'])
    })

    it('fusion en échec sans tôle illimitée : la chute restante départage, comme avant', async () => {
        script([false])
        const out = await runPool('job-degrade-sans', payloadOf({ priority: false }), { walks: 3 })
        expect(out.result.alternatives.map((a) => a.tag)).toEqual(['peu-servi'])
    })

    it('la garde d\'embouchure retire des pièces : fusion refaite avec toutes les recherches', async () => {
        script([[short(2)], [WALKS()[0]]])
        const out = await runPool('job-garde', payloadOf(), { walks: 3 })
        expect(merges.map((m) => tags(m.runs))).toEqual([['servi'], ['peu-servi', 'servi', 'cher']])
        // Toujours comparés par le seul coût des neuves.
        expect(merges[1].runs.map((r) => r.cost_detail.bin_cost)).toEqual([200, 200, 400])
        expect(out.ok).toBe(true)
        expect(out.result.alternatives.map((a) => a.tag)).toEqual(['peu-servi'])
    })

    it('refaite une seule fois : le second résultat est livré tel quel', async () => {
        script([[short(2)], [short(1)]])
        const out = await runPool('job-garde-2', payloadOf(), { walks: 3 })
        expect(merges).toHaveLength(2)
        expect(out.result.alternatives.map((a) => a.tag)).toEqual(['court-1'])
    })

    it('refaite puis en échec : le meilleur walk complet', async () => {
        script([[short(2)], false])
        const out = await runPool('job-garde-3', payloadOf(), { walks: 3 })
        expect(out.result.alternatives.map((a) => a.tag)).toEqual(['servi'])
        expect(out.result.degraded.reason).toBe('merge_failed')
    })

    it.each([
        ['le résultat est complet', payloadOf(), [[WALKS()[1]]], WALKS, 3],
        ['aucun run écarté', payloadOf(), [[short(2)]], () => [WALKS()[1]], 3],
        ['aucune recherche complète', payloadOf(), [[short(2)]], () => [short(3), short(2)], 2],
        ['sans tôle illimitée', payloadOf({ priority: false }), [[short(2)]], WALKS, 3],
    ])('pas de seconde fusion quand %s', async (_, payload, replies, walks, n) => {
        script(replies, walks)
        await runPool('job-une-fois', payload, { walks: n })
        expect(merges).toHaveLength(1)
    })
})
