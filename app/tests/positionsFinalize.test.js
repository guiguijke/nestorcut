import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Lot positions : les positions sont calculées à la finalisation (vrai bundle
// wasm, vrai chemin assembleBrowserArtifacts), attachées au record, et ne
// quittent JAMAIS le navigateur.

const BUNDLE_JS = path.resolve(__dirname, '../../public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.resolve(__dirname, '../../public/geometry/nest_geometry_bg.wasm')
const glue = vi.hoisted(() => ({ mod: null }))

vi.mock('../composables/geometryClient', () => ({
    geoExportSvgSheet: vi.fn(async (spec) => glue.mod.export_svg_sheet(JSON.stringify(spec))),
    geoExportDxfSheet: vi.fn(async (slugs, sources, spec) =>
        glue.mod.export_dxf_sheet(slugs, sources.map((b) => new Uint8Array(b)), JSON.stringify(spec))),
    geoPinwheelCapacity: vi.fn(async () => ({ rotations: [] })),
    geoComputeReport: vi.fn(async (spec) => JSON.parse(glue.mod.compute_report(JSON.stringify(spec)))),
}))

import { alternativePositions, assembleBrowserArtifacts, dropPositionsUnlessBrowserBuilt } from '../composables/finalizeLocal'
import { parseSheetSvg } from '../utils/sheetSvgReport'
import { hydrateLocalItem } from '../composables/localHydrate'
import { entityIndexOf, readDxfEntities } from '../utils/dxfEntities'

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
})

const enc = (s) => new Uint8Array(Buffer.from(s))
const ringOf = (cx, cy, r, n = 72) => {
    const pts = Array.from({ length: n }, (_, k) => {
        const a = (2 * Math.PI * k) / n
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    })
    pts.push(pts[0])
    return pts
}
const circleSource = (r) => enc(`0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n5\nC1\n8\n0\n10\n${r}\n20\n${r}\n40\n${r}\n0\nENDSEC\n0\nEOF\n`)
const RECT_SOURCE = enc('0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n5\nR1\n8\n0\n90\n4\n70\n1\n10\n0\n20\n0\n10\n30\n20\n0\n10\n30\n20\n20\n10\n0\n20\n20\n0\nENDSEC\n0\nEOF\n')

// Disque importé de 153 mm (polygone à 72 côtés) et quatre pièces : trois vrais cercles
// (17 ; 22,5 ; 35,3 mm) et un rectangle 30 x 20.
const R = 76.5
const DISC = ringOf(R, R, R)
const parts = [
    { id: 0, file_slug: 'c17', handles: ['C1'], coords: ringOf(8.5, 8.5, 8.5), holes: [], count: 1, color: '#2563EB', ringHull: ringOf(8.5, 8.5, 8.5) },
    { id: 1, file_slug: 'c225', handles: ['C1'], coords: ringOf(11.25, 11.25, 11.25), holes: [], count: 1, color: '#2563EB', ringHull: ringOf(11.25, 11.25, 11.25) },
    { id: 2, file_slug: 'c353', handles: ['C1'], coords: ringOf(17.65, 17.65, 17.65), holes: [], count: 1, color: '#2563EB', ringHull: ringOf(17.65, 17.65, 17.65) },
    { id: 3, file_slug: 'rect', handles: ['R1'], coords: [[0, 0], [30, 0], [30, 20], [0, 20], [0, 0]], holes: [], count: 1, color: '#2563EB', ringHull: [[0, 0], [30, 0], [30, 20], [0, 20], [0, 0]] },
]
const sources = { c17: circleSource(8.5), c225: circleSource(11.25), c353: circleSource(17.65), rect: RECT_SOURCE }
const names = { c17: 'Rond 17.dxf', c225: 'Rond 22,5.dxf', c353: 'Rond 35.3.dxf', rect: 'plaque.dxf' }
const place = (id, x, y, rotation = 0) => ({ item_id: id, transformation: { rotation, translation: [x, y] } })
// Centres voulus : (50 ; 76,5), (95 ; 60), (76,5 ; 105) et le rectangle en (55 ; 25).
const LAYOUT = {
    container_id: 0,
    placed_items: [place(0, 41.5, 68), place(1, 83.75, 48.75), place(2, 58.85, 87.35), place(3, 55, 25)],
}
const payloadOf = (opts = {}) => ({
    problem: 'bpp',
    instance: {
        name: 't',
        bins: [{ id: 0, cost: 1, stock: 1, shape: { type: 'polygon', data: { outer: DISC } } }],
        items: parts.map((p) => ({ id: p.id, demand: 1 })),
    },
    engineConfig: { min_item_separation: 0 },
    requestedSpace: 0,
    shapedSheets: [{ id: 0, usableAreaMm2: 1, perimeterMm: 1 }],
    parts,
    ...opts,
})
const resultOf = () => ({ problem: 'bpp', alternatives: [{ rank: 0, seed: 1, solution: { layouts: [structuredClone(LAYOUT)] } }] })

