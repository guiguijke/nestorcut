import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { encodeWinAnsi } from '~~/app/utils/pdfWriter'
import { buildReportPdf } from '~~/app/utils/reportPdf'
import { buildReportPdfModel } from '~~/app/utils/reportPdfModel'
import { reportPdfClick } from '~~/app/utils/reportPdfClick'
import { parseSheetSvg } from '~~/app/utils/sheetSvgReport'
import { translate } from '~~/app/utils/i18n'
import { checkPdfStructure, pageStreams } from './pdfTestHelpers'
import { mountSfc, passthrough } from './helpers/mountSfc'

const file = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const text = (bytes) => pageStreams(bytes).filter((s) => s.includes(' Tf')).join('\n@@\n')
const img = (w, h) => ({ width: w, height: h, rgb: new Uint8Array(w * h * 3) })

describe('encodeWinAnsi : signes hors cp1252 translittérés', () => {
    it('≥ ≤ − ≈ → sortent en ASCII, coches retirées, jamais « ? »', () => {
        const s = (str) => Buffer.from(encodeWinAnsi(str)).toString('latin1')
        expect(s('Écart ≥ 2 mm')).toBe('\xc9cart >= 2 mm')
        expect(s('a ≤ b ≈ c → d')).toBe('a <= b ~ c -> d')
        expect(s('−3')).toBe('-3')
        expect(s('✓ ok ✗')).toBe(' ok ')
        expect(s('≥')).not.toContain('?')
    })
})

describe('en-tête et tableaux', () => {
    it('logo d’entreprise 480x160 : proportions gardées, texte après la largeur RÉELLE dessinée', () => {
        const bytes = buildReportPdf({ title: 'T', advanced: true, branding: { logo: img(480, 160), company: 'Atelier', line: '' } })
        const s = text(bytes)
        const cm = /q ([\d.]+) 0 0 ([\d.]+) 40 [\d.]+ cm \/Im1 Do/.exec(s)
        const [w, h] = [Number(cm[1]), Number(cm[2])]
        expect(w).toBeLessThanOrEqual(170)
        expect(h).toBeLessThanOrEqual(48)
        expect(w / h).toBeCloseTo(3, 2)
        const td = /\/F2 15 Tf [\d. ]+ rg ([\d.]+) [\d.]+ Td \(Atelier\)/.exec(s)
        expect(Number(td[1])).toBeCloseTo(40 + w + 16, 1)
    })

    it('logo NestorCut du PDF de base : 36 à 40 pt de haut', () => {
        const s = text(buildReportPdf({ title: 'T', nestorcutLogo: img(120, 30) }))
        const cm = /q ([\d.]+) 0 0 ([\d.]+) 40 [\d.]+ cm \/Im1 Do/.exec(s)
        expect(Number(cm[2])).toBeGreaterThanOrEqual(36)
        expect(Number(cm[2])).toBeLessThanOrEqual(40)
    })

    it('une ligne libre sans nom ni logo apparaît dans l’en-tête', () => {
        const s = text(buildReportPdf({ title: 'T', advanced: true, branding: { logo: null, company: '', line: 'Rue des Lilas 12' } }))
        expect(s).toContain('(Rue des Lilas 12)')
    })

    for (const paper of ['letter', 'a4']) {
        it(`9 colonnes en ${paper}, nombres à U+202F : jamais de coupe dans un mot ni un nombre`, () => {
            const keys = ['n', 'fmt', 'qty', 'used', 'free', 'dens', 'off', 'cut', 'pierce']
            const heads = ['Num', 'Format', 'Pieces', 'Utilise', 'Libre', 'Densite', 'Chute', 'Longueur', 'Amorcages']
            const big = '12 345 678,9'
            const model = {
                paper,
                title: 'T',
                sheetTable: {
                    columns: keys.map((key, i) => ({ key, label: heads[i], align: i ? 'right' : 'left' })),
                    rows: [{ n: '1', fmt: '1 000 × 2 000 mm', qty: '14', used: big, free: big, dens: '45,5 %', off: '500 × 800', cut: '28,27 m', pierce: '1 234' }],
                },
            }
            const s = text(buildReportPdf(model))
            for (const h of heads) expect(s, h).toContain(`(${h})`)
            expect(s).toContain('(12\\240345\\240678,9)')
            expect(s).toContain('(1\\240234)')
            expect(s).toContain('(1\\240000 \\327 2\\240000 mm)'.replace(' \\327 ', ' \\327 '))
        })
    }
})

