import { describe, expect, it } from 'vitest'
import { formatNumber } from '../utils/i18n'
import { formatElapsed } from '../utils/elapsedFormat'

const NBSP = ' '

describe('temps écoulé — séparateur décimal par langue', () => {
    it('français : « 2,1 s » avec une espace insécable avant s', () => {
        expect(formatElapsed(2.1, 'fr')).toBe(`2,1${NBSP}s`)
    })

    it('anglais : « 2.1s » inchangé', () => {
        expect(formatElapsed(2.1, 'en')).toBe('2.1s')
    })

    it('zéro et valeurs invalides : une décimale, comme avant', () => {
        expect(formatElapsed(0, 'en')).toBe('0.0s')
        expect(formatElapsed(-3, 'en')).toBe('0.0s')
        expect(formatElapsed(NaN, 'en')).toBe('0.0s')
        expect(formatElapsed(0, 'fr')).toBe(`0,0${NBSP}s`)
    })

    it('forme en minutes : 2m05.3 en anglais, 2m05,3 en français', () => {
        expect(formatElapsed(125.3, 'en')).toBe('2m05.3')
        expect(formatElapsed(125.3, 'fr')).toBe('2m05,3')
    })

    it('pas de « 1m60.0 » : l\'arrondi au dixième reporte la minute', () => {
        expect(formatElapsed(59.96, 'en')).toBe('1m00.0')
        expect(formatElapsed(65, 'fr')).toBe('1m05,0')
    })
})

describe('formatNumber — décimales minimales (option ajoutée)', () => {
    it('sans option, le comportement est inchangé', () => {
        expect(formatNumber(5, 'en', 1)).toBe('5')
        expect(formatNumber(2.1, 'fr', 1)).toBe('2,1')
    })

    it('avec minDigits, les décimales sont toujours présentes', () => {
        expect(formatNumber(5, 'en', 1, 1)).toBe('5.0')
        expect(formatNumber(5, 'fr', 1, 1)).toBe('5,0')
    })
})
