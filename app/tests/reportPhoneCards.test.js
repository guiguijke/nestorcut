import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
    fileURLToPath(new URL('../components/ResultReport.vue', import.meta.url)),
    'utf8',
).replace(/\r\n/g, '\n')

// Le volet de rapport du bureau (fenêtre ≥ 768 px, deux colonnes : 1/3 de la
// largeur, soit ≈ 450 à 530 px à 1440–1680) passe sous le seuil de 560 px du
// conteneur : seule la fenêtre dit « téléphone ».
describe('tableau des tôles : mini-cartes réservées au téléphone', () => {
    it('la requête de conteneur de 560 px est dans une requête de fenêtre sous 768 px', () => {
        const at = css.indexOf('@container (max-width: 560px)')
        expect(at).toBeGreaterThan(-1)
        const media = css.lastIndexOf('@media', at)
        expect(media).toBeGreaterThan(-1)
        expect(css.slice(media, at)).toMatch(/^@media \(max-width: 767px\) \{\s*$/)
        // Aucune autre accolade ouverte entre les deux : elle l'enveloppe.
        const between = css.slice(media, at)
        expect((between.match(/\{/g) || []).length).toBe(1)
        expect((between.match(/\}/g) || []).length).toBe(0)
    })

    it('une seule requête de conteneur de 560 px, sans règle de cartes hors téléphone', () => {
        expect(css.match(/@container \(max-width: 560px\)/g)).toHaveLength(1)
    })
})
