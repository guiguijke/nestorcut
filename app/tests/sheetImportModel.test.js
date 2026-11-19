import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isReactive, reactive, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import {
    ERROR_KEYS,
    INCH_HINT_MAX_MM,
    MIN_ZONE_PX,
    baseName,
    buildRecord,
    buildSheetView,
    cleanName,
    confirmLabel,
    contourScreenPx,
    defaultSheetName,
    fitTransform,
    forbidAll,
    forbidInvert,
    forbidNone,
    ignoredLines,
    importErrorOf,
    isDxfName,
    isListOnly,
    looksLikeDxf,
    looksLikeInches,
    newSheetSlug,
    pairDecimals,
    ringPath,
    thumbModel,
    toPlain,
    toggleZone,
    usableArea,
    zoneStates,
} from '../utils/sheetImportModel'
import { ringArea, ringBbox, scaleContours } from '../utils/sheetShape'
import { DICTS, LOCALES, translate } from '../utils/i18n'

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const circle = (cx, cy, r, n = 32) => {
    const pts = Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)])
    return [...pts, pts[0]]
}
const contour = (ring, depth, parent) => ({ ring, depth, parent, areaMm2: ringArea(ring), bbox: ringBbox(ring) })

// 0 tôle 100x100 ; 1 zone A (20x20) ; 2 zone B dans A ; 3 zone C ; 4 autre contour extérieur
const CONTOURS = [
    contour(rect(0, 0, 100, 100), 1, null),
    contour(rect(10, 10, 30, 30), 2, 0),
    contour(rect(50, 50, 60, 60), 2, 0),
    contour(rect(12, 12, 15, 15), 3, 1),
    contour(rect(200, 0, 210, 10), 1, null),
]

describe('importErrorOf', () => {
    it('refus du lecteur : trop lourd, le message du lecteur est gardé', () => {
        expect(importErrorOf({ refusal: { reason: 'time' }, message: 'Too many entities' }))
            .toEqual({ key: ERROR_KEYS.tooHeavy, detail: 'Too many entities' })
        expect(importErrorOf({ refusal: {} }).detail).toBeNull()
    })
    it('échec du lecteur ou valeur vide : illisible', () => {
        expect(importErrorOf({ ok: false, error: 'boom' }).key).toBe(ERROR_KEYS.unreadable)
        expect(importErrorOf(null).key).toBe(ERROR_KEYS.unreadable)
        expect(importErrorOf(undefined).key).toBe(ERROR_KEYS.unreadable)
    })
    it('aucun contour fermé, ou aucun contour de profondeur 1', () => {
        expect(importErrorOf({ contours: [] }).key).toBe(ERROR_KEYS.noContour)
        expect(importErrorOf({ contours: [contour(rect(0, 0, 1, 1), 2, 0)] }).key).toBe(ERROR_KEYS.noContour)
    })
    it('un résultat exploitable : null', () => {
        expect(importErrorOf({ contours: CONTOURS })).toBeNull()
    })
    it('chaque erreur du modèle a sa clé', () => {
        const key = (m) => importErrorOf(new Error(m)).key
        expect(key('sheet_no_outline')).toBe(ERROR_KEYS.noContour)
        expect(key('sheet_bad_geometry')).toBe(ERROR_KEYS.badGeometry)
        expect(key('sheet_too_many_vertices')).toBe(ERROR_KEYS.tooManyVertices)
        expect(key('sheet_too_many_zones')).toBe(ERROR_KEYS.tooManyZones)
        expect(key('indexeddb_unavailable')).toBe(ERROR_KEYS.storage)
        expect(key('autre chose')).toBe(ERROR_KEYS.unreadable)
        expect(importErrorOf('sheet_too_many_zones').key).toBe(ERROR_KEYS.tooManyZones)
    })
})

describe('nom de fichier', () => {
    it('isDxfName : extension .dxf, casse libre', () => {
        expect(isDxfName('a.dxf')).toBe(true)
        expect(isDxfName('PLAN.DXF')).toBe(true)
        expect(isDxfName('a.dwg')).toBe(false)
        expect(isDxfName('dxf')).toBe(false)
        expect(isDxfName(null)).toBe(false)
    })
    it('baseName', () => {
        expect(baseName('C:\\x\\plan.v2.dxf')).toBe('plan.v2')
        expect(baseName('a/b/disc.DXF')).toBe('disc')
        expect(baseName('')).toBe('')
    })
})

