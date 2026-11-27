import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildLocalPayload } from '../composables/localPayloadBuilder'
import { fmtLengthMax, fmtLengthValue, floorLengthMm, displayToMm } from '../utils/units'
import { minSheetCase } from '../utils/overhangView'
import { edgeShiftMm } from '../utils/spacingParams'
import { firstPartFittingNoSheet } from '../utils/partSheetFit'

// Écran de la distance au bord : maxima annoncés, message « pièce trop grande »,
// champ sans inputmode, valeur tapée au séparateur de la langue.

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
const file = (w, h) => ({
    slug: 'a.dxf', name: 'A.dxf', count: 1, rotations: [0],
    parts: [{ coordinates: rect(w, h), holes: [], handles: ['A'], color: null, width: w, height: h }],
})
const profile = { timeBudgetSec: 13, vcores: 1, maxDirections: 1, level: 'browser' }
const build = (files, params) => buildLocalPayload(
    { files, params: { directions: ['left'], alternativesCount: 1, ...params }, profile }, {},
)
const read = (str) => Number(str.replace(',', '.'))

describe('fmtLengthMax : arrondi vers le bas à la précision affichée', () => {
    it('mm : 12,37 -> 12,3 ; 20,95 -> 20,9 (jamais 21) ; point en en, virgule en fr', () => {
        expect(fmtLengthMax(12.37, 'mm', undefined, 'fr')).toBe('12,3')
        expect(fmtLengthMax(20.95, 'mm', undefined, 'fr')).toBe('20,9')
        expect(fmtLengthMax(2.475, 'mm', undefined, 'en')).toBe('2.4')
        expect(fmtLengthValue(20.95, 'mm', undefined, 'en')).not.toBe(fmtLengthMax(20.95, 'mm', undefined, 'en'))
    })
    it('un nombre déjà rond reste rond (pas de perte au flottant)', () => {
        for (const v of [50, 12.6, 0.3, 4.5, 1000.1]) expect(read(fmtLengthMax(v, 'mm', undefined, 'en'))).toBe(v)
    })
    it('pouce : 23,57 mm -> 0.927" (pas 0.928), puis le plafond mm correspondant', () => {
        expect(fmtLengthMax(23.57, 'inch', undefined, 'en')).toBe('0.927')
        const mm = floorLengthMm(23.57, 'inch')
        expect(mm).toBeLessThanOrEqual(23.57)
        expect(23.57 - mm).toBeLessThan(0.0254)
    })
    it('non fini : tiret', () => {
        expect(fmtLengthMax(Infinity, 'mm', undefined, 'en')).toBe('—')
    })
})

describe('le maximum annoncé, retapé, est accepté par le constructeur', () => {
    const sheets = [{ width: 1000, height: 1000, count: 1 }]
    for (const unit of ['mm', 'inch']) {
        for (const w of [952.86, 952.91, 960.55]) {
            it(`bord trop grand (${unit}, pièce ${w}) : la valeur affichée passe`, async () => {
                const files = [file(w, 100)]
                const err = await build(files, { sheets, space: 2, edgeDistance: 400 }).catch((e) => e)
                expect(err.message).toBe('edge_too_large')
                const shown = fmtLengthMax(err.__edge.maxEdgeMm, unit, undefined, 'fr')
                const typedMm = displayToMm(read(shown), unit)
                const ok = await build(files, { sheets, space: 2, edgeDistance: typedMm })
                expect(ok.payload).toBeTruthy()
            })
        }
        it(`surplomb trop grand (${unit}) : la valeur affichée passe`, async () => {
            const files = [file(100, 41.94)]
            const err = await build(files, { sheets, space: 2, edgeDistance: -30 }).catch((e) => e)
            expect(err.message).toBe('edge_overhang_too_large')
            const shown = fmtLengthMax(err.__edge.maxOverhangMm, unit, undefined, 'fr')
            const typedMm = displayToMm(-read(shown), unit)
            const ok = await build(files, { sheets, space: 2, edgeDistance: typedMm })
            expect(ok.payload).toBeTruthy()
        })
    }
})

