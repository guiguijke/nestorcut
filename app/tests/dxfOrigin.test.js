import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { DXF_ORIGIN_UNSUPPORTED, dxfUnitScale, pyFloatStr, shiftDxf } from '../utils/dxfOrigin'

// Lot positions : recentrage d'un DXF écrit par NOTRE écrivain. Le test qui
// compte : le vrai bundle wasm exporte la même tôle une fois « au coin » puis
// une fois avec poses et forme décalées PAR L'ÉCRIVAIN lui-même ; shiftDxf du
// premier doit redonner le second.

const ROOT = path.resolve(__dirname, '../..')
const BUNDLE_JS = path.join(ROOT, 'public/geometry/nest_geometry.js')
const BUNDLE_WASM = path.join(ROOT, 'public/geometry/nest_geometry_bg.wasm')
const CORPUS = path.join(ROOT, 'workers/geometry/parity/corpus_extra')
const glue = { mod: null }

beforeAll(async () => {
    expect(existsSync(BUNDLE_JS) && existsSync(BUNDLE_WASM), 'bundle wasm absent').toBe(true)
    glue.mod = await import(pathToFileURL(BUNDLE_JS).href)
    glue.mod.initSync({ module: new WebAssembly.Module(readFileSync(BUNDLE_WASM)) })
})

const pairsOf = (text) => {
    const l = text.split('\n')
    const p = []
    for (let i = 0; i + 1 < l.length; i += 2) p.push([l[i], l[i + 1]])
    return p
}

describe('pyFloatStr : le repr de l\'écrivain (pyfloat.rs)', () => {
    it('mêmes valeurs que les références Python de l\'écrivain', () => {
        const golden = [
            [0, '0.0'], [1, '1.0'], [-1, '-1.0'], [300, '300.0'], [0.002, '0.002'], [0.6, '0.6'],
            [11.811023622047244, '11.811023622047244'], [0.30000000000000004, '0.30000000000000004'],
            [1e-5, '1e-05'], [1e-4, '0.0001'], [1e16, '1e+16'], [123456.789, '123456.789'],
            [2.5, '2.5'], [0.35, '0.35'], [59.05511811023622, '59.05511811023622'],
            [3.141592653589793, '3.141592653589793'], [0.0006, '0.0006'], [1e-7, '1e-07'],
            [2e-5, '2e-05'], [0.0024, '0.0024'], [1e15, '1000000000000000.0'],
            [123456789012345680, '1.2345678901234568e+17'], [-76.5, '-76.5'], [1e-300, '1e-300'],
            [5e-324, '5e-324'], [1.7976931348623157e308, '1.7976931348623157e+308'],
        ]
        for (const [v, s] of golden) expect(pyFloatStr(v), String(v)).toBe(s)
    })

    it('jamais -0.0 ; non fini : refus', () => {
        expect(pyFloatStr(-0)).toBe('0.0')
        expect(() => pyFloatStr(NaN)).toThrow(DXF_ORIGIN_UNSUPPORTED)
        expect(() => pyFloatStr(Infinity)).toThrow(DXF_ORIGIN_UNSUPPORTED)
    })

    it('relit toujours la même valeur', () => {
        for (let i = 0; i < 2000; i++) {
            const v = (Math.random() - 0.5) * 10 ** Math.floor(Math.random() * 14 - 6)
            expect(Number(pyFloatStr(v))).toBe(v)
        }
    })
})

const HEAD = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n9\n$INSUNITS\n70\n4\n9\n$MEASUREMENT\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\n0\n70\n0\n62\n7\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n'
const TAIL = '0\nENDSEC\n0\nEOF\n'
const doc = (body) => HEAD + body + TAIL