describe('finalisation : positions des pièces d\'un disque importé de 153 mm', () => {
    it('une ligne par pièce, centres et diamètres EXACTS des CIRCLE du DXF livré', async () => {
        const out = await assembleBrowserArtifacts({ result: resultOf(), payload: payloadOf(), sources, jobSlug: 'job' })
        expect(out.alternatives).toHaveLength(1)
        const alt = out.alternatives[0]
        expect(alt.dxfs).toHaveLength(1)
        expect(alt.dxfs[0].fileName).toBe('job_alt0_part_1.dxf')
        // La boîte de la tôle ENTIÈRE, sur le fichier et sur les positions.
        expect(alt.dxfs[0].box).toEqual([153, 153])
        // Son centre : celui du cercle, le même pour le DXF recentré et pour le CSV.
        expect(Math.hypot(alt.dxfs[0].center[0] - 76.5, alt.dxfs[0].center[1] - 76.5)).toBeLessThan(1e-9)
        expect(alt.positions[0].center).toEqual(alt.dxfs[0].center)
        expect(alt.outputUnit).toBe('mm')
        expect(alt.positions).toHaveLength(1)
        expect(alt.positions[0].sheet).toBe(1)
        expect(alt.positions[0].box).toEqual([153, 153])
        const rows = alt.positions[0].rows
        expect(rows.map((r) => r.fileSlug)).toEqual(['c17', 'c225', 'c353', 'rect'])
        const round = (r) => [r.x, r.y, r.d]
        expect(round(rows[0])).toEqual([50, 76.5, 17])
        expect(round(rows[1])).toEqual([95, 60, 22.5])
        expect(round(rows[2])).toEqual([76.5, 105, 35.3])
        expect(rows[3]).toEqual({ fileSlug: 'rect', x: 70, y: 35, d: null, rot: 0 })
        // Ces mêmes centres sont ceux des CIRCLE du fichier livré.
        const dxf = alt.dxfs[0].content
        const g = dxf.split('\n')
        const circles = []
        for (let i = 0; i + 1 < g.length; i += 2) {
            if (g[i] === '0' && g[i + 1] === 'CIRCLE') {
                const at = (code) => Number(g[g.indexOf(code, i + 2) + 1])
                circles.push([at('10'), at('20'), 2 * at('40')])
            }
        }
        expect(circles).toHaveLength(3)
        circles.forEach((c, k) => {
            expect(c[0]).toBeCloseTo(rows[k].x, 12)
            expect(c[1]).toBeCloseTo(rows[k].y, 12)
            expect(c[2]).toBeCloseTo(rows[k].d, 12)
        })
        // Le rectangle : le centre de la boîte de l'entité LIVRÉE (hors cadre de la tôle).
        const delivered = [...readDxfEntities(dxf).values()].flat().filter((e) => e.layer === '0' && e.type === 'LWPOLYLINE')
        expect(delivered).toHaveLength(1)
        const xs = delivered[0].verts.map((v) => v[0])
        const ys = delivered[0].verts.map((v) => v[1])
        expect(rows[3].x).toBeCloseTo((Math.min(...xs) + Math.max(...xs)) / 2, 9)
        expect(rows[3].y).toBeCloseTo((Math.min(...ys) + Math.max(...ys)) / 2, 9)
    })

    it('jamais d\'échec : un conteneur illisible donne « pas de positions », le reste du résultat reste', async () => {
        expect(alternativePositions([{ bin_width: 10, bin_height: 10, transforms: null }], payloadOf(), entityIndexOf(sources))).toBeNull()
        expect(alternativePositions(null, payloadOf(), entityIndexOf(sources))).toBeNull()
        expect(alternativePositions([{ bin_width: 10, bin_height: 10, transforms: [{ item_id: '99', angle: 0, x: 0, y: 0 }] }], payloadOf(), entityIndexOf(sources))).toBeNull()
        // Une tôle sans lignes sur deux : tout ou rien, jamais un CSV amputé.
        const ok = { bin_width: 153, bin_height: 153, transforms: [{ item_id: '3', file_slug: 'rect', angle: 0, x: 0, y: 0 }] }
        const bad = { bin_width: 153, bin_height: 153, transforms: [{ item_id: '3', file_slug: 'rect', angle: NaN, x: 0, y: 0 }] }
        expect(alternativePositions([ok, bad], payloadOf(), entityIndexOf(sources))).toBeNull()
        expect(alternativePositions([ok, ok], payloadOf(), entityIndexOf(sources))).toHaveLength(2)
    })

    it('sortie en pouces : unité du DXF (celle du CSV) et CIRCLE relus en mm', async () => {
        const out = await assembleBrowserArtifacts({ result: resultOf(), payload: payloadOf({ outputUnit: 'inch' }), sources, jobSlug: 'job' })
        const alt = out.alternatives[0]
        expect(alt.outputUnit).toBe('inch')
        const rows = alt.positions[0].rows
        expect(rows[0].x).toBeCloseTo(50, 9)
        expect(rows[0].d).toBeCloseTo(17, 9)
        expect(alt.dxfs[0].box).toEqual([153, 153])
    })

    it('l\'hydratation ne garde qu\'un booléen : les lignes restent dans le record', async () => {
        const out = await assembleBrowserArtifacts({ result: resultOf(), payload: payloadOf(), sources, jobSlug: 'job' })
        const record = { slug: 's', alternatives: out.alternatives }
        const item = hydrateLocalItem({ slug: 's', status: 'completed' }, record)
        expect(item.alternatives[0].hasPositions).toBe(true)
        expect(JSON.stringify(item.alternatives)).not.toContain('fileSlug')
        expect(item.localRecord.alternatives[0].positions[0].rows).toHaveLength(4)
        const old = hydrateLocalItem({ slug: 's' }, { slug: 's', alternatives: [{ ...out.alternatives[0], positions: undefined }] })
        expect(old.alternatives[0].hasPositions).toBe(false)
    })
})

