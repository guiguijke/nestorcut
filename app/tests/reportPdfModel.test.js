import { describe, expect, it } from 'vitest'
import { buildReportPdfModel } from '~~/app/utils/reportPdfModel'
import { buildReportPdf } from '~~/app/utils/reportPdf'
import { parseSheetSvg } from '~~/app/utils/sheetSvgReport'
import { reportPdfState } from '~~/app/utils/reportExport'
import { checkPdfStructure, pageStreams } from './pdfTestHelpers'

// Dictionnaire de test : la clé elle-même, params en suffixe (le modèle ne traduit rien d'autre).
const t = (key, p) => (p ? `${key}${JSON.stringify(p)}` : key)
const tp = (base, n) => `${base}.${n === 1 ? 'one' : 'other'}:${n}`
const fmtLength = (mm) => `${Math.round(mm * 10) / 10} mm`
const fmtArea = (mm2) => `${Math.round(mm2)} mm2`
const fmtPercent = (p) => `${p} %`
const fmtNumber = (n) => String(n)
const nameOf = (slug) => `fichier-${slug}.dxf`

const sq = (x, y, w, h) => `M${x} ${y} ${x + w} ${y} ${x + w} ${y + h} ${x} ${y + h}Z`
const part = (d, tx, ty) => `<path d="${d}" transform="translate(${tx} ${ty}) scale(1 -1) rotate(0)" fill="#2563EB" fill-opacity="0.35" fill-rule="evenodd" stroke="#2563EB" stroke-width="2" />`
const svgOf = (w, h, parts) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><path d="M0 ${h} L${w} ${h} L${w} 0 L0 0 Z" fill="#FFFFFF" stroke="#3B82F6" />${parts.join('')}</svg>`

// Tôle 1 : trois pièces (a, a, b), la seconde avec un trou. Tôle 2 : une pièce (a).
const SVG1 = svgOf(1000, 500, [part(sq(0, 0, 100, 50), 10, 100), part(`${sq(0, 0, 100, 50)} ${sq(20, 10, 40, 20)}`, 300, 100), part(sq(0, 0, 60, 60), 600, 100)])
const SVG2 = svgOf(1000, 500, [part(sq(0, 0, 100, 50), 10, 100)])
const img = { width: 4, height: 2, rgb: new Uint8Array(24) }
const logo = { width: 4, height: 2, rgb: new Uint8Array(24), alpha: new Uint8Array(8).fill(255) }

const sheetRow = (index, partCount, extra = {}) => ({
    index, widthMm: 1000, heightMm: 500, partCount, partsAreaMm2: 12000, freeAreaMm2: 488000, densityPct: 2.4, offcut: null, ...extra,
})

function input(over = {}) {
    return {
        advanced: true,
        t, tp, fmtLength, fmtArea, fmtPercent, fmtNumber, nameOf,
        unit: 'mm',
        projectName: 'Support SECRET-PROJET',
        resultId: 'res-123',
        optionNumber: 2,
        dateText: '27 novembre 2026',
        requested: 4,
        placed: 4,
        report: { unplaced: 0, holesFilled: 1, offcut: { widthMm: 400, heightMm: 300, areaMm2: 120000, reusable: true } },
        sheets: [sheetRow(0, 3), sheetRow(1, 1)],
        totals: { sheetCount: 2, partsAreaMm2: 24000, freeAreaMm2: 976000, densityPct: 2.4 },
        materialFormats: '2 × 1000 × 500 mm',
        badges: [{ ok: true, label: 'Sans recouvrement' }, { ok: false, label: 'report.notVerified' }],
        unfit: false,
        edgeMm: 5,
        previews: [parseSheetSvg(SVG1), parseSheetSvg(SVG2)],
        images: [img, img],
        slugs: [['a', 'a', 'b'], ['a']],
        slugsMissing: 'old',
        requestedBySlug: { a: 3, b: 1 },
        nestorcutLogo: logo,
        branding: { logo, company: 'ACME-ENTREPRISE', line: 'LIGNE-SECRETE' },
        fields: { client: 'CLIENT-X', reference: 'REF-42', material: 'Acier 3 mm', comment: 'COMMENTAIRE-X' },
        ...over,
    }
}

describe('buildReportPdfModel : contenu avancé', () => {
    const m = buildReportPdfModel(input())

    it('papier, méta, chiffre principal et pied de page', () => {
        expect(m.paper).toBe('a4')
        expect(buildReportPdfModel(input({ unit: 'inch' })).paper).toBe('letter')
        expect(m.meta.map((x) => x.value)).toContain('Support SECRET-PROJET')
        expect(m.meta.map((x) => x.value)).toContain('res-123')
        expect(m.headline.value).toBe('2 × 1000 × 500 mm')
        expect(m.footer.left).toBe('reportPdf.footer')
        expect(m.footer.pageLabel(2, 5)).toBe('reportPdf.page{"n":2,"total":5}')
    })

    it('chiffres clés : distance au bord, trous, coupe totale (4 pièces)', () => {
        const byLabel = Object.fromEntries(m.figures.map((f) => [f.label, f.value]))
        expect(byLabel['reportPdf.fig.placed']).toBe('4 / 4')
        expect(byLabel['reportPdf.fig.edge']).toBe('5 mm')
        expect(byLabel['reportPdf.fig.holes']).toBe('1')
        expect(byLabel['reportPdf.fig.offcut']).toContain('400 mm × 300 mm')
        // Périmètres : 3 x (300) + 1 pièce a (300) + trou (120) + b (240) ... voir calcul ci-dessous
        const perim = (w, h) => 2 * (w + h)
        const expected = perim(100, 50) * 3 + perim(40, 20) + perim(60, 60)
        expect(byLabel['reportPdf.fig.cutLength']).toBe(`${Math.round(expected * 10) / 10} mm`)
        expect(byLabel['reportPdf.fig.pierces']).toBe('5') // 4 contours + 1 trou
    })

    it('verdicts : « Non vérifié » donne null, jamais une coche', () => {
        expect(m.checks).toEqual([{ label: 'Sans recouvrement', ok: true }, { label: 'report.notVerified', ok: null }])
    })

    it('un résultat non découpable commence par une croix rouge', () => {
        const u = buildReportPdfModel(input({ unfit: true }))
        expect(u.checks[0]).toEqual({ label: 'report.unfit.title', ok: false })
    })

    it('tableau des tôles avec coupe et amorçages', () => {
        expect(m.sheetTable.columns.map((c) => c.key)).toEqual(expect.arrayContaining(['cut', 'pierces']))
        expect(m.sheetTable.rows[1].pierces).toBe('1')
    })

    it('plans : numéros alignés, légende, boîtes des pièces', () => {
        const s = m.sheets[0]
        expect(s.title).toBe('result.sheet{"n":1,"total":2}')
        expect(s.plan.widthMm).toBe(1000)
        expect(s.plan.labels.map((l) => l.text)).toEqual(['1', '1', '2'])
        expect(s.plan.labels[0].boxW).toBeCloseTo(100, 6)
        expect(s.plan.labels[0].boxH).toBeCloseTo(50, 6)
        expect(s.legend).toEqual([{ ref: 1, name: 'fichier-a.dxf', count: 2 }, { ref: 2, name: 'fichier-b.dxf', count: 1 }])
        expect(s.note).toBeNull()
        expect(m.sheets[1].plan.labels.map((l) => l.text)).toEqual(['1'])
    })

    it('page « Pièces » : repères, posées, tôles, demandées et non posées', () => {
        expect(m.partsTable.rows).toEqual([
            { ref: '1', name: 'fichier-a.dxf', placed: '3', requested: '3', missing: '0', sheets: '1, 2' },
            { ref: '2', name: 'fichier-b.dxf', placed: '1', requested: '1', missing: '0', sheets: '1' },
        ])
        const sans = buildReportPdfModel(input({ requestedBySlug: null }))
        expect(sans.partsTable.columns.map((c) => c.key)).toEqual(['ref', 'name', 'placed', 'sheets'])
    })

    it('marque et champs libres (non vides seulement)', () => {
        expect(m.branding).toEqual({ logo, company: 'ACME-ENTREPRISE', line: 'LIGNE-SECRETE' })
        expect(m.fields.map((f) => f.value)).toEqual(['CLIENT-X', 'REF-42', 'Acier 3 mm', 'COMMENTAIRE-X'])
        const partiel = buildReportPdfModel(input({ fields: { client: ' Dupont ', reference: '  ', material: '', comment: null } }))
        expect(partiel.fields).toEqual([{ label: 'reportPdf.field.client', value: 'Dupont' }])
    })

    it('le PDF avancé se fabrique et contient les numéros', () => {
        const bytes = buildReportPdf(m)
        checkPdfStructure(bytes)
        const streams = pageStreams(bytes).join('\n')
        expect(streams).toContain('(ACME-ENTREPRISE)')
        expect(streams).toContain('(fichier-a.dxf)')
    })
})

describe('SÉCURITÉ COMMERCIALE : le modèle de base ne contient rien d\'avancé', () => {
    for (const advanced of [false, undefined, null, 0, '', 'true', 'enabled', 1]) {
        it(`advanced = ${JSON.stringify(advanced)} (valeurs passées : logo, champs, numéros, coupe)`, () => {
            const m = buildReportPdfModel(input({ advanced }))
            expect(m.advanced).toBe(false)
            expect(m.branding).toBeNull()
            expect(m.fields).toEqual([])
            expect(m.partsTable).toBeNull()
            for (const s of m.sheets) {
                expect(s.plan.labels).toEqual([])
                expect(s.legend).toBeUndefined()
                expect(s.legendTitle).toBeUndefined()
                expect(s.figures).toBeUndefined()
            }
            const keys = m.sheetTable.columns.map((c) => c.key)
            expect(keys).not.toContain('cut')
            expect(keys).not.toContain('pierces')
            expect(m.figures.map((f) => f.label)).not.toContain('reportPdf.fig.cutLength')
            expect(m.figures.map((f) => f.label)).not.toContain('reportPdf.fig.pierces')
            // Aucune trace des valeurs avancées nulle part dans le modèle.
            const dump = JSON.stringify(m)
            for (const secret of ['ACME-ENTREPRISE', 'LIGNE-SECRETE', 'CLIENT-X', 'REF-42', 'COMMENTAIRE-X', 'fichier-a.dxf', 'reportPdf.legend', 'reportPdf.partsTitle']) {
                expect(dump).not.toContain(secret)
            }
        })
    }

    it('le PDF de base ne contient ni nom d\'entreprise, ni champs, ni nom de fichier', () => {
        const bytes = buildReportPdf(buildReportPdfModel(input({ advanced: false })))
        const streams = pageStreams(bytes).join('\n')
        for (const secret of ['ACME-ENTREPRISE', 'LIGNE-SECRETE', 'CLIENT-X', 'COMMENTAIRE-X', 'fichier-a.dxf']) expect(streams).not.toContain(secret)
    })

    it('le verrou : seul l\'état \'enabled\' relu donne l\'avancé', () => {
        const advancedOf = (level, paidOff) => reportPdfState(level, paidOff).advanced === 'enabled'
        expect(advancedOf('free', false)).toBe(false)
        expect(advancedOf('free', true)).toBe(false)
        expect(advancedOf(null, false)).toBe(false)
        expect(advancedOf('standard', false)).toBe(true)
        expect(advancedOf('privacy', false)).toBe(true)
        expect(reportPdfState('free', false).base).toBe('enabled')
        expect(reportPdfState('free', true)).toEqual({ base: 'enabled', advanced: 'disabled' })
    })
})

describe('buildReportPdfModel : cas dégradés', () => {
    it('numéros absents : une note, ni labels ni légende, ni page « Pièces »', () => {
        const old = buildReportPdfModel(input({ slugs: null, slugsMissing: 'old' }))
        expect(old.sheets[0].plan.labels).toEqual([])
        expect(old.sheets[0].note).toBe('reportPdf.note.noNumbersOld')
        expect(old.partsTable).toBeNull()
        const srv = buildReportPdfModel(input({ slugs: null, slugsMissing: 'server' }))
        expect(srv.sheets[0].note).toBe('reportPdf.note.noNumbersServer')
        // La coupe, elle, reste disponible (elle vient des aperçus).
        expect(srv.figures.map((f) => f.label)).toContain('reportPdf.fig.cutLength')
    })

    it('liste d\'identifiants non alignée : pas de numéros pour cette tôle, et pas de page « Pièces »', () => {
        const m = buildReportPdfModel(input({ slugs: [['a', 'a'], ['a']] }))
        expect(m.sheets[0].plan.labels).toEqual([])
        expect(m.sheets[0].note).toBe('reportPdf.note.noNumbersSheet')
        expect(m.sheets[1].plan.labels).toHaveLength(1)
        expect(m.partsTable).toBeNull()
    })

    it('un aperçu illisible : le total de coupe dit « au moins », jamais un faux total complet', () => {
        const m = buildReportPdfModel(input({ previews: [parseSheetSvg(SVG1), null], images: [img, null] }))
        const cut = m.figures.find((f) => f.label === 'reportPdf.fig.cutLength')
        expect(cut.value.startsWith('report.offcut.atLeast ')).toBe(true)
        expect(m.sheetTable.rows[1].cut).toBe('—')
        expect(m.sheets[1].plan).toBeNull()
        expect(m.sheets[1].note).toBe('reportPdf.note.noPlan')
        expect(m.notes).toContain('reportPdf.note.partialPlans')
        const none = buildReportPdfModel(input({ previews: [null, null], images: [null, null] }))
        expect(none.figures.map((f) => f.label)).not.toContain('reportPdf.fig.cutLength')
        expect(none.notes).toContain('reportPdf.note.noPlans')
    })

    it('tôle importée : note, pas de chute', () => {
        const m = buildReportPdfModel(input({ sheets: [sheetRow(0, 3, { shaped: true }), sheetRow(1, 1, { shaped: true })] }))
        expect(m.notes).toContain('reportPdf.note.shaped')
        expect(m.figures.map((f) => f.label)).not.toContain('reportPdf.fig.offcut')
    })

    it('pièces non posées et distance au bord inconnue', () => {
        const m = buildReportPdfModel(input({ placed: 3, edgeMm: null, report: { unplaced: 1 } }))
        const labels = m.figures.map((f) => f.label)
        expect(labels).toContain('reportPdf.fig.unplaced')
        expect(labels).not.toContain('reportPdf.fig.edge')
    })

    it('sans rapport : un seul contrôle « non vérifié », modèle vide qui se fabrique', () => {
        const m = buildReportPdfModel(input({ report: null, sheets: [], totals: null, previews: [], images: [], slugs: [], advanced: false }))
        expect(m.checks).toEqual([{ label: 'report.notVerified', ok: null }])
        expect(m.notes).toContain('reportPdf.note.noPlans')
        checkPdfStructure(buildReportPdf(m))
    })
})
