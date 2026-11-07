import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DICTS, LOCALES } from '../utils/i18n'
import { allQuantitiesAtOne } from '../utils/quantityHint'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const DONE = 'done'

describe('badge de la vue en direct', () => {
    it.each(LOCALES.map((l) => l.code || l))('« Terminé » ne dit pas la même chose que « tient sur la tôle » (%s)', (code) => {
        const d = DICTS[code]
        expect(d['live.feasible']).toBe(d['result.state.done'])
        expect(d['live.fitsSheet']).toBeTruthy()
        expect(d['live.fitsSheet']).not.toBe(d['live.feasible'])
        expect(d['live.widthTitle']).toBeTruthy()
    })
})

describe('boutons d\'export du rapport', () => {
    const src = read('../components/ResultReport.vue')

    it('le libellé ne change pas quand l\'export est verrouillé', () => {
        expect(src).not.toMatch(/exportLocked\s*\?\s*t\(/)
        expect(src).not.toContain('report.exportLocked')
    })

    it('le verrou et le clic vers l\'abonnement restent', () => {
        expect(src).toContain(':icon="exportLocked ? iconType.lock : undefined"')
        expect(src).toContain("onExportClick(copyReport, 'report_copy_locked_click')")
        expect(src).toContain("onExportClick(exportCsv, 'report_csv_locked_click')")
    })

    it('les libellés français sont ceux du propriétaire', () => {
        expect(DICTS.fr['report.copy']).toBe('Copier le rapport')
        expect(DICTS.fr['report.csv']).toBe('Exporter CSV')
    })
})

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

describe('réglages : un seul intitulé « directions »', () => {
    it('le titre de section porte l\'aide, plus de second intitulé', () => {
        const src = read('../components/MainSettings.vue')
        expect(src).not.toContain("t('settings.directions')")
        expect(src).toMatch(/settings\.section\.directions'\) \}\}<HelpDot topic="directions"/)
    })
})

describe('français : espaces insécables', () => {
    const values = Object.values(DICTS.fr).filter((v) => typeof v === 'string')
    it('aucune espace ordinaire avant : ; ? ! %', () => {
        expect(values.filter((v) => /\S [:;?!%]/.test(v))).toEqual([])
    })
    it('aucune espace ordinaire dans les guillemets « »', () => {
        expect(values.filter((v) => /« | »/.test(v))).toEqual([])
    })
    it('aucune espace ordinaire entre un nombre et son unité', () => {
        expect(values.filter((v) => /[\d}] (mm|cm|kg|min|Mo|h)(?![\wé])/.test(v))).toEqual([])
    })
})

describe('thème sombre : texte tertiaire lisible', () => {
    const lum = (hex) => {
        const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
            .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
        return (x + 0.05) / (y + 0.05)
    }
    it('--label-tertiary atteint 4,5:1 sur les fonds sombres', () => {
        const css = read('../assets/css/tokens.css')
        const dark = css.slice(css.indexOf('[data-theme="primary"] {'))
        const tok = (name) => dark.match(new RegExp(name + ": *(#[0-9a-fA-F]{6})"))[1]
        expect(dark).toMatch(/--label-tertiary:\s*var\(--text-3\)/)
        const fg = tok('--text-3')
        expect(ratio(fg, tok('--bg'))).toBeGreaterThanOrEqual(4.5)
        expect(ratio(fg, tok('--surface'))).toBeGreaterThanOrEqual(4.5)
    })
})