describe('rapport PDF : identifiants de fichier de chaque forme de l’aperçu (svgSlugs)', () => {
    it('une liste par tôle, dans l’ordre des formes du SVG, sans rien changer au SVG', async () => {
        const out = await assembleBrowserArtifacts({ result: resultOf(), payload: payloadOf(), sources, jobSlug: 'job' })
        const alt = out.alternatives[0]
        expect(alt.svgSlugs).toEqual([['c17', 'c225', 'c353', 'rect']])
        // Une pose par forme (aucun bloc ici) : indices 0 à 3 ; retirés avec les identifiants.
        expect(alt.svgPoses).toEqual([[0, 1, 2, 3]])
        // Alignement : autant de formes dans le SVG que d identifiants, dans le même ordre
        // (la 4e est le rectangle 30 x 20).
        const parsed = parseSheetSvg(alt.svgs[0])
        expect(parsed.parts).toHaveLength(alt.svgSlugs[0].length)
        const box = (rings) => ({ w: Math.max(...rings[0].map((p) => p[0])) - Math.min(...rings[0].map((p) => p[0])), h: Math.max(...rings[0].map((p) => p[1])) - Math.min(...rings[0].map((p) => p[1])) })
        expect(box(parsed.parts[3].rings).w).toBeCloseTo(30, 6)
        expect(box(parsed.parts[3].rings).h).toBeCloseTo(20, 6)
        expect(box(parsed.parts[0].rings).w).toBeCloseTo(17, 1)
        // Le champ est additif : aucun autre champ de l'alternative n'a bougé de forme.
        expect(Array.isArray(alt.svgs)).toBe(true)
        expect(typeof alt.svgs[0]).toBe('string')
    })

    it('retiré hors job construit dans le navigateur, comme les positions', async () => {
        const out = await assembleBrowserArtifacts({ result: resultOf(), payload: payloadOf(), sources, jobSlug: 'job' })
        const kept = dropPositionsUnlessBrowserBuilt(structuredClone(out.alternatives), 'client-built')
        expect(kept[0].svgSlugs).toEqual([['c17', 'c225', 'c353', 'rect']])
        const dropped = dropPositionsUnlessBrowserBuilt(structuredClone(out.alternatives), 'server')
        expect(dropped[0].svgSlugs).toBeUndefined()
        expect(dropped[0].svgPoses).toBeUndefined()
        expect(dropped[0].positions).toBeUndefined()
    })

    it('un résultat ancien (sans svgSlugs) s’hydrate sans rien casser', async () => {
        const out = await assembleBrowserArtifacts({ result: resultOf(), payload: payloadOf(), sources, jobSlug: 'job' })
        const { svgSlugs, ...old } = out.alternatives[0]
        expect(svgSlugs).toBeDefined()
        const item = hydrateLocalItem({ slug: 's' }, { slug: 's', alternatives: [old] })
        expect(item.localRecord.alternatives[0].svgSlugs).toBeUndefined()
        expect(item.alternatives[0].svgs).toHaveLength(1)
    })
})

