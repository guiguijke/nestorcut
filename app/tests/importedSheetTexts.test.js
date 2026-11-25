import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as sass from 'sass'
import { describe, expect, it } from 'vitest'
import { DICTS } from '../utils/i18n'
import { UNLIMITED_DIALOG_FEATURE_KEYS, UNLIMITED_FEATURE_KEYS } from '../utils/planBenefits'

// Textes de la tôle importée : offres et tableau comparatif, introduction de
// la fenêtre d'import, aide du cadre de la tôle, et étiquettes des vignettes.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const LANGS = Object.keys(DICTS)

const CRACKS = {
    en: /[Cc]racks and chips/, fr: /fissures et les éclats/, de: /Risse und Ausbrüche/,
    es: /grietas y los desconchones/, it: /crepe e le scheggiature/, pt: /fissuras e as lascas/,
}

describe('offres : la tôle importée et le rapport distinguent Free d’Unlimited', () => {
    const page = read('../pages/plans.vue')
    const KEYS = [
        'plans.free.customSheets', 'plans.free.report', 'plans.unlimited.customSheets', 'plans.unlimited.report',
        'plans.compare.customSheets', 'plans.compare.report',
        'plans.value.nestOnly', 'plans.value.withCutFiles', 'plans.value.onScreen', 'plans.value.copyCsv',
    ]

    it('les textes existent dans les 6 langues, sur une ligne', () => {
        for (const lang of LANGS) {
            for (const key of KEYS) {
                expect(DICTS[lang][key], `${lang} ${key}`).toBeTruthy()
                expect(DICTS[lang][key], `${lang} ${key}`).not.toMatch(/\n/)
            }
            expect(DICTS[lang]['plans.free.customSheets'], lang).toMatch(/DXF/)
            expect(DICTS[lang]['plans.unlimited.report'], lang).toMatch(/CSV/)
            expect(DICTS[lang]['plans.free.f3'], lang).toContain('{n}')
            expect(DICTS[lang], lang).not.toHaveProperty('plans.compare.importedNote')
        }
    })

    it('Free ne promet que des tôles rectangulaires au téléchargement', () => {
        const RECT = { en: /rectangular/, fr: /rectangulaires/, de: /rechteckigen/, es: /rectangulares/, it: /rettangolari/, pt: /retangulares/ }
        for (const lang of LANGS) expect(DICTS[lang]['plans.free.f3'], lang).toMatch(RECT[lang])
    })

    it('la carte Free, la carte Unlimited et la fenêtre d’abonnement les portent', () => {
        expect(page).toContain("t('plans.free.customSheets')")
        expect(page).toContain("t('plans.free.report')")
        for (const key of ['plans.unlimited.customSheets', 'plans.unlimited.report']) {
            expect(UNLIMITED_FEATURE_KEYS).toContain(key)
            expect(UNLIMITED_DIALOG_FEATURE_KEYS).toContain(key)
        }
    })

    it('le comparatif : Free calcule et voit, Unlimited et Pro ont les fichiers, la copie et le CSV', () => {
        expect(page).toMatch(/plans\.compare\.customSheets'\),\s*values: \[t\('plans\.value\.nestOnly'\), t\('plans\.value\.withCutFiles'\), t\('plans\.value\.withCutFiles'\)\]/)
        expect(page).toMatch(/plans\.compare\.report'\),\s*values: \[t\('plans\.value\.onScreen'\), t\('plans\.value\.copyCsv'\), t\('plans\.value\.copyCsv'\)\]/)
        expect(page.indexOf('plans.compare.customSheets')).toBeGreaterThan(page.indexOf('plans.compare.sheetDownloads'))
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
