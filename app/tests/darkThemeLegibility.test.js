import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as sass from 'sass'
import { describe, expect, it } from 'vitest'

// Thème sombre : l'attribut data-theme="primary" sur <html> (cookie `theme` ou bouton
// de l'en-tête) redéfinit les jetons de tokens.css. Un écran qui garde une couleur
// écrite en dur, ou un alias que le thème sombre ne redéfinit pas, devient illisible :
// carte blanche sous un texte clair, étiquette sombre sur vert moyen, bouton grisé
// qui disparaît. Ces tests lisent le CSS compilé des écrans corrigés.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const compile = (rel) =>
    sass
        .compileString(read(rel).match(/<style lang="scss" scoped>([\s\S]*)<\/style>/)[1], { quietDeps: true, logger: sass.Logger.silent })
        .css.replace(/\s+/g, ' ')

describe('thème sombre : écrans qui restaient illisibles', () => {
    it('la carte de connexion des visiteurs suit --surface, pas le blanc fixe', () => {
        const css = compile('../pages/index.vue')
        expect(css).toMatch(/\.card \{[^}]*background: var\(--surface\);/)
        expect(css).not.toContain('--main-white')
    })

    it('les étiquettes « Cherche » et « Terminé » de la vue en direct utilisent --warn et --ok', () => {
        const css = compile('../components/LiveNestingView.vue')
        expect(css).toMatch(/\.live__badge \{[^}]*background: var\(--warn\);/)
        expect(css).toMatch(/\.live__badge--ok \{[^}]*background: var\(--ok\);/)
        expect(css).not.toMatch(/\.live__badge[^{]*\{[^}]*rgb\(/)
    })

    it('un bouton grisé reste lisible : texte --text-2, sans opacité ; le primaire passe sur --fill-secondary', () => {
        const css = compile('../components/MainButton.vue')
        expect(css).toMatch(/\.button--disabled \{[^}]*opacity: 1;/)
        expect(css).toMatch(/\.button--disabled \.button__label \{[^}]*color: var\(--text-2\);/)
        expect(css).toMatch(/\.button--theme-primary\.button--disabled \{[^}]*background-color: var\(--fill-secondary\);/)
    })

    it('/plans : les titres d’offre sont en couleur de texte, le bleu reste aux actions', () => {
        const css = compile('../pages/plans.vue')
        expect(css).toMatch(/\.cards__name \{[^}]*color: var\(--text\);/)
        expect(css).toMatch(/\.compare__table thead th \{[^}]*color: var\(--text\);/)
    })
})
