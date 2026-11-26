import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLocalPayload } from '../composables/localPayloadBuilder'
import { capacityReport } from '../composables/capacityClient'
import { runPool } from '../composables/localPool'
import { runInWorker } from '../composables/localCompute'
import { engineBinShape, makeSheetRecord, payloadHasShapedSheet, ringArea, ringBbox } from '../utils/sheetShape'

// Tôle importée d'un DXF : le moteur nide DANS son contour et évite ses zones
// interdites. Ces tests verrouillent le trajet payload -> config -> pool.

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const contour = (ring, depth, parent) => ({ ring, depth, parent, areaMm2: ringArea(ring), bbox: ringBbox(ring) })

/** Tôle 100 x 200 posée en (1000, 500) dans le repère du DXF, une zone interdite 20 x 20. */
function makeRecord({ extra = [], forbidden = [1], outline = rect(1000, 500, 1100, 700) } = {}) {
    const contours = [
        contour(outline, 1, null),
        contour(rect(1020, 520, 1040, 540), 2, 0),
        ...extra,
    ]
    return makeSheetRecord({
        id: 'sheet-lx2k9f0a-ab12cd',
        projectSlug: 'p',
        name: 'Tôle du client',
        sourceFileName: 'client.dxf',
        sourceUnits: 'mm',
        contours,
        outlineIndex: 0,
        forbidden,
        addedAt: 1,
    })
}

const SHEET_ID = 'sheet-lx2k9f0a-ab12cd'
const part = (w, h) => ({
    coordinates: rect(0, 0, w, h), holes: [], handles: ['A'], color: null,
})
const fileOf = (count, w = 10, h = 10) => ({
    slug: 'a.dxf', name: 'a.dxf', count, rotations: [0, 90], parts: [part(w, h)],
})
const profile = { timeBudgetSec: 13, vcores: 1, maxDirections: 1, level: 'browser' }

const build = (sheets, { files = [fileOf(3)], record = makeRecord(), space = 2, deps } = {}) =>
    buildLocalPayload(
        { files, params: { sheets, space, directions: ['left'], alternativesCount: 1 }, profile },
        deps || { getSheetRecord: async (slug) => (slug === SHEET_ID ? record : null) },
    )

describe('engineBinShape — le conteneur moteur d\'une tôle importée', () => {
    it('translate le contour en (0,0), garde les zones à leur place relative, anneaux fermés', () => {
        const shape = engineBinShape(makeRecord())
        expect(shape.outer).toEqual(rect(0, 0, 100, 200))
        expect(shape.inner).toEqual([rect(20, 20, 40, 40)])
        expect(shape.widthMm).toBe(100)
        expect(shape.heightMm).toBe(200)
        for (const r of [shape.outer, ...shape.inner]) {
            expect(r[0]).toEqual(r[r.length - 1])
        }
    })

    it('aire utile = contour moins zones ; périmètre = contour + zones', () => {
        const shape = engineBinShape(makeRecord())
        expect(shape.usableAreaMm2).toBe(100 * 200 - 20 * 20)
        expect(shape.perimeterMm).toBe(2 * (100 + 200) + 4 * 20)
    })

    it('sans zone : pas d\'`inner`', () => {
        const shape = engineBinShape(makeRecord({ forbidden: [] }))
        expect(shape.inner).toEqual([])
    })

    it('un anneau de zone dégénéré après translation est abandonné', () => {
        // Trois points alignés : trois sommets distincts (le modèle l'accepte), aire nulle.
        const flat = [[1020, 520], [1030, 520], [1040, 520], [1020, 520]]
        const record = makeRecord({ extra: [contour(flat, 2, 0)], forbidden: [1, 2] })
        const shape = engineBinShape(record)
        expect(shape.inner).toHaveLength(1)
    })

    it('un contour inutilisable lève sheet_shape_missing', () => {
        expect(() => engineBinShape(null)).toThrow('sheet_shape_missing')
        expect(() => engineBinShape({ contours: [], outlineIndex: 0 })).toThrow('sheet_shape_missing')
    })
})