describe('vue de zones', () => {
    const view = buildSheetView(CONTOURS)
    it('tôle, candidates numérotées, autre contour extérieur compté', () => {
        expect(view.outlineIndex).toBe(0)
        expect(view.candidates).toEqual([1, 2, 3])
        expect(view.zones.map((z) => z.number)).toEqual([1, 2, 3])
        expect(view.otherOutlines).toBe(1)
        expect(view.outline).toEqual({ kind: 'box', widthMm: 100, heightMm: 100 })
    })
    it('taille et zones qui contiennent', () => {
        expect(view.zones[0]).toMatchObject({ index: 1, widthMm: 20, heightMm: 20, areaMm2: 400, ancestorNumbers: [] })
        expect(view.zones[2]).toMatchObject({ index: 3, widthMm: 3, heightMm: 3, ancestorNumbers: [1] })
    })
    it('aucun contour extérieur : pas de vue', () => {
        expect(buildSheetView([])).toBeNull()
        expect(buildSheetView([contour(rect(0, 0, 1, 1), 2, 0)])).toBeNull()
    })
    it('aucune zone : liste vide, pas d\'erreur', () => {
        const only = buildSheetView([CONTOURS[0]])
        expect(only.zones).toEqual([])
        expect(forbidAll([CONTOURS[0]], only)).toEqual([])
    })
})

describe('états et bascule', () => {
    const view = buildSheetView(CONTOURS)
    const states = (forb) => zoneStates(CONTOURS, view, forb).map((s) => `${s.number}:${s.state}${s.coveredBy ? '@' + s.coveredBy : ''}`)

    it('rien n\'est interdit par défaut', () => {
        expect(states([])).toEqual(['1:free', '2:free', '3:free'])
    })
    it('une zone interdite couvre celles qu\'elle contient', () => {
        expect(states([1])).toEqual(['1:forbidden', '2:free', '3:implied@1'])
    })
    it('bascule : libre -> interdite -> libre', () => {
        let f = toggleZone(CONTOURS, view, [], 2)
        expect(f).toEqual([2])
        f = toggleZone(CONTOURS, view, f, 2)
        expect(f).toEqual([])
    })
    it('interdire un parent absorbe l\'enfant déjà interdit ; le lever le rend libre', () => {
        let f = toggleZone(CONTOURS, view, [3], 1)
        expect(f).toEqual([1])
        expect(states(f)[2]).toBe('3:implied@1')
        f = toggleZone(CONTOURS, view, f, 1)
        expect(f).toEqual([])
        expect(states(f)[2]).toBe('3:free')
    })
    it('une zone couverte ne bascule pas ; un indice inconnu non plus', () => {
        expect(toggleZone(CONTOURS, view, [1], 3)).toEqual([1])
        expect(toggleZone(CONTOURS, view, [1], 4)).toEqual([1])
        expect(toggleZone(CONTOURS, view, [1], 0)).toEqual([1])
    })
    it('raccourcis : aucune, toutes (zones de tête), inverser', () => {
        expect(forbidNone()).toEqual([])
        expect(forbidAll(CONTOURS, view)).toEqual([1, 2])
        expect(forbidInvert(CONTOURS, view, [])).toEqual([1, 2])
        expect(forbidInvert(CONTOURS, view, [1, 2])).toEqual([])
        expect(forbidInvert(CONTOURS, view, [2])).toEqual([1])
    })
    it('l\'aire utile suit les zones, sans double compte', () => {
        expect(usableArea(CONTOURS, view, [])).toBe(10000)
        expect(usableArea(CONTOURS, view, [1, 3])).toBe(10000 - 400)
        expect(usableArea(CONTOURS, view, [1, 2])).toBe(10000 - 400 - 100)
    })
})

