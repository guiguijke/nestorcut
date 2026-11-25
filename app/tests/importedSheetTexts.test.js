import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as sass from 'sass'
import { describe, expect, it } from 'vitest'
import { DICTS } from '../utils/i18n'

// Textes de la tôle importée : offres, note du tableau comparatif, introduction de
// la fenêtre d'import, aide du cadre de la tôle, et étiquettes des vignettes.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const LANGS = Object.keys(DICTS)

// Un fragment par langue, dans le vocabulaire de results.importedLocked.
const EXCEPT = {
    en: /except imported sheets/, fr: /sauf les tôles importées/, de: /außer importierten Blechen/,
    es: /salvo las chapas importadas/, it: /tranne le lamiere importate/, pt: /exceto as chapas importadas/,
}
const INCLUDED = {
    en: /imported sheets included/, fr: /tôles importées comprises/, de: /auch importierter Bleche/,
    es: /incluidas las importadas/, it: /incluse le lamiere importate/, pt: /incluindo as importadas/,
}
const CRACKS = {
    en: /[Cc]racks and chips/, fr: /fissures et les éclats/, de: /Risse und Ausbrüche/,
    es: /grietas y los desconchones/, it: /crepe e le scheggiature/, pt: /fissuras e as lascas/,
}

describe('offres : la tôle importée est dite sur /plans', () => {
    it('Free : l’export des premières tôles exclut les tôles importées, dans les 6 langues', () => {
        for (const lang of LANGS) expect(DICTS[lang]['plans.free.f3'], lang).toMatch(EXCEPT[lang])
    })

    it('Unlimited : tout se télécharge, tôles importées comprises, dans les 6 langues', () => {
        for (const lang of LANGS) expect(DICTS[lang]['plans.unlimited.f3'], lang).toMatch(INCLUDED[lang])
    })

    it('la note du tableau existe partout, nomme Free et Unlimited et garde le {n} des cartes', () => {
        for (const lang of LANGS) {
            const note = DICTS[lang]['plans.compare.importedNote']
            expect(note, lang).toBeTruthy()
            expect(note, lang).toMatch(/Free/)
            expect(note, lang).toMatch(/Unlimited/)
            expect(note, lang).not.toMatch(/\n/)
            expect(DICTS[lang]['plans.free.f3'], lang).toContain('{n}')
        }
        // espaces insécables avant : et ; (règle de resultFinish.test.js)
        expect(DICTS.fr['plans.compare.importedNote'].replaceAll(' ', ' ')).toBe(
            "Tôle importée : en Free, le calcul et l'aperçu sont ouverts ; télécharger ses fichiers de coupe demande Unlimited.",
        )
    })

    it('la note vient APRÈS le tableau, sur une ligne à elle', () => {
        const page = read('../pages/plans.vue')
        const end = page.indexOf('</table>')
        const note = page.indexOf("t('plans.compare.importedNote')")
        expect(end).toBeGreaterThan(-1)
        expect(note).toBeGreaterThan(end)
        expect(page.slice(end, note)).toMatch(/<p class="compare__note"/)
    })
})

describe('fenêtre d’import et aide du cadre', () => {
    it('l’introduction dit que les fissures et les éclats se dessinent ensuite sur la tôle', () => {
        for (const lang of LANGS) expect(DICTS[lang]['sheetImport.intro'], lang).toMatch(CRACKS[lang])
    })

    // Une zone ou un défaut intérieur est un trou de la tôle du moteur : le writer
    // DXF les écrit tous sur FORBIDDEN_ZONE ; un défaut du bord est retiré du contour.
    it('l’aide du cadre dit où vont les défauts, et le calque FORBIDDEN_ZONE est toujours cité', () => {
        for (const lang of LANGS) {
            const hint = DICTS[lang]['settings.addOutShapeHint']
            expect(hint, lang).toContain('FORBIDDEN_ZONE')
            expect(hint, lang).toContain('BIN_BOUNDARY')
        }
        expect(DICTS.en['settings.addOutShapeHint']).toMatch(/without the defects drawn on its edge/)
        expect(DICTS.en['settings.addOutShapeHint']).toMatch(/defects drawn inside the sheet on the FORBIDDEN_ZONE layer/)
        const writer = read('../../workers/geometry/crates/nest-export/src/dxf_writer.rs')
        expect(writer).toMatch(/for zone in &shape\.inner[\s\S]{0,300}FORBIDDEN_LAYER/)
    })
})

describe('étiquette sous la vignette d’une tôle', () => {
    const page = read('../pages/project/[slug].vue')
    const css = sass
        .compileString(page.match(/<style lang="scss" scoped>([\s\S]*)<\/style>/)[1], { quietDeps: true, logger: sass.Logger.silent })
        .css.replace(/\s+/g, ' ')
    const rule = (selector) => css.match(new RegExp(`(?:^|[{}] )${selector.replace(/[.\-_]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? ''

    it('passe à la ligne au lieu d’être coupée par des points de suspension', () => {
        const dims = rule('.stage__dims')
        expect(dims).toMatch(/overflow-wrap: anywhere;/)
        expect(dims).toMatch(/text-align: center;/)
        expect(dims).not.toMatch(/text-overflow|white-space: nowrap|overflow: hidden/)
        expect(page).toMatch(/<p class="stage__dims" :title="pane\.label">/)
    })

    it('plusieurs tôles : une colonne ne descend pas sous un plancher, et deux lignes sont réservées', () => {
        expect(rule('.stage__idle--multi .stage__pane')).toMatch(/min-width: 4\.5rem;/)
        expect(rule('.stage__idle--multi .stage__dims')).toMatch(/min-height: 2\.6em;/)
    })
})
