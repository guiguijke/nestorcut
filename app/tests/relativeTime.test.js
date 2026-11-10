import { describe, expect, it } from 'vitest'
import { DICTS, LOCALES, translate } from '../utils/i18n'
import { relativeTimeParts } from '../utils/relativeTime'

describe('heure relative des projets — clé choisie', () => {
    it('moins d\'une minute : « à l\'instant »', () => {
        expect(relativeTimeParts(0)).toEqual({ key: 'time.justNow', n: 0 })
    })

    it('59 minutes : minutes au pluriel', () => {
        expect(relativeTimeParts(59)).toEqual({ key: 'time.minAgo', n: 59 })
    })

    it('1 heure : singulier dédié', () => {
        expect(relativeTimeParts(60)).toEqual({ key: 'time.hourAgo', n: 1 })
    })

    it('2 heures : pluriel', () => {
        expect(relativeTimeParts(120)).toEqual({ key: 'time.hoursAgo', n: 2 })
    })

    it('1 jour : singulier dédié', () => {
        expect(relativeTimeParts(1440)).toEqual({ key: 'time.dayAgo', n: 1 })
    })

    it('2 jours : pluriel', () => {
        expect(relativeTimeParts(2880)).toEqual({ key: 'time.daysAgo', n: 2 })
    })
})

describe('heure relative — clé time.hourAgo dans les six langues', () => {
    it('chaque dictionnaire a le singulier, sans variable {n} résiduelle', () => {
        for (const lang of LOCALES) {
            const value = DICTS[lang]['time.hourAgo']
            expect(typeof value, `[${lang}]`).toBe('string')
            expect(value, `[${lang}]`).not.toContain('{n}')
            expect(translate('time.hourAgo', lang), `[${lang}]`).toMatch(/1/)
        }
    })

    it('en anglais : « 1 hour ago », jamais « 1 hours ago »', () => {
        expect(translate('time.hourAgo', 'en')).toBe('1 hour ago')
        expect(translate('time.hoursAgo', 'en', { n: 2 })).toBe('2 hours ago')
    })
})
