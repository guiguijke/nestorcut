import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DICTS } from '../utils/i18n'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

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
