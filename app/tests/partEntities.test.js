import { describe, expect, it } from 'vitest'
import { entityIndexOf, readDxfEntities } from '../utils/dxfEntities'
import { sheetPositions } from '../utils/partPositions'
import { convexHullRing } from '../composables/localPayloadBuilder'

// Lot positions : les positions se mesurent sur les ENTITÉS RÉELLES d'une source
// DXF (arcs, bosses de polyligne, ellipses, splines), jamais sur les anneaux
// simplifiés, cordés ou élargis du payload.

const D2R = Math.PI / 180
// --- fabrique de sources DXF canoniques --------------------------------------
const circle = (h, cx, cy, r) => `0\nCIRCLE\n5\n${h}\n8\n0\n10\n${cx}\n20\n${cy}\n40\n${r}\n`
const arc = (h, cx, cy, r, a0, a1) => `0\nARC\n5\n${h}\n8\n0\n10\n${cx}\n20\n${cy}\n40\n${r}\n50\n${a0}\n51\n${a1}\n`
const line = (h, x0, y0, x1, y1) => `0\nLINE\n5\n${h}\n8\n0\n10\n${x0}\n20\n${y0}\n11\n${x1}\n21\n${y1}\n`
const lwpoly = (h, verts, closed = true) => `0\nLWPOLYLINE\n5\n${h}\n8\n0\n90\n${verts.length}\n70\n${closed ? 1 : 0}\n`
    + verts.map(([x, y, b]) => `10\n${x}\n20\n${y}\n${b ? `42\n${b}\n` : ''}`).join('')
const legacy = (h, verts, closed = true) => `0\nPOLYLINE\n5\n${h}\n8\n0\n66\n1\n70\n${closed ? 1 : 0}\n`
    + verts.map(([x, y, b]) => `0\nVERTEX\n8\n0\n10\n${x}\n20\n${y}\n${b ? `42\n${b}\n` : ''}70\n0\n`).join('') + '0\nSEQEND\n'
const ellipse = (h, cx, cy, mx, my, q, t0 = 0, t1 = 2 * Math.PI) => `0\nELLIPSE\n5\n${h}\n8\n0\n10\n${cx}\n20\n${cy}\n11\n${mx}\n21\n${my}\n40\n${q}\n41\n${t0}\n42\n${t1}\n`
const spline = (h, degree, knots, control, weights = []) => `0\nSPLINE\n5\n${h}\n8\n0\n70\n0\n71\n${degree}\n72\n${knots.length}\n73\n${control.length}\n`
    + knots.map((k) => `40\n${k}\n`).join('') + control.map(([x, y]) => `10\n${x}\n20\n${y}\n`).join('') + weights.map((w) => `41\n${w}\n`).join('')
const point = (h, x, y) => `0\nPOINT\n5\n${h}\n8\n0\n10\n${x}\n20\n${y}\n`
const dxf = (...ents) => `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${ents.join('')}0\nENDSEC\n0\nEOF\n`

