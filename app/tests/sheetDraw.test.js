import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Lot 6 : le vrai contour et les zones interdites à l'écran. Le SVG est celui du
// bundle wasm livré (public/geometry), appelé tel quel ; le reste est du JS pur.

const BUNDLE_JS = path.resolve(__dirname, '../../public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.resolve(__dirname, '../../public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null }))

vi.mock('../composables/geometryClient', () => ({
    geoExportSvgSheet: vi.fn(async (spec) => glue.mod.export_svg_sheet(JSON.stringify(spec))),
    geoExportDxfSheet: vi.fn(async () => null),
    geoPinwheelCapacity: vi.fn(async () => ({ rotations: [] })),
    geoComputeReport: vi.fn(async (spec) => JSON.parse(glue.mod.compute_report(JSON.stringify(spec)))),
}))

import { buildAlternativeArtifacts, decorateLiveLayout } from '../composables/localBridge'
import { buildLiveLayout } from '../composables/finalizeLocal'
import {
    ZONE_RED, fmtNum, liveFormatOfRank, liveHatchId, liveShapeFields, liveShapeTable, livePaneShape,
    outlineSize, ringToPath, shapeToDrawPaths, shortHash, withLiveShapes, withSheetShapeSvg,
} from '../utils/sheetDraw'

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
})

const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const DISC = (() => {
    const r = Array.from({ length: 72 }, (_, k) => {
        const a = (k * 5 * Math.PI) / 180
        return [500 + 500 * Math.cos(a), 500 + 500 * Math.sin(a)]
    })
    r.push(r[0])
    return r
})()
const ZONE = sq(200, 200, 300, 300)
const bin = (id, data) => ({ id, cost: 1, stock: 1, shape: { type: 'polygon', data } })
const part = (id, w, h) => ({ id, file_slug: `f${id}`, coords: sq(0, 0, w, h), holes: [], count: 1, color: '#2563EB' })
const place = (x, y, id = 0) => ({ item_id: id, transformation: { rotation: 0, translation: [x, y] } })
const payloadOf = (bins, shaped = []) => ({
    problem: 'bpp',
    instance: { name: 't', bins, items: [{ id: 0, demand: 1 }] },
    engineConfig: { min_item_separation: 2 },
    parts: [part(0, 100, 100)],
    ...(shaped.length ? { shapedSheets: shaped.map((id) => ({ id, usableAreaMm2: 1, perimeterMm: 1 })) } : {}),
})
const resultOf = (layouts) => ({
    problem: 'bpp',
    alternatives: [{ rank: 0, seed: 1, solution: { layouts } }],
})

describe('chemins de dessin (purs)', () => {
    it('fmtNum : court, déterministe, jamais -0', () => {
        expect(fmtNum(12.3456789)).toBe('12.346')
        expect(fmtNum(5)).toBe('5')
        expect(fmtNum(-0.0001)).toBe('0')
        expect(fmtNum(NaN)).toBe('0')
    })

    it('ringToPath : y retourné (H - y), doublon de fermeture retiré', () => {
        expect(ringToPath(sq(0, 0, 10, 20), 20)).toBe('M0 20 10 20 10 0 0 0Z')
        expect(ringToPath([[0, 0], [1, 1]], 5)).toBe('')
        expect(ringToPath([[0, 0], [1, 1], [NaN, 2]], 5)).toBe('')
    })

    it('shapeToDrawPaths : contour illisible = null, zones dans un seul chemin', () => {
        expect(shapeToDrawPaths({ outer: [] }, 10)).toBeNull()
        const p = shapeToDrawPaths({ outer: sq(0, 0, 10, 10), inner: [sq(1, 1, 2, 2), sq(5, 5, 6, 6)] }, 10)
        expect(p.outline.startsWith('M0 10')).toBe(true)
        expect(p.zones.match(/M/g)).toHaveLength(2)
        expect(shapeToDrawPaths({ outer: sq(0, 0, 10, 10) }, 10).zones).toBe('')
    })

    it('outlineSize : boîte du contour', () => {
        expect(outlineSize(DISC)).toEqual([1000, 1000])
        expect(outlineSize([])).toBeNull()
    })
})

