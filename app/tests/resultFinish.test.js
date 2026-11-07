import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DICTS, LOCALES } from '../utils/i18n'
import { allQuantitiesAtOne } from '../utils/quantityHint'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const DONE = 'done'

describe('quantité des fiches pièce', () => {
    it('aide : vraie seulement si toutes les pièces prêtes sont à 1', () => {
        const f = (count, processingStatus = DONE) => ({ count, processingStatus })
        expect(allQuantitiesAtOne([f(1), f(1)], DONE)).toBe(true)
        expect(allQuantitiesAtOne([f(1), f(3)], DONE)).toBe(false)
        expect(allQuantitiesAtOne([f(0)], DONE)).toBe(false)
        expect(allQuantitiesAtOne([], DONE)).toBe(false)
        expect(allQuantitiesAtOne([f(1, 'error')], DONE)).toBe(false)
        expect(allQuantitiesAtOne([f(1), f(5, 'error')], DONE)).toBe(true)
    })

    it('la fiche affiche un libellé visible et le dépôt l\'aide', () => {
        expect(read('../components/FileDone.vue')).toContain("t('file.quantityLabel')")
        const pf = read('../components/ProjectFiles.vue')
        expect(pf).toContain("t('files.quantityHint')")
        expect(pf).toContain('allQuantitiesAtOne(props.projectFiles')
    })

    it('les textes existent dans les 6 langues', () => {
        for (const l of LOCALES.map((x) => x.code || x)) {
            expect(DICTS[l]['file.quantityLabel']).toBeTruthy()
            expect(DICTS[l]['files.quantityHint']).toBeTruthy()
        }
    })
})
