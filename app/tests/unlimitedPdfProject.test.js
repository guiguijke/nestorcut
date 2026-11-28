/**
 * Tôle à quantité illimitée avec le rapport PDF et le fichier de projet :
 * le PDF dit « Tôles » et l'origine de chaque tôle (rien de nouveau sans tôle
 * illimitée) ; un projet enregistré puis rouvert garde la case cochée.
 */
import { describe, expect, it } from 'vitest'
import { buildReportPdfModel } from '~~/app/utils/reportPdfModel'
import { materializeProject, readProjectFile, writeProjectFile } from '~~/app/utils/projectFile'
import { makeSheetRecord } from '~~/app/utils/sheetShape'

const t = (key) => key
const row = (index, extra = {}) => ({
    index, widthMm: 1000, heightMm: 500, partCount: 1, partsAreaMm2: 10, freeAreaMm2: 10, densityPct: 1, offcut: null, ...extra,
})
const model = (sheets) => buildReportPdfModel({
    advanced: false,
    t,
    tp: (base, n) => `${base}:${n}`,
    fmtLength: (mm) => `${mm}`,
    fmtArea: (mm2) => `${mm2}`,
    fmtPercent: (p) => `${p} %`,
    fmtNumber: String,
    nameOf: String,
    unit: 'mm',
    sheets,
    report: { unplaced: 0 },
    totals: { sheetCount: sheets.length },
    materialFormats: 'x',
    badges: [],
    previews: [],
    images: [],
})

describe('rapport PDF et tôle illimitée', () => {
    it('titre « Matière nécessaire » et origine de chaque tôle', () => {
        const m = model([row(0, { supply: 'stock' }), row(1, { supply: 'new' })])
        expect(m.headline.label).toBe('report.material')
        expect(m.sheets[0].subtitle).toContain(' · report.supply.stock · ')
        expect(m.sheets[1].subtitle).toContain(' · report.supply.new · ')
    })

    it('sans tôle illimitée : titre et sous-titres d’avant', () => {
        const m = model([row(0), row(1)])
        expect(m.headline.label).toBe('report.material')
        expect(m.sheets[0].subtitle).not.toContain('report.supply')
    })
})

describe('fichier de projet et tôle illimitée', () => {
    it('enregistré puis rouvert : la case reste cochée sur la bonne ligne', async () => {
        const params = {
            sheets: [
                { width: '600', height: '800', count: '1' },
                { width: '1000', height: '2000', count: '3', unlimited: true },
            ],
            space: '2',
            kerf: '0',
            safety: '2',
        }
        const bytes = await writeProjectFile({
            title: 'p', appVersion: '0', savedAt: '2026-11-27T00:00:00.000Z', unit: 'mm', params, paramsUnit: 'mm', pieces: [], sheets: [],
        })
        const out = materializeProject(await readProjectFile(bytes), {
            projectSlug: 'proj-new',
            newFileSlug: () => 'f-new',
            newSheetSlug: () => 'sheet-new',
            makeSheetRecord,
            snapshotVersion: 2,
        })
        expect(out.snapshot.params.sheets).toEqual(params.sheets)
    })
})
