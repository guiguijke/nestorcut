/**
 * Quantité illimitée, de bout en bout : le VRAI constructeur, le VRAI pool
 * (recettes de coût, graines, choix avant fusion), le VRAI moteur wasm
 * (public/engine) derrière le protocole de son worker, recherche bornée en
 * travail, le VRAI client géométrie à travers le corps de
 * public/workers/geometry.worker.js et la VRAIE finalisation
 * (`assembleBrowserArtifacts`). Espacement 2, sens gauche, mm.
 *
 * (a) stock 1500 × 3000 × 2 + illimitée 1000 × 2000, 60 rectangles 200 × 300 :
 *     une seule tôle, du stock (sans la règle : trois neuves) ;
 * (b) stock 600 × 800 × 1 + illimitée, 1 × 900 × 1400 + 8 × 100 × 150 : les huit
 *     petites sur la tôle du stock, la grande sur une seule neuve ;
 * chute en quantité 1 ou 2 + illimitée, 1 × 900 × 1400 + 30 × 100 × 150 ;
 * (c) stock 500 × 500 et 700 × 900 + illimitée, 6 × 600 × 800 + 30 × 120 × 180.
 *
 * Ce qui est GARANTI, quelle que soit la graine : l'option livrée a, parmi les
 * recherches faites (un seul sens), le moins de pièces non posées, puis le moindre
 * coût en tôles à prévoir, puis la plus grande aire de pièces sur le stock, puis
 * le moins de tôles du stock. Ce qui ne l'est PAS : ce qu'aucune recherche n'a
 * trouvé (une tôle du stock laissée vide, une neuve de trop, la deuxième tôle
 * d'un format jamais servie). Les quantités de pièces attendues sur le stock en
 * (b) et sur la chute en quantité 1 sont observées, pas garanties.
 *
 * Partout : stock d'abord dans tout ce qui est livré, `supply` par tôle, aucune
 * tôle vide ; grille comprise quand une tôle du stock est trop petite pour elle.
 * L'ordre des options affichées suit le même choix (résultats moteur écrits à la
 * main).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const ROOT = path.resolve(__dirname, '../..')
const BUNDLE_JS = path.join(ROOT, 'public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.join(ROOT, 'public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null }))

/** Recherche bornée en TRAVAIL : le résultat ne dépend pas de la vitesse de la
 * machine. La fusion garde la config du payload (sa finition est au temps). */
const BOUNDED = {
    time_budget_sec: 3600, sa_max_iterations: 100, explore_max_conseq_failed_attempts: 2,
    compress_failure_decay: 0.5, live_events: false,
}
/** Les recherches faites par le moteur : message reçu et alternatives rendues. */
const searched = []

/** Le moteur derrière le protocole de public/workers/engine.worker.js. */
function engineSide(worker) {
    const reply = (data) => queueMicrotask(() => worker.onmessage({ data }))
    return {
        onmessage({ data: msg }) {
            if (msg.op === 'merge') {
                reply({ id: msg.id, jobSlug: msg.jobSlug, ok: true, result: engine.merge_alternatives(JSON.stringify(msg.merge)) })
                return
            }
            const cfg = { ...msg.engineConfig, ...BOUNDED }
            delete cfg.plateau_patience_sec
            const out = JSON.parse(engine.run_nesting(JSON.stringify(msg.instance), JSON.stringify(cfg), BigInt(msg.seed)))
            searched.push({ ...msg, alternatives: structuredClone(out.alternatives) })
            reply({ ok: true, jobSlug: msg.jobSlug, result: out })
        },
    }
}

class FakeWorker {
    constructor(url) {
        if (String(url).includes('engine.worker')) {
            this.inner = engineSide(this)
            return
        }
        const src = readFileSync(path.join(ROOT, 'public/workers/geometry.worker.js'), 'utf8')
        const names = /import init, \{([^}]*)\}/.exec(src)[1].split(',').map((s) => s.trim()).filter(Boolean)
        const body = src.replace(/import init, \{[^}]*\} from '[^']*'/, '')
        const self = { postMessage: (data) => this.onmessage({ data }) }
        new Function('self', 'init', ...names, body)(self, async () => {}, ...names.map((n) => glue.mod[n]))
        this.inner = self
    }

    postMessage(data) { this.inner.onmessage({ data }) }

    terminate() {}
}

