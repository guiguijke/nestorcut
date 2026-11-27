import { describe, expect, it } from 'vitest'
import { buildReportPdf } from '~~/app/utils/reportPdf'
import { checkPdfStructure, mediaBoxes, pageStreams } from './pdfTestHelpers'

const img = (w, h, withAlpha = false) => {
    const rgb = new Uint8Array(w * h * 3)
    for (let i = 0; i < w * h; i++) rgb.set([(i * 7) % 256, 120, 200], i * 3)
    return { width: w, height: h, rgb, alpha: withAlpha ? new Uint8Array(w * h).fill(255) : undefined }
}

const cols = [
    { key: 'n', label: 'Tôle', align: 'left' },
    { key: 'fmt', label: 'Format', align: 'left' },
    { key: 'qty', label: 'Pièces', align: 'right' },
]
const rowsOf = (count) => Array.from({ length: count }, (_, i) => ({ n: `Tôle ${i + 1}`, fmt: '1 000 × 2 000 mm', qty: String(10 + i) }))

function baseModel(over = {}) {
    return {
        paper: 'a4',
        title: 'Rapport de nesting',
        docTitle: 'Rapport de nesting - Projet',
        advanced: false,
        nestorcutLogo: img(40, 10, true),
        branding: null,
        meta: [{ label: 'Projet', value: 'Support (V2)' }, { label: 'Date', value: '27 novembre 2026' }],
        fields: [],
        headline: { label: 'Matière à prévoir', value: '3 × 1 000 × 2 000 mm' },
        figures: [{ label: 'Taux de chute', value: '18,8 %' }, { label: 'Pièces', value: '42' }, { label: 'Surface', value: '5,4 m²' }],
        checks: [{ label: 'Toutes les pièces sont posées', ok: true }, { label: 'Aucun chevauchement', ok: false }, { label: 'Épaisseur', ok: null }],
        notes: ['Contour importé, pas de chute calculée'],
        sheetTable: { columns: cols, rows: rowsOf(3) },
        sheets: [
            { title: 'Tôle 1 / 2', subtitle: '1 000 × 2 000 mm · 14 pièces', plan: { image: img(50, 100), widthMm: 1000, heightMm: 2000, labels: [{ x: 500, y: 1000, text: '1' }] }, figures: [{ label: 'Chute', value: '18,8 %' }], note: null },
            { title: 'Tôle 2 / 2', subtitle: '2 000 × 1 000 mm · 3 pièces', plan: { image: img(100, 50), widthMm: 2000, heightMm: 1000, labels: [] }, figures: [], note: null },
        ],
        partsTable: null,
        footer: { left: 'Rapport NestorCut · nestorcut.com', right: '27/11/2026' },
        creationDate: new Date(Date.UTC(2026, 10, 27)),
        ...over,
    }
}