describe('shiftDxf : ce qui bouge, ce qui reste', () => {
    it('LINE : 10/20 et 11/21 ; zéro écrit 0.0, jamais -0.0 ; le reste est identique', () => {
        const src = doc('0\nLINE\n5\n1\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n5.0\n20\n5.0\n11\n15.0\n21\n7.5\n')
        const out = shiftDxf(src, 5, 7.5)
        expect(out).toBe(doc('0\nLINE\n5\n1\n100\nAcDbEntity\n8\n0\n100\nAcDbLine\n10\n0.0\n20\n-2.5\n11\n10.0\n21\n0.0\n'))
        expect(out).not.toContain('-0.0')
    })

    it('ELLIPSE : le vecteur de l\'axe majeur (11/21) ne bouge PAS ; le centre bouge', () => {
        const src = doc('0\nELLIPSE\n5\n1\n8\n0\n100\nAcDbEllipse\n10\n70.0\n20\n5.0\n11\n8.0\n21\n2.0\n40\n0.5\n41\n0.0\n42\n6.283185307179586\n')
        expect(shiftDxf(src, 10, 1)).toBe(doc('0\nELLIPSE\n5\n1\n8\n0\n100\nAcDbEllipse\n10\n60.0\n20\n4.0\n11\n8.0\n21\n2.0\n40\n0.5\n41\n0.0\n42\n6.283185307179586\n'))
    })

    it('ARC/CIRCLE : centre seulement (rayon et angles intacts) ; POLYLINE : seuls les VERTEX', () => {
        const src = doc('0\nARC\n5\n1\n8\n0\n100\nAcDbCircle\n10\n20.0\n20\n20.0\n40\n4.0\n50\n10.0\n51\n100.0\n'
            + '0\nCIRCLE\n5\n2\n8\n0\n100\nAcDbCircle\n10\n5.0\n20\n6.0\n40\n3.0\n'
            + '0\nPOLYLINE\n5\n3\n8\n0\n70\n1\n66\n1\n0\nVERTEX\n10\n1.0\n20\n2.0\n42\n0.5\n70\n0\n0\nVERTEX\n10\n3.0\n20\n4.0\n70\n0\n0\nSEQEND\n')
        expect(shiftDxf(src, 1, 2)).toBe(doc('0\nARC\n5\n1\n8\n0\n100\nAcDbCircle\n10\n19.0\n20\n18.0\n40\n4.0\n50\n10.0\n51\n100.0\n'
            + '0\nCIRCLE\n5\n2\n8\n0\n100\nAcDbCircle\n10\n4.0\n20\n4.0\n40\n3.0\n'
            + '0\nPOLYLINE\n5\n3\n8\n0\n70\n1\n66\n1\n0\nVERTEX\n10\n0.0\n20\n0.0\n42\n0.5\n70\n0\n0\nVERTEX\n10\n2.0\n20\n2.0\n70\n0\n0\nSEQEND\n'))
    })

    it('SPLINE : points de contrôle 10/20 seulement (noeuds 40 et poids 41 intacts) ; POINT ; LWPOLYLINE avec bulge', () => {
        const src = doc('0\nSPLINE\n5\n1\n8\n0\n100\nAcDbSpline\n70\n0\n71\n3\n72\n8\n73\n4\n40\n0.0\n40\n1.0\n10\n10.0\n20\n10.0\n10\n12.0\n20\n14.0\n41\n1.0\n'
            + '0\nPOINT\n5\n2\n8\n0\n100\nAcDbPoint\n10\n3.0\n20\n4.0\n'
            + '0\nLWPOLYLINE\n5\n3\n8\n0\n100\nAcDbPolyline\n90\n2\n70\n1\n10\n0.0\n20\n0.0\n42\n0.4142135623730951\n10\n9.0\n20\n9.0\n')
        expect(shiftDxf(src, 2, 3)).toBe(doc('0\nSPLINE\n5\n1\n8\n0\n100\nAcDbSpline\n70\n0\n71\n3\n72\n8\n73\n4\n40\n0.0\n40\n1.0\n10\n8.0\n20\n7.0\n10\n10.0\n20\n11.0\n41\n1.0\n'
            + '0\nPOINT\n5\n2\n8\n0\n100\nAcDbPoint\n10\n1.0\n20\n1.0\n'
            + '0\nLWPOLYLINE\n5\n3\n8\n0\n100\nAcDbPolyline\n90\n2\n70\n1\n10\n-2.0\n20\n-3.0\n42\n0.4142135623730951\n10\n7.0\n20\n6.0\n'))
    })

    it('les fins de ligne CRLF sont conservées octet pour octet', () => {
        const crlf = doc('0\nLINE\n5\n1\n8\n0\n10\n5.0\n20\n5.0\n11\n15.0\n21\n5.0\n').replace(/\n/g, '\r\n')
        const out = shiftDxf(crlf, 5, 5)
        expect(out).toBe(doc('0\nLINE\n5\n1\n8\n0\n10\n0.0\n20\n0.0\n11\n10.0\n21\n0.0\n').replace(/\n/g, '\r\n'))
        expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    })

    it('déplacement nul : le texte lui-même', () => {
        const src = doc('0\nCIRCLE\n5\n2\n8\n0\n10\n5.0\n20\n6.0\n40\n3.0\n')
        expect(shiftDxf(src, 0, 0)).toBe(src)
    })

    it('les valeurs non déplacées gardent leur texte d\'origine (même une valeur « 5 » ou « 70 »)', () => {
        const src = doc('0\nLWPOLYLINE\n5\n5\n8\n5\n90\n1\n70\n1\n10\n1e-05\n20\n2\n')
        const out = shiftDxf(src, 1, 1)
        expect(out).toBe(doc('0\nLWPOLYLINE\n5\n5\n8\n5\n90\n1\n70\n1\n10\n-0.99999\n20\n1.0\n'))
    })
})