let engine
beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
    vi.stubGlobal('Worker', FakeWorker)
    engine = await import(/* @vite-ignore */ pathToFileURL(path.join(ROOT, 'public/engine/nest_wasm.js')).href)
    await engine.default({ module_or_path: readFileSync(path.join(ROOT, 'public/engine/nest_wasm_bg.wasm')) })
    vi.spyOn(console, 'info').mockImplementation(() => {})
})

import { buildLocalPayload } from '../composables/localPayloadBuilder'
import { runPool } from '../composables/localPool'
import { assembleBrowserArtifacts } from '../composables/finalizeLocal'
import { geoOffsetRing, geoOpenHoles, geoPinwheelCapacity } from '../composables/geometryClient'
import { unlimitedLayoutTest } from '../utils/sheetStock'

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
const part = (slug, count, w, h) => ({
    slug, name: `${slug}.dxf`, count, rotations: [0, 90], parts: [{ coords: rect(w, h), holes: [], width: w, height: h }],
})
const stock = (width, height, count) => ({ width, height, count })
const open = (width, height) => ({ width, height, count: 1, unlimited: true })

const deps = {
    openHoles: (c, h, s) => geoOpenHoles(c, h, s),
    pinwheelCapacity: (r, c, s, a) => geoPinwheelCapacity(r, c, s, a),
    offsetRing: (r, d, o) => geoOffsetRing(r, d, o),
}

/** Le VRAI pool (envoi et graines des walks, choix avant fusion, fusion), puis
 * la finalisation. `walked` : les alternatives de toutes les recherches. */
async function runJob(files, sheets, { walks = 2, directions = ['left'] } = {}) {
    const built = await buildLocalPayload(
        { files, params: { sheets, space: 2, directions }, profile: { timeBudgetSec: 2 } }, deps)
    searched.length = 0
    const outcome = await runPool('e2e', built.payload,
        { walks: built.payload.problem === 'spp' ? 1 : walks, concurrency: walks })
    expect(outcome.error).toBeUndefined()
    const walked = searched.flatMap((m) => m.alternatives)
    const out = await assembleBrowserArtifacts({
        result: outcome.result, payload: built.payload, sources: {}, jobSlug: 'e2e', withPositions: false,
    })
    return { ...built, walked, out }
}

/** Ce qu'une recherche prend au stock et demande en neuf, recalculé ici
 * (pièces rectangulaires : l'aire d'un item est celle de son contour). */
function seenBy(payload, run) {
    const isNew = unlimitedLayoutTest(payload)
    const area = new Map(payload.instance.items.map((it) => {
        const ring = it.shape.data.outer || it.shape.data
        let s = 0
        for (let i = 0; i < ring.length; i++) {
            const [x1, y1] = ring[i]
            const [x2, y2] = ring[(i + 1) % ring.length]
            s += x1 * y2 - x2 * y1
        }
        return [it.id, Math.abs(s) / 2]
    }))
    const used = run.solution.layouts.filter((l) => l.placed_items.length)
    const stock = used.filter((l) => !isNew(l))
    return {
        unplaced: run.cost_detail.unplaced,
        newCost: used.filter(isNew).reduce((n, l) => n + payload.instance.bins[l.container_id].cost, 0),
        fresh: used.length - stock.length,
        area: Math.round(stock.reduce((n, l) => n + l.placed_items.reduce((m, p) => m + area.get(p.item_id), 0), 0)),
        stock: stock.length,
        pieces: stock.reduce((n, l) => n + l.placed_items.length, 0),
    }
}

/** La meilleure des recherches : le moins de pièces non posées, puis de coût en
 * neuf, puis la plus grande aire sur le stock, puis le moins de tôles du stock. */
function bestWalk({ payload, walked }) {
    return walked.map((run) => seenBy(payload, run)).sort((a, b) => (a.unplaced - b.unplaced)
        || (a.newCost - b.newCost) || (b.area - a.area) || (a.stock - b.stock))[0]
}

const onStock = (rows) => rows.filter((r) => r.supply === 'stock')
const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0)

