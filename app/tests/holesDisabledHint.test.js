import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { holesDisabledHintVisible, HOLES_HINT_FROM_MM } from '../utils/holesHint'
import { SPACING_MARGIN_CAP_MM, channelsUsable } from '../composables/localPayloadBuilder'
import en from '../utils/i18n/en'
import fr from '../utils/i18n/fr'
import de from '../utils/i18n/de'
import es from '../utils/i18n/es'
import it_ from '../utils/i18n/it'
import pt from '../utils/i18n/pt'

describe('avertissement : imbrication dans les trous désactivée', () => {
    it('se déclenche à 2,38 mm (2,5 − marge maximale 0,12)', () => {
        expect(HOLES_HINT_FROM_MM).toBeCloseTo(2.5 - SPACING_MARGIN_CAP_MM, 12)
        expect(holesDisabledHintVisible(2.37, true)).toBe(false)
        expect(holesDisabledHintVisible(2.38, true)).toBe(true)
        expect(holesDisabledHintVisible(2.4, true)).toBe(true)
        expect(holesDisabledHintVisible(2.5, true)).toBe(true)
    })

    it('ne s’affiche pas quand le remplissage des trous est coupé', () => {
        expect(holesDisabledHintVisible(3, false)).toBe(false)
    })

    it('à 2,38 demandé, une marge pleine (0,12) ferme bien les canaux : l’alerte est vraie', () => {
        expect(channelsUsable(2.38 + SPACING_MARGIN_CAP_MM)).toBe(false)
        expect(channelsUsable(2.37 + SPACING_MARGIN_CAP_MM)).toBe(true)
    })

    it('les six langues parlent de 2,38 et non plus de 2,4', () => {
        for (const d of [en, fr, de, es, it_, pt]) {
            const text = d['settings.spacingHolesDisabled']
            expect(text).toMatch(/2[.,]38/)
            expect(text).not.toMatch(/2[.,]4\b/)
        }
    })

    it('le composant utilise la règle partagée', () => {
        const vue = readFileSync(new URL('../components/MainSettings.vue', import.meta.url), 'utf8')
        expect(vue).toContain('holesDisabledHintVisible(effectiveSpace.value, unref(params).fillHoles !== false)')
        expect(vue).not.toContain('effectiveSpace.value > 2.4')
    })
})
