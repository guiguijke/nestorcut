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

    it('it est publiée : son préfixe et SON ancre (paquet P L2)', () => {
        expect(docsHelpUrl('it', 'sheets')).toBe('https://nestorcut.com/it/docs/interface/#le-lamiere')
        expect(docsHelpUrl('it', 'spacing')).toContain('/it/docs/nesting/spacing/#la-distanza')
        expect(docsHelpUrl('it', 'badges')).toContain('/it/docs/nesting/#cosa-garantiscono-i-badge')
        expect(docsHelpUrl('it', 'downloads')).toContain('/it/docs/results/exports/#cosa-si-scarica')
    })

    it('de est publiée : son préfixe et SON ancre — umlauts compris (paquet P L3)', () => {
        expect(docsHelpUrl('de', 'sheets')).toBe('https://nestorcut.com/de/docs/interface/#die-bleche')
        expect(docsHelpUrl('de', 'spacing')).toContain('/de/docs/nesting/spacing/#der-abstand')
        // l'ancre à umlaut doit être EXACTEMENT l'id bâti (die Teile in den Löchern)
        expect(docsHelpUrl('de', 'holes')).toContain('/de/docs/nesting/directions/#die-teile-in-den-löchern')
        expect(docsHelpUrl('de', 'badges')).toContain('/de/docs/nesting/#was-die-badges-garantieren')
        expect(docsHelpUrl('de', 'offcut')).toContain('/de/docs/results/#das-nutzbare-restblech--und-mindestens')
        expect(docsHelpUrl('de', 'downloads')).toContain('/de/docs/results/exports/#was-heruntergeladen-wird')
    })

    it('es est publiée : son préfixe et SON ancre (paquet P L4)', () => {
        expect(docsHelpUrl('es', 'sheets')).toBe('https://nestorcut.com/es/docs/interface/#las-chapas')
        expect(docsHelpUrl('es', 'spacing')).toContain('/es/docs/nesting/spacing/#la-separación')
        expect(docsHelpUrl('es', 'holes')).toContain('/es/docs/nesting/directions/#las-piezas-en-los-agujeros')
        expect(docsHelpUrl('es', 'badges')).toContain('/es/docs/nesting/#lo-que-garantizan-las-insignias')
        expect(docsHelpUrl('es', 'downloads')).toContain('/es/docs/results/exports/#qué-se-descarga')
    })

    it('toute langue non publiée REPIE sur l\'anglais (écrit pour six codes)', () => {
        // Paquet P : pt, it puis de SONT PUBLIÉS, retirés de la liste des replis
        for (const code of ['zz-unknown']) {
            expect(docsHelpUrl(code, 'sheets')).toBe(docsHelpUrl('en', 'sheets'))
        }
    })

    it('chaque sujet porte son ancre dans CHAQUE langue publiée', () => {
        for (const topic of Object.keys(HELP_TOPICS)) {
            for (const lang of DOCS_LANGS) {
                const url = docsHelpUrl(lang, topic)
                expect(url, `${topic}/${lang}`).toMatch(/#.+$/)
                expect(url).toMatch(/^https:\/\/nestorcut\.com\/(fr\/|pt\/|it\/|de\/|es\/)?docs\//)
            }
        }
    })

    it('un sujet inconnu ne rend rien (le composant cache le lien)', () => {
        expect(docsHelpUrl('fr', 'inexistant')).toBeNull()
    })
})
