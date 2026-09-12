/**
 * Verrous du lot E1-bis — l'aperçu du dessin posé sur une tôle.
 *
 * Ce qui est mesuré : la poignée règle la LARGEUR CIBLE (donc le mode
 * `width` du panneau, pas une seconde arithmétique), changer de tôle ne
 * touche pas le facteur, le hors-tôle est signalé dans les deux
 * orientations de la tôle, et une dépose à panneau OUVERT ne crée aucune
 * fiche avant validation — panneau fermé, rien n'est lu de plus.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ reads: 0 }))

vi.mock('../composables/geometryClient', () => ({
    geoImportFile: vi.fn(async () => {
        state.reads += 1
        return { parts: [], warnings: [], findings: [] }
    }),
    geoCanonicalDxf: vi.fn(async () => new Uint8Array([1])),
    geoCanonicalDxfScaled: vi.fn(async () => new Uint8Array([2])),
    geoCanonicalDxfPart: vi.fn(async () => new Uint8Array([3])),
    IMPORT_MAX_ENTITIES: 10000,
    IMPORT_TIME_BUDGET_MS: 20000,
}))

import {
    advancedImportOptions,
    drawingExtent,
    fitsSheet,
    needsPreview,
    resolveScale,
    scaleFromHandle,
    useAdvancedImport,
} from '../composables/advancedImport'
import { translate } from '../utils/i18n'

const rect = (w, h, x = 0, y = 0) => ({
    coordinates: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]],
    holes: [],
    width: w,
    height: h,
})

// Le logo du collègue : étendue mesurée 2834,34 × 230,6 mm.
const LOGO = [rect(1612.61, 230.6), rect(1000, 200, 1834.34, 0)]

beforeEach(() => {
    state.reads = 0
    useAdvancedImport().reset()
})

describe('E1-bis — la poignée', () => {
    it('donne le facteur « largeur cible / largeur mesurée »', () => {
        // 900 mm visés sur un dessin de 2834,34 mm : facteur 0,318.
        const f = scaleFromHandle(900, 2834.34)
        expect(Math.round(f * 1000) / 1000).toBe(0.318)
    })

    it('ne multiplie jamais par l’infini', () => {
        expect(scaleFromHandle(900, 0)).toBe(1)
        expect(scaleFromHandle(0, 100)).toBe(1)
        expect(scaleFromHandle(Number.NaN, 100)).toBe(1)
    })

    it('écrit le mode « largeur cible » du panneau, pas une autre échelle', () => {
        const adv = useAdvancedImport()
        adv.toggleOpen()
        adv.dragToWidth(900)
        expect(adv.state.mode).toBe('width')
        expect(adv.state.value).toBe(900)
        // La chaîne d'import résout ce mode sur l'étendue MESURÉE du dessin.
        const opts = advancedImportOptions()
        expect(opts.scaleTarget).toEqual({ mode: 'width', mm: 900 })
        const f = resolveScale(opts, drawingExtent(LOGO))
        expect(Math.round(f * 1000) / 1000).toBe(0.318)
    })
})

describe('E1-bis — la tôle est une référence', () => {
    it('changer de tôle ne change pas le facteur', () => {
        const adv = useAdvancedImport()
        adv.toggleOpen()
        adv.dragToWidth(900)
        const before = advancedImportOptions()
        adv.setSheet(1500, 3000)
        expect(advancedImportOptions()).toEqual(before)
        adv.setSheet(1000, 2000)
        expect(advancedImportOptions()).toEqual(before)
    })

    it('le hors-tôle est signalé, dans les deux orientations de la tôle', () => {
        const extent = drawingExtent(LOGO) // 2834,34 × 230,6
        // Tel quel sur 1000 × 2000 : trop large, MAIS la tôle peut se poser
        // dans l'autre sens — 2834 > 2000 dans les deux cas : hors tôle.
        expect(fitsSheet(extent, 1, { width: 1000, height: 2000 })).toBe(false)
        // À 0,318, l'étendue tombe à 901 × 73 : ça tient.
        expect(fitsSheet(extent, 0.318, { width: 1000, height: 2000 })).toBe(true)
        // Un dessin de 1500 × 900 tient sur une tôle 1000 × 2000 posée en
        // travers (1500 ≤ 2000 et 900 ≤ 1000).
        expect(fitsSheet({ width: 1500, height: 900 }, 1, { width: 1000, height: 2000 })).toBe(true)
    })

    it('une tôle absurde ne fait pas crier au hors-tôle', () => {
        expect(fitsSheet({ width: 10, height: 10 }, 1, null)).toBe(true)
        expect(fitsSheet({ width: 10, height: 10 }, 1, { width: 0, height: 0 })).toBe(true)
    })

    it('la tôle refuse les valeurs impossibles', () => {
        const adv = useAdvancedImport()
        adv.setSheet(1000, 2000)
        expect(adv.preview.sheet).toEqual({ width: 1000, height: 2000 })
        adv.setSheet(0, 2000)
        expect(adv.preview.sheet).toBeNull()
    })
})

describe('E1-bis — la dépose', () => {
    it('panneau FERMÉ : aucun aperçu, donc aucune lecture de plus', async () => {
        expect(needsPreview()).toBe(false)
        // (la chaîne d'import, elle, est verrouillée par advancedImport.test.js)
        expect(state.reads).toBe(0)
    })

    it('panneau OUVERT : le fichier est lu UNE fois et aucune fiche n’est créée', async () => {
        const adv = useAdvancedImport()
        adv.toggleOpen()
        expect(needsPreview()).toBe(true)
        const pending = await adv.stage([{ name: 'logo.dxf', arrayBuffer: async () => new ArrayBuffer(3) }], {
            projectSlug: 'p1',
            readFile: async () => {
                state.reads += 1
                return { parts: LOGO, warnings: [], findings: [] }
            },
        })
        expect(state.reads).toBe(1)
        expect(pending).toHaveLength(1)
        expect(pending[0].name).toBe('logo.dxf')
        expect(pending[0].projectSlug).toBe('p1')
        expect(Math.round(pending[0].extent.width * 100) / 100).toBe(2834.34)
        expect(adv.preview.loading).toBe(false)
    })

    it('annuler ne garde rien', async () => {
        const adv = useAdvancedImport()
        adv.toggleOpen()
        await adv.stage([{ name: 'logo.dxf' }], {
            readFile: async () => ({ parts: LOGO }),
        })
        adv.setUseSheet(true)
        adv.cancel()
        expect(adv.preview.pending).toEqual([])
        expect(adv.preview.useSheet).toBe(false)
        expect(adv.preview.sheet).toBeNull()
    })

    it('une lecture qui échoue laisse un message, pas une exception', async () => {
        const adv = useAdvancedImport()
        adv.toggleOpen()
        await adv.stage([{ name: 'casse.dxf' }], {
            readFile: async () => { throw new Error('localImport.parseError') },
        })
        expect(adv.preview.error).toBe('localImport.parseError')
        expect(adv.preview.loading).toBe(false)
        expect(adv.preview.pending).toEqual([])
    })
})

describe('E1-bis — libellés', () => {
    it('les neuf clés de l’aperçu existent en FR et EN', () => {
        const keys = [
            'importPreview.reading', 'importPreview.title', 'importPreview.batch',
            'importPreview.outside', 'importPreview.factor', 'importPreview.sheet',
            'importPreview.useSheet', 'importPreview.confirm', 'importPreview.cancel',
        ]
        for (const locale of ['fr', 'en']) {
            for (const k of keys) {
                const v = translate(k, locale)
                expect(v, `${k} (${locale})`).not.toBe(k)
            }
        }
        expect(translate('importPreview.factor', 'fr', { v: '0.318' })).toContain('0.318')
        expect(translate('importPreview.batch', 'en', { n: 3 })).toContain('3')
    })
})