describe('libellé du bouton', () => {
    it('aucune zone : phrase dédiée ; sinon pluriel avec le nombre', () => {
        expect(confirmLabel(0)).toEqual({ key: 'sheetImport.confirm.none', n: 0 })
        expect(confirmLabel(1)).toEqual({ plural: 'sheetImport.confirm.some', n: 1 })
        expect(confirmLabel(7)).toEqual({ plural: 'sheetImport.confirm.some', n: 7 })
        expect(confirmLabel(-3).key).toBe('sheetImport.confirm.none')
    })
})

describe('unités et nom par défaut', () => {
    it('pouces : seulement sans unité déclarée et sous 30 mm', () => {
        expect(looksLikeInches(0, 20, 20)).toBe(true)
        expect(looksLikeInches(0, 29.9, 5)).toBe(true)
        expect(looksLikeInches(0, INCH_HINT_MAX_MM, 5)).toBe(false)
        expect(looksLikeInches(0, 500, 500)).toBe(false)
        expect(looksLikeInches(4, 20, 20)).toBe(false)
        expect(looksLikeInches(1, 20, 20)).toBe(false)
        expect(looksLikeInches(0, 0, 0)).toBe(false)
    })
    it('disque et boîte, en mm', () => {
        expect(defaultSheetName({ kind: 'disc', diameterMm: 500 }, 'mm', 'en')).toBe('Ø 500 mm')
        expect(defaultSheetName({ kind: 'box', widthMm: 1200, heightMm: 800 }, 'mm', 'en')).toBe('1200 × 800 mm')
        expect(defaultSheetName({ kind: 'box', widthMm: 1200.04, heightMm: 800.5 }, 'mm', 'fr')).toBe('1200 × 800,5 mm')
    })
    it('disque et boîte, en pouces', () => {
        expect(defaultSheetName({ kind: 'disc', diameterMm: 508 }, 'inch', 'en')).toBe('Ø 20"')
        expect(defaultSheetName({ kind: 'box', widthMm: 1219.2, heightMm: 2438.4 }, 'inch', 'en')).toBe('48 × 96"')
    })
    it('cleanName rogne, replie les blancs, borne la longueur', () => {
        expect(cleanName('  Ø  500   mm ')).toBe('Ø 500 mm')
        expect(cleanName('   ')).toBe('')
        expect(cleanName(null)).toBe('')
        expect(cleanName('x'.repeat(200))).toHaveLength(60)
    })
    it('newSheetSlug : déterministe, différent selon horloge et hasard', () => {
        const a = newSheetSlug(1700000000000, 0.123456)
        expect(a).toBe(newSheetSlug(1700000000000, 0.123456))
        expect(a).not.toBe(newSheetSlug(1700000000001, 0.123456))
        expect(a).not.toBe(newSheetSlug(1700000000000, 0.654321))
        expect(a).toMatch(/^sheet-[0-9a-z]+-[0-9a-z]{6}$/)
    })
})

describe('ce qui est ignoré', () => {
    it('seulement les compteurs non nuls', () => {
        expect(ignoredLines({ openPaths: 0, skippedEntities: 0 })).toEqual([])
        expect(ignoredLines({})).toEqual([])
        expect(ignoredLines({ openPaths: 3, skippedEntities: 12, otherOutlines: 1 })).toEqual([
            { key: 'sheetImport.ignored.open', n: 3 },
            { key: 'sheetImport.ignored.other', n: 12 },
            { key: 'sheetImport.ignored.outlines', n: 1 },
        ])
        expect(ignoredLines({ skippedEntities: 2 })).toEqual([{ key: 'sheetImport.ignored.other', n: 2 }])
    })
})

