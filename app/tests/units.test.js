// Relecture A L2 (20/09) — les LONGUEURS suivent la langue, comme les
// aires depuis L1. Le point décimal « 1040.4 mm » était un défaut produit
// EN PRODUCTION FRANÇAISE, sorti de la capture italienne du paquet A
// (badge « Distanza ≥ 5.87 mm » avec un point, là où la carte écrivait
// « 1,24 m² » avec une virgule). Verrou exigé par la relecture :
// fmtLength(1040.4, 'mm', 'it'|'fr') ⇒ « 1040,4 mm », 'en' ⇒ « 1040.4 mm ».
import { describe, expect, it } from 'vitest'
import { fmtLength, fmtLengthValue } from '../utils/units'

describe('fmtLength suit la locale (relecture A L2)', () => {
    it('la virgule décimale suit la langue de l\'application', () => {
        expect(fmtLength(1040.4, 'mm', 'it')).toBe('1040,4 mm')
        expect(fmtLength(1040.4, 'mm', 'fr')).toBe('1040,4 mm')
        expect(fmtLength(1040.4, 'mm', 'pt')).toBe('1040,4 mm')
        expect(fmtLength(1040.4, 'mm', 'en')).toBe('1040.4 mm')
    })

    it('l\'espacement du badge : 5,87 en FR/IT, 5.87 en EN', () => {
        expect(fmtLengthValue(5.87, 'mm', 2, 'it')).toBe('5,87')
        expect(fmtLengthValue(5.87, 'mm', 2, 'fr')).toBe('5,87')
        expect(fmtLengthValue(5.87, 'mm', 2, 'en')).toBe('5.87')
    })

    it('sans locale (chemins machine — export CSV), le point reste', () => {
        expect(fmtLengthValue(1040.4, 'mm')).toBe('1040.4')
        expect(fmtLengthValue(5.87, 'mm', 2)).toBe('5.87')
    })

    it('zéros de queue trimmés, entiers entiers, pouces localisés', () => {
        expect(fmtLengthValue(1000.0, 'mm', undefined, 'fr')).toBe('1000')
        // 48,5 mm = 1,909" — la valeur d'entrée est TOUJOURS en mm.
        expect(fmtLengthValue(48.5, 'inch', undefined, 'en')).toBe('1.909')
        expect(fmtLengthValue(48.9, 'inch', undefined, 'fr')).toBe('1,925')
    })
})