/** L'option livrée se sert du stock comme la meilleure des recherches. */
function expectBest(rows, job) {
    const best = bestWalk(job)
    expect(Math.round(sum(onStock(rows), 'partsAreaMm2'))).toBe(best.area)
    expect(onStock(rows)).toHaveLength(best.stock)
    expect(rows.filter((r) => r.supply === 'new')).toHaveLength(best.fresh)
}

/** Contrôles communs à chaque option livrée ; rend les lignes de rapport. */
function checkDelivered({ out }, total) {
    expect(out.allAlternativesInvalid).toBe(false)
    expect(out.alternatives.length).toBeGreaterThan(0)
    return out.alternatives.map((alt, k) => {
        const rows = alt.report.sheets
        const layouts = out.result.alternatives[k].solution.layouts || [out.result.alternatives[k].solution.layout]
        expect(rows).toHaveLength(alt.layoutCount)
        expect(layouts).toHaveLength(alt.layoutCount)
        expect(rows.reduce((n, r) => n + r.partCount, 0)).toBe(total)
        for (const r of rows) expect(r.partCount).toBeGreaterThan(0)
        // Stock d'abord, et le `.job`, le SVG et le résultat suivent ce rang.
        const supplies = rows.map((r) => r.supply)
        expect(supplies).toEqual([...supplies].sort((a, b) => Number(a === 'new') - Number(b === 'new')))
        expect(out.jobSheets[k].map((s) => s.length)).toEqual(rows.map((r) => r.partCount))
        expect(layouts.map((l) => l.placed_items.length)).toEqual(rows.map((r) => r.partCount))
        rows.forEach((r, i) => {
            expect(alt.svgs[i]).toContain(`viewBox="0 0 ${r.widthMm.toFixed(1)} ${r.heightMm.toFixed(1)}"`)
        })
        expect(alt.report.overlapFree).toBe(true)
        expect(alt.report.insideSheet).toBe(true)
        expect(alt.report.unplaced).toBe(0)
        return rows
    })
}
const shape = (rows) => rows.map((r) => `${r.supply} ${r.widthMm}x${r.heightMm}`)
const finalView = ({ out }) => {
    const live = out.liveLayout
    return { sheets: live.sheets, counts: live.sheets.map((_, i) => live.items.filter((it) => it[1] === i).length) }
}