describe('shiftDxf : jamais un fichier faux', () => {
    const bad = (src, what) => it(what, () => {
        expect(() => shiftDxf(src, 1, 1)).toThrow(DXF_ORIGIN_UNSUPPORTED)
    })
    bad(doc('0\nINSERT\n5\n1\n8\n0\n2\nB\n10\n1.0\n20\n1.0\n'), 'INSERT : refus')
    bad(doc('0\nTEXT\n5\n1\n8\n0\n10\n1.0\n20\n1.0\n1\nabc\n'), 'entité inconnue (TEXT) : refus')
    bad(doc('0\nHATCH\n5\n1\n'), 'HATCH : refus')
    bad(doc('0\nLINE\n5\n1\n10\n1.0\n20\n1.0\n11\n2.0\n21\n2.0\n31\n0.0\n'), 'cote Z (31) : refus')
    bad(doc('0\nSPLINE\n5\n1\n11\n1.0\n21\n1.0\n'), 'SPLINE avec points d\'ajustement (11/21) : refus')
    bad(doc('0\nPOLYLINE\n5\n1\n10\n0.0\n20\n0.0\n0\nSEQEND\n'), 'POLYLINE avec point propre : refus')
    bad(doc('0\nVERTEX\n10\n1.0\n20\n1.0\n'), 'VERTEX hors POLYLINE : refus')
    bad(doc('0\nPOLYLINE\n5\n1\n0\nLINE\n10\n1.0\n20\n1.0\n11\n1.0\n21\n1.0\n'), 'POLYLINE jamais fermée : refus')
    bad(doc('0\nLINE\n5\n1\n10\nabc\n20\n1.0\n11\n1.0\n21\n1.0\n'), 'nombre illisible : refus')
    bad(doc('0\nLINE\n5\n1\n10\nNaN\n20\n1.0\n11\n1.0\n21\n1.0\n'), 'nombre non fini : refus')
    bad(HEAD.replace('9\n$MEASUREMENT', '9\n$EXTMIN\n10\n0.0\n20\n0.0\n9\n$MEASUREMENT') + TAIL, 'étendue dans l\'en-tête ($EXTMIN) : refus')
    bad(doc('').replace('0\nTABLE\n2\nLAYER', '0\nTABLE\n2\nVPORT\n0\nVPORT\n10\n0.0\n20\n0.0\n0\nENDTAB\n0\nTABLE\n2\nLAYER'), 'point dans une table (VPORT) : refus')
    bad(doc('').replace('0\nSECTION\n2\nENTITIES', '0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n0\nSECTION\n2\nENTITIES'), 'section BLOCKS : refus')
    bad(doc('0\nLINE\n5\n1\n10\n1.0\n20\n1.0\n11\n1.0\n21\n1.0\n').replace('0\nEOF\n', ''), 'fichier sans EOF : refus')
    bad(doc('0\nLINE\n5\n1\n10\n1.0\n20\n1.0\n11\n1.0\n21\n1.0\n') + '0\nLINE\n', 'contenu après EOF : refus')
    bad(doc('0\nLINE\n5\n1\nxx\n1.0\n10\n1.0\n20\n1.0\n11\n1.0\n21\n1.0\n'), 'code de groupe illisible : refus')
    bad('', 'texte vide : refus')

    it('déplacement non fini ou texte non chaîne : refus', () => {
        expect(() => shiftDxf(doc(''), NaN, 0)).toThrow(DXF_ORIGIN_UNSUPPORTED)
        expect(() => shiftDxf(null, 1, 1)).toThrow(DXF_ORIGIN_UNSUPPORTED)
    })
})

