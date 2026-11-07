import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = (rel) => fs.readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8')

// Page projet « les pièces d'abord » : l'ordre et le bloc collant tiennent au
// gabarit, que seule la lecture du source verrouille en vitest (le rendu réel
// est vérifié par captures et par scripts/qa-e2e-failure-scroll.mjs).
describe('page projet : les pièces d\'abord', () => {
    const page = source('app/pages/project/[slug].vue')
    const template = page.slice(0, page.indexOf('<script setup>'))

    it('les fiches viennent avant la tôle et les réglages', () => {
        expect(template.indexOf('<ProjectFiles')).toBeGreaterThan(-1)
        expect(template.indexOf('<ProjectFiles')).toBeLessThan(template.indexOf('class="atelier"'))
    })

    it('le bouton Nest est un bloc collant hors des réglages, dernier de la page', () => {
        const asideEnd = template.indexOf('</aside>')
        const cta = template.indexOf('class="atelier__cta"')
        expect(cta).toBeGreaterThan(asideEnd)
        expect(template.indexOf('<MainSettings')).toBeLessThan(asideEnd)
        expect(template.slice(0, asideEnd)).not.toContain('atelier__nest')
        expect(page).toMatch(/&__cta \{[^}]*position: sticky;[^}]*bottom: 0;/)
    })

    it('la vue en direct garde la section atelier comme cible du défilement', () => {
        expect(template).toContain('<section ref="liveSection" class="atelier">')
    })

    it('la mise en page ne crée pas de zone de défilement qui neutralise le bloc collant', () => {
        const layout = source('app/layouts/auth.vue')
        const main = layout.slice(layout.indexOf('.main {'), layout.indexOf('&__content'))
        expect(main).toMatch(/overflow:\s*clip;/)
        expect(main).not.toMatch(/overflow:\s*hidden;/)
    })
})