describe('dessin', () => {
    it('ringPath : M, L, Z', () => {
        expect(ringPath(rect(0, 0, 2, 1))).toBe('M0 0L2 0L2 1L0 1L0 0Z')
        expect(ringPath([])).toBe('')
    })
    it('fitTransform : le dessin remplit la boîte moins la marge, centré, y flippé', () => {
        const fit = fitTransform([0, 0, 100, 50], 400, 300, 20)
        expect(fit.scale).toBe(3.6) // (400 - 40) / 100
        expect(fit.viewBox).toBe('0 0 400 300')
        // x : 0 mm -> 20 px, 100 mm -> 380 px
        expect(fit.scale * 0 + fit.tx).toBe(20)
        expect(fit.scale * 100 + fit.tx).toBeCloseTo(380, 6)
        // y flippé : y = 0 (bas du dessin) est BAS à l'écran, y = 50 est plus HAUT (valeur plus petite)
        const screenY = (y) => -fit.scale * y + fit.ty
        expect(screenY(0)).toBeGreaterThan(screenY(50))
        // centré verticalement : (300 - 180) / 2 = 60 px de chaque côté
        expect(screenY(50)).toBeCloseTo(60, 6)
        expect(screenY(0)).toBeCloseTo(240, 6)
        expect(fit.transform).toBe(`matrix(3.6 0 0 -3.6 ${fit.tx} ${fit.ty})`)
    })
    it('fitTransform : décalage du repère DXF (minx, miny non nuls) et dessin haut', () => {
        const fit = fitTransform([1000, -500, 1100, 500], 200, 600, 10)
        expect(fit.scale).toBe(0.58) // largeur : 1,8 ; hauteur : 580 / 1000 = 0,58 -> la plus petite
        // le coin bas-gauche du dessin (1000, -500) tombe en bas à gauche de la zone utile
        expect(fit.scale * 1000 * 0 + fit.tx + fit.scale * 1000).toBeCloseTo(10 + (180 - 58) / 2, 6)
        expect(-fit.scale * -500 + fit.ty).toBeCloseTo(590, 6)
    })
    it('fitTransform : boîte dégénérée, taille nulle', () => {
        expect(fitTransform([5, 5, 5, 5], 100, 100).scale).toBe(1)
        expect(Number.isFinite(fitTransform(null, 0, 0).scale)).toBe(true)
        expect(fitTransform([0, 0, 10, 0], 100, 100, 10).scale).toBe(8)
    })
    it('contourScreenPx et isListOnly : seuil de 6 px', () => {
        const tiny = contour(rect(0, 0, 3, 2), 2, 0)
        expect(contourScreenPx(tiny, 1)).toBe(3)
        expect(isListOnly(tiny, 1)).toBe(true)
        expect(isListOnly(tiny, 2)).toBe(false) // 6 px pile : cliquable
        expect(isListOnly(tiny, 1.9)).toBe(true)
        expect(MIN_ZONE_PX).toBe(6)
    })
    it('thumbModel : contour et zones interdites normalisées', () => {
        const record = { contours: CONTOURS, outlineIndex: 0, forbidden: [1, 3] }
        const m = thumbModel(record, 80, 60)
        expect(m.outlineD.startsWith('M0 0')).toBe(true)
        expect(m.zonesD).toHaveLength(1)
        expect(m.viewBox).toBe('0 0 80 60')
        expect(thumbModel({ contours: [], outlineIndex: 0 })).toBeNull()
        expect(thumbModel(null)).toBeNull()
    })
})

describe('mise à l\'échelle en pouces (scaleContours) et vue', () => {
    it('un disque de 20 (unités du dessin) devient 508 mm de diamètre', () => {
        const small = [contour(circle(0, 0, 10), 1, null)]
        expect(looksLikeInches(0, 20, 20)).toBe(true)
        const scaled = scaleContours(small, 25.4)
        const view = buildSheetView(scaled)
        expect(view.outline.kind).toBe('disc')
        expect(view.outline.diameterMm).toBeCloseTo(508, 1)
        expect(looksLikeInches(0, 508, 508)).toBe(false)
    })
})