describe('aucune position ne quitte le navigateur', () => {
    const appDir = path.resolve(__dirname, '..')
    const SKIP = new Set(['tests', 'node_modules', '.nuxt', '.output', '.cache'])
    const walk = (dir, out = []) => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name)
            if (statSync(full).isDirectory()) {
                if (!SKIP.has(name)) walk(full, out)
            } else if (/\.(vue|js|ts)$/.test(name)) out.push(full)
        }
        return out
    }
    const balanced = (src, start) => {
        let depth = 0
        for (let i = start; i < src.length; i++) {
            if (src[i] === '(') depth++
            else if (src[i] === ')' && --depth === 0) return src.slice(start, i + 1)
        }
        return src.slice(start)
    }

    it('aucun appel réseau de l\'application ne cite positions, fileNames ni box ; local-quota = scalaires', () => {
        const calls = []
        for (const file of walk(appDir)) {
            const src = readFileSync(file, 'utf8')
            for (const m of src.matchAll(/(\$fetch|useApiFetch|useFetch|fetch|sendBeacon)\(/g)) {
                calls.push({ file: path.relative(appDir, file), call: balanced(src, m.index + m[0].length - 1) })
            }
        }
        expect(calls.length).toBeGreaterThan(20)
        const leaking = calls.filter((c) => /\bpositions\b|\bfileNames\b|\bblockParts\b|\bsvgSlugs\b|\bsvgPoses\b|\bbranding\b|\bcompanyLogo\b/.test(c.call))
        expect(leaking).toEqual([])
        // Le corps de local-quota (la seule requête qui part à la fin d'un job local) :
        // des scalaires, jamais les alternatives ni le record.
        const priv = readFileSync(path.join(appDir, 'composables/localJobPrivate.js'), 'utf8')
        const at = priv.indexOf('/local-quota`')
        expect(at).toBeGreaterThan(0)
        const body = balanced(priv, priv.indexOf('(', priv.lastIndexOf('$fetch(', at)))
        expect(body).not.toMatch(/alternatives\b|\.\.\.alt|dxfs|record|positions/)
    })
})
