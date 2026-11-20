import { describe, expect, it } from 'vitest'
import {
    effectiveRotationCount,
    initialOtherMode,
    pickRotationSegment,
    rotationSegment,
} from '../utils/rotationChoice'

describe('rotationChoice : « Autre » collant', () => {
    it('taper 1 puis 12 dans « Autre » garde le champ ouvert', () => {
        // L'utilisateur est dans « Autre » (mode collant) : 1 est un préréglage mais le champ reste.
        expect(rotationSegment('1', true)).toBe('other')
        expect(rotationSegment('12', true)).toBe('other')
        // Sans état collant (ancien comportement), « 1 » ferme le champ.
        expect(rotationSegment('1', false)).toBe(1)
    })

    it('champ vidé ou 0 pendant la frappe : reste dans « Autre », valeur effective 4', () => {
        expect(rotationSegment('', true)).toBe('other')
        expect(rotationSegment('0', true)).toBe('other')
        expect(effectiveRotationCount('')).toBe(4)
        expect(effectiveRotationCount('0')).toBe(4)
    })

    it('un préréglage tapé dans le champ (4) garde le champ ouvert', () => {
        expect(rotationSegment('4', true)).toBe('other')
    })

    it('chargement : « Autre » seulement si la valeur enregistrée n\'est pas un préréglage', () => {
        expect(initialOtherMode(4)).toBe(false)
        expect(initialOtherMode('8')).toBe(false)
        expect(initialOtherMode(12)).toBe(true)
        expect(rotationSegment(12, initialOtherMode(12))).toBe('other')
        expect(rotationSegment(2, initialOtherMode(2))).toBe(2)
    })

    it('bornes 1..360 comme le serveur', () => {
        expect(effectiveRotationCount('12')).toBe(12)
        expect(effectiveRotationCount('-5')).toBe(1)
        expect(effectiveRotationCount('999')).toBe(360)
        expect(effectiveRotationCount('12.7')).toBe(12)
    })

    it('clic sur un segment : préréglage ferme « Autre », « Autre » ouvre sans écraser', () => {
        expect(pickRotationSegment(8, '12', true)).toEqual({ otherMode: false, count: 8 })
        expect(pickRotationSegment('other', 4, false)).toEqual({ otherMode: true, count: 3 })
        expect(pickRotationSegment('other', 12, false)).toEqual({ otherMode: true, count: undefined })
        expect(pickRotationSegment('other', '1', true)).toEqual({ otherMode: true, count: undefined })
    })
})