describe('le stock d\'abord, avec le vrai moteur', () => {
    it('(a) stock plus grand que la tôle illimitée : tout sur une tôle du stock', async () => {
        const job = await runJob([part('p', 60, 200, 300)], [stock(1500, 3000, 2), open(1000, 2000)])
        expect(job.payload.problem).toBe('bpp')
        for (const rows of checkDelivered(job, 60)) expect(shape(rows)).toEqual(['stock 1500x3000'])
    })

    it('(a, témoin) sans la quantité illimitée, trois tôles neuves', async () => {
        const job = await runJob([part('p', 60, 200, 300)], [stock(1500, 3000, 2), stock(1000, 2000, 998)])
        const rows = job.out.alternatives[0].report.sheets
        expect(rows.map((r) => r.widthMm)).toEqual([1000, 1000, 1000])
        for (const r of rows) expect('supply' in r).toBe(false)
    })

    it('(b) une neuve obligatoire : la chute est remplie, et une seule neuve', async () => {
        const job = await runJob(
            [part('grande', 1, 900, 1400), part('petite', 8, 100, 150)],
            [stock(600, 800, 1), open(1000, 2000)],
            { walks: 8 },
        )
        const all = checkDelivered(job, 9)
        expectBest(all[0], job)
        // La chute reçoit les huit petites, la neuve la seule grande pièce.
        expect(shape(all[0])).toEqual(['stock 600x800', 'new 1000x2000'])
        expect(all[0].map((r) => r.partCount)).toEqual([8, 1])
        const view = finalView(job)
        expect(view.sheets).toEqual([[600, 800], [1000, 2000]])
        expect(view.counts).toEqual([8, 1])
    })

    it.each([1, 2])('une chute (quantité %i) reçoit autant que la mieux servie des recherches', async (count) => {
        const job = await runJob(
            [part('grande', 1, 900, 1400), part('petite', 30, 100, 150)],
            [stock(600, 800, count), open(1000, 2000)],
            { walks: 8 },
        )
        const [rows] = checkDelivered(job, 31)
        expectBest(rows, job)
        // Observé (pas une garantie du moteur) : la chute est bien remplie. Avant,
        // une seule petite pièce y était livrée.
        expect(sum(onStock(rows), 'partCount')).toBeGreaterThanOrEqual(25)
    })

    it('(c) deux tôles du stock, illimitée déclarée en premier : le garanti, à toute graine', async () => {
        const job = await runJob(
            [part('moyenne', 6, 600, 800), part('petite', 30, 120, 180)],
            [open(1000, 2000), stock(500, 500, 1), stock(700, 900, 1)],
            { walks: 4 },
        )
        const delivered = checkDelivered(job, 36)
        // Au plus une grande pièce par chute, trois par neuve : deux neuves au moins.
        expect(bestWalk(job).fresh).toBeGreaterThanOrEqual(2)
        for (const rows of delivered) {
            expectBest(rows, job)
            expect(rows.filter((r) => r.supply === 'new').every((r) => r.widthMm === 1000)).toBe(true)
        }
        expect(finalView(job).sheets).toEqual(delivered[0].map((r) => [r.widthMm, r.heightMm]))
    })

    it('une seule illimitée, sens gauche : bande, tôle « à prévoir »', async () => {
        const job = await runJob([part('p', 6, 200, 300)], [open(1000, 2000)])
        expect(job.payload.problem).toBe('spp')
        for (const rows of checkDelivered(job, 6)) expect(shape(rows)).toEqual(['new 1000x2000'])
    })

    it('moteur qui rend la neuve d\'abord : tout ce qui se livre met le stock devant', async () => {
        const files = [part('p', 3, 100, 150)]
        const { payload } = await buildLocalPayload(
            { files, params: { sheets: [open(1000, 2000), stock(600, 800, 1)], space: 2 }, profile: { timeBudgetSec: 2 } }, deps)
        const pose =(x) => ({ item_id: 0, transformation: { rotation: 0, translation: [x, 5] } })
        // Conteneurs : 0 = stock, 1 = illimitée. La finition du moteur (`spp`, la
        // bande résiduelle est alors sautée) nomme la tôle neuve par son rang, 0.
        const result = {
            problem: 'bpp',
            alternatives: [{
                rank: 0, bias: 'left', finish: { sheet: 0, kept: 'spp', bias: 'left', before: {}, after: {} },
                solution: {
                    layouts: [
                        { container_id: 1, placed_items: [pose(5), pose(120)] },
                        { container_id: 0, placed_items: [pose(5)] },
                    ],
                },
            }],
        }
        const out = await assembleBrowserArtifacts({ result, payload, sources: {}, jobSlug: 'e2e', withPositions: false })
        const [alt] = out.alternatives
        expect(shape(alt.report.sheets)).toEqual(['stock 600x800', 'new 1000x2000'])
        expect(alt.report.sheets.map((r) => [r.index, r.partCount])).toEqual([[0, 1], [1, 2]])
        expect(alt.svgs[0]).toContain('viewBox="0 0 600.0 800.0"')
        expect(alt.svgs[1]).toContain('viewBox="0 0 1000.0 2000.0"')
        expect(out.jobSheets[0].map((s) => s.length)).toEqual([1, 2])
        expect(out.result.alternatives[0].solution.layouts.map((l) => l.container_id)).toEqual([0, 1])
        expect(finalView({ out })).toEqual({ sheets: [[600, 800], [1000, 2000]], counts: [1, 2] })
        expect(alt.finish.sheet).toBe(1)
    })

    it('grille : une tôle du stock trop petite pour elle ne sort pas vide', async () => {
        const job = await runJob(
            [part('hote', 24, 200, 160), part('cale', 20, 40, 30)],
            [stock(30, 30, 1), open(700, 700)],
        )
        expect(job.out.structMultiDiag.built).toBe(true)
        const all = checkDelivered(job, 44)
        expect(job.out.alternatives[0].strategy).toBe('grid')
        for (const rows of all) expect(rows.every((r) => r.supply === 'new')).toBe(true)
    })
})