describe('dxfUnitScale', () => {
    it('lit $INSUNITS : 4 = mm, 1 = pouces ; autre : refus', () => {
        expect(dxfUnitScale(HEAD)).toBe(1)
        expect(dxfUnitScale(HEAD.replace('70\n4\n', '70\n1\n'))).toBe(1 / 25.4)
        expect(() => dxfUnitScale(HEAD.replace('70\n4\n', '70\n0\n'))).toThrow(DXF_ORIGIN_UNSUPPORTED)
        expect(() => dxfUnitScale('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n')).toThrow(DXF_ORIGIN_UNSUPPORTED)
    })
})

// ---------------------------------------------------------------------------
// Contre l'écrivain du vrai bundle wasm.
// ---------------------------------------------------------------------------

const enc = (s) => new Uint8Array(Buffer.from(s))
const HANDCRAFTED = enc(
    '0\nSECTION\n2\nENTITIES\n'
    + '0\nLINE\n5\nA1\n8\n0\n10\n0\n20\n0\n11\n10\n21\n5\n'
    + '0\nCIRCLE\n5\nA2\n8\nCUT\n10\n30\n20\n12\n40\n3\n'
    + '0\nARC\n5\nA3\n8\nCUT\n10\n20\n20\n20\n40\n4\n50\n10\n51\n100\n'
    + '0\nPOINT\n5\nA4\n8\n0\n10\n41\n20\n9\n'
    + '0\nSPLINE\n5\nA5\n8\n0\n70\n8\n71\n3\n72\n8\n73\n4\n40\n0\n40\n0\n40\n0\n40\n0\n40\n1\n40\n1\n40\n1\n40\n1\n'
    + '10\n60\n20\n10\n10\n65\n20\n30\n10\n80\n20\n30\n10\n90\n20\n10\n'
    + '0\nENDSEC\n0\nEOF\n',
)

/** Source canonique (celle que le navigateur conserve) + tous les handles de ses entités. */
function canonicalSource(file) {
    const canon = new Uint8Array(glue.mod.canonical_dxf(new Uint8Array(readFileSync(path.join(CORPUS, file))), 0.01))
    const text = Buffer.from(canon).toString('utf8')
    const body = text.slice(text.indexOf('2\nENTITIES\n'))
    const handles = pairsOf(body).filter(([c]) => c === '5').map(([, v]) => v)
    return { bytes: canon, handles }
}

const SOURCES = {
    hand: { bytes: HANDCRAFTED, handles: ['A1', 'A2', 'A3', 'A4', 'A5'] },
}
for (const f of ['only_ellipse.dxf', 'polyline_bulge.dxf', 'curves_mix.dxf',
    'bulge_notable_lwpolyline.dxf', 'rotated_plates.dxf', 'legacy_polyline.dxf', 'only_arc.dxf']) {
    SOURCES[f] = null // chargés dans beforeAll (le wasm doit être prêt)
}
beforeAll(() => {
    for (const f of Object.keys(SOURCES)) if (SOURCES[f] === null) SOURCES[f] = canonicalSource(f)
})

const rectBin = (w, h) => ({ outer: [[0, 0], [w, 0], [w, h], [0, h], [0, 0]], inner: [] })
const discBin = (r) => ({
    outer: Array.from({ length: 73 }, (_, k) => [r + r * Math.cos((k * 5 * Math.PI) / 180), r + r * Math.sin((k * 5 * Math.PI) / 180)]),
    inner: [[[40, 40], [60, 40], [60, 60], [40, 60], [40, 40]]],
})

