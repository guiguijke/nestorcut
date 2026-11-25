import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import en from '../utils/i18n/en'
import fr from '../utils/i18n/fr'
import de from '../utils/i18n/de'
import es from '../utils/i18n/es'
import it_ from '../utils/i18n/it'
import pt from '../utils/i18n/pt'
import { failureBannerText } from '../utils/failureReason'

// Messages de la tôle importée : refus du calcul (contour), forme absente ou illisible,
// plafond de types de tôle, tôle d'usine remplacée.

vi.mock('../composables/useLocale', () => ({
    useLocale: () => ({
        t: (key, params) => `${key}${params ? JSON.stringify(params) : ''}`,
        fmtNumber: (n) => String(n),
        locale: { value: 'en' },
    }),
}))

const DICTS = { en, fr, de, es, it: it_, pt }
const NEW_KEYS = {
    'project.sheetShapeMissing': ['name'],
    'localMode.partTooLargeShape': ['file', 'h', 'w'],
    'localMode.partTooLargeShapeMargin': ['file', 'h', 'margin', 'space', 'w'],
    'nest.error.tooManyFormats': ['max'],
    'settings.sheetFormatsLimit': ['max'],
    'settings.factorySheetReplaced': ['h', 'unit', 'w'],
    'localImport.unreadableSheetShape': [],
    'localImport.missingSheetShape': [],
}
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('dictionnaires : clés de la tôle importée', () => {
    it.each(Object.keys(NEW_KEYS))('%s : présente dans les six langues avec les mêmes paramètres', (key) => {
        for (const [lang, dict] of Object.entries(DICTS)) {
            expect(dict[key], `${lang}:${key}`).toBeTruthy()
            expect(placeholders(dict[key]), `${lang}:${key}`).toEqual(NEW_KEYS[key])
        }
    })

    it('les refus du calcul promettent le remboursement', () => {
        for (const [lang, dict] of Object.entries(DICTS)) {
            for (const key of ['localMode.partTooLargeShape', 'localMode.partTooLargeShapeMargin']) {
                expect(dict[key], `${lang}:${key}`).toMatch(/refund|rembours|erstatt|reembols|rimbors/i)
            }
        }
    })

    it('la forme absente : guillemets droits hors français (comme les voisines), « » en français', () => {
        for (const [lang, dict] of Object.entries(DICTS)) {
            if (lang === 'fr') expect(dict['project.sheetShapeMissing']).toContain('« {name} »')
            else expect(dict['project.sheetShapeMissing'], lang).toContain('"{name}"')
        }
    })

    it('le plafond parle de types de tôle, comme le bouton voisin, pas de « format »', () => {
        const words = { en: /sheet types/, fr: /types de tôle/, de: /Blechtyp/, es: /tipos de chapa/, it: /tipi di lamiera/, pt: /tipos de chapa/ }
        for (const [lang, dict] of Object.entries(DICTS)) {
            expect(dict['settings.sheetFormatsLimit'], lang).toMatch(new RegExp(words[lang].source, 'i'))
            expect(dict['nest.error.tooManyFormats'], lang).toMatch(new RegExp(words[lang].source, 'i'))
            expect(dict['settings.sheetFormatsLimit'], lang).not.toMatch(/format/i)
        }
    })

    it('« introuvable » dit aussi l\'autre onglet', () => {
        expect(en['localImport.missingSheetShape']).toMatch(/another tab/)
        expect(fr['localImport.missingSheetShape']).toMatch(/autre onglet/)
    })
})

describe('useLocalMode.mapError — refus de la tôle importée', () => {
    let mapError
    beforeEach(async () => {
        vi.resetModules()
        vi.stubGlobal('useState', (_k, init) => ref(init()))
        vi.stubGlobal('ref', ref)
        vi.stubGlobal('onBeforeUnmount', () => {})
        const { useLocalMode } = await import('../composables/useLocalMode')
        ;({ mapError } = useLocalMode('p'))
    })

    it('part_too_large avec shape : la phrase du contour, sans marge ni espacement', () => {
        const out = mapError('part_too_large', { params: { file: 'a.dxf', w: '150', h: '150', shape: true } })
        expect(out).toBe('localMode.partTooLargeShape{"file":"a.dxf","w":"150","h":"150"}')
    })

    it('part_too_large avec shape ET marge de courbes : la variante qui dit la marge', () => {
        const out = mapError('part_too_large', { params: { file: 'a', w: '1', h: '2', shape: true, space: 2, margin: '0.10' } })
        expect(out).toBe('localMode.partTooLargeShapeMargin{"file":"a","w":"1","h":"2","space":"2","margin":"0.10"}')
    })

    it('sans shape : les phrases d\'avant', () => {
        expect(mapError('part_too_large', { params: { file: 'a', w: '1', h: '2' } }).startsWith('localMode.partTooLarge{')).toBe(true)
        expect(mapError('part_too_large', { params: { file: 'a', w: '1', h: '2', space: 2, margin: '0.10' } }).startsWith('localMode.partTooLargeMargin')).toBe(true)
        expect(mapError('part_too_large')).toBe('localMode.partTooLargePlain')
    })

    it('sheet_shape_unreadable et sheet_shape_missing : deux phrases', () => {
        expect(mapError('sheet_shape_unreadable')).toBe('localImport.unreadableSheetShape')
        expect(mapError('sheet_shape_missing')).toBe('localImport.missingSheetShape')
    })

    it('après rechargement, le bandeau d\'un job en échec sheet_shape_unreadable', () => {
        const text = failureBannerText({ errorCode: 'sheet_shape_unreadable', information: 'sheet_shape_unreadable' }, (k) => k, (code) => mapError(code))
        expect(text).toBe('localImport.unreadableSheetShape')
    })
})