describe('ordre des options affichées', () => {
    const sheetOf = (container_id, n) => ({
        container_id,
        placed_items: Array.from({ length: n }, (_, k) => ({
            item_id: 0, transformation: { rotation: 0, translation: [5 + 115 * k, 5] },
        })),
    })
    /** Ordre d'avant (gauche, bas, équilibré) : 2 neuves ; stock + 1 neuve ; 1 neuve. */
    const handMade = () => ({
        problem: 'bpp',
        alternatives: [
            { rank: 0, bias: 'left', solution: { layouts: [sheetOf(1, 2), sheetOf(1, 1)] } },
            { rank: 1, bias: 'bottom', solution: { layouts: [sheetOf(1, 2), sheetOf(0, 1)] } },
            { rank: 2, bias: 'balanced', solution: { layouts: [sheetOf(1, 3)] } },
        ],
    })
    const deliver = async (sheets) => {
        const { payload } = await buildLocalPayload(
            { files: [part('p', 3, 100, 150)], params: { sheets, space: 2 }, profile: { timeBudgetSec: 2 } }, deps)
        return assembleBrowserArtifacts({ result: handMade(), payload, sources: {}, jobSlug: 'e2e', withPositions: false })
    }
    const counts = (list) => list.map((sheets) => sheets.map((s) => s.length))

    it('le moins de neuves, puis la plus grande aire sur le stock ; résultat, `.job` et frame finale suivent', async () => {
        const out = await deliver([stock(600, 800, 1), open(1000, 2000)])
        expect(out.alternatives.map((a) => a.strategy)).toEqual(['bottom', 'balanced', 'left'])
        expect(out.alternatives.map((a) => shape(a.report.sheets))).toEqual([
            ['stock 600x800', 'new 1000x2000'],
            ['new 1000x2000'],
            ['new 1000x2000', 'new 1000x2000'],
        ])
        expect(out.alternatives.map((a) => a.altId)).toEqual([0, 1, 2])
        expect(out.result.alternatives.map((a) => a.bias)).toEqual(['bottom', 'balanced', 'left'])
        expect(counts(out.jobSheets)).toEqual([[1, 2], [3], [2, 1]])
        expect(finalView({ out })).toEqual({ sheets: [[600, 800], [1000, 2000]], counts: [1, 2] })
        expect(out.placed).toBe(3)
        out.alternatives.forEach((a) => {
            expect(a.svgs).toHaveLength(a.layoutCount)
            expect(a.svgs[0]).toContain(`viewBox="0 0 ${a.report.sheets[0].widthMm.toFixed(1)} `)
        })
    })

    it('à neuves égales, l\'aire sur le stock passe avant le nombre de ses tôles', async () => {
        const { payload } = await buildLocalPayload(
            { files: [part('p', 4, 100, 150)], params: { sheets: [stock(600, 800, 2), open(1000, 2000)], space: 2 }, profile: { timeBudgetSec: 2 } }, deps)
        // Conteneurs : 0 et 1 = les deux tôles du stock, 2 = illimitée.
        const result = {
            problem: 'bpp',
            alternatives: [
                { rank: 0, bias: 'left', solution: { layouts: [sheetOf(0, 1), sheetOf(1, 1), sheetOf(2, 2)] } },
                { rank: 1, bias: 'bottom', solution: { layouts: [sheetOf(0, 3), sheetOf(2, 1)] } },
            ],
        }
        const out = await assembleBrowserArtifacts({ result, payload, sources: {}, jobSlug: 'e2e', withPositions: false })
        expect(out.alternatives.map((a) => a.strategy)).toEqual(['bottom', 'left'])
        expect(counts(out.jobSheets)).toEqual([[3, 1], [1, 1, 2]])
    })

    it('sans tôle illimitée : le tri par sens, comme avant', async () => {
        const out = await deliver([stock(600, 800, 1), stock(1000, 2000, 5)])
        expect(out.alternatives.map((a) => a.strategy)).toEqual(['left', 'bottom', 'balanced'])
        expect(out.result.alternatives.map((a) => a.bias)).toEqual(['left', 'bottom', 'balanced'])
        for (const a of out.alternatives) expect(a.report.sheets.some((r) => 'supply' in r)).toBe(false)
    })
})
