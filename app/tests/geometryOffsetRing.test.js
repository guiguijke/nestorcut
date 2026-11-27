import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Distance au bord : la route JS (geoOffsetRing -> worker -> offset_ring) et
// le champ `edge` du rapport (geoComputeReport -> compute_report), sur le
// bundle wasm livré. La géométrie elle-même est testée en Rust
// (nest-import/tests/sheet_offset.rs, nest-report/src/edge_tests.rs).

const ROOT = path.resolve(__dirname, '../..')
const BUNDLE_JS = path.join(ROOT, 'public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.join(ROOT, 'public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null }))

vi.mock('../composables/localCompute', () => ({ isLocalComputeEnabled: () => true }))

// Le vrai corps de geometry.worker.js, sans son import : un faux Worker l'exécute.
class FakeWorker {
    constructor(url) {
        expect(url).toBe('/workers/geometry.worker.js')
        const src = readFileSync(path.join(ROOT, 'public/workers/geometry.worker.js'), 'utf8')
        const names = /import init, \{([^}]*)\}/.exec(src)[1].split(',').map((s) => s.trim()).filter(Boolean)
        for (const n of names) expect(typeof glue.mod[n], `${n} absent du bundle`).toBe('function')
        const body = src.replace(/import init, \{[^}]*\} from '[^']*'/, '')
        const self = { postMessage: (data) => this.onmessage({ data }) }
        new Function('self', 'init', ...names, body)(self, async () => {}, ...names.map((n) => glue.mod[n]))
        this.inner = self
    }
    postMessage(data) { this.inner.onmessage({ data }) }
    terminate() {}
}

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
    vi.stubGlobal('Worker', FakeWorker)
})

import { geoComputeReport, geoOffsetRing } from '../composables/geometryClient'
import { engineBinShape } from '../utils/sheetShape'

const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const disc = (cx, cy, r, n) => {
    const out = Array.from({ length: n }, (_, k) => {
        const a = (2 * Math.PI * k) / n
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    })
    out.push(out[0])
    return out
}
const area = (ring) => {
    let a = 0
    for (let i = 0; i + 1 < ring.length; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return a / 2
}
const segDist = (p, a, b) => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1])
}
const edgeDist = (p, ring) => {
    let d = Infinity
    for (let i = 0; i + 1 < ring.length; i++) d = Math.min(d, segDist(p, ring[i], ring[i + 1]))
    return d
}
const inside = (p, ring) => {
    let inn = false
    for (let i = 0; i + 1 < ring.length; i++) {
        const [a, b] = [ring[i], ring[i + 1]]
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) inn = !inn
    }
    return inn
}
// Distance signée à la région : négative dedans.
const signedDist = (p, ring) => (inside(p, ring) ? -1 : 1) * edgeDist(p, ring)
const probes = (ring) => {
    const out = []
    for (let i = 0; i + 1 < ring.length; i++) {
        for (const t of [0, 0.25, 0.5, 0.75]) {
            out.push([ring[i][0] + t * (ring[i + 1][0] - ring[i][0]), ring[i][1] + t * (ring[i + 1][1] - ring[i][1])])
        }
    }
    return out
}