describe('withSheetShapeSvg', () => {
    const base = [
        "<?xml version='1.0' encoding='utf-8'?>",
        '<svg xmlns="http://www.w3.org/2000/svg" width="1000.0mm" height="1000.0mm" viewBox="0 0 1000.0 1000.0">',
        '<rect x="0" y="0" width="1000.0" height="1000.0" fill="#FFFFFF" stroke="#3B82F6" stroke-width="3.0" />',
        '<path d="M1 1Z" />',
        '</svg>',
    ].join('\n')

    it('sans forme : le SVG reste le même, octet pour octet', () => {
        expect(withSheetShapeSvg(base, null, 1000, 1000)).toBe(base)
        expect(withSheetShapeSvg(base, { outer: [] }, 1000, 1000)).toBe(base)
    })

    it('ligne du rectangle non reconnue : inchangé (jamais un SVG cassé)', () => {
        const odd = base.replace('<rect x="0"', '<rect x="1"')
        expect(withSheetShapeSvg(odd, { outer: DISC }, 1000, 1000)).toBe(odd)
    })

    it('contour vrai : plus de rectangle de tôle, les pièces restent après', () => {
        const out = withSheetShapeSvg(base, { outer: DISC, inner: [] }, 1000, 1000, 3)
        expect(out).not.toContain('<rect')
        expect(out).toContain('fill="#FFFFFF" stroke="#3B82F6" stroke-width="3"')
        expect(out.indexOf('<path d="M1 1Z" />')).toBeGreaterThan(out.indexOf('M1000 500'))
        expect(out).not.toContain('<defs>')
        expect(out.split('\n')).toHaveLength(base.split('\n').length)
    })

    it('zones : rouges explicites (fond + hachure + trait), sous les pièces, id par tôle', () => {
        const out = withSheetShapeSvg(base, { outer: DISC, inner: [ZONE] }, 1000, 1000, 2)
        expect(out).toContain(`fill="${ZONE_RED}" fill-opacity="0.18"`)
        expect(out).toContain('fill="url(#nc-zone-hatch-2)"')
        expect(out).toContain(`stroke="${ZONE_RED}"`)
        expect(out).not.toContain('var(')
        expect(out.indexOf('nc-zone-hatch-2')).toBeLessThan(out.indexOf('<path d="M1 1Z" />'))
        // y retourné : la zone 200..300 occupe y = 700..800 dans le dessin
        expect(out).toContain('M200 800 300 800 300 700 200 700Z')
        // ids distincts d'une tôle à l'autre
        const other = withSheetShapeSvg(base, { outer: DISC, inner: [ZONE] }, 1000, 1000, 5)
        expect(other).toContain('nc-zone-hatch-5')
        expect(other).not.toContain('nc-zone-hatch-2')
    })

    it("J4 : la portée rend l'id unique entre deux résultats d'une même page", () => {
        const idOf = (svg) => /<pattern id="([^"]+)"/.exec(svg)[1]
        const a = withSheetShapeSvg(base, { outer: DISC, inner: [ZONE] }, 1000, 1000, 0, shortHash('job-a'))
        const b = withSheetShapeSvg(base, { outer: DISC, inner: [ZONE] }, 1000, 1000, 0, shortHash('job-b'))
        expect(idOf(a)).not.toBe(idOf(b))
        expect(a).toContain(`fill="url(#${idOf(a)})"`)
        expect(idOf(a)).toMatch(/^nc-zone-hatch-0-[0-9a-f]{8}$/)
        // portée hostile : assainie ; sans portée : id d'avant
        expect(idOf(withSheetShapeSvg(base, { outer: DISC, inner: [ZONE] }, 1000, 1000, 0, '"><x'))).toBe('nc-zone-hatch-0-x')
        expect(idOf(withSheetShapeSvg(base, { outer: DISC, inner: [ZONE] }, 1000, 1000, 0))).toBe('nc-zone-hatch-0')
    })

    it("l'id de motif ne laisse passer aucun caractère dangereux", () => {
        const out = withSheetShapeSvg(base, { outer: DISC, inner: [ZONE] }, 1000, 1000, '"><x')
        expect(out).toContain('id="nc-zone-hatch-x"')
    })
})