describe('buildRecord', () => {
    const base = {
        slug: 'sheet-abc', projectSlug: 'p1', name: ' Plaque  A ', sourceFileName: 'a.dxf', sourceUnits: 4,
        contours: CONTOURS, outlineIndex: 0, forbidden: [1, 3], now: '2026-11-19T10:00:00.000Z',
    }
    it('enregistrement complet, nom nettoyé, zone couverte abandonnée', () => {
        const { record, error } = buildRecord(base)
        expect(error).toBeUndefined()
        expect(record).toMatchObject({
            slug: 'sheet-abc', kind: 'sheet', projectSlug: 'p1', name: 'Plaque A', forbidden: [1],
            widthMm: 100, heightMm: 100, addedAt: base.now, lastUsedAt: base.now,
        })
        expect(record.areaMm2).toBe(10000 - 400)
    })
    it('nom vide : erreur de nom', () => {
        expect(buildRecord({ ...base, name: '   ' })).toEqual({ error: ERROR_KEYS.nameRequired })
    })
    it('erreurs du modèle -> clés de message', () => {
        expect(buildRecord({ ...base, outlineIndex: 99 })).toEqual({ error: ERROR_KEYS.noContour })
        const bad = [contour([[0, 0], [1, 1], [0, 0]], 1, null)]
        expect(buildRecord({ ...base, contours: bad, forbidden: [] })).toEqual({ error: ERROR_KEYS.badGeometry })
    })
    it('trop de zones', () => {
        const many = [contour(rect(0, 0, 1000, 1000), 1, null)]
        for (let i = 0; i < 201; i++) many.push(contour(rect(i * 4, 1, i * 4 + 2, 3), 2, 0))
        const forbidden = many.slice(1).map((_, i) => i + 1)
        expect(buildRecord({ ...base, contours: many, forbidden })).toEqual({ error: ERROR_KEYS.tooManyZones })
    })
})

describe('clés de message : toutes présentes dans les six langues', () => {
    const keys = [
        ...Object.values(ERROR_KEYS),
        'sheetImport.confirm.none',
        'sheetImport.inches.on',
        'sheetImport.confirm.some.one', 'sheetImport.confirm.some.other',
        'sheetImport.ignored.open.one', 'sheetImport.ignored.open.other',
        'sheetImport.ignored.other.one', 'sheetImport.ignored.other.other',
        'sheetImport.ignored.outlines.one', 'sheetImport.ignored.outlines.other',
        'sheetImport.units.0', 'sheetImport.units.1', 'sheetImport.units.2',
        'sheetImport.units.4', 'sheetImport.units.5', 'sheetImport.units.6', 'sheetImport.units.other',
    ]
    it('chaque clé existe dans chaque langue, avec les mêmes {placeholders}', () => {
        const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
        for (const lang of LOCALES) {
            for (const k of keys) {
                expect(DICTS[lang][k], `[${lang}] ${k}`).toBeTruthy()
                expect(ph(DICTS[lang][k]), `[${lang}] ${k}`).toBe(ph(DICTS.en[k]))
            }
        }
    })
    it('le libellé de confirmation dit le nombre de zones dans chaque langue', () => {
        for (const lang of LOCALES) {
            expect(translate('sheetImport.confirm.some.other', lang, { n: 3 })).toContain('3')
        }
    })
})

describe('buildRecord : enregistrement cloneable (entrées réactives de Vue)', () => {
    const base = {
        slug: 'sheet-abc', projectSlug: 'p1', name: 'Plaque', sourceFileName: 'a.dxf', sourceUnits: 4,
        outlineIndex: 0, now: '2026-11-19T10:00:00.000Z',
    }
    const allPlainNumbers = (ring) => Array.isArray(ring) && ring.every((pt) => Array.isArray(pt) && !isReactive(pt) && pt.every((n) => typeof n === 'number'))

    it('contours et zones dans reactive() : structuredClone ne jette pas', () => {
        const contours = reactive(CONTOURS.map((c) => ({ ...c, ring: c.ring.map((p) => [...p]), bbox: [...c.bbox] })))
        const forbidden = reactive([1, 3])
        expect(isReactive(contours[1])).toBe(true)
        const { record, error } = buildRecord({ ...base, contours, forbidden })
        expect(error).toBeUndefined()
        expect(() => structuredClone(record)).not.toThrow()
        expect(isReactive(record.contours)).toBe(false)
        expect(isReactive(record.forbidden)).toBe(false)
        for (const c of record.contours) {
            expect(isReactive(c)).toBe(false)
            expect(allPlainNumbers(c.ring)).toBe(true)
            expect(c.bbox.every((n) => typeof n === 'number')).toBe(true)
        }
        expect(record.forbidden).toEqual([1])
    })
    it('entrées gardées dans un ref() (lecture du lecteur) : même garantie', () => {
        const holder = ref({ contours: CONTOURS.map((c) => ({ ...c })), forbidden: [3] })
        const { record } = buildRecord({ ...base, contours: holder.value.contours, forbidden: holder.value.forbidden })
        expect(() => structuredClone(record)).not.toThrow()
        expect(allPlainNumbers(record.contours[0].ring)).toBe(true)
        expect(record.forbidden).toEqual([3])
    })
    it('anneau à refermer (chemin de makeSheetRecord qui recopie) : toujours cloneable', () => {
        const open = reactive([contour(rect(0, 0, 100, 100), 1, null)])
        open[0].ring = open[0].ring.slice(0, -1) // anneau non fermé
        const { record, error } = buildRecord({ ...base, contours: open, forbidden: reactive([]) })
        expect(error).toBeUndefined()
        expect(() => structuredClone(record)).not.toThrow()
        expect(allPlainNumbers(record.contours[0].ring)).toBe(true)
    })
    it('toPlain : copie profonde, abandonne fonctions et undefined', () => {
        const src = reactive({ a: [1, [2, 3]], b: { c: 'x', f() {}, u: undefined }, n: null })
        const out = toPlain(src)
        expect(out).toEqual({ a: [1, [2, 3]], b: { c: 'x' }, n: null })
        expect(isReactive(out.a)).toBe(false)
    })
})