describe('geoOffsetRing', () => {
    it('rend les champs du contrat, en camelCase', async () => {
        const r = await geoOffsetRing(sq(0, 0, 1000, 500), -10)
        expect(Object.keys(r).sort()).toEqual(
            ['appliedDistanceMm', 'lostAreaMm2', 'maxShiftMm', 'pieces', 'ring', 'voids'],
        )
        expect(r).toMatchObject({ pieces: 1, lostAreaMm2: 0, appliedDistanceMm: -10, voids: [] })
        expect(r.maxShiftMm).toBeLessThanOrEqual(3e-4)
        expect(r.ring.length).toBe(5)
        expect(r.ring[0]).toEqual(r.ring[4])
    })

    it('distance positive = vers l\'extérieur, coins arrondis ; négative = vers l\'intérieur', async () => {
        const input = sq(0, 0, 1000, 500)
        const grown = await geoOffsetRing(input, 10)
        const shrunk = await geoOffsetRing(input, -10)
        const exactGrown = 500000 + 10 * 3000 + Math.PI * 100
        expect(area(grown.ring)).toBeLessThanOrEqual(exactGrown)
        expect(area(grown.ring)).toBeGreaterThan(exactGrown - 2.5)
        expect(area(shrunk.ring)).toBeLessThanOrEqual(980 * 480)
        expect(area(shrunk.ring)).toBeGreaterThan(980 * 480 - 2)
        // Jamais plus grand que le décalage exact.
        for (const p of probes(grown.ring)) expect(signedDist(p, input)).toBeLessThanOrEqual(10 + 1e-9)
        for (const p of probes(shrunk.ring)) expect(signedDist(p, input)).toBeLessThanOrEqual(-10 + 1e-9)
    })

    it('un disque décalé reste du côté sûr, à l\'erreur d\'arc près', async () => {
        const input = disc(500, 500, 500, 360)
        for (const d of [-25, 25]) {
            const r = await geoOffsetRing(input, d)
            expect(r.appliedDistanceMm).toBe(d)
            for (const p of probes(r.ring)) {
                const s = signedDist(p, input)
                expect(s).toBeLessThanOrEqual(d + 1e-9)
                expect(s).toBeGreaterThan(d - 0.04)
            }
        }
    })

    it('l\'anneau rendu a la forme des anneaux de engineBinShape : fermé, anti-horaire', async () => {
        // L'anneau de tôle du moteur, tel que l'application le fabrique.
        const bin = engineBinShape({
            contours: [{ ring: disc(700, 650, 300, 180), areaMm2: 1 }],
            outlineIndex: 0,
            forbidden: [],
        })
        expect(bin.outer[0]).toEqual(bin.outer[bin.outer.length - 1])
        expect(area(bin.outer)).toBeGreaterThan(0)
        for (const d of [-12, 12]) {
            const r = await geoOffsetRing(bin.outer, d)
            expect(r.ring[0]).toEqual(r.ring[r.ring.length - 1])
            expect(area(r.ring)).toBeGreaterThan(0)
            expect(new Set(r.ring.slice(0, -1).map((p) => `${p[0]},${p[1]}`)).size).toBe(r.ring.length - 1)
            // Vers l'extérieur, la boîte commence à -d (à la marge de grille près) :
            // translatée de (d ; d), elle revient en (0 ; 0).
            const minX = Math.min(...r.ring.map((p) => p[0]))
            const minY = Math.min(...r.ring.map((p) => p[1]))
            expect(Math.abs(minX + d)).toBeLessThan(0.02)
            expect(Math.abs(minY + d)).toBeLessThan(0.02)
        }
    })

    it('un goulet qui se ferme : le plus grand morceau, le reste compté', async () => {
        const dumbbell = [
            [0, 0], [300, 0], [300, 135], [500, 135], [500, 50], [700, 50], [700, 250], [500, 250],
            [500, 165], [300, 165], [300, 300], [0, 300], [0, 0],
        ]
        const r = await geoOffsetRing(dumbbell, -20)
        expect(r.pieces).toBe(2)
        expect(r.lostAreaMm2).toBeGreaterThan(25600)
        expect(r.lostAreaMm2).toBeLessThan(25700)
        expect(area(r.ring)).toBeGreaterThan(67600)
        expect(area(r.ring)).toBeLessThan(67700)
    })

    it('segmentsPerTurn règle la finesse des arcs', async () => {
        const coarse = await geoOffsetRing(sq(0, 0, 100, 100), 20, { segmentsPerTurn: 8 })
        const fine = await geoOffsetRing(sq(0, 0, 100, 100), 20)
        expect(coarse.ring.length).toBeLessThan(fine.ring.length)
        expect(area(coarse.ring)).toBeLessThan(area(fine.ring))
    })

    it('un vide enfermé est refusé, ou rendu si on le demande', async () => {
        const keyhole = [
            [0, 0], [400, 0], [400, 400], [206, 400], [206, 250], [250, 250], [250, 150], [150, 150],
            [150, 250], [194, 250], [194, 400], [0, 400], [0, 0],
        ]
        await expect(geoOffsetRing(keyhole, 10)).rejects.toMatchObject({
            message: 'offset_enclosed_void', code: 'offset_enclosed_void',
        })
        const r = await geoOffsetRing(keyhole, 10, { keepVoids: true })
        expect(r.voids.length).toBe(1)
        expect(area(r.voids[0])).toBeGreaterThan(6400)
        expect(area(r.voids[0])).toBeLessThan(6415)
    })

    it('keepVoids : des anneaux fermés, anti-horaires, sur la grille, dans le conteneur et loin de la tôle', async () => {
        // Tôle en C : baie (150..250 x 100..300) ouverte à droite par un couloir de 12 mm.
        const c = [
            [0, 0], [400, 0], [400, 194], [250, 194], [250, 100], [150, 100], [150, 300], [250, 300],
            [250, 206], [400, 206], [400, 400], [0, 400], [0, 0],
        ]
        await expect(geoOffsetRing(c, 10)).rejects.toMatchObject({ code: 'offset_enclosed_void' })
        const r = await geoOffsetRing(c, 10, { keepVoids: true })
        expect(r.appliedDistanceMm).toBe(10)
        expect(r.voids.length).toBe(1)
        const [v] = r.voids
        // Même forme que `ring` : c'est ce que le constructeur translate et passe
        // au moteur comme zone interdite.
        expect(v[0]).toEqual(v[v.length - 1])
        expect(area(v)).toBeGreaterThan(0)
        for (const p of v) for (const x of p) expect(Math.abs(x * 1e4 - Math.round(x * 1e4))).toBeLessThan(1e-6)
        for (const p of probes(v)) {
            expect(inside(p, r.ring)).toBe(true)
            // À 10 mm de la matière au moins (à l'erreur d'arc près) : hors d'atteinte du dépassement.
            const d = signedDist(p, c)
            expect(d).toBeLessThanOrEqual(10 + 1e-9)
            expect(d).toBeGreaterThanOrEqual(10 - 0.02)
        }
        expect(inside([200, 200], v)).toBe(true)
        // Rien d'enfermé : liste vide, pas de refus.
        expect((await geoOffsetRing(c, 5, { keepVoids: true })).voids).toEqual([])
        expect((await geoOffsetRing(c, 60, { keepVoids: true })).voids).toEqual([])
    })

    it('une fente de largeur nulle est tenue à la distance jusqu\'à son bout', async () => {
        // L'aller et le retour de la fente sont sur la même droite (demi-tour exact en (50 ; 30)).
        const slit = [[0, 0], [50, 0], [50, 30], [50, 5], [50.0002, 0], [100, 0], [100, 100], [0, 100], [0, 0]]
        const r = await geoOffsetRing(slit, -10)
        expect(r.appliedDistanceMm).toBe(-10)
        let tip = Infinity
        for (const p of probes(r.ring)) {
            tip = Math.min(tip, Math.hypot(p[0] - 50, p[1] - 30))
            expect(edgeDist(p, slit)).toBeGreaterThanOrEqual(10 - 1e-6)
        }
        expect(tip).toBeGreaterThanOrEqual(10 - 1e-6)
        expect(tip).toBeLessThan(10.03)
    })

    it('rejette avec le code du refus', async () => {
        await expect(geoOffsetRing(sq(0, 0, 100, 100), -60)).rejects.toMatchObject({ code: 'offset_empty' })
        await expect(geoOffsetRing([[0, 0], [10, 0]], 5)).rejects.toMatchObject({ code: 'offset_bad_input' })
        await expect(geoOffsetRing(null, 5)).rejects.toMatchObject({ code: 'offset_bad_input' })
        await expect(geoOffsetRing(sq(0, 0, 100, 100), NaN)).rejects.toMatchObject({ code: 'offset_bad_input' })
        await expect(geoOffsetRing([[0, 0], [100, 100], [100, 0], [0, 100]], 5))
            .rejects.toMatchObject({ code: 'offset_bad_input' })
        const err = await geoOffsetRing(sq(0, 0, 100, 100), -60).catch((e) => e)
        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('offset_empty')
    })

    it('les coordonnées partent en chaînes : distance nulle, anneau rendu au bit près', async () => {
        const ring = [[0.1 + 0.2, 1 / 3], [977 / 7, 0.30000000000000004], [100.123456789, 250 / 3], [1 / 3, 80.7]]
        const r = await geoOffsetRing(ring, 0)
        expect(r.ring).toEqual([...ring, ring[0]])
        expect(r.appliedDistanceMm).toBe(0)
    })
})

