import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as sass from 'sass'
import { describe, expect, it } from 'vitest'

// À 390 px, sur les pages publiques d'un compte connecté, la barre d'actions de
// l'en-tête dépassait l'écran : la page débordait et la fenêtre d'abonnement
// sortait à droite. Pas de mise en page dans ces tests : ils lisent le CSS compilé
// et les gabarits, pour vérifier la règle et les pages qu'elle touche.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const header = read('../components/MainHeader.vue')
const css = sass
    .compileString(header.match(/<style lang="scss" scoped>([\s\S]*)<\/style>/)[1], { quietDeps: true, logger: sass.Logger.silent })
    .css.replace(/\s+/g, ' ')

describe("en-tête sur téléphone : la barre d'actions passe à la ligne plutôt que de déborder", () => {
    it('sous 567 px, la barre non primaire peut passer à la ligne', () => {
        expect(css).toContain('@media (max-width: 566.98px) { .header__wrapper:not(.header__wrapper--is-primary) { flex-wrap: wrap; } }')
    })

    it('la règle de base reste sans passage à la ligne, et rien ne le permet à la barre primaire', () => {
        expect(css).toMatch(/\.header__wrapper \{[^}]*flex-wrap: nowrap;/)
        expect(css).not.toMatch(/\.header__wrapper--is-primary \{[^}]*flex-wrap: wrap/)
    })

    it('la barre primaire est celle de /profile et des pages de travail', () => {
        expect(read('../pages/profile.vue')).toContain("layout: 'auth'")
        for (const layout of ['auth', 'profile']) {
            expect(read(`../layouts/${layout}.vue`), layout).toContain(':theme="themeType.primary"')
        }
        expect(header).toContain(":class=\"{ 'header__wrapper--is-primary': isPrimaryTheme }\"")
    })
})