describe('aucun tracé de pièce dans le PDF (le plan est une IMAGE)', () => {
    const sheetPart = (k) => ({ rings: [[[k, k], [k + 5, k], [k + 5, k + 5], [k, k + 5]]], color: '#2563EB' })
    const build = (n) => {
        const parts = Array.from({ length: n }, (_, k) => sheetPart(k))
        const t = (key) => key
        return buildReportPdf(buildReportPdfModel({
            advanced: false, t, tp: (b, c) => `${b}${c}`, fmtLength: String, fmtArea: String, fmtPercent: String, fmtNumber: String, nameOf: String,
            unit: 'mm', projectName: 'P', resultId: 'r', optionNumber: 1, dateText: 'd', requested: n, placed: n,
            report: {}, sheets: [{ index: 0, widthMm: 1000, heightMm: 500, partCount: n, partsAreaMm2: 1, freeAreaMm2: 1, densityPct: 1 }],
            totals: { sheetCount: 1 }, materialFormats: 'x', badges: [], previews: [{ widthMm: 1000, heightMm: 500, parts, ignored: 0 }], images: [img(40, 20)],
        }))
    }
    const ops = (bytes) => {
        const sheetPage = pageStreams(bytes).filter((s) => s.includes(' Tf'))[1]
        return (sheetPage.match(/\s(m|l|c|re|h|f|S|B)(?=\s|$)/g) || []).length
    }
    it('1 pièce ou 200 pièces : même nombre d’opérateurs de tracé sur la page de tôle', () => {
        const one = ops(build(1))
        expect(one).toBeGreaterThan(0)
        expect(ops(build(200))).toBe(one)
    })
})

