/**
 * Verrous du lot E4 — l'aperçu d'échelle ouvert SUR UNE FICHE (E1-bis
 * restructuré par E4-b/E4-d) : la poignée et les trois champs disent la même
 * échelle (une seule source de vérité : le facteur), la tôle est une
 * référence qui ne touche pas au facteur, et rien n'est appliqué depuis ce
 * composable.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
    drawingExtent, fitsSheet, resolveScale, scaleFromHandle, useAdvancedImport,
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
    useAdvancedImport().reset()
})

describe('E4-b — la poignée et les champs disent la MÊME échelle', () => {
    it('la poignée donne le facteur « largeur cible / largeur mesurée »', () => {
        // 900 mm visés sur un dessin de 2834,34 mm : facteur 0,318.
        const f = scaleFromHandle(900, 2834.34)
        expect(Math.round(f * 1000) / 1000).toBe(0.318)
    })

    it('ne multiplie jamais par l’infini', () => {
        expect(scaleFromHandle(900, 0)).toBe(1)
        expect(scaleFromHandle(0, 100)).toBe(1)
        expect(scaleFromHandle(Number.NaN, 100)).toBe(1)
    })

    it('la poignée écrit le mode « largeur cible », pas une autre échelle', () => {
        const adv = useAdvancedImport()
        adv.setTargetWidth(900)
        expect(adv.state.mode).toBe('width')
        expect(adv.state.value).toBe(900)
        const opts = adv.targetOptions()
        expect(opts.scaleTarget).toEqual({ mode: 'width', mm: 900 })
        expect(Math.round(resolveScale(opts, drawingExtent(LOGO)) * 1000) / 1000).toBe(0.318)
    })

    it('largeur, hauteur et facteur : trois saisies, un seul état', () => {
        const adv = useAdvancedImport()
        adv.setTargetHeight(115.3)
        expect(adv.targetOptions().scaleTarget).toEqual({ mode: 'height', mm: 115.3 })
        adv.setFactor(0.5)
        expect(adv.targetOptions()).toEqual({ scale: 0.5 })
        adv.setTargetWidth(1000)
        expect(adv.targetOptions().scaleTarget).toEqual({ mode: 'width', mm: 1000 })
    })

    it('une valeur absurde est ignorée, pas interprétée', () => {
        const adv = useAdvancedImport()
        adv.setFactor(2)
        adv.setFactor(0)
        adv.setFactor(Number.NaN)
        adv.setTargetWidth(-5)
        expect(adv.targetOptions()).toEqual({ scale: 2 })
    })
})

describe('E4-b — ouverture sur une fiche', () => {
    it('stage la fiche : géométrie connue, étendue mesurée, réglages NEUFS', () => {
        const adv = useAdvancedImport()
        adv.setFactor(3)
        adv.openFicheScale({ slug: 'f-abc.dxf', name: 'logo.dxf', parts: LOGO })
        expect(adv.preview.pending).toHaveLength(1)
        expect(adv.preview.pending[0].ficheSlug).toBe('f-abc.dxf')
        expect(adv.preview.pending[0].name).toBe('logo.dxf')
        expect(Math.round(adv.preview.pending[0].extent.width * 100) / 100).toBe(2834.34)
        // Le choix vaut pour CETTE application : la précédente ne décide pas.
        expect(adv.state.mode).toBe('factor')
        expect(adv.state.value).toBe(1)
    })

    it('annuler ne garde rien', () => {
        const adv = useAdvancedImport()
        adv.openFicheScale({ slug: 'f-abc.dxf', name: 'logo.dxf', parts: LOGO })
        adv.setUseSheet(true)
        adv.cancel()
        expect(adv.preview.pending).toEqual([])
        expect(adv.preview.useSheet).toBe(false)
        expect(adv.preview.sheet).toBeNull()
    })
})

describe('E1-bis — la tôle est une référence', () => {
    it('changer de tôle ne change pas le facteur', () => {
        const adv = useAdvancedImport()
        adv.setTargetWidth(900)
        const before = adv.targetOptions()
        adv.setSheet(1500, 3000)
        expect(adv.targetOptions()).toEqual(before)
        adv.setSheet(1000, 2000)
        expect(adv.targetOptions()).toEqual(before)
    })

    it('le hors-tôle est signalé, dans les deux orientations de la tôle', () => {
        const extent = drawingExtent(LOGO) // 2834,34 × 230,6
        expect(fitsSheet(extent, 1, { width: 1000, height: 2000 })).toBe(false)
        expect(fitsSheet(extent, 0.318, { width: 1000, height: 2000 })).toBe(true)
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

describe('E4 — libellés', () => {
    it('les clés de l’aperçu et des actions existent en FR et EN', () => {
        const keys = [
            'importPreview.reading', 'importPreview.title',
            'importPreview.targetWidth', 'importPreview.targetHeight',
            'importPreview.factorLabel', 'importPreview.outside',
            'importPreview.factor', 'importPreview.sheet',
            'importPreview.useSheet', 'importPreview.apply', 'importPreview.cancel',
            'files.scaleAction', 'files.resetScaleAction', 'files.explodeAction',
            'files.explodeConfirmText', 'files.explodeConfirmOk',
        ]
        for (const locale of ['fr', 'en']) {
            for (const k of keys) {
                const v = translate(k, locale)
                expect(v, `${k} (${locale})`).not.toBe(k)
            }
        }
        expect(translate('importPreview.factor', 'fr', { v: '0.318' })).toContain('0.318')
        expect(translate('files.explodeConfirmText', 'en', { n: 17 })).toContain('17')
    })
})