describe('message « pièce trop grande » : le bord n’est nommé que s’il est la cause', () => {
    const sheets = [{ width: 1000, height: 2000, count: 1 }]
    const run = (files, edgeMm) => {
        const args = { files, sheets, toMm: (v) => v, rotationCount: 4 }
        const withEdge = firstPartFittingNoSheet({ ...args, ...(edgeMm !== null ? { edgeMm } : {}) })
        const plain = firstPartFittingNoSheet(args)
        return minSheetCase(edgeMm, withEdge, plain)
    }
    const withParts = (...dims) => dims.map(([w, h], i) => ({ ...file(w, h), name: `P${i}.dxf` }))
    it('pièce trop grande même à bord 0 : message simple', () => {
        const r = run(withParts([2100, 50]), 5)
        expect(r.edge).toBe(false)
        expect(r.part.name).toBe('P0.dxf')
    })
    it('pièce qui ne manque que par le bord : message du bord', () => {
        const r = run(withParts([900, 1900]), 60)
        expect(r.edge).toBe(true)
        expect(r.part.name).toBe('P0.dxf')
    })
    it('deux pièces : celle qui bloque sans bord est nommée, pas celle du bord', () => {
        const r = run(withParts([900, 1900], [2100, 50]), 60)
        expect(r.edge).toBe(false)
        expect(r.part.name).toBe('P1.dxf')
    })
    it('bord vide : message simple', () => {
        const r = run(withParts([2100, 50]), null)
        expect(r.edge).toBe(false)
        expect(r.part.name).toBe('P0.dxf')
    })
})

describe('bord égal à l’espacement : comme un champ vide', () => {
    it('edgeShiftMm vaut 0 (la page ne passe alors ni edge ni contrôle propre au bord)', () => {
        expect(edgeShiftMm(2, 2)).toBe(0)
        expect(edgeShiftMm(0, 0)).toBe(0)
    })
    it('la page annule le bord via edgeShiftMm', () => {
        const src = readFileSync(resolve(__dirname, '../pages/project/[slug].vue'), 'utf8')
        expect(src).toMatch(/edgeShiftMm\(spaceMm, edgeMm\) === 0 \? null : edgeMm/)
    })
})

describe('gabarits', () => {
    const settings = readFileSync(resolve(__dirname, '../components/MainSettings.vue'), 'utf8')
    it('le champ du bord n’a pas d’inputmode (pas de touche « moins » sur iPhone sinon)', () => {
        const i = settings.indexOf('data-testid="settings-edge"')
        expect(i).toBeGreaterThan(0)
        const open = settings.lastIndexOf('<InputField', i)
        const tag = settings.slice(open, i)
        expect(tag).not.toMatch(/inputmode/i)
    })
    it('l’indication du surplomb formate la valeur tapée avec la langue, sans arrondi', () => {
        expect(settings).not.toMatch(/String\(Math\.abs\(n\)\)/)
        expect(settings).toMatch(/fmtLengthValue\(displayToMm\(Math\.abs\(n\)\), 6\)/)
        expect(fmtLengthValue(1.25, 'mm', 6, 'fr')).toBe('1,25')
        expect(fmtLengthValue(displayToMm(0.0625, 'inch'), 'inch', 6, 'fr')).toBe('0,0625')
    })
})

describe('« Nos serveurs » : champ actif, grisé avec sa phrase', () => {
    const settings = readFileSync(resolve(__dirname, '../components/MainSettings.vue'), 'utf8')
    const page = readFileSync(resolve(__dirname, '../pages/project/[slug].vue'), 'utf8')
    it('le champ se grise d’après edgeBlock (démo, DWG, calcul navigateur coupé), plus d’après le seul projet local', () => {
        expect(settings).toMatch(/const edgeDisabled = computed\(\(\) => edgeBlock\.value !== null\)/)
        expect(settings).not.toMatch(/edgeDisabled = computed\(\(\) => !isLocalProject/)
    })
    it('chaque cas a sa phrase, et la ligne « calculé sur cet appareil » est sur le champ actif', () => {
        expect(settings).toMatch(/'demo'\) return t\('settings\.edgeNoDemo'\)/)
        expect(settings).toMatch(/'dwg'\) return t\('settings\.edgeNoDwg'\)/)
        expect(settings).toMatch(/'off'\) return t\('settings\.edgeLocalOnly'\)/)
        expect(settings).toMatch(/data-testid="settings-edge-computed-here"/)
        expect(settings).toMatch(/!isLocalProject\.value && edgeBlock\.value === null/)
    })
    it('la page ne lit aucun bord quand le champ est grisé (requête, contrôles de page)', () => {
        expect(page).toMatch(/if \(unref\(filesGetters\.edgeBlock\) !== null\) return null/)
    })
    it('la page passe sa fonction de chiffres au bandeau d’échec', () => {
        expect(page).toMatch(/edgeParams: edgeRefusalParams/)
    })
})