describe('tôle importée sans aucune surface utile (zones = tout le contour)', () => {
    const covered = () => makeRecord({
        extra: [contour(rect(1000, 500, 1100, 700), 2, 0)], forbidden: [1, 2],
    })

    it('engineBinShape lève sheet_shape_missing', () => {
        expect(() => engineBinShape(covered())).toThrow('sheet_shape_missing')
    })

    it("le job s'arrête avant tout moteur avec sheet_shape_missing", async () => {
        await expect(build([{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }], { record: covered() }))
            .rejects.toThrow('sheet_shape_missing')
    })

    it("la capacité ne retombe jamais sur la boîte englobante d'une tôle à aire utile nulle", () => {
        const parts = [{ coords: rect(0, 0, 10, 10), count: 3 }]
        const dead = { width: 100, height: 200, count: 1, usableAreaMm2: 0, perimeterMm: 680 }
        expect(capacityReport(parts, [dead], 0)).toBeNull()
        // À côté d'un rectangle : seul le rectangle compte, la boîte de la tôle morte n'ajoute rien.
        const mixed = capacityReport(parts, [dead, { width: 50, height: 50, count: 1 }], 0)
        expect(mixed.totalUsableMm2).toBe(2500)
        // Aire utile négative ou non finie : même chose.
        for (const bad of [-5, Number.NaN]) {
            expect(capacityReport(parts, [{ ...dead, usableAreaMm2: bad }], 0)).toBeNull()
        }
    })

    it('la grille de boîtes ne prouve rien pour une tôle à aire utile nulle', () => {
        // 3 pièces de 10 x 10 tiennent dans la boîte 100 x 200 mais pas dans une tôle sans surface.
        const parts = [{ coords: rect(0, 0, 10, 10), count: 3 }]
        const withRect = capacityReport(parts, [{ width: 100, height: 200, count: 1 }, { width: 5, height: 5, count: 1, usableAreaMm2: 0, perimeterMm: 1 }], 0)
        expect(withRect.sheetsNeeded).toBe(1)
        const deadOnly = capacityReport(parts, [{ width: 100, height: 200, count: 1, usableAreaMm2: 0, perimeterMm: 1 }], 0)
        expect(deadOnly).toBeNull()
    })
})

describe('buildLocalPayload — coût des bins à forme', () => {
    it('chaque coût est fini et >= 1, deux tôles de tailles différentes', async () => {
        const big = makeRecord({ outline: rect(1000, 500, 1300, 800), forbidden: [] })
        const { payload } = await build(
            [{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }, { width: 300, height: 300, count: 1, shapeId: 'big' }],
            { deps: { getSheetRecord: async (slug) => (slug === SHEET_ID ? makeRecord() : slug === 'big' ? big : null) } },
        )
        for (const bin of payload.instance.bins) {
            expect(Number.isFinite(bin.cost)).toBe(true)
            expect(bin.cost).toBeGreaterThanOrEqual(1)
        }
    })
})