/** Export wasm d'une tôle ; `d` = [dx, dy] en mm : poses et forme décalées par l'écrivain. */
function exportSheet(names, placements, { unit = 'mm', shaped = null, w = 400, h = 300, d = [0, 0], outShape = true } = {}) {
    const transforms = placements.map((p, i) => ({
        item_id: String(i),
        file_slug: p.src,
        handles: SOURCES[p.src].handles,
        angle: p.angle,
        x: p.x - d[0],
        y: p.y - d[1],
        color: null,
    }))
    const spec = {
        transforms, space: 2, add_out_shape: outShape, bin_width: w, bin_height: h, output_unit: unit,
    }
    if (shaped) {
        const sh = (ring) => ring.map((p) => [String(p[0] - d[0]), String(p[1] - d[1])])
        spec.bin_shape = { outer: sh(shaped.outer), inner: shaped.inner.map(sh) }
    }
    return glue.mod.export_dxf_sheet(names, names.map((n) => SOURCES[n].bytes), JSON.stringify(spec))
}

/** Compare deux DXF paire par paire : texte identique, ou nombres à 1e-9 près. */
function expectSameDxf(a, b, tol = 1e-9) {
    const pa = pairsOf(a)
    const pb = pairsOf(b)
    expect(pa.length).toBe(pb.length)
    let numbers = 0
    for (let i = 0; i < pa.length; i++) {
        expect(pa[i][0]).toBe(pb[i][0])
        if (['10', '20', '11', '21'].includes(pa[i][0])) numbers++
        if (pa[i][1] === pb[i][1]) continue
        const x = Number(pa[i][1])
        const y = Number(pb[i][1])
        expect(Number.isFinite(x) && Number.isFinite(y), `groupe ${pa[i][0]} #${i} : « ${pa[i][1]} » ≠ « ${pb[i][1]} »`).toBe(true)
        expect(Math.abs(x - y), `groupe ${pa[i][0]} #${i} : ${pa[i][1]} vs ${pb[i][1]}`).toBeLessThanOrEqual(tol)
    }
    return numbers
}

const POSES = [
    { src: 'hand', x: 10, y: 10, angle: 0 },
    { src: 'hand', x: 150, y: 80, angle: Math.PI / 2 },
    { src: 'hand', x: 200, y: 200, angle: 0.6435011087932844 },
    { src: 'only_ellipse.dxf', x: 120, y: 60, angle: 0.3 },
    { src: 'polyline_bulge.dxf', x: 20, y: 20, angle: 0 },
    { src: 'polyline_bulge.dxf', x: 250, y: 120, angle: 4.1 },
    { src: 'curves_mix.dxf', x: 300, y: 200, angle: 1.2 },
    { src: 'bulge_notable_lwpolyline.dxf', x: 50, y: 250, angle: 0 },
    { src: 'rotated_plates.dxf', x: 0, y: 0, angle: 5.5 },
    { src: 'legacy_polyline.dxf', x: 100, y: 100, angle: 2 },
    { src: 'only_arc.dxf', x: 340, y: 40, angle: 0.1 },
]
const NAMES = [...new Set(POSES.map((p) => p.src))]