describe('SVG couleur du résultat local (wasm réel)', () => {
    const rectBin = bin(0, { outer: sq(0, 0, 1000, 1000) })

    it('job sans tôle importée : SVG identique à celui du bundle, octet pour octet', async () => {
        const payload = payloadOf([rectBin])
        const arts = await buildAlternativeArtifacts(resultOf([{ container_id: 0, placed_items: [place(10, 10)] }]), payload)
        const raw = glue.mod.export_svg_sheet(JSON.stringify({
            transforms: [{ item_id: '0', file_slug: 'f0', handles: [], angle: 0, x: 10, y: 10 }],
            items: { 0: { coords: sq(0, 0, 100, 100), holes: [], color: '#2563EB' } },
            bin_width: 1000,
            bin_height: 1000,
        }))
        expect(arts[0].sheets[0]).toBe(raw)
        expect(arts[0].sheets[0]).toContain('<rect x="0" y="0"')
    })

    it('tôle disque + zone : contour vrai, zone rouge, pièce dessinée après', async () => {
        const payload = payloadOf([bin(0, { outer: DISC, inner: [ZONE] })], [0])
        const arts = await buildAlternativeArtifacts(resultOf([{ container_id: 0, placed_items: [place(450, 450)] }]), payload)
        const svg = arts[0].sheets[0]
        expect(svg).not.toContain('<rect')
        expect(svg).toContain('nc-zone-hatch-0')
        expect(svg.indexOf('nc-zone-hatch-0')).toBeLessThan(svg.indexOf('fill-opacity="0.35"'))
        expect(svg).toContain('viewBox="0 0 1000.0 1000.0"')
    })

    it('multi-tôles et format mixte : chaque tôle a SA forme (container_id)', async () => {
        const payload = payloadOf([rectBin, bin(1, { outer: DISC, inner: [ZONE] })], [1])
        const arts = await buildAlternativeArtifacts(resultOf([
            { container_id: 1, placed_items: [place(450, 450)] },
            { container_id: 0, placed_items: [place(10, 10)] },
            { container_id: 1, placed_items: [place(600, 600)] },
        ]), payload)
        const [a, b, c] = arts[0].sheets
        expect(a).toContain('nc-zone-hatch-0')
        expect(b).toContain('<rect x="0" y="0"')
        expect(b).not.toContain('nc-zone')
        expect(c).toContain('nc-zone-hatch-2')
    })

    it('format importé introuvable (container_id hors liste) : rectangle, pas de forme fausse', async () => {
        const payload = payloadOf([bin(0, { outer: DISC })], [0])
        const arts = await buildAlternativeArtifacts(resultOf([{ container_id: 7, placed_items: [place(10, 10)] }]), payload)
        expect(arts[0].sheets[0]).toContain('<rect x="0" y="0"')
    })

    it("R1 : une pièce à 0,5 mm d'une zone, espacement 2 → badge « Écart » rouge ; à 2,2 mm → vert", async () => {
        const payload = payloadOf([bin(0, { outer: DISC, inner: [ZONE] })], [0])
        // zone (200..300)² ; pièce 100 x 100 : bord gauche à x, donc écart x - 300
        const near = await buildAlternativeArtifacts(resultOf([{ container_id: 0, placed_items: [place(300.5, 200)] }]), payload)
        const v = near[0].report.verify
        expect(v.zoneClear).toBe(true)
        expect(v.minDistToZoneMm).toBeCloseTo(0.5, 2)
        expect(v.smallestGapMm).toBeCloseTo(0.5, 2)
        expect(v.spacingOk).toBe(false)
        const far = await buildAlternativeArtifacts(resultOf([{ container_id: 0, placed_items: [place(302.2, 200)] }]), payload)
        expect(far[0].report.verify.spacingOk).toBe(true)
        expect(far[0].report.verify.smallestGapMm).toBeCloseTo(2.2, 2)
    })

    it('R4 : forme introuvable (container_id hors liste) → chute null, dans la tôle null, non vérifié', async () => {
        const payload = payloadOf([bin(0, { outer: DISC })], [0])
        const arts = await buildAlternativeArtifacts(resultOf([{ container_id: 7, placed_items: [place(10, 10)] }]), payload)
        const r = arts[0].report
        expect(r.per_sheet[0].offcut).toBeNull()
        expect(r.verify.insideSheet).toBeNull()
        expect(r.verify.shapeVerified).toBe(false)
        expect(r.verify.verifyStatus).toBe('skipped')
    })

    it('aucun anneau de tôle dans le résultat livré hors du SVG (containers, rapport)', async () => {
        const payload = payloadOf([bin(0, { outer: DISC, inner: [ZONE] })], [0])
        const arts = await buildAlternativeArtifacts(resultOf([{ container_id: 0, placed_items: [place(450, 450)] }]), payload)
        expect(JSON.stringify(arts[0].containers)).not.toContain('"outer"')
        expect(JSON.stringify(arts[0].report)).not.toContain('"outer"')
    })
})

