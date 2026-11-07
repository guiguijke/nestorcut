import { describe, expect, it } from 'vitest'
import { demoToPromote, hasActivity } from '../utils/homeFresh'
import { DICTS } from '../utils/i18n'

describe('accueil d\'un compte neuf', () => {
    it('masque les statistiques avant chargement et quand tout est à zéro', () => {
        expect(hasActivity(null)).toBe(false)
        expect(hasActivity({ projects: 0, nestings: 0, partsNested: 0 })).toBe(false)
    })

    it("attend le premier calcul : un projet sans calcul ne montre pas de 0 % de réussite", () => {
        expect(hasActivity({ projects: 1, nestings: 0, dxfFiles: 4 })).toBe(false)
        expect(hasActivity({ projects: 0, nestings: 3 })).toBe(true)
        expect(hasActivity({ projects: 2, nestings: 1 })).toBe(true)
    })

    it('met la démo en avant seulement quand le compte n\'a aucun projet à lui', () => {
        const demo = { slug: 'demo', isDemo: true }
        expect(demoToPromote([demo])).toBe(demo)
        expect(demoToPromote([demo, { slug: 'a' }])).toBe(null)
        expect(demoToPromote([{ slug: 'a' }])).toBe(null)
        expect(demoToPromote(null)).toBe(null)
    })

    it('a les textes de la carte démo dans les six langues', () => {
        for (const [loc, dict] of Object.entries(DICTS)) {
            for (const k of ['home.demo.title', 'home.demo.text', 'home.demo.cta']) {
                expect(dict[k], `${loc} ${k}`).toBeTruthy()
            }
        }
    })
})