describe('looksLikeDxf', () => {
    const bytes = (s) => new TextEncoder().encode(s)
    const fixture = (name) => readFileSync(fileURLToPath(new URL(`../../workers/geometry/parity/corpus_sheets/${name}`, import.meta.url)))
    it("tête d'un vrai DXF des corpus", () => {
        for (const name of ['disc_1000.dxf', 'ring_1000_300.dxf', 'title_block.dxf']) {
            expect(looksLikeDxf(new Uint8Array(fixture(name)).subarray(0, 4096)), name).toBe(true)
        }
    })
    it('DXF avec commentaire 999 en tête, fins de ligne CRLF, BOM UTF-8', () => {
        expect(looksLikeDxf(bytes('999\r\nmade by x\r\n  0\r\nSECTION\r\n  2\r\nHEADER\r\n'))).toBe(true)
        expect(looksLikeDxf(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('0\nSECTION\n2\nHEADER\n')]))).toBe(true)
        expect(looksLikeDxf(bytes('0\nSECTION'))).toBe(true)
    })
    it('texte ordinaire renommé .dxf, fichier vide, binaire quelconque : non', () => {
        expect(looksLikeDxf(bytes('Bonjour, ceci est une note.\nPas un dessin.\n'))).toBe(false)
        expect(looksLikeDxf(bytes("0\nCeci n'est pas une section\n"))).toBe(false)
        expect(looksLikeDxf(new Uint8Array(0))).toBe(false)
        expect(looksLikeDxf(null)).toBe(false)
        expect(looksLikeDxf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))).toBe(false)
    })
    it('en-tête du DXF binaire accepté', () => {
        expect(looksLikeDxf(bytes('AutoCAD Binary DXF\r\n\x1a\x00'))).toBe(true)
    })
    it('un vrai DXF sans contour fermé reste « aucun contour » (pas « pas un DXF »)', () => {
        expect(looksLikeDxf(bytes('0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n5\n21\n5\n0\nENDSEC\n0\nEOF\n'))).toBe(true)
        expect(importErrorOf({ ok: true, contours: [] })).toEqual({ key: ERROR_KEYS.noContour, detail: null })
        expect(ERROR_KEYS.notDxfContent).not.toBe(ERROR_KEYS.noContour)
    })
})

describe('pairDecimals', () => {
    it('largeur et hauteur partagent le même arrondi', () => {
        expect(pairDecimals('mm', 507.8, 507.9)).toBe(0)
        expect(pairDecimals('mm', 1000, 2000)).toBe(0)
        expect(pairDecimals('mm', 1000.5, 800)).toBe(1)
        expect(pairDecimals('inch', 508, 508)).toBe(0)
        expect(pairDecimals('inch', 25.4 * 10.5, 254)).toBe(3)
    })
})
