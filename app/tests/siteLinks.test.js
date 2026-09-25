// Lot M3 : les liens du site vitrine ET de la documentation dans la langue.
// Verrou de préfixe : l'anglais à la racine, les cinq autres sous leur
// préfixe, même règle que docsHelpUrl. Ce verrou ÉCHOUE sur l'ancien code
// (liens anglais en dur dans MainHeader.vue).
import { describe, expect, it } from 'vitest'
import { siteUrl, docsHomeUrl } from '../utils/docsLinks'

describe('M3 — liens du site et de la doc dans la langue', () => {
    const PREFIXED = ['fr', 'pt', 'it', 'de', 'es']

    it('siteUrl : l\'anglais à la racine, les cinq autres sous préfixe', () => {
        expect(siteUrl('en', 'features')).toBe('https://nestorcut.com/#features')
        expect(siteUrl('en')).toBe('https://nestorcut.com/')
        for (const lang of PREFIXED) {
            expect(siteUrl(lang, 'faq')).toBe(`https://nestorcut.com/${lang}/#faq`)
            expect(siteUrl(lang)).toBe(`https://nestorcut.com/${lang}/`)
        }
        // repli : locale inconnue -> anglais
        expect(siteUrl('zz')).toBe('https://nestorcut.com/')
    })

    it('docsHomeUrl : l\'accueil de la doc dans la langue', () => {
        expect(docsHomeUrl('en')).toBe('https://nestorcut.com/docs/')
        for (const lang of PREFIXED) {
            expect(docsHomeUrl(lang)).toBe(`https://nestorcut.com/${lang}/docs/`)
        }
        expect(docsHomeUrl('zz')).toBe('https://nestorcut.com/docs/')
    })

    it('nav.docs existe dans les six dictionnaires', async () => {
        const { translate, LOCALES } = await import('../utils/i18n')
        for (const lang of LOCALES) {
            const label = translate('nav.docs', lang)
            expect(label, `[${lang}] nav.docs doit exister`).not.toBe('nav.docs')
            expect(label.length).toBeGreaterThan(3)
        }
    })

    it('PREUVE que le verrou mord : les anciens liens anglais en dur doivent être absents', async () => {
        const fs = await import('node:fs')
        const src = fs.readFileSync('app/components/MainHeader.vue', 'utf8')
        expect(src, 'aucun lien anglais nu vers nestorcut.com/#').not.toMatch(/https:\/\/nestorcut\.com\/#/)
        expect(src, 'le code doit importer siteUrl').toContain('siteUrl')
        expect(src, 'le code doit importer docsHomeUrl').toContain('docsHomeUrl')
    })
})
