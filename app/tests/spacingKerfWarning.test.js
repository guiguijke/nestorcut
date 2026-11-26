import { describe, expect, it } from 'vitest'
import { DICTS, LOCALES, translate } from '../utils/i18n'
import { fmtLengthValue, unitLabel } from '../utils/units'

// L'avertissement « espacement sous 0,05 mm » suit l'unité d'affichage : en pouces
// il restait écrit en millimètres. Le seuil est 0,05 mm, donné par la page.
const text = (locale, unit) => translate('settings.spacingKerf', locale, {
    limit: fmtLengthValue(0.05, unit, 4, locale),
    unit: unitLabel(unit),
})

describe('avertissement d\'espacement sous le kerf', () => {
    it('aucune langue n\'écrit le seuil en dur', () => {
        for (const l of LOCALES) {
            const raw = DICTS[l]['settings.spacingKerf']
            expect(raw, l).toContain('{limit}')
            expect(raw, l).toContain('{unit}')
            expect(raw, l).not.toMatch(/0[.,]05/)
        }
    })

    it('en millimètres : 0.05 mm, virgule en français', () => {
        expect(text('en', 'mm')).toContain('Spacing below 0.05 mm:')
        expect(text('fr', 'mm')).toContain('Espacement < 0,05 mm :')
        expect(text('de', 'mm')).toContain('Abstand unter 0,05 mm:')
    })

    it('en pouces : le seuil est converti, plus de millimètre', () => {
        for (const l of LOCALES) {
            const t = text(l, 'inch')
            expect(t, l).not.toMatch(/\bmm\b/)
            expect(t, l).toMatch(/0[.,]002\s*"/)
        }
    })
})