describe('geoComputeReport avec une distance au bord', () => {
    const item = (id, x0, y0, x1, y1) => ({ id, coords: sq(x0, y0, x1, y1), holes: [] })
    const at = (id) => ({ item_id: id, angle: 0, x: 0, y: 0 })
    const spec = (items, extra = {}) => ({
        items,
        containers: [{ bin_width: 1000, bin_height: 500, transforms: items.map((i) => at(i.id)) }],
        space: 5,
        ...extra,
    })

    it('sans `edge` : aucun champ ajouté, l\'écart au bord compte dans l\'écart minimal', async () => {
        const r = await geoComputeReport(spec([item('a', 1, 20, 101, 120), item('b', 107, 20, 207, 120)]))
        expect(r.verify).toEqual({
            smallestGapMm: 1, overlapFree: true, insideSheet: true, spacingOk: false, holesFilled: 0,
            holesTotal: 0, holesOverflow: 0, duplicatePoses: 0, verifyStatus: 'measured',
        })
        const same = await geoComputeReport(spec([item('a', 1, 20, 101, 120), item('b', 107, 20, 207, 120)], { edge: null }))
        expect(same).toEqual(r)
    })

    it('avec `edge` : l\'écart au bord est jugé à part, l\'espacement entre pièces seulement', async () => {
        const r = await geoComputeReport(spec([item('a', 1, 20, 101, 120), item('b', 107, 20, 207, 120)], { edge: 1 }))
        expect(r.verify).toMatchObject({
            smallestGapMm: 6, spacingOk: true, edgeGapMm: 1, edgeOk: true, insideSheet: true,
        })
    })

    it('distance négative : un dépassement dans la limite reste « dans la tôle », au-delà non', async () => {
        const ok = await geoComputeReport(spec([item('a', -8, 20, 92, 120)], { edge: -10 }))
        expect(ok.verify).toMatchObject({
            edgeGapMm: -8, edgeOk: true, insideSheet: true, smallestGapMm: null, spacingOk: true, overlapFree: true,
        })
        const ko = await geoComputeReport(spec([item('a', -10.5, 20, 89.5, 120)], { edge: -10 }))
        expect(ko.verify).toMatchObject({ edgeGapMm: -10.5, edgeOk: false, insideSheet: false })
    })

    it('rectangle : `insideSheet` a la tolérance de `edgeOk` (0,01 mm) dès qu\'une distance au bord est réglée', async () => {
        // Le moteur lit la tôle décalée en f32 : une pose au ras peut passer la limite d'un dix-millième.
        for (const [edge, limit] of [[0, 0], [-5, 5]]) {
            const ok = await geoComputeReport(spec([item('a', -(limit + 0.0005), 20, 100, 120)], { edge }))
            expect(ok.verify).toMatchObject({ edgeOk: true, insideSheet: true })
            const ko = await geoComputeReport(spec([item('a', -(limit + 0.02), 20, 100, 120)], { edge }))
            expect(ko.verify).toMatchObject({ edgeOk: false, insideSheet: false })
        }
        // Sans distance au bord : la tolérance d'avant (1e-6).
        const legacy = await geoComputeReport(spec([item('a', -0.0005, 20, 100, 120)]))
        expect(legacy.verify.insideSheet).toBe(false)
    })

    it('distance négative : une pièce presque sans matière sur la tôle est hors tôle, même dans la limite', async () => {
        // Équerre 100 x 100 à ailes de 12 mm, coin en (-45 ; -45) : sa boîte dépasse
        // de 45 mm (permis), toute sa matière est hors de la tôle.
        const bracket = (x, y) => ({
            id: 'l',
            coords: [[x, y], [x + 100, y], [x + 100, y + 12], [x + 12, y + 12], [x + 12, y + 100], [x, y + 100], [x, y]],
            holes: [],
        })
        const off = await geoComputeReport(spec([bracket(-45, -45)], { edge: -45 }))
        expect(off.verify).toMatchObject({ edgeGapMm: -45, edgeOk: true, insideSheet: false })
        const on = await geoComputeReport(spec([bracket(-5, -5)], { edge: -45 }))
        expect(on.verify).toMatchObject({ edgeOk: true, insideSheet: true })
        // Tôle importée : même règle, comptée dans partsOutsideOutline.
        const shaped = (items) => ({
            items,
            containers: [{
                bin_width: 1000,
                bin_height: 1000,
                transforms: items.map((i) => at(i.id)),
                shape: { outer: sq(0, 0, 1000, 1000), inner: [] },
            }],
            space: 2,
            edge: -12,
        })
        const bar = await geoComputeReport(shaped([item('b', -12, 100, -2, 400)]))
        expect(bar.verify).toMatchObject({ edgeGapMm: -12, edgeOk: true, insideSheet: false, partsOutsideOutline: 1 })
        const half = await geoComputeReport(shaped([item('b', -12, 100, 88, 400)]))
        expect(half.verify).toMatchObject({ edgeGapMm: -12, edgeOk: true, insideSheet: true, partsOutsideOutline: 0 })
    })

    it('tôle importée : une pièce qui avale une cavité à l\'embouchure étroite n\'est vue que par une zone', async () => {
        // Fente de 1 mm (y 0..5) ouvrant sur une chambre de 8 x 8 : le centre de la
        // chambre est à 4 mm de la matière, plus que les 3 mm permis, mais aucun bord
        // de la pièce n'y passe. Le rapport seul reste vert : le constructeur doit
        // passer la chambre au moteur comme zone interdite (vides de keepVoids).
        const keyhole = [
            [0, 0], [499.5, 0], [499.5, 5], [496, 5], [496, 13], [504, 13], [504, 5], [500.5, 5], [500.5, 0],
            [1000, 0], [1000, 1000], [0, 1000], [0, 0],
        ]
        const part = item('p', 450, 2, 550, 102)
        const report = (inner) => geoComputeReport({
            items: [part],
            containers: [{
                bin_width: 1000, bin_height: 1000, transforms: [at('p')], shape: { outer: keyhole, inner },
            }],
            space: 2,
            edge: -3,
        })
        expect((await report([])).verify).toMatchObject({
            edgeGapMm: -0.5, edgeOk: true, insideSheet: true, partsOutsideOutline: 0,
        })
        // Le vide rendu par le décalage de |bord| = 3 mm, passé comme zone : violation.
        const { voids } = await geoOffsetRing(keyhole, 3, { keepVoids: true })
        expect(voids.length).toBe(1)
        expect(inside([500, 9], voids[0])).toBe(true)
        expect((await report(voids)).verify).toMatchObject({ zoneViolations: 1, zoneClear: false, spacingOk: false })
    })

    it('tôle importée : le contour suit `edge`, la zone interdite garde l\'espacement', async () => {
        const items = [item('z', 299.5, 450, 399.5, 550), item('e', -3, 700, 97, 800)]
        const r = await geoComputeReport({
            items,
            containers: [{
                bin_width: 1000,
                bin_height: 1000,
                transforms: items.map((i) => at(i.id)),
                shape: { outer: sq(0, 0, 1000, 1000), inner: [sq(400, 400, 600, 600)] },
            }],
            space: 2,
            edge: -5,
        })
        expect(r.verify).toMatchObject({
            edgeGapMm: -3, edgeOk: true, insideSheet: true, partsOutsideOutline: 0,
            minDistToZoneMm: 0.5, smallestGapMm: 0.5, spacingOk: false, zoneClear: true,
        })
    })
})