describe('vue live : formats et formes', () => {
    const one = payloadOf([bin(0, { outer: DISC, inner: [ZONE] })], [0])
    const mixed = payloadOf([bin(0, { outer: sq(0, 0, 1000, 1000) }), bin(1, { outer: DISC, inner: [ZONE] })], [1])

    it('job sans tôle importée : aucun champ ajouté à la frame', () => {
        expect(liveShapeFields(payloadOf([bin(0, { outer: sq(0, 0, 10, 10) })]))).toEqual({})
        expect(liveShapeTable(payloadOf([bin(0, { outer: sq(0, 0, 10, 10) })]))).toBeNull()
    })

    it('table par format : null pour un rectangle, chemins prêts pour une tôle importée', () => {
        const t = liveShapeTable(mixed)
        expect(t[0]).toBeNull()
        expect(t[1]).toMatchObject({ w: 1000, h: 1000 })
        expect(t[1].zones).toContain('M200 800')
        expect(liveShapeTable(mixed)).toBe(t)
    })

    it('un seul format : toutes les tôles ont sa forme', () => {
        const frame = { ...liveShapeFields(one), sheets: [[1000, 1000]] }
        expect(liveFormatOfRank(frame, 0)).toBe(0)
        expect(liveFormatOfRank(frame, 3)).toBe(0)
        expect(livePaneShape(frame, { bin: 2, w: 1000, h: 1000 })).not.toBeNull()
    })

    it('plusieurs formats, rang inconnu : rectangle (null), jamais une forme devinée', () => {
        const frame = { ...liveShapeFields(mixed), sheets: [[1000, 1000], [1000, 1000]] }
        expect(liveFormatOfRank(frame, 0)).toBeNull()
        expect(livePaneShape(frame, { bin: 1, w: 1000, h: 1000 })).toBeNull()
    })

    it('frame finale : le format de chaque rang est connu (binFormats)', () => {
        const frame = { ...liveShapeFields(mixed), binFormats: [1, 0, 1] }
        expect(liveFormatOfRank(frame, 0)).toBe(1)
        expect(liveFormatOfRank(frame, 1)).toBe(0)
        expect(livePaneShape(frame, { bin: 0, w: 1000, h: 1000 })).not.toBeNull()
        // rang de format rectangle : pas de forme
        expect(livePaneShape(frame, { bin: 1, w: 1000, h: 1000 })).toBeNull()
        // format hors table : inconnu
        expect(liveFormatOfRank({ ...frame, binFormats: [9] }, 0)).toBeNull()
    })

    it('J1 : la frame finale rendue à la page porte la table des formes ET le format de chaque tôle', () => {
        const bestAlt = { solution: { layouts: [
            { container_id: 1, placed_items: [place(450, 450)] },
            { container_id: 0, placed_items: [place(10, 10)] },
        ] } }
        const raw = buildLiveLayout({ problem: 'bpp' }, mixed, bestAlt, 0.5)
        // sans la table : toutes les tôles retombent sur le rectangle (le défaut vu)
        expect(livePaneShape(raw, { bin: 0, w: 1000, h: 1000 })).toBeNull()
        const final = withLiveShapes(raw, mixed)
        expect(livePaneShape(final, { bin: 0, w: 1000, h: 1000 })).toMatchObject({ w: 1000, h: 1000 })
        expect(livePaneShape(final, { bin: 0, w: 1000, h: 1000 }).zones).toContain('M200 800')
        expect(livePaneShape(final, { bin: 1, w: 1000, h: 1000 })).toBeNull() // rang 1 = format rectangle
        // job rectangulaire : la frame reste la même, objet pour objet
        const plain = payloadOf([bin(0, { outer: sq(0, 0, 1000, 1000) })])
        const g = buildLiveLayout({ problem: 'bpp' }, plain, bestAlt, 0.5)
        expect(withLiveShapes(g, plain)).toBe(g)
    })

    it("boîte du panneau différente de celle de la forme : rectangle", () => {
        const frame = { ...liveShapeFields(one) }
        expect(livePaneShape(frame, { bin: 0, w: 2000, h: 1000 })).toBeNull()
    })

    it('buildLiveLayout : frame finale à tôle importée porte binFormats et la boîte de chaque tôle', () => {
        const result = { problem: 'bpp' }
        const bestAlt = { solution: { layouts: [
            { container_id: 1, placed_items: [place(450, 450)] },
            { container_id: 0, placed_items: [place(10, 10)] },
        ] } }
        const f = buildLiveLayout(result, mixed, bestAlt, 0.5)
        expect(f.binFormats).toEqual([1, 0])
        expect(f.sheets).toEqual([[1000, 1000], [1000, 1000]])
        // job rectangulaire : frame inchangée (ni binFormats, ni sheets par tôle)
        const g = buildLiveLayout(result, payloadOf([bin(0, { outer: sq(0, 0, 1000, 1000) })]), bestAlt, 0.5)
        expect('binFormats' in g).toBe(false)
        expect(g.sheets).toEqual([[1000, 1000]])
    })

    it('decorateLiveLayout ne touche pas aux formes (elles sont ajoutées par le job local)', () => {
        const out = decorateLiveLayout({ items: [], sheets: [[1, 1]] }, one)
        expect(out.sheetShapes).toBeUndefined()
    })

    it('ids de motif live uniques par vue, carte et panneau', () => {
        const a = liveHatchId('v1', 'm', 0)
        expect(a).not.toBe(liveHatchId('v1', 'm', 1))
        expect(a).not.toBe(liveHatchId('v1', 'left', 0))
        expect(a).not.toBe(liveHatchId('v2', 'm', 0))
    })
})