describe('buildReportPdf', () => {
    it('modèle de base : PDF valide, 3 pages, tôle large en paysage', () => {
        const bytes = buildReportPdf(baseModel())
        const { s } = checkPdfStructure(bytes)
        expect(s).toContain('/Count 3')
        const boxes = mediaBoxes(bytes)
        expect(boxes).toHaveLength(3)
        expect(boxes[0]).toEqual([595.28, 841.89])
        expect(boxes[1]).toEqual([595.28, 841.89]) // tôle haute : portrait
        expect(boxes[2]).toEqual([841.89, 595.28]) // tôle large : paysage
        const streams = pageStreams(bytes).join('\n')
        expect(streams).toContain('(Page 1 / 3)')
        expect(streams).toContain('(Page 3 / 3)')
        expect(streams).toContain('(Rapport de nesting)')
        expect(s).toContain('/Title (Rapport de nesting - Projet)')
    })

    it('modèle avancé : logo entreprise, champs, légende, pièces', () => {
        const model = baseModel({
            advanced: true,
            branding: { logo: img(60, 30, true), company: 'Atelier Dupont', line: '12 rue des Lilas · 75000 Paris' },
            fields: [{ label: 'Client', value: 'Société Martin' }, { label: 'Commentaire', value: 'Livraison urgente '.repeat(30) }],
            partsTable: { title: 'Pièces', columns: cols, rows: rowsOf(5) },
        })
        model.sheets[0].legendTitle = 'Pièces de la tôle'
        model.sheets[0].legend = [{ ref: 1, name: 'Équerre', count: 4 }, { ref: 2, name: 'Un nom de fichier vraiment très long '.repeat(4), count: 10 }]
        model.sheets[0].plan.labels = [{ x: 200, y: 300, text: '1' }, { x: 800, y: 1500, text: '2' }]
        const bytes = buildReportPdf(model)
        const { s } = checkPdfStructure(bytes)
        expect(s).toContain('/Count 4') // page 1 + 2 tôles + pièces
        const streams = pageStreams(bytes).join('\n')
        expect(streams).toContain('(Pi\\350ces)')
        expect(streams).toContain('(Atelier Dupont)')
        expect(streams).toContain('(Page 4 / 4)')
        // Images : logo NestorCut (pied), logo entreprise, 2 plans.
        expect((s.match(/\/Subtype \/Image/g) || []).length).toBeGreaterThanOrEqual(4)
    })

    it('long tableau : continue sur la page suivante, en-tête répété', () => {
        const model = baseModel({ sheets: [], sheetTable: { columns: cols, rows: rowsOf(50) } })
        const bytes = buildReportPdf(model)
        const { s } = checkPdfStructure(bytes)
        expect(s).toContain('/Count 2')
        const streams = pageStreams(bytes).filter((t) => t.includes('BT'))
        // L'en-tête « Format » (gras, F2) figure sur les deux pages.
        expect(streams.filter((t) => t.includes('/F2') && t.includes('(Format)')).length).toBe(2)
        expect(streams[1]).toContain('(T\\364le 50)')
    })

    it('plan absent ou sans image : la page garde la tête, les chiffres et la note', () => {
        const model = baseModel({
            sheets: [{ title: 'Tôle 1 / 1', subtitle: 's', plan: null, figures: [{ label: 'Chute', value: '12 %' }], note: 'Plans non disponibles' }],
        })
        const bytes = buildReportPdf(model)
        const { s } = checkPdfStructure(bytes)
        expect(s).toContain('/Count 2')
        const t = pageStreams(bytes)
        const sheetPage = t.find((x) => x.includes('Plans non disponibles'))
        expect(sheetPage).toContain('(12 %)')
        expect(mediaBoxes(bytes)[1]).toEqual([595.28, 841.89])
    })

    it('Letter, pied de page personnalisé, labels hors cadre omis', () => {
        const model = baseModel({ paper: 'letter', footer: { left: 'L', right: 'R', pageLabel: (n, t) => `p. ${n}/${t}` } })
        model.sheets[0].plan.labels = [{ x: -50, y: 10, text: 'X' }, { x: 500, y: 1000, text: 'OK' }]
        const bytes = buildReportPdf(model)
        checkPdfStructure(bytes)
        expect(mediaBoxes(bytes)[0]).toEqual([612, 792])
        const streams = pageStreams(bytes).join('\n')
        expect(streams).toContain('(p. 1/3)')
        expect(streams).toContain('(OK)')
        expect(streams).not.toContain('(X)')
        const tpl = buildReportPdf(baseModel({ footer: { left: 'L', right: 'R', pageLabel: 'Seite {n} von {total}' } }))
        expect(pageStreams(tpl).join('\n')).toContain('(Seite 1 von 3)')
    })

    it('modèle minimal ou vide : ne lève pas', () => {
        checkPdfStructure(buildReportPdf({}))
        checkPdfStructure(buildReportPdf(undefined))
    })
})