describe('shiftDxf contre l\'écrivain du bundle wasm', () => {
    it('le jeu de sources couvre arcs, splines, ellipses, polylignes à bulge, cercles, points', () => {
        const base = exportSheet(NAMES, POSES)
        for (const kind of ['LINE', 'CIRCLE', 'ARC', 'POINT', 'ELLIPSE', 'SPLINE', 'LWPOLYLINE']) {
            expect(base, kind).toContain(`0\n${kind}\n`)
        }
    })

    it('tôle rectangulaire en mm : mêmes entités, coordonnées à 1e-9, OUT_SHAPE comprise', () => {
        const dx = 200
        const dy = 150
        const base = exportSheet(NAMES, POSES)
        const writer = exportSheet(NAMES, POSES, { d: [dx, dy] })
        const mine = shiftDxf(base, dx, dy)
        // Le rectangle BIN_BOUNDARY est dessiné de (0,0) à (w,h) quoi qu'on pose : attente directe.
        const stripBin = (t) => t.replace(/0\nLWPOLYLINE\n5\n[0-9A-F]+\n100\nAcDbEntity\n8\nBIN_BOUNDARY\n[\s\S]*?(?=0\nLWPOLYLINE|0\nENDSEC)/, '')
        const n = expectSameDxf(stripBin(mine), stripBin(writer))
        expect(n).toBeGreaterThan(100)
        const boundary = pairsOf(mine.slice(mine.indexOf('8\nBIN_BOUNDARY'))).filter(([c]) => c === '10' || c === '20').slice(0, 8).map(([, v]) => Number(v))
        expect(boundary).toEqual([-200, -150, 200, -150, 200, 150, -200, 150])
        // OUT_SHAPE : le cadre suit les pièces, décalé de la même quantité.
        expect(mine).toContain('8\nOUT_SHAPE')
    })

    it('tôle importée (disque + zone interdite) : contour, zone et pièces égaux à ceux de l\'écrivain', () => {
        const shaped = discBin(200)
        const poses = POSES.map((p) => ({ ...p, x: p.x + 40, y: p.y + 40 }))
        const dx = 200
        const dy = 200
        const base = exportSheet(NAMES, poses, { shaped, w: 400, h: 400 })
        const writer = exportSheet(NAMES, poses, { shaped, w: 400, h: 400, d: [dx, dy] })
        const n = expectSameDxf(shiftDxf(base, dx, dy), writer)
        expect(n).toBeGreaterThan(100)
        expect(base).toContain('8\nFORBIDDEN_ZONE')
        // Le contour est centré sur (0,0) : première coordonnée (0 + 200) - 200 + 200 cos0...
        const out = shiftDxf(base, dx, dy)
        const ys = pairsOf(out.slice(out.indexOf('8\nBIN_BOUNDARY'))).filter(([c]) => c === '20').slice(0, 72).map(([, v]) => Number(v))
        expect(Math.min(...ys)).toBeCloseTo(-200, 9)
        expect(Math.max(...ys)).toBeCloseTo(200, 9)
    })

    it('sortie en pouces : le décalage est en pouces, mêmes entités à 1e-9', () => {
        const dx = 200
        const dy = 150
        const k = 1 / 25.4
        const base = exportSheet(NAMES, POSES, { unit: 'inch' })
        expect(base).toContain('9\n$INSUNITS\n70\n1\n')
        expect(dxfUnitScale(base)).toBe(k)
        const writer = exportSheet(NAMES, POSES, { unit: 'inch', d: [dx, dy] })
        const stripBin = (t) => t.replace(/0\nLWPOLYLINE\n5\n[0-9A-F]+\n100\nAcDbEntity\n8\nBIN_BOUNDARY\n[\s\S]*?(?=0\nLWPOLYLINE|0\nENDSEC)/, '')
        const n = expectSameDxf(stripBin(shiftDxf(base, dx * k, dy * k)), stripBin(writer))
        expect(n).toBeGreaterThan(100)
    })

    it('sans OUT_SHAPE et avec une seule pièce : même résultat que l\'écrivain', () => {
        const poses = [POSES[0]]
        const base = exportSheet(['hand'], poses, { outShape: false })
        const writer = exportSheet(['hand'], poses, { outShape: false, d: [7.25, 3.5] })
        const strip = (t) => t.slice(0, t.indexOf('0\nLWPOLYLINE\n'))
        expectSameDxf(strip(shiftDxf(base, 7.25, 3.5)), strip(writer))
    })

    it('chaque fichier de l\'écrivain est accepté (aucun type d\'entité hors liste)', () => {
        const base = exportSheet(NAMES, POSES)
        expect(() => shiftDxf(base, 1, 1)).not.toThrow()
        const shapedBase = exportSheet(NAMES, POSES, { shaped: discBin(200), w: 400, h: 400 })
        expect(() => shiftDxf(shapedBase, 1, 1)).not.toThrow()
        // Une tôle rectangulaire reste un rectangle qu'on ne sait pas confondre avec une forme.
        expect(() => shiftDxf(exportSheet(['hand'], [POSES[0]], { shaped: { outer: rectBin(400, 300).outer, inner: [] } }), 1, 1)).not.toThrow()
    })
})