describe('modèle : coupe fiable, blocs, formats', () => {
    const t = (key, p) => (p ? `${key}${JSON.stringify(p)}` : key)
    const base = (over = {}) => ({
        advanced: true, t, tp: (b, n) => `${b}:${n}`, fmtLength: (v) => `${v} mm`, fmtArea: String, fmtPercent: (v) => `${v} %`,
        fmtNumber: (v, d) => (d == null ? String(v) : Number(v).toFixed(d)), nameOf: (s) => `f-${s}`,
        unit: 'mm', projectName: 'P', resultId: 'r', optionNumber: 1, dateText: 'd', requested: 3, placed: 3,
        report: { offcut: { widthMm: 5, heightMm: 5, areaMm2: 25, reusable: true } },
        sheets: [{ index: 0, widthMm: 1000, heightMm: 500, partCount: 3, partsAreaMm2: 10, freeAreaMm2: 10, densityPct: 2 }],
        totals: { sheetCount: 1, partsAreaMm2: 10, freeAreaMm2: 10, densityPct: 2 }, materialFormats: 'x', badges: [], unfit: false,
        previews: [], images: [img(2, 2)], slugs: [['a', 'a', 'b']], slugsMissing: 'old', ...over,
    })
    const sq = (x, y, w, h) => `M${x} ${y} ${x + w} ${y} ${x + w} ${y + h} ${x} ${y + h}Z`
    const part = (d, tx) => `<path d="${d}" transform="translate(${tx} 100) scale(1 -1) rotate(0)" fill="#2563EB"/>`
    const svg = (parts) => `<svg xmlns="http://www.w3.org/2000/svg" width="1000mm" height="500mm" viewBox="0 0 1000 500"><path d="M0 0 L1 0 L1 1Z"/>${parts.join('')}</svg>`
    const good = svg([part(sq(0, 0, 100, 50), 10), part(sq(0, 0, 100, 50), 300), part(sq(0, 0, 60, 60), 600)])

    it('parseSheetSvg compte les chemins de pièces illisibles', () => {
        const bad = svg([part(sq(0, 0, 100, 50), 10), '<path d="" transform="translate(1 1) scale(1 -1) rotate(0)"/>'])
        expect(parseSheetSvg(bad).ignored).toBe(1)
        expect(parseSheetSvg(good).ignored).toBe(0)
    })

    it('un chemin écarté : tôle « — », total « au moins », pas de numéros', () => {
        const bad = svg([part(sq(0, 0, 100, 50), 10), part(sq(0, 0, 100, 50), 300), part(sq(0, 0, 60, 60), 600), '<path d="" transform="translate(1 1) scale(1 -1) rotate(0)"/>'])
        const m = buildReportPdfModel(base({ previews: [parseSheetSvg(bad)] }))
        expect(m.sheetTable.rows[0].cut).toBe('—')
        expect(m.figures.map((f) => f.label)).not.toContain('reportPdf.fig.cutLength')
        expect(m.sheets[0].plan.labels).toEqual([])
        expect(m.partsTable).toBeNull()
    })

    it('moins de formes que de pièces posées : même traitement', () => {
        const few = svg([part(sq(0, 0, 100, 50), 10)])
        const m = buildReportPdfModel(base({ previews: [parseSheetSvg(few)] }))
        expect(m.sheetTable.rows[0].cut).toBe('—')
        expect(m.sheets[0].plan.labels).toEqual([])
    })

    it('longueur de coupe : mètres en mm, pieds en pouces', () => {
        const prev = [parseSheetSvg(good)]
        const perim = 2 * (150) * 2 + 2 * 120 // a, a, b
        const mm = buildReportPdfModel(base({ previews: prev }))
        expect(mm.figures.find((f) => f.label === 'reportPdf.fig.cutLength').value).toBe(`${(perim / 1000).toFixed(2)} m`)
        expect(mm.sheetTable.rows[0].cut).toBe(`${(perim / 1000).toFixed(2)} m`)
        expect(mm.sheets[0].figures[0].value).toBe(`${(perim / 1000).toFixed(2)} m`)
        const inch = buildReportPdfModel(base({ previews: prev, unit: 'inch' }))
        expect(inch.figures.find((f) => f.label === 'reportPdf.fig.cutLength').value).toBe(`${(perim / 304.8).toFixed(1)} ft`)
    })

    it('un dessin « bloc » de 4 pièces posé une fois : compté une fois, même numéro', () => {
        const four = svg([part(sq(0, 0, 10, 10), 10), part(sq(0, 0, 10, 10), 30), part(sq(0, 0, 10, 10), 50), part(sq(0, 0, 10, 10), 70)])
        const m = buildReportPdfModel(base({
            requested: 1, placed: 1,
            sheets: [{ index: 0, widthMm: 1000, heightMm: 500, partCount: 1, partsAreaMm2: 10, freeAreaMm2: 10, densityPct: 2 }],
            previews: [parseSheetSvg(four)], slugs: [['blk', 'blk', 'blk', 'blk']], poses: [[0, 0, 0, 0]], requestedBySlug: { blk: 1 },
        }))
        expect(m.sheets[0].plan.labels.map((l) => l.text)).toEqual(['1', '1', '1', '1'])
        expect(m.sheets[0].legend).toEqual([{ ref: 1, name: 'f-blk', count: 1 }])
        expect(m.partsTable.rows).toEqual([{ ref: '1', name: 'f-blk', placed: '1', requested: '1', missing: '0', sheets: '1' }])
    })

    it('chute « au moins » comme à l’écran ; densité de l’option si totals n’en a pas', () => {
        const m = buildReportPdfModel(base({ previews: [parseSheetSvg(good)], totals: { sheetCount: 1 }, densityPct: 12.5 }))
        expect(m.figures.find((f) => f.label.startsWith('reportPdf.fig.offcut')).label).toContain('report.offcut.atLeast')
        expect(m.figures.find((f) => f.label === 'result.densityFull').value).toBe('12.5 %')
    })
})