describe('buildLocalPayload — tôle importée', () => {
    it('le bin porte le contour et les zones, boîte en (0,0), coût sur l\'aire utile', async () => {
        const { payload } = await build([{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }])
        expect(payload.instance.bins).toHaveLength(1)
        const bin = payload.instance.bins[0]
        expect(bin.shape.type).toBe('polygon')
        expect(bin.shape.data.outer).toEqual(rect(0, 0, 100, 200))
        expect(bin.shape.data.inner).toEqual([rect(20, 20, 40, 40)])
        expect(bin.stock).toBe(1)
        expect(bin.cost).toBe(100) // minArea = elle-même
        expect(payload.shapedSheets).toEqual([{ id: 0, usableAreaMm2: 19600, perimeterMm: 680 }])
        expect(payloadHasShapedSheet(payload)).toBe(true)
    })

    it('la boîte du contour fait foi, pas la largeur/hauteur envoyée', async () => {
        const { payload } = await build([{ width: 99.99, height: 200.01, count: 1, shapeId: SHEET_ID }])
        expect(payload.instance.bins[0].shape.data.outer).toEqual(rect(0, 0, 100, 200))
    })

    it('BPP FORCÉ : une tôle, stock 1, direction gauche seule => pas de bande SPP', async () => {
        // Témoin : la même demande sur une tôle rectangulaire reste SPP.
        const files = [fileOf(30)]
        const plain = await build([{ width: 100, height: 200, count: 1 }], { files })
        expect(plain.payload.problem).toBe('spp')
        expect(plain.payload.instance.strip_height).toBe(200)

        const shaped = await build([{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }], { files })
        expect(shaped.payload.problem).toBe('bpp')
        expect(shaped.payload.instance.strip_height).toBeUndefined()
        expect(shaped.payload.engineConfig.max_strip_width).toBeUndefined()
    })

    it('finish_partial_sheet éteint dans la config d\'une tôle importée, absent sinon', async () => {
        const shaped = await build([{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }])
        expect(shaped.payload.engineConfig.finish_partial_sheet).toBe(false)
        const plain = await build([{ width: 100, height: 200, count: 1 }])
        expect('finish_partial_sheet' in plain.payload.engineConfig).toBe(false)
        expect('shapedSheets' in plain.payload).toBe(false)
    })

    it('tôle importée + tôle rectangulaire : tout le job suit les règles, coût sur l\'aire utile', async () => {
        const { payload } = await build([
            { width: 1000, height: 1000, count: 1 },
            { width: 100, height: 200, count: 2, shapeId: SHEET_ID },
        ])
        expect(payload.problem).toBe('bpp')
        expect(payload.engineConfig.finish_partial_sheet).toBe(false)
        const [plainBin, shapedBin] = payload.instance.bins
        expect(plainBin.shape.data.inner).toBeUndefined()
        expect(plainBin.shape.data.outer).toEqual(rect(0, 0, 1000, 1000))
        expect(shapedBin.shape.data.inner).toHaveLength(1)
        expect(shapedBin.stock).toBe(2)
        // minArea = aire utile 19600 : la tôle à forme coûte 100, le rectangle 1e6 / 19600.
        expect(shapedBin.cost).toBe(100)
        expect(plainBin.cost).toBe(Math.round((1000 * 1000) / 19600 * 100))
        expect(payload.shapedSheets).toEqual([{ id: 1, usableAreaMm2: 19600, perimeterMm: 680 }])
    })

    it('enregistrement absent => sheet_shape_missing, avant tout calcul', async () => {
        await expect(build(
            [{ width: 100, height: 200, count: 1, shapeId: 'sheet-zzzzzzzz-000000' }],
        )).rejects.toThrow('sheet_shape_missing')
        // Pas de dépendance fournie : même refus, jamais un rectangle par défaut.
        await expect(build(
            [{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }],
            { deps: {} },
        )).rejects.toThrow('sheet_shape_missing')
    })

    it('lecture refusée (IndexedDB fermée, bloquée) => sheet_shape_unreadable, pas « absente »', async () => {
        await expect(build(
            [{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }],
            { deps: { getSheetRecord: async () => { throw new Error('indexeddb_unavailable') } } },
        )).rejects.toThrow('sheet_shape_unreadable')
        // Un enregistrement absent reste « absent » (rendu null, pas levé).
        await expect(build(
            [{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }],
            { deps: { getSheetRecord: async () => null } },
        )).rejects.toThrow('sheet_shape_missing')
    })

    it('la garde « la pièce tient dans la boîte » reste : pièce plus grande que la boîte refusée', async () => {
        await expect(build(
            [{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }],
            { files: [fileOf(1, 250, 10)] },
        )).rejects.toBeTruthy()
        // 150 x 10 tient en tournant (200 de haut) : la garde ne refuse pas.
        const ok = await build(
            [{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }],
            { files: [fileOf(1, 150, 10)] },
        )
        expect(ok.payload.problem).toBe('bpp')
    })

    it('la pré-vérification de capacité compte l\'aire UTILE : la boîte seule dirait « ça tient »', async () => {
        // Contour 100 x 200 mais zone interdite 90 x 190 : il reste 1 700 mm² de métal.
        const record = makeRecord({
            extra: [],
            forbidden: [1],
        })
        record.contours[1] = contour(rect(1005, 505, 1095, 695), 2, 0)
        const files = [fileOf(12, 20, 20)] // 12 x 400 mm² = 4 800 mm² > 1 700
        const shaped = build([{ width: 100, height: 200, count: 1, shapeId: SHEET_ID }], { files, record, space: 0 })
        await expect(shaped).rejects.toMatchObject({ message: 'capacity_exceeded' })
        // Même demande sur le rectangle plein 100 x 200 : 20 000 mm², c'est accepté.
        const plain = await build([{ width: 100, height: 200, count: 1 }], { files, space: 0 })
        expect(plain.payload.instance).toBeTruthy()
    })
})

