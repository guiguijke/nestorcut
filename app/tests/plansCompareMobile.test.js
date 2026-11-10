import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as sass from 'sass'
import { describe, expect, it } from 'vitest'

// À 390 px, le tableau comparatif de /plans ne montrait que la colonne Free : la
// table gardait 560 px de large dans un cadre qui défile sans aucun indice. Pas de
// mise en page dans ces tests : ils lisent le CSS compilé de la page.

const page = readFileSync(fileURLToPath(new URL('../pages/plans.vue', import.meta.url)), 'utf8')
const css = sass
    .compileString(page.match(/<style lang="scss" scoped>([\s\S]*)<\/style>/)[1], { quietDeps: true, logger: sass.Logger.silent })
    .css.replace(/\s+/g, ' ')

describe('tableau comparatif de /plans sur téléphone', () => {
    it('sous 640 px, la table n’impose plus 560 px et resserre ses colonnes', () => {
        const rule = css.match(/@media \(max-width: 640px\) \{(.*?)\} \}/)?.[1] ?? ''
        expect(rule).toMatch(/\.compare__table \{[^}]*min-width: 0;/)
        expect(rule).toMatch(/\.compare__table th, \.compare__table td \{[^}]*padding: 10px 6px;/)
    })

    it('sous 640 px, un long mot de libellé peut se couper (allemand : « Optimierungsrichtungen »)', () => {
        expect(css).toMatch(/@media \(max-width: 640px\) \{ \.compare__label \{[^}]*hyphens: auto;[^}]*overflow-wrap: anywhere;/)
    })

    it('la largeur minimale de 560 px reste la règle de base (tablette et bureau)', () => {
        expect(css).toMatch(/\.compare__table \{[^}]*min-width: 560px;/)
    })
})
