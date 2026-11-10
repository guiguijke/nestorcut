import { describe, expect, it } from 'vitest'
import { parseChangelog, pickBullets, useAppChangelog } from '../utils/changelogParser'

const LANGS = ['fr', 'en', 'pt', 'it', 'de', 'es']

// Un journal à six blocs : chaque langue a un texte différent.
const SIX_BLOCKS = [
    '## V9.0.0',
    '',
    '*FR*',
    '',
    '- puce française',
    '',
    '*EN*',
    '',
    '- english bullet',
    '',
    '*PT*',
    '',
    '- ponto português',
    '',
    '*IT*',
    '',
    '- punto italiano',
    '',
    '*DE*',
    '',
    '- deutscher Punkt',
    '',
    '*ES*',
    '',
    '- punto español',
    '',
].join('\r\n')

// Une version sans bloc *DE* : l'allemand doit retomber sur l'anglais.
const NO_DE_BLOCK = [
    '## V8.0.0',
    '',
    '*FR*',
    '',
    '- puce française',
    '',
    '*EN*',
    '',
    '- english bullet',
    '',
    '*PT*',
    '',
    '- ponto português',
    '',
    '*IT*',
    '',
    '- punto italiano',
    '',
    '*ES*',
    '',
    '- punto español',
    '',
].join('\n')

describe('journal — parseur à six langues', () => {
    it('un texte à 6 blocs rend 6 listes distinctes', () => {
        const [entry] = parseChangelog(SIX_BLOCKS)
        const lists = LANGS.map((lang) => entry[lang])
        for (const list of lists) expect(list.length).toBe(1)
        const distinct = new Set(lists.map((l) => JSON.stringify(l)))
        expect(distinct.size).toBe(6)
    })

    it('le parseur extrait DE et ES', () => {
        const [entry] = parseChangelog(SIX_BLOCKS)
        expect(entry.de).toEqual(['deutscher Punkt'])
        expect(entry.es).toEqual(['punto español'])
    })

    it('pickBullets rend le bloc de la langue courante, parmi les six', () => {
        const [entry] = parseChangelog(SIX_BLOCKS)
        expect(pickBullets(entry, 'fr')).toEqual(['puce française'])
        expect(pickBullets(entry, 'en')).toEqual(['english bullet'])
        expect(pickBullets(entry, 'pt')).toEqual(['ponto português'])
        expect(pickBullets(entry, 'it')).toEqual(['punto italiano'])
        expect(pickBullets(entry, 'de')).toEqual(['deutscher Punkt'])
        expect(pickBullets(entry, 'es')).toEqual(['punto español'])
    })

    it('une version sans bloc DE rend l\'anglais en allemand', () => {
        const [entry] = parseChangelog(NO_DE_BLOCK)
        expect(entry.de).toEqual(['english bullet'])
        expect(pickBullets(entry, 'de')).toEqual(['english bullet'])
    })

    it('pickBullets se replie sur l\'anglais quand le bloc de la langue est vide', () => {
        const entry = { title: 'V1', fr: [], en: ['fallback'], pt: [], it: [], de: [], es: [] }
        expect(pickBullets(entry, 'fr')).toEqual(['fallback'])
        expect(pickBullets(entry, 'es')).toEqual(['fallback'])
    })

    it('le vrai CHANGELOG.md : la première version a 6 listes non vides, de même longueur', () => {
        const [first] = useAppChangelog()
        const lengths = LANGS.map((lang) => first[lang].length)
        for (const lang of LANGS) expect(first[lang].length, `[${lang}] vide`).toBeGreaterThan(0)
        expect(new Set(lengths).size, `longueurs ${lengths.join(',')}`).toBe(1)
    })
})