describe('reportPdfClick : le chemin du clic', () => {
    const make = () => {
        const calls = []
        const locked = (mode) => async (onProceed, beforePaywall) => {
            calls.push('locked')
            if (mode === 'paywall') {
                beforePaywall()
                calls.push('paywall')
            } else if (mode === 'proceed') onProceed()
            // 'stale' : contexte périmé, rien
        }
        return { calls, locked, make: async (adv) => { calls.push(`make:${adv}`) }, closeDialog: () => calls.push('close') }
    }
    it('base : toujours fabriqué, sans verrou ni lecture d’offre', async () => {
        const c = make()
        const readState = vi.fn(() => 'locked')
        expect(await reportPdfClick({ wantAdvanced: false, readState, lockedClick: c.locked('paywall'), make: c.make, closeDialog: c.closeDialog })).toBe('base')
        expect(c.calls).toEqual(['make:false'])
        expect(readState).not.toHaveBeenCalled()
    })
    it('toujours verrouillé : fenêtre PDF fermée AVANT l’abonnement, une seule fois, rien fabriqué', async () => {
        const c = make()
        const r = await reportPdfClick({ wantAdvanced: true, readState: () => 'locked', lockedClick: c.locked('paywall'), make: c.make, closeDialog: c.closeDialog })
        expect(r).toBe('paywall')
        expect(c.calls).toEqual(['locked', 'close', 'paywall'])
    })
    it('relu payant : rien fabriqué, la fenêtre reste ouverte pour remplir les champs', async () => {
        const c = make()
        const r = await reportPdfClick({ wantAdvanced: true, readState: () => 'locked', lockedClick: c.locked('proceed'), make: c.make, closeDialog: c.closeDialog })
        expect(r).toBe('unlocked')
        expect(c.calls).toEqual(['locked'])
    })
    it('abonnements coupés : ni abonnement ni fabrication', async () => {
        const c = make()
        expect(await reportPdfClick({ wantAdvanced: true, readState: () => 'disabled', lockedClick: c.locked('paywall'), make: c.make, closeDialog: c.closeDialog })).toBe('disabled')
        expect(c.calls).toEqual([])
    })
    it('déjà payant : fabriqué en avancé', async () => {
        const c = make()
        expect(await reportPdfClick({ wantAdvanced: true, readState: () => 'enabled', lockedClick: c.locked('paywall'), make: c.make, closeDialog: c.closeDialog })).toBe('advanced')
        expect(c.calls).toEqual(['make:true'])
    })
    it('contexte périmé : rien du tout', async () => {
        const c = make()
        const r = await reportPdfClick({ wantAdvanced: true, readState: () => 'locked', lockedClick: c.locked('stale'), make: c.make, closeDialog: c.closeDialog })
        expect(r).toBe('none')
        expect(c.calls).toEqual(['locked'])
    })
})

describe('ReportPdfDialog montée', () => {
    const dict = (key, params) => translate(key, 'fr', params)
    async function mount(state) {
        const props = reactive({ isModalOpen: true, advancedState: state, busy: false, errorText: '' })
        const emitted = []
        props['onUpdate:isModalOpen'] = () => {}
        props.onDownload = (p) => emitted.push(p)
        const view = await mountSfc(file('../components/ReportPdfDialog.vue'), {
            props,
            modules: { '~/utils/track': { trackEvent() {} } },
            components: {
                DialogWrapper: passthrough,
                UiIcon: passthrough,
                MainButton: file('../components/MainButton.vue'),
                UiSegmented: file('../components/ui/UiSegmented.vue'),
                UiField: file('../components/ui/UiField.vue'),
            },
            globals: { useLocale: () => ({ t: (k, p) => translate(k, 'fr', p) }) },
        })
        return { view, props, emitted }
    }
    const advancedBtn = (view) => view.byTestId('report-pdf-mode-advanced')

    it('verrouillé : « avancé » choisi montre la phrase du verrou, aucun champ', async () => {
        const { view } = await mount('locked')
        expect(view.byTestId('report-pdf-advanced')).toBeNull()
        await view.click(advancedBtn(view))
        expect(view.byTestId('report-pdf-locked')).not.toBeNull()
        expect(view.text()).toContain(dict('reportPdf.mode.locked'))
        expect(view.byTestId('report-pdf-advanced')).toBeNull()
    })

    it('abonnements coupés : l’option avancée est grisée et un clic ne la choisit pas', async () => {
        const { view, emitted } = await mount('disabled')
        const btn = advancedBtn(view)
        expect(btn.props.disabled).toBe(true)
        await view.click(btn)
        expect(view.byTestId('report-pdf-locked')).toBeNull()
        await view.click(view.byTestId('report-pdf-download'))
        expect(emitted).toEqual([{ advanced: false }])
    })

    it('payant : champs affichés ; passage à « coupé » : retour au PDF de base', async () => {
        const { view, props, emitted } = await mount('enabled')
        await view.click(advancedBtn(view))
        expect(view.byTestId('report-pdf-advanced')).not.toBeNull()
        props.advancedState = 'disabled'
        await new Promise((r) => setTimeout(r, 20))
        expect(view.byTestId('report-pdf-advanced')).toBeNull()
        await view.click(view.byTestId('report-pdf-download'))
        expect(emitted.at(-1)).toEqual({ advanced: false })
    })
})