// --- référence : aplatissement dense (autre code que la mesure), boîte des points posés.
// Les splines y reprennent les points de la mesure : leur vérité indépendante (ezdxf/scipy)
// est celle du banc de corpus, hors de ce fichier.
function flatten(e) {
    const out = []
    const arcPts = (cx, cy, r, a0, sweep) => {
        const n = Math.max(2000, Math.ceil(Math.abs(sweep) / (0.01 * D2R)))
        for (let i = 0; i <= n; i++) {
            const a = a0 + (sweep * i) / n
            out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
        }
    }
    if (e.type === 'LINE') out.push([e.pts[0], e.pts[1]], [e.pts[2], e.pts[3]])
    else if (e.type === 'POINT') out.push([e.c[0], e.c[1]])
    else if (e.type === 'CIRCLE') arcPts(e.c[0], e.c[1], e.r, 0, 2 * Math.PI)
    else if (e.type === 'ARC') {
        let sw = (e.a1 - e.a0) * D2R
        sw = ((sw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
        arcPts(e.c[0], e.c[1], e.r, e.a0 * D2R, sw)
    } else if (e.type === 'ELLIPSE') {
        // balayage réduit modulo 2π (comme l'importeur) : plein si les bornes sont égales ou distantes de 2π
        const raw = e.t1 - e.t0
        const full = Math.abs(raw) < 1e-9 || Math.abs(Math.abs(raw) - 2 * Math.PI) < 1e-9
        const sweep = full ? 2 * Math.PI : ((raw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
        const mx = e.m[0], my = e.m[1]
        for (let i = 0; i <= 20000; i++) {
            const t = e.t0 + (sweep * i) / 20000
            out.push([e.c[0] + mx * Math.cos(t) - e.q * my * Math.sin(t), e.c[1] + my * Math.cos(t) + e.q * mx * Math.sin(t)])
        }
    } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
        const v = e.verts
        const n = v.length
        const segs = e.closed ? n : n - 1
        for (let i = 0; i < n; i++) out.push([v[i][0], v[i][1]])
        for (let i = 0; i < segs; i++) {
            const b = v[i][2]
            if (!b) continue
            const p = v[i], q = v[(i + 1) % n]
            const th = 4 * Math.atan(b)
            const L = Math.hypot(q[0] - p[0], q[1] - p[1])
            const r = L / (2 * Math.abs(Math.sin(th / 2)))
            const off = (L / 2) / Math.tan(th / 2)
            const cx = (p[0] + q[0]) / 2 + (-(q[1] - p[1]) / L) * off
            const cy = (p[1] + q[1]) / 2 + ((q[0] - p[0]) / L) * off
            arcPts(cx, cy, r, Math.atan2(p[1] - cy, p[0] - cx), th)
        }
    } else if (e.type === 'SPLINE') out.push(...e.pts)
    return out
}
function truthBox(entities, angle, x, y) {
    const c = Math.cos(angle), s = Math.sin(angle)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const e of entities) {
        for (const p of flatten(e)) {
            const X = c * p[0] - s * p[1] + x
            const Y = s * p[0] + c * p[1] + y
            x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y)
        }
    }
    return [x0, y0, x1, y1]
}

const tr = (id, slug, handles, x, y, angle = 0) => ({ item_id: String(id), file_slug: slug, handles, angle, x, y })
const container = (transforms) => ({ bin_width: 400, bin_height: 300, transforms })
// L'enveloppe de l'anneau IMPORTÉ : arcs aplatis à 0,01 mm, polyligne à bosses en
// cordes (comme l'importeur). Par défaut celle des entités de la pièce ; un test la
// donne à la main quand la pièce n'est pas tout ce que portent ses poignées.
const rectHull = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const discHull = (cx, cy, r, n = 96) => {
    const p = Array.from({ length: n }, (_, k) => [cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)])
    return [...p, p[0]]
}
function tess(e) {
    const arcPts = (cx, cy, r, a0, sweep) => {
        const n = Math.max(4, Math.ceil(Math.abs(sweep) / (2 * Math.acos(Math.max(0, 1 - 0.01 / r)))))
        return Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(a0 + (sweep * i) / n), cy + r * Math.sin(a0 + (sweep * i) / n)])
    }
    if (e.type === 'CIRCLE') return arcPts(e.c[0], e.c[1], e.r, 0, 2 * Math.PI)
    if (e.type === 'ARC') {
        const sw = ((((e.a1 - e.a0) * D2R) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
        return arcPts(e.c[0], e.c[1], e.r, e.a0 * D2R, sw)
    }
    if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') return e.verts.map((v) => [v[0], v[1]])
    return flatten(e)
}
const hullOf = (text, handles) => convexHullRing(handles.flatMap((h) => readDxfEntities(text).get(h)).filter((e) => !e.bad).flatMap(tess))
const rowsOf = (text, handles, x, y, angle, extra = {}) => {
    const part = { id: 0, handles, ...extra, ringHull: extra.ringHull ?? hullOf(text, handles) }
    return sheetPositions(container([tr(0, 's', handles, x, y, angle)]), new Map([['0', part]]), entityIndexOf({ s: text }))
}
const idx = (text) => readDxfEntities(text)
const boxOfHandles = (text, handles, angle, x, y) => truthBox(handles.flatMap((h) => idx(text).get(h)), angle, x, y)

describe('lecture des entités et boîte exacte', () => {
    it('un LWPOLYLINE à bosse : le centre est celui de la forme livrée, pas de la corde (lug 60x30, bulge 1)', () => {
        const text = dxf(lwpoly('A', [[0, 0], [45, 0, 1], [45, 30], [0, 30]]))
        // 7,5 mm d'écart avec le polygone cordé (centre 22,5) : l'arc fait la boîte jusqu'à x = 60.
        for (const angle of [0, Math.PI / 2, 37 * D2R, 4.1]) {
            const [r] = rowsOf(text, ['A'], 100, 80, angle, { ringHull: rectHull(0, 0, 45, 30) })
            const t = boxOfHandles(text, ['A'], angle, 100, 80)
            expect(r.x).toBeCloseTo((t[0] + t[2]) / 2, 3)
            expect(r.y).toBeCloseTo((t[1] + t[3]) / 2, 3)
            expect(r.d).toBeNull()
            expect(r.rot).toBeCloseTo(((angle / D2R) % 360 + 360) % 360, 6)
        }
        const [r0] = rowsOf(text, ['A'], 0, 0, 0, { ringHull: rectHull(0, 0, 45, 30) })
        expect(r0.x).toBeCloseTo(30, 9)
        expect(r0.y).toBeCloseTo(15, 9)
    })

    it('même pièce en POLYLINE ancienne (VERTEX + 42), ou en LINE + ARC : même centre', () => {
        const a = rowsOf(dxf(legacy('A', [[0, 0], [45, 0, 1], [45, 30], [0, 30]])), ['A'], 10, 20, 0.7)[0]
        const b = rowsOf(dxf(line('A', 0, 0, 45, 0), arc('B', 45, 15, 15, -90, 90), line('C', 45, 30, 0, 30), line('D', 0, 30, 0, 0)), ['A', 'B', 'C', 'D'], 10, 20, 0.7)[0]
        expect(a.x).toBeCloseTo(b.x, 9)
        expect(a.y).toBeCloseTo(b.y, 9)
    })

    it('rond = UN cercle entier : CIRCLE, 4 arcs de polyligne, 2 demi-arcs ARC ; x, y, d exacts, rot null', () => {
        const cases = [
            dxf(circle('A', 8.5, 8.5, 8.5)),
            dxf(lwpoly('A', [[0, 8.5, Math.tan(Math.PI / 8)], [8.5, 0, Math.tan(Math.PI / 8)], [17, 8.5, Math.tan(Math.PI / 8)], [8.5, 17, Math.tan(Math.PI / 8)]])),
            dxf(arc('A', 8.5, 8.5, 8.5, 0, 180), arc('B', 8.5, 8.5, 8.5, 180, 360)),
        ]
        for (const [i, text] of cases.entries()) {
            const [r] = rowsOf(text, i === 2 ? ['A', 'B'] : ['A'], 100, 50, 0.9)
            const c = Math.cos(0.9), s = Math.sin(0.9)
            const ct = i === 1 ? [8.5, 8.5] : [8.5, 8.5]
            expect(r.d).toBeCloseTo(17, 9)
            expect(r.x).toBeCloseTo(c * ct[0] - s * ct[1] + 100, 9)
            expect(r.y).toBeCloseTo(s * ct[0] + c * ct[1] + 50, 9)
            expect(r.rot).toBeNull()
        }
    })

    it('cercles concentriques à moins de 0,2 mm : le diamètre est celui du contour extérieur', () => {
        const text = dxf(circle('A', 11.25, 11.25, 11.2), circle('B', 11.25, 11.25, 11.25))
        const [r] = rowsOf(text, ['A', 'B'], 0, 0, 0)
        expect(r.d).toBeCloseTo(22.5, 9)
        const [r2] = rowsOf(dxf(circle('B', 11.25, 11.25, 11.25), circle('A', 11.25, 11.25, 11.2)), ['B', 'A'], 0, 0, 0)
        expect(r2.d).toBeCloseTo(22.5, 9)
        // Rondelle : un trou concentrique, le diamètre reste celui de l'extérieur.
        const [w] = rowsOf(dxf(circle('A', 10, 10, 10), circle('B', 10, 10, 4)), ['A', 'B'], 0, 0, 0)
        expect(w.d).toBeCloseTo(20, 9)
    })

    it('petits disques (2 mm, 0,5 mm) : ronds, exacts', () => {
        for (const d of [2, 0.5]) {
            const [r] = rowsOf(dxf(circle('A', d / 2, d / 2, d / 2)), ['A'], 50, 60, 0)
            expect(r.d).toBeCloseTo(d, 12)
            expect(r.x).toBeCloseTo(50 + d / 2, 12)
        }
    })

    it('ne sont PAS ronds : disque à méplat, polygone régulier de 16 côtés, ellipse presque ronde', () => {
        // Wafer : arc de 322° et sa corde
        const flat = dxf(arc('A', 50, 50, 50, 109, 71 + 360 - 0), line('B', 50 + 50 * Math.cos(71 * D2R), 50 + 50 * Math.sin(71 * D2R), 50 + 50 * Math.cos(109 * D2R), 50 + 50 * Math.sin(109 * D2R)))
        const [f] = rowsOf(flat, ['A', 'B'], 0, 0, 0.3)
        expect(f.d).toBeNull()
        expect(f.rot).toBeCloseTo(0.3 / D2R, 6)
        const gon = dxf(lwpoly('A', Array.from({ length: 16 }, (_, k) => [10 + 10 * Math.cos((2 * Math.PI * k) / 16), 10 + 10 * Math.sin((2 * Math.PI * k) / 16)])))
        const [g] = rowsOf(gon, ['A'], 0, 0, 0)
        expect(g.d).toBeNull()
        const [e] = rowsOf(dxf(ellipse('A', 11.25, 11.25, 11.25, 0, 22.39 / 22.5)), ['A'], 0, 0, 0)
        expect(e.d).toBeNull()
        expect(e.x).toBeCloseTo(11.25, 9)
        expect(e.y).toBeCloseTo(11.25, 9)
    })

    it('ARC dont le balayage passe par 0° / 90° / 180° : les extrêmes de l\'arc sont dans la boîte, une pose tournée aussi', () => {
        const text = dxf(arc('A', 10, 10, 10, 300, 100)) // de -60° à 100° : passe par 0° et 90°
        for (const angle of [0, 0.4, 2.2, -1]) {
            const [r] = rowsOf(text, ['A'], 30, 40, angle)
            const t = boxOfHandles(text, ['A'], angle, 30, 40)
            expect(r.x).toBeCloseTo((t[0] + t[2]) / 2, 3)
            expect(r.y).toBeCloseTo((t[1] + t[3]) / 2, 3)
        }
    })

    it('ELLIPSE (entière et arc, grand axe incliné) : extrêmes analytiques', () => {
        const cases = [
            dxf(ellipse('A', 30, 20, 20, 10, 0.5)),
            dxf(ellipse('A', 30, 20, 12, -9, 0.4, 0.3, 4.0)),
            dxf(ellipse('A', 0, 0, 0, 15, 0.7, 5, 1)), // t1 < t0 : repasse par 0
        ]
        for (const text of cases) {
            for (const angle of [0, 0.5, 2.5]) {
                const [r] = rowsOf(text, ['A'], 10, 10, angle)
                const t = boxOfHandles(text, ['A'], angle, 10, 10)
                expect(r.x).toBeCloseTo((t[0] + t[2]) / 2, 3)
                expect(r.y).toBeCloseTo((t[1] + t[3]) / 2, 3)
            }
        }
    })

    it('SPLINE : la courbe de l\'écrivain (nœuds, contrôle, poids), évaluée ; spline incohérente : entité illisible', () => {
        const ctrl = [[0, 0], [10, 40], [30, -20], [50, 10]]
        const knots = [0, 0, 0, 0, 1, 1, 1, 1]
        const text = dxf(spline('A', 3, knots, ctrl))
        const [r] = rowsOf(text, ['A'], 0, 0, 0)
        // La courbe de Bézier cubique tient dans l'enveloppe de ses points de contrôle ; boîte vérifiée à 1e-3 par aplatissement dense.
        const t = boxOfHandles(text, ['A'], 0, 0, 0)
        expect(r.x).toBeCloseTo((t[0] + t[2]) / 2, 3)
        expect(r.y).toBeCloseTo((t[1] + t[3]) / 2, 3)
        // Rationnelle : un quart de cercle exact (poids √2/2) : boîte x 0..10, y 0..10 (arc de cercle de rayon 10).
        const w = Math.SQRT1_2
        const quarter = dxf(spline('A', 2, [0, 0, 0, 1, 1, 1], [[10, 0], [10, 10], [0, 10]], [1, w, 1]))
        const [q] = rowsOf(quarter, ['A'], 0, 0, 0)
        expect(q.x).toBeCloseTo(5, 4)
        expect(q.y).toBeCloseTo(5, 4)
        expect(readDxfEntities(dxf(spline('A', 3, [0, 0, 1, 1], ctrl))).get('A')[0].bad).toBe(true)
        expect(readDxfEntities(dxf(spline('A', 3, knots, ctrl, [1, 1]))).get('A')[0].bad).toBe(true)
    })

    it('POINT et plusieurs entités sous une même poignée', () => {
        const text = dxf(point('A', 5, 5), line('A', 0, 0, 10, 0))
        const [r] = rowsOf(text, ['A'], 0, 0, 0)
        expect(r.x).toBeCloseTo(5, 9)
        expect(r.y).toBeCloseTo(2.5, 9)
    })
})

describe('refus : jamais un nombre deviné', () => {
    const ok = dxf(line('A', 0, 0, 10, 10))
    it('une entité illisible (type inconnu, nombre, dégénérée, spline) est marquée, la source reste lisible', () => {
        const idx2 = readDxfEntities(dxf('0\nTEXT\n5\nT\n10\n1\n20\n1\n1\nabc\n' + circle('G', 5, 5, 5)
            + '0\nINSERT\n5\nI\n2\nB\n10\n1\n20\n1\n' + '0\nCIRCLE\n5\nN\n10\nabc\n20\n1\n40\n3\n'
            + '0\nCIRCLE\n5\nZ\n10\n1\n20\n1\n40\n0\n' + spline('S', 3, [0, 0, 1, 1], [[0, 0], [1, 1], [2, 0], [3, 1]])))
        expect(idx2).not.toBeNull()
        for (const h of ['T', 'I', 'N', 'Z', 'S']) expect(idx2.get(h)[0].bad, h).toBe(true)
        expect(idx2.get('G')[0].bad).toBeUndefined()
        expect(readDxfEntities(dxf('0\nPOLYLINE\n5\nA\n70\n1\n0\nVERTEX\n10\n1\n20\n1\n')).get('A')[0].bad).toBe(true)
        expect(readDxfEntities(dxf(spline('A', 3, [0, 0, 0, 0, 1, 1, 1, 1], [[0, 0], [10, 40], [30, -20], [50, 10]], [1, 1]))).get('A')[0].bad).toBe(true)
        expect(readDxfEntities(ok)).not.toBeNull()
        expect(readDxfEntities(new TextEncoder().encode(ok))).not.toBeNull()
    })

    it('une entité illisible ne refuse que les pièces qui portent sa poignée (pas toute la source)', () => {
        const text = dxf(circle('G', 5, 5, 5), '0\nCIRCLE\n5\nZ\n10\n1\n20\n1\n40\n0\n')
        const parts = new Map([['0', { id: 0, handles: ['G'], ringHull: discHull(5, 5, 5) }], ['1', { id: 1, handles: ['Z'], ringHull: rectHull(0, 0, 2, 2) }]])
        const index = entityIndexOf({ s: text })
        expect(sheetPositions(container([tr(0, 's', ['G'], 0, 0)]), parts, index)).toHaveLength(1)
        expect(sheetPositions(container([tr(1, 's', ['Z'], 0, 0)]), parts, index)).toBeNull()
    })

    it('source absente, poignée inconnue, pièce sans poignée, pose non finie : null pour toute la tôle', () => {
        const parts = new Map([['0', { id: 0, handles: ['A'], ringHull: rectHull(0, 0, 10, 10) }], ['1', { id: 1, handles: ['Z'], ringHull: rectHull(0, 0, 10, 10) }], ['2', { id: 2, handles: [], ringHull: rectHull(0, 0, 10, 10) }], ['3', { id: 3, handles: ['A'] }]])
        const index = entityIndexOf({ s: ok })
        expect(sheetPositions(container([tr(0, 's', ['A'], 0, 0)]), parts, index)).toHaveLength(1)
        expect(sheetPositions(container([tr(0, 'absent', ['A'], 0, 0)]), parts, index)).toBeNull()
        expect(sheetPositions(container([tr(1, 's', ['Z'], 0, 0)]), parts, index)).toBeNull()
        expect(sheetPositions(container([tr(2, 's', [], 0, 0)]), parts, index)).toBeNull()
        expect(sheetPositions(container([tr(0, 's', ['A'], NaN, 0)]), parts, index)).toBeNull()
        expect(sheetPositions(container([tr(0, 's', ['A'], 0, 0, Infinity)]), parts, index)).toBeNull()
        expect(sheetPositions(container([tr(0, 's', ['A'], 0, 0), tr(1, 's', ['Z'], 0, 0)]), parts, index)).toBeNull()
        expect(sheetPositions(container([tr(9, 's', ['A'], 0, 0)]), parts, index)).toBeNull()
        // pas d'enveloppe d'anneau : jamais un nombre deviné
        expect(sheetPositions(container([tr(3, 's', ['A'], 0, 0)]), parts, index)).toBeNull()
        expect(sheetPositions(null, parts, index)).toBeNull()
        expect(sheetPositions({ bin_width: 1, bin_height: 1, transforms: 'x' }, parts, index)).toBeNull()
        expect(sheetPositions({ bin_width: NaN, bin_height: 1, transforms: [] }, parts, index)).toBeNull()
    })
})

describe('blocs : une ligne par pièce, avec SES poignées', () => {
    const text = dxf(rectLines('A', 0, 0, 20, 20), circle('C', 80, 10, 10))
    function rectLines(h, x0, y0, x1, y1) {
        return lwpoly(h, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
    }
    it('chaque blockPart porte ses poignées : deux lignes sous la pose du bloc', () => {
        const part = { id: 0, handles: ['A', 'C'], blockParts: [{ handles: ['A'], ringHull: rectHull(0, 0, 20, 20) }, { handles: ['C'], ringHull: discHull(80, 10, 10) }] }
        const rows = sheetPositions(container([tr(0, 's', ['A', 'C'], 5, 5)]), new Map([['0', part]]), entityIndexOf({ s: text }))
        expect(rows).toHaveLength(2)
        expect(rows[0]).toMatchObject({ fileSlug: 's', d: null })
        expect(rows[0].x).toBeCloseTo(15, 9)
        expect(rows[1].d).toBeCloseTo(20, 9)
        expect(rows[1].x).toBeCloseTo(85, 9)
        expect(rows[1].y).toBeCloseTo(15, 9)
    })
    it('un bloc sans poignées par pièce : null (jamais un point au milieu du dessin)', () => {
        const part = { id: 0, handles: ['A', 'C'], blockParts: [{ coords: [] }, { coords: [] }] }
        expect(sheetPositions(container([tr(0, 's', ['A', 'C'], 5, 5)]), new Map([['0', part]]), entityIndexOf({ s: text }))).toBeNull()
    })
})

// ---------------------------------------------------------------------------
// Contour de la pièce : ce que l'importeur rattache à son encre (axes, cotes,
// repères, arête d'une voisine) ne fait pas la boîte de la pièce.
// ---------------------------------------------------------------------------
describe('contour de la pièce : son anneau importé (ringHull), pas tout ce que portent ses poignées', () => {
    const POSES = [[0, 0], [37 * D2R, 0], [Math.PI / 2, 0]]
    const at = (cx, cy, angle, x, y) => [Math.cos(angle) * cx - Math.sin(angle) * cy + x, Math.sin(angle) * cx + Math.cos(angle) * cy + y]
    const DISC = circle('A', 8.5, 8.5, 8.5)
    const check = (text, handles, ringHull, expectation) => {
        for (const [angle] of POSES) {
            const [r] = rowsOf(text, handles, 100, 60, angle, { ringHull })
            expectation(r, angle)
        }
    }
    const roundAt = (cx, cy, d) => (r, angle) => {
        expect(r).toBeTruthy()
        const c = at(cx, cy, angle, 100, 60)
        expect(r.d).toBeCloseTo(d, 9)
        expect(r.x).toBeCloseTo(c[0], 9)
        expect(r.y).toBeCloseTo(c[1], 9)
        expect(r.rot).toBeNull()
    }
    const D17 = discHull(8.5, 8.5, 8.5)

    it('disque + axe qui le dépasse : rond, centre et diamètre exacts', () => {
        check(dxf(DISC, line('L', -4, 8.5, 21, 8.5)), ['A', 'L'], D17, roundAt(8.5, 8.5, 17))
    })
    it('disque + cote de rayon (ligne de cote et flèche) : rond', () => {
        check(dxf(DISC, line('L', 8.5, 8.5, 28, 8.5), line('M', 17, 8.5, 19, 9.5)), ['A', 'L', 'M'], D17, roundAt(8.5, 8.5, 17))
    })
    it('disque + repère, sortant ou rentrant : rond', () => {
        check(dxf(DISC, line('L', 17, 8.5, 19.5, 8.5), line('M', 14, 8.5, 17, 8.5)), ['A', 'L', 'M'], D17, roundAt(8.5, 8.5, 17))
    })
    it('arc ouvert qui entoure le disque sans le toucher : écarté', () => {
        check(dxf(DISC, arc('R', 8.5, 8.5, 12, 0, 90)), ['A', 'R'], D17, roundAt(8.5, 8.5, 17))
    })
    it('deux disques reliés par UNE ligne : chacun garde son centre et son diamètre', () => {
        const text = dxf(circle('A', 8.5, 8.5, 8.5), circle('B', 48.5, 8.5, 8.5), line('L', 8.5, 8.5, 48.5, 8.5))
        for (const [angle] of POSES) {
            const parts = new Map([['0', { id: 0, handles: ['A', 'L'], ringHull: D17 }], ['1', { id: 1, handles: ['B', 'L'], ringHull: discHull(48.5, 8.5, 8.5) }]])
            const rows = sheetPositions(container([tr(0, 's', ['A', 'L'], 100, 60, angle), tr(1, 's', ['B', 'L'], 100, 60, angle)]), parts, entityIndexOf({ s: text }))
            roundAt(8.5, 8.5, 17)(rows[0], angle)
            roundAt(48.5, 8.5, 17)(rows[1], angle)
        }
    })
    it('rectangle + axe : le centre du rectangle, pas du rectangle plus l\'axe', () => {
        const text = dxf(lwpoly('A', [[0, 0], [40, 0], [40, 20], [0, 20]]), line('L', 20, -5, 20, 25))
        check(text, ['A', 'L'], rectHull(0, 0, 40, 20), (r, angle) => {
            const c = at(20, 10, angle, 100, 60)
            expect(r.d).toBeNull()
            expect(r.x).toBeCloseTo(c[0], 9)
            expect(r.y).toBeCloseTo(c[1], 9)
        })
    })
    it('deux rectangles qui partagent une arête dessinée : chacun son centre', () => {
        const text = dxf(lwpoly('A', [[0, 0], [20, 0], [20, 20], [0, 20]]),
            line('B1', 20, 0, 40, 0), line('B2', 40, 0, 40, 20), line('B3', 40, 20, 20, 20), line('S', 20, -5, 20, 25))
        for (const [angle] of POSES) {
            const parts = new Map([['0', { id: 0, handles: ['A', 'S'], ringHull: rectHull(0, 0, 20, 20) }], ['1', { id: 1, handles: ['B1', 'B2', 'B3', 'S'], ringHull: rectHull(20, 0, 40, 20) }]])
            const rows = sheetPositions(container([tr(0, 's', ['A', 'S'], 100, 60, angle), tr(1, 's', ['B1', 'B2', 'B3', 'S'], 100, 60, angle)]), parts, entityIndexOf({ s: text }))
            const a = at(10, 10, angle, 100, 60)
            const b = at(30, 10, angle, 100, 60)
            expect(rows[0].x).toBeCloseTo(a[0], 9)
            expect(rows[0].y).toBeCloseTo(a[1], 9)
            expect(rows[1].x).toBeCloseTo(b[0], 9)
            expect(rows[1].y).toBeCloseTo(b[1], 9)
        }
    })
    it('en bloc (blockParts) : une ligne par pièce, axes écartés', () => {
        const text = dxf(DISC, line('L', -4, 8.5, 21, 8.5), circle('B', 48.5, 8.5, 8.5), line('M', 48.5, -4, 48.5, 21))
        const block = { id: 0, handles: ['A', 'L', 'B', 'M'], blockParts: [{ handles: ['A', 'L'], ringHull: D17 }, { handles: ['B', 'M'], ringHull: discHull(48.5, 8.5, 8.5) }] }
        const rows = sheetPositions(container([tr(0, 's', ['A', 'L', 'B', 'M'], 100, 60, 37 * D2R)]), new Map([['0', block]]), entityIndexOf({ s: text }))
        expect(rows).toHaveLength(2)
        roundAt(8.5, 8.5, 17)(rows[0], 37 * D2R)
        roundAt(48.5, 8.5, 17)(rows[1], 37 * D2R)
    })
    it('pas d\'enveloppe, polyligne illisible, contour et amorce dans la même polyligne à arcs, arc en retrait qui dépasse : null', () => {
        const text = dxf(circle('A', 5, 5, 5), line('L', 0, 0, 40, 0))
        expect(sheetPositions(container([tr(0, 's', ['A'], 0, 0)]), new Map([['0', { id: 0, handles: ['A'] }]]), entityIndexOf({ s: text }))).toBeNull()
        const bad = dxf(lwpoly('A', [[0, 0], [45, 0], [45, 30], [0, 30]]), '0\nLWPOLYLINE\n5\nP\n90\n2\n70\n0\n10\nabc\n20\n0\n')
        expect(rowsOf(bad, ['A', 'P'], 0, 0, 0, { ringHull: rectHull(0, 0, 45, 30) })).toBeNull()
        const lead = dxf(lwpoly('A', [[-12, -5], [0, 0], [45, 0, 1], [45, 30], [0, 30], [0, 0]], false))
        expect(rowsOf(lead, ['A'], 0, 0, 0, { ringHull: rectHull(0, 0, 45, 30) })).toBeNull()
        // Épaulement : la corde de l'arc est en retrait de 5 mm, l'arc dépasse l'enveloppe ;
        // la polyligne n'est pas tout le contour (une LINE le ferme) : ambigu.
        const step = dxf(lwpoly('A', [[0, 0], [45, 0], [45, 5], [40, 5, 1], [40, 25], [45, 25], [45, 30], [0, 30]], false), line('B', 0, 30, 0, 0))
        expect(rowsOf(step, ['A', 'B'], 0, 0, 0, { ringHull: rectHull(0, 0, 45, 30) })).toBeNull()
        // Fermée, elle EST le contour : l'arc compte (x jusqu'à 50).
        const whole = dxf(lwpoly('A', [[0, 0], [45, 0], [45, 5], [40, 5, 1], [40, 25], [45, 25], [45, 30], [0, 30]]))
        expect(rowsOf(whole, ['A'], 0, 0, 0)[0].x).toBeCloseTo(25, 9)
    })
    it('cotes et repères à arcs (polylignes à bosses), flèche de rotation : rien ne bouge, à tout angle', () => {
        const D = roundAt(8.5, 8.5, 17)
        check(dxf(DISC, lwpoly('L', [[14, 14, 0.4], [26, 22], [34, 22]], false)), ['A', 'L'], D17, D)
        check(dxf(DISC, lwpoly('L', [[19.5, 8.5, 0.6], [8.5, 19.5]], false)), ['A', 'L'], D17, D)
        check(dxf(DISC, legacy('L', [[14, 14, 0.4], [26, 22]], false)), ['A', 'L'], D17, D)
        const two = dxf(circle('A', 8.5, 8.5, 8.5), circle('B', 48.5, 8.5, 8.5), lwpoly('L', [[8.5, 8.5, 0.5], [48.5, 8.5]], false))
        check(two, ['A', 'L'], D17, D)
        const rc = (cx, cy) => (r, angle) => {
            const c = at(cx, cy, angle, 100, 60)
            expect(r.d).toBeNull()
            expect(r.x).toBeCloseTo(c[0], 9)
            expect(r.y).toBeCloseTo(c[1], 9)
        }
        check(dxf(lwpoly('A', [[0, 0], [40, 0], [40, 20], [0, 20]]), lwpoly('L', [[40, 10, 0.7], [70, 35]], false)), ['A', 'L'], rectHull(0, 0, 40, 20), rc(20, 10))
        // deux rectangles reliés par une polyligne à arc, en un seul morceau
        check(dxf(lwpoly('A', [[0, 0], [40, 0], [40, 20], [0, 20]]), lwpoly('L', [[40, 10, 0.7], [90, 10]], false)), ['A', 'L'], rectHull(0, 0, 40, 20), rc(20, 10))
    })
    it('marques DANS la boîte mais hors de la pièce, à 30 et 45° : le centre est celui de la pièce', () => {
        const tri = [[0, 0], [60, 0], [0, 40], [0, 0]]
        const truth = (pts, angle) => {
            const q = pts.map(([x, y]) => at(x, y, angle, 100, 60))
            const xs = q.map((p) => p[0]), ys = q.map((p) => p[1])
            return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
        }
        const text = dxf(lwpoly('A', [[0, 0], [60, 0], [0, 40]]), line('L', 0, 0, 60, 40), line('M', 30, 20, 60, 40), circle('H', 15, 10, 4), line('N', 5, 10, 48, 10))
        for (const angle of [0, 30 * D2R, 45 * D2R, 1.9]) {
            const [r] = rowsOf(text, ['A', 'L', 'M', 'H', 'N'], 100, 60, angle, { ringHull: tri })
            const c = truth(tri, angle)
            expect(r.x).toBeCloseTo(c[0], 9)
            expect(r.y).toBeCloseTo(c[1], 9)
            expect(r.d).toBeNull()
        }
        // disque + cote vers le coin de sa boîte, + croix d'un trou excentré qui dépasse
        const disc = dxf(DISC, line('L', 8.5, 8.5, 17, 17), line('M', 13, 4, 16.5, 0.5))
        for (const angle of [0, 30 * D2R, 45 * D2R]) roundAt(8.5, 8.5, 17)(rowsOf(disc, ['A', 'L', 'M'], 100, 60, angle, { ringHull: D17 })[0], angle)
    })
    it('une arête du contour absente des poignées (partagée avec une voisine) : l\'anneau la connaît', () => {
        const text = dxf(line('B1', 20, 0, 40, 0), line('B2', 40, 0, 40, 20), line('B3', 40, 20, 20, 20))
        const [r] = rowsOf(text, ['B1', 'B2'], 0, 0, 0.6, { ringHull: rectHull(20, 0, 40, 20) })
        const c = at(30, 10, 0.6, 0, 0)
        expect(r.x).toBeCloseTo(c[0], 9)
        expect(r.y).toBeCloseTo(c[1], 9)
    })
    it('anneau fendu, petit méplat, encoche, dents : PAS un disque (l\'enveloppe seule ne les voit pas)', () => {
        // Fente de 6 mm : 2 ARC + 2 LINE ; l'enveloppe fait le tour à moins de 10° près.
        const r0 = 45
        const half = Math.asin(3 / r0) / D2R
        const ringDxf = dxf(arc('A', 0, 0, r0, half, 360 - half), arc('B', 0, 0, 30, half, 360 - half),
            line('C', 30 * Math.cos(half * D2R), 30 * Math.sin(half * D2R), r0 * Math.cos(half * D2R), r0 * Math.sin(half * D2R)),
            line('D', 30 * Math.cos(half * D2R), -30 * Math.sin(half * D2R), r0 * Math.cos(half * D2R), -r0 * Math.sin(half * D2R)))
        const [r] = rowsOf(ringDxf, ['A', 'B', 'C', 'D'], 0, 0, 0.4)
        expect(r.d).toBeNull()
        expect(r.rot).toBeCloseTo(0.4 / D2R, 6)
        // Méplat de 5 mm sur un disque de 153 mm (ARC + LINE).
        const f = Math.asin(2.5 / 76.5) / D2R
        const p = (a) => [76.5 * Math.cos(a * D2R), 76.5 * Math.sin(a * D2R)]
        const flat = dxf(arc('A', 0, 0, 76.5, 90 + f, 90 - f), line('L', ...p(90 - f), ...p(90 + f)))
        const [m] = rowsOf(flat, ['A', 'L'], 0, 0, 0)
        expect(m.d).toBeNull()
        expect(m.y).toBeCloseTo((76.5 * Math.cos(f * D2R) - 76.5) / 2, 3)
        // Un disque dessiné par des splines ou une polyligne fine, lui, garde son diamètre.
        const poly = Array.from({ length: 72 }, (_, k) => [10 + 10 * Math.cos((2 * Math.PI * k) / 72), 10 + 10 * Math.sin((2 * Math.PI * k) / 72)])
        expect(rowsOf(dxf(lwpoly('A', poly)), ['A'], 0, 0, 0)[0].d).toBeCloseTo(20, 1)
    })
    it('arc ouvert au bord : contour mal ajusté ou repère tracé d\'un bord à l\'autre : null ; cercle dessiné : exact', () => {
        const H = rectHull(0, 0, 45, 30)
        const lines = [line('A', 0, 0, 45, 0), line('B', 45, 30, 0, 30), line('C', 0, 30, 0, 0)]
        // Bouts qui dépassent de 0,2 mm : c'est le contour, mal ajusté.
        expect(rowsOf(dxf(...lines, lwpoly('D', [[45, -0.2, 1], [45, 30.2]], false)), ['A', 'B', 'C', 'D'], 0, 0, 0, { ringHull: H })).toBeNull()
        // Bien ajusté : l'arc compte.
        expect(rowsOf(dxf(...lines, lwpoly('D', [[45, 0, 1], [45, 30]], false)), ['A', 'B', 'C', 'D'], 0, 0, 0, { ringHull: H })[0].x).toBeCloseTo(30, 9)
        // Un côté droit est dessiné là : l'arc est un repère.
        expect(rowsOf(dxf(...lines, line('E', 45, 0, 45, 30), lwpoly('D', [[45, 8, 0.6], [45, 22]], false)), ['A', 'B', 'C', 'E', 'D'], 0, 0, 0, { ringHull: H })).toBeNull()
        // Arc de rayon d'angle, d'un bord à l'autre.
        expect(rowsOf(dxf(lwpoly('A', [[0, 0], [45, 0], [45, 30], [0, 30]]), lwpoly('D', [[35, 30, -0.9], [45, 20]], false)), ['A', 'D'], 0, 0, 0, { ringHull: H })).toBeNull()
        // Disque dessiné par un CIRCLE, avec un arc de cote d'un bord à l'autre : exact.
        const [r] = rowsOf(dxf(DISC, lwpoly('D', [[8.5, 17, -0.8], [17, 8.5]], false)), ['A', 'D'], 0, 0, 0, { ringHull: D17 })
        expect(r.d).toBeCloseTo(17, 9)
    })
    it('méplat avec le cercle entier tracé en construction : PAS un disque', () => {
        const flat = discHull(50, 50, 50, 360).slice(0, -1).filter((p) => p[1] > 5)
        const [r] = rowsOf(dxf(circle('C', 50, 50, 50), line('L', 20, 5, 80, 5)), ['C', 'L'], 0, 0, 0, { ringHull: [...flat, flat[0]] })
        expect(r.d).toBeNull()
        expect(r.y).toBeCloseTo((Math.min(...flat.map((p) => p[1])) + 100) / 2, 2)
    })
    it('carré avec cercle inscrit tangent : PAS un disque (une entité sort du cercle)', () => {
        const text = dxf(lwpoly('A', [[0, 0], [50, 0], [50, 50], [0, 50]]), circle('C', 25, 25, 25))
        const [r] = rowsOf(text, ['A', 'C'], 0, 0, 0.5, { ringHull: rectHull(0, 0, 50, 50) })
        expect(r.d).toBeNull()
        expect(r.rot).toBeCloseTo(0.5 / D2R, 6)
    })
    it('ELLIPSE de rapport 1, polygone très fin, courbes de Bézier : ronds avec diamètre ajusté', () => {
        const [e] = rowsOf(dxf(ellipse('A', 10, 10, 10, 0, 1)), ['A'], 0, 0, 0)
        expect(e.d).toBeCloseTo(20, 9)
        const poly = Array.from({ length: 72 }, (_, k) => [10 + 10 * Math.cos((2 * Math.PI * k) / 72), 10 + 10 * Math.sin((2 * Math.PI * k) / 72)])
        const [p] = rowsOf(dxf(lwpoly('A', poly)), ['A'], 5, 5, 0)
        expect(p.d).toBeCloseTo(20, 1)
        expect(p.x).toBeCloseTo(15, 6)
        expect(p.rot).toBeNull()
        const gon16 = Array.from({ length: 16 }, (_, k) => [10 + 10 * Math.cos((2 * Math.PI * k) / 16), 10 + 10 * Math.sin((2 * Math.PI * k) / 16)])
        expect(rowsOf(dxf(lwpoly('A', gon16)), ['A'], 0, 0, 0)[0].d).toBeNull()
    })
    it('arcs de même cercle : balayages qui se recouvrent fusionnés (200° + 200° décalés = 360°, 200° + 200° identiques = 200°)', () => {
        const [full] = rowsOf(dxf(arc('A', 10, 10, 10, 0, 200), arc('B', 10, 10, 10, 180, 360)), ['A', 'B'], 0, 0, 0)
        expect(full.d).toBeCloseTo(20, 9)
        const [dup] = rowsOf(dxf(arc('A', 10, 10, 10, 0, 200), arc('B', 10, 10, 10, 0, 200), line('C', 0, 10, 20, 10)), ['A', 'B', 'C'], 0, 0, 0)
        expect(dup.d).toBeNull()
    })
    it('ELLIPSE dont les paramètres dépassent 2π : balayage réduit modulo 2π comme l\'importeur', () => {
        for (const [t0, t1] of [[-1.454, 6.283185307179586], [8, 1], [0.5, 9.0]]) {
            const text = dxf(ellipse('A', 30, 20, 20, 10, 0.5, t0, t1))
            for (const angle of [0, 0.5]) {
                const [r] = rowsOf(text, ['A'], 10, 10, angle)
                const t = boxOfHandles(text, ['A'], angle, 10, 10)
                expect(r.x).toBeCloseTo((t[0] + t[2]) / 2, 3)
                expect(r.y).toBeCloseTo((t[1] + t[3]) / 2, 3)
            }
        }
    })
    it('une mesure par (source, poignées) : trois poses du même dessin ne mesurent qu\'une fois', () => {
        const text = dxf(DISC, line('L', -4, 8.5, 21, 8.5))
        const index = entityIndexOf({ s: text })
        const part = { id: 0, handles: ['A', 'L'], ringHull: D17 }
        const rows = sheetPositions(container([tr(0, 's', ['A', 'L'], 0, 0, 0.3), tr(0, 's', ['A', 'L'], 50, 0, 1.1), tr(0, 's', ['A', 'L'], 90, 0, 0.3)]), new Map([['0', part]]), index)
        expect(rows).toHaveLength(3)
        expect(index.cache.size).toBe(1)
    })
})
