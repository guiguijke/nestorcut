// Lot D5 — les liens « ? » vers la documentation.
//
// Le helper est écrit pour SIX codes : seules les langues PUBLIÉES
// (DOCS_LANGS) servent leur préfixe ; toute autre — pt, it, de, es
// avant leur publication, ou une locale inconnue — REPIE sur
// l'anglais, jamais sur une page absente. Les ancres sont dépendantes
// de la langue (Starlight reprend les titres traduits) : chaque sujet
// porte son ancre par langue publiée.
import { describe, expect, it } from 'vitest'
import { docsHelpUrl, HELP_TOPICS, DOCS_LANGS } from '../utils/docsLinks'

describe('D5 — liens d\'aide vers la documentation', () => {
    it('la langue publiée sert son préfixe et SON ancre', () => {
        expect(docsHelpUrl('fr', 'spacing')).toBe('https://nestorcut.com/fr/docs/nesting/spacing/#lespacement')
        expect(docsHelpUrl('en', 'spacing')).toBe('https://nestorcut.com/docs/nesting/spacing/#spacing')
        expect(docsHelpUrl('fr', 'badges')).toContain('/fr/docs/nesting/#ce-que-garantissent-les-badges')
    })

    it('pt est publiée : son préfixe et SON ancre', () => {
        expect(docsHelpUrl('pt', 'sheets')).toBe('https://nestorcut.com/pt/docs/interface/#as-chapas')
        expect(docsHelpUrl('pt', 'badges')).toContain('/pt/docs/nesting/#o-que-os-badges-garantem')
    })

    it('toute langue non publiée REPIE sur l\'anglais (écrit pour six codes)', () => {
        // Paquet P : pt est PUBLIÉ, retiré de la liste des replis
        for (const code of ['it', 'de', 'es', 'zz-unknown']) {
            expect(docsHelpUrl(code, 'sheets')).toBe(docsHelpUrl('en', 'sheets'))
        }
    })

    it('chaque sujet porte son ancre dans CHAQUE langue publiée', () => {
        for (const topic of Object.keys(HELP_TOPICS)) {
            for (const lang of DOCS_LANGS) {
                const url = docsHelpUrl(lang, topic)
                expect(url, `${topic}/${lang}`).toMatch(/#.+$/)
                expect(url).toMatch(/^https:\/\/nestorcut\.com\/(fr\/|pt\/)?docs\//)
            }
        }
    })

    it('un sujet inconnu ne rend rien (le composant cache le lien)', () => {
        expect(docsHelpUrl('fr', 'inexistant')).toBeNull()
    })
})