describe('capacityReport — format à aire utile', () => {
    const parts = [{ coords: rect(0, 0, 10, 10), count: 10 }]
    it('une tôle à forme utilise son aire utile, le rectangle inchangé', () => {
        const plain = capacityReport(parts, [{ width: 100, height: 200, count: 1 }], 0)
        expect(plain.totalUsableMm2).toBe(20000)
        const shaped = capacityReport(
            parts, [{ width: 100, height: 200, count: 1, usableAreaMm2: 19600, perimeterMm: 680 }], 0)
        expect(shaped.totalUsableMm2).toBe(19600)
        // L'espacement retire s/2 le long de chaque bord (contour et zones).
        const spaced = capacityReport(
            parts, [{ width: 100, height: 200, count: 1, usableAreaMm2: 19600, perimeterMm: 680 }], 2)
        expect(spaced.totalUsableMm2).toBe(19600 - 680)
    })

    it("tôle à forme : le moteur tranche sous l'aire totale, refus au-dessus seulement", () => {
        const big = [{ coords: rect(0, 0, 10, 10), count: 15 }] // 15 pièces : ratio 0,94 de 1 600
        const shaped = [{ width: 40, height: 40, count: 1, usableAreaMm2: 1600, perimeterMm: 160 }]
        // Rectangle : la grille de boîtes (16 cases) lève le refus, inchangé.
        expect(capacityReport(big, [{ width: 40, height: 40, count: 1 }], 0).refused).toBe(false)
        // Tôle à forme : ratio 0,94 > 0,88, plus de refus, le moteur décide.
        const r = capacityReport(big, shaped, 0)
        expect(r.ratio).toBeGreaterThan(0.88)
        expect(r.refused).toBe(false)
        // 17 pièces : l'aire ne tient pas du tout (ratio 1,06), refus, sur les deux.
        const more = [{ coords: rect(0, 0, 10, 10), count: 17 }]
        expect(capacityReport(more, shaped, 0).refused).toBe(true)
        expect(capacityReport(more, [{ width: 40, height: 40, count: 1 }], 0).refused).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// Pool : finition éteinte pour les walks ET pour la fusion
// ---------------------------------------------------------------------------

class MockWorker {
    constructor() {
        this.messages = []
        MockWorker.instances.push(this)
    }

    postMessage(msg) {
        this.messages.push(msg)
        queueMicrotask(() => {
            if (msg.op === 'merge') {
                this.onmessage?.({
                    data: {
                        id: msg.id,
                        jobSlug: msg.jobSlug,
                        ok: true,
                        result: JSON.stringify({ problem: 'bpp', alternatives: msg.merge.runs }),
                    },
                })
                return
            }
            this.onmessage?.({
                data: {
                    ok: true,
                    jobSlug: msg.jobSlug,
                    result: {
                        problem: 'bpp',
                        alternatives: [{ rank: 0, seed: 1, bias: 'left', solution: { layouts: [] } }],
                    },
                    memory: { pagesBefore: 1, pagesAfter: 2 },
                },
            })
        })
    }

    terminate() {}
}
MockWorker.instances = []

const poolPayload = (extra = {}) => ({
    problem: 'bpp',
    instance: {
        name: 't',
        bins: [{ id: 0, shape: { data: { outer: rect(0, 0, 100, 200) } } }],
        items: [{ id: 0, demand: 1 }],
    },
    // Volontairement SANS finish_partial_sheet : la garde du pool doit tenir seule.
    engineConfig: { time_budget_sec: 13, prng_seed: '42', n_alternatives: 3, biases: ['left', 'bottom', 'balanced'] },
    parts: [],
    walks: 4,
    ...extra,
})

describe('localPool — la finition de tôle partielle reste éteinte pour une tôle importée', () => {
    beforeEach(() => {
        MockWorker.instances = []
        vi.stubGlobal('Worker', MockWorker)
    })
    afterEach(() => vi.unstubAllGlobals())

    const mergeOf = () => MockWorker.instances.flatMap((w) => w.messages).find((m) => m.op === 'merge').merge
    const solveMessages = () => MockWorker.instances.flatMap((w) => w.messages).filter((m) => m.op !== 'merge')

    it('walks et fusion : finish_partial_sheet = false', async () => {
        const out = await runPool('job-shaped', poolPayload({ shapedSheets: [{ id: 0, usableAreaMm2: 1, perimeterMm: 1 }] }))
        expect(out.ok).toBe(true)
        expect(solveMessages()).toHaveLength(4)
        for (const msg of solveMessages()) expect(msg.engineConfig.finish_partial_sheet).toBe(false)
        expect(mergeOf().engineConfig.finish_partial_sheet).toBe(false)
    })

    it('job rectangulaire : la fusion garde sa config telle quelle (finition ouverte au moteur)', async () => {
        await runPool('job-plain', poolPayload())
        expect('finish_partial_sheet' in mergeOf().engineConfig).toBe(false)
        expect(mergeOf().engineConfig).toEqual({ ...poolPayload().engineConfig, prng_seed: 0 })
        // Les walks, eux, l'ont toujours éteinte (le plan « dernière tôle »).
        for (const msg of solveMessages()) expect(msg.engineConfig.finish_partial_sheet).toBe(false)
    })
})

describe('localCompute.runInWorker — chemin mono-walk', () => {
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
    afterEach(() => vi.unstubAllGlobals())

    it('tôle importée : finish_partial_sheet = false même si la config ne le disait pas', async () => {
        await runInWorker('j-shaped', poolPayload({ shapedSheets: [{ id: 0, usableAreaMm2: 1, perimeterMm: 1 }] }))
        expect(posted[0].engineConfig.finish_partial_sheet).toBe(false)
    })

    it('tôle rectangulaire : la config passe sans modification', async () => {
        const payload = poolPayload()
        await runInWorker('j-plain', payload)
        expect(posted[0].engineConfig).toBe(payload.engineConfig)
    })
})
