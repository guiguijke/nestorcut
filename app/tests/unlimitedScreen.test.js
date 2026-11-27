/**
 * Quantité illimitée à l'écran : le panneau de réglages réellement monté, le
 * dessin au repos, l'estimation et le contrôle de capacité de la page, le
 * panneau de refus, le rapport (bloc matière, texte, CSV) et la vue live.
 */
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as Vue from 'vue'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { mountSfc, passthrough } from './helpers/mountSfc'
import * as sheetStock from '../utils/sheetStock'
import * as units from '../utils/units'
import * as spacingParams from '../utils/spacingParams'
import * as partSheetFit from '../utils/partSheetFit'
import * as holesHint from '../utils/holesHint'
import * as sheetView from '../utils/sheetView'
import * as rotationChoice from '../utils/rotationChoice'
import * as paymentConstants from '../../shared/constants/payment.constants'
import * as demoConstants from '../../shared/constants/demo.constants'
import { idlePaneModel } from '../utils/idlePanes'
import { preflightSheetsOf, preflightParts, sheetFigure } from '../utils/preflightModel'
import { freeDownloadNoteVisible } from '../utils/sheetDownloadState'
import { capacityReport, stockFirstEstimate } from '../composables/capacityClient'
import { addSheetsPlan, capacityPanelModel, declaredSheetCount, exceedsMaxSheets } from '../utils/capacityPanel'
import { formatsOfSupply, hasSupply, materialBySupply, materialKeys, supplyColumn } from '../utils/reportSupply'
import { liveFormatFields } from '../utils/liveSheetFormats'
import { DICTS, translate } from '../utils/i18n'

const ROOT = path.resolve(__dirname, '..')
const t = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key)
const copies = []
afterAll(() => copies.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

/** Copie du composant dont les `import` du script ne sont plus indentés : le
 * montage sans navigateur (`mountSfc`) ne reconnaît que ceux-là. */
function dedentedImports(file) {
    const dir = mkdtempSync(path.join(tmpdir(), 'nc-sfc-'))
    copies.push(dir)
    const copy = path.join(dir, path.basename(file))
    writeFileSync(copy, readFileSync(file, 'utf8').replace(/^[ \t]+import\s/gm, 'import '))
    return copy
}

async function mountSettings({ local, sheets }) {
    const setSheetUnlimited = vi.fn()
    // Comme le magasin réel (readonly) : les getters rendent des valeurs.
    const getters = {
        params: { sheets, space: '2', kerf: '0', safety: '2', directions: ['left'] },
        projectLocal: local,
        projectFiles: [],
        sheetFormatsAtLimit: false,
        factorySheetReplaced: '',
        factorySheetReplacedLabel: null,
    }
    const actions = new Proxy({ setSheetUnlimited }, { get: (target, key) => target[key] || (() => {}) })
    const view = await mountSfc(dedentedImports(path.join(ROOT, 'components/MainSettings.vue')), {
        globals: {
            useLocale: () => ({ t, fmtNumber: (n) => String(n) }),
            useUnit: () => ({
                unit: Vue.ref('mm'), unitLabel: Vue.ref('mm'), enabled: Vue.ref(false),
                fmtLength: String, fmtLengthValue: String, fmtLengthMax: String, displayToMm: Number,
            }),
            filesStore: { getters, actions },
            authStore: { getters: { user: Vue.ref(null) } },
            useRoute: () => ({ params: { slug: 'p' } }),
        },
        modules: {
            '~/utils/units': units,
            '~~/shared/constants/payment.constants': paymentConstants,
            '~/utils/sheetStock': sheetStock,
            '~/utils/holesHint': holesHint,
            '~/utils/spacingParams': spacingParams,
            '~/utils/partSheetFit': partSheetFit,
            '~~/shared/constants/demo.constants': demoConstants,
            '~/utils/sheetView': sheetView,
            '~/utils/rotationChoice': rotationChoice,
        },
        components: {
            InputField: path.join(ROOT, 'components/InputField.vue'),
            HelpDot: passthrough,
            UiSegmented: passthrough,
            UiSwitch: passthrough,
            UiIcon: passthrough,
            SheetImportDialog: passthrough,
        },
    })
    const all = (id) => {
        const out = []
        const visit = (node) => {
            if (node.props?.['data-testid'] === id) out.push(node)
            node.children.forEach(visit)
        }
        let root = view.byTestId('settings-sheets')
        while (root.parent) root = root.parent
        visit(root)
        return out
    }
    const inputs = () => {
        const out = []
        const visit = (node) => {
            if (node.tag === 'input') out.push(node)
            node.children.forEach(visit)
        }
        visit(view.byTestId('settings-sheets'))
        return out
    }
    return { view, all, inputs, setSheetUnlimited }
}
const row = (count, extra = {}) => ({ width: '1000', height: '2000', count, ...extra })

describe('panneau de réglages', () => {
    it('projet « Cet appareil » : case par tôle ; cochée, quantité grisée « ∞ » et une phrase d\'aide', async () => {
        const { view, all, inputs, setSheetUnlimited } = await mountSettings({
            local: true,
            sheets: [row('3'), row('5', { unlimited: true, shapeId: 'sheet-a', name: 'Chute' })],
        })
        const boxes = all('settings-sheet-unlimited')
        expect(boxes.map((b) => [b.props.type, b.props.checked, b.props.disabled])).toEqual([
            ['checkbox', false, false], ['checkbox', true, false],
        ])
        // Le libellé entoure la case : cliquable.
        for (const box of boxes) expect(box.parent.tag).toBe('label')
        expect(view.textOf(boxes[0].parent)).toBe('settings.sheetUnlimited')
        const quantities = inputs().filter((i) => i.props.value === '3' || i.props.value === '∞')
        expect(quantities.map((i) => [i.props.value, Boolean(i.props.disabled)])).toEqual([['3', false], ['∞', true]])
        expect(all('settings-sheet-unlimited-hint')).toHaveLength(1)
        expect(view.textOf(all('settings-sheet-unlimited-hint')[0])).toBe('settings.sheetUnlimitedHint {"n":"1000"}')
        expect(all('settings-unlimited-local-only')).toHaveLength(0)
        boxes[0].props.onChange({ target: { checked: true } })
        boxes[1].props.onChange({ target: { checked: false } })
        expect(setSheetUnlimited.mock.calls).toEqual([[0, true], [1, false]])
    })

    it('autre projet : cases grisées, jamais cochées, une seule phrase, la quantité saisie reste', async () => {
        const { all, inputs } = await mountSettings({ local: false, sheets: [row('3'), row('5', { unlimited: true })] })
        expect(all('settings-sheet-unlimited').map((b) => [b.props.checked, b.props.disabled]))
            .toEqual([[false, true], [false, true]])
        expect(all('settings-unlimited-local-only')).toHaveLength(1)
        expect(all('settings-sheet-unlimited-hint')).toHaveLength(0)
        expect(inputs().filter((i) => i.props.value === '5').map((i) => Boolean(i.props.disabled))).toEqual([false])
    })

    const named = (box) => box.props['aria-label']
    const described = (box) => box.props['aria-describedby']

    it('chaque case a un nom qui cite sa tôle et pointe la phrase qui la concerne', async () => {
        const { all } = await mountSettings({
            local: true,
            sheets: [row('3'), row('5', { unlimited: true, shapeId: 'sheet-a', name: 'Chute' })],
        })
        const [first, second] = all('settings-sheet-unlimited')
        expect(named(first)).toBe(`settings.sheetUnlimitedAria ${JSON.stringify({ sheet: 'settings.sheet {"n":1}' })}`)
        expect(named(second)).toBe('settings.sheetUnlimitedAria {"sheet":"Chute"}')
        // Non cochée : aucune phrase à décrire ; cochée : sa phrase d'aide.
        expect(described(first)).toBeUndefined()
        const [hint] = all('settings-sheet-unlimited-hint')
        expect(hint.props.id).toBeTruthy()
        expect(described(second)).toBe(hint.props.id)
    })

    it('autre projet : les cases pointent la raison', async () => {
        const { all } = await mountSettings({ local: false, sheets: [row('3'), row('5')] })
        const [reason] = all('settings-unlimited-local-only')
        expect(reason.props.id).toBeTruthy()
        expect(all('settings-sheet-unlimited').map(described)).toEqual([reason.props.id, reason.props.id])
    })
})

describe('page projet', () => {
    const formatSize = (w, h) => `${w} × ${h}`

    it('dessin au repos : « × ∞ », même quantité saisie vide', () => {
        const model = idlePaneModel([row('2'), row('', { unlimited: true }), row('0')], { formatSize })
        expect(model.panes.map((p) => p.label)).toEqual(['1000 × 2000 × 2', '1000 × 2000 × ∞'])
    })

    it('estimation : la quantité effective, jamais celle saisie', () => {
        const rows = [row('2'), row('1', { unlimited: true })]
        expect(preflightSheetsOf(rows, {}, (v) => v).sheets.map((s) => s.count)).toEqual([2, 998])
        // 20 pièces de 900 × 900 : refusées avec la quantité saisie, acceptées avec l'effective.
        const parts = preflightParts([{ count: 20, parts: [{ width: 900, height: 900 }] }], false)
        const typed = capacityReport(parts, [{ width: 1000, height: 1000, count: 1 }], 2)
        expect(typed.refused).toBe(true)
        const effective = capacityReport(
            parts, preflightSheetsOf([{ width: '1000', height: '1000', count: '1', unlimited: true }], {}, (v) => v).sheets, 2)
        expect(effective.refused).toBe(false)
    })

    it('illimitée quand le stock prend la borne : une tôle quand même', () => {
        expect(preflightSheetsOf([row('1000'), row('1', { unlimited: true })], {}, (v) => v).sheets.map((s) => s.count))
            .toEqual([1000, 1])
    })

    it('tôle importée illimitée : active même avec une quantité saisie illisible', () => {
        const stats = { 'sheet-a': { widthMm: 100, heightMm: 60, usableAreaMm2: 6000, perimeterMm: 320 } }
        const model = preflightSheetsOf([row('', { unlimited: true, shapeId: 'sheet-a' })], stats, (v) => v)
        expect(model).toMatchObject({ state: 'ready', imported: true })
        expect(model.sheets.map((s) => s.count)).toEqual([1000])
    })

    describe('« ≈ n tôles » : le stock d\'abord', () => {
        const estimate = (rows, sizes) => {
            const files = sizes.map(([count, width, height]) => ({ count, parts: [{ width, height }] }))
            const model = preflightSheetsOf(rows, {}, (v) => Number(v))
            const parts = preflightParts(files, model.imported)
            const report = capacityReport(parts, model.sheets, 2)
            return { model, report, shown: stockFirstEstimate(report, parts, model.sheets, 2) }
        }
        const sheet = (width, height, count, extra = {}) => ({ width: String(width), height: String(height), count, ...extra })
        const open = sheet(1000, 2000, '1', { unlimited: true })

        it('le stock suffit : une tôle, là où la moyenne des formats en annonçait trois', () => {
            const { report, shown } = estimate([sheet(1500, 3000, '2'), open], [[60, 200, 300]])
            expect(report.sheetsNeeded).toBe(3)
            expect(shown).toEqual({ ...report, sheetsNeeded: 1 })
            const figure = sheetFigure({ imported: false, state: 'ready', report: shown })
            expect(figure).toEqual({ show: true, n: 1, panelSheets: 1 })
            expect(freeDownloadNoteVisible('locked', shown.sheetsNeeded)).toBe(false)
        })

        it('le stock ne suffit pas : tout le stock, puis les tôles à prévoir', () => {
            expect(estimate([sheet(1000, 1000, '3'), open], [[20, 400, 400]]).shown.sheetsNeeded).toBe(4)
            expect(estimate([sheet(600, 800, '1'), open], [[1, 900, 1400], [8, 100, 150]]).shown.sheetsNeeded).toBe(2)
            // Sans stock : les seules tôles à prévoir.
            expect(estimate([open], [[60, 200, 300]]).shown.sheetsNeeded).toBe(3)
        })

        it('la plus grande tôle du stock d\'abord ; une ligne sans quantité ne compte pas', () => {
            expect(estimate([sheet(500, 500, '1'), sheet(1500, 3000, '1'), open], [[60, 200, 300]]).shown.sheetsNeeded).toBe(1)
            const empty = estimate([sheet(1500, 3000, '0'), open], [[60, 200, 300]])
            expect(empty.model.sheets).toEqual([{ width: 1000, height: 2000, count: 1000, unlimited: true }])
            expect(empty.shown.sheetsNeeded).toBe(3)
        })

        it('sans tôle illimitée : le rapport lui-même, aucune marque sur les tôles', () => {
            const { model, report, shown } = estimate([sheet(1500, 3000, '2'), sheet(1000, 2000, '998')], [[60, 200, 300]])
            expect(shown).toBe(report)
            expect(model.sheets.some((s) => 'unlimited' in s)).toBe(false)
            expect(stockFirstEstimate(null, [], model.sheets, 2)).toBeNull()
        })

        it('la page passe son rapport par cette estimation', () => {
            const src = readFileSync(path.join(ROOT, 'pages/project/[slug].vue'), 'utf8')
            expect(src).toContain('return stockFirstEstimate(report, parts, model.sheets, spaceMm + curveMargin, edge)')
        })
    })

    it('la page lit ces lignes pour les contrôles, l\'estimation et le dessin', () => {
        const src = readFileSync(path.join(ROOT, 'pages/project/[slug].vue'), 'utf8')
        expect(src).toContain('preflightSheetsOf(unref(projectSheets)')
        expect(src).toContain('idlePaneModel(unref(projectSheets)')
        expect(src).toContain('effectiveSheets(unref(projectSheets))')
        expect(src.match(/sheets: unref\(computedSheets\)/g)).toHaveLength(4)
        expect(src).not.toMatch(/sheets: unref\(currentSheets\)/)
    })
})

describe('panneau de refus', () => {
    const sheets = [row('2'), row('1', { unlimited: true })]

    it('pas d\'« Ajouter des tôles » avec une tôle illimitée', () => {
        expect(addSheetsPlan({ sheetsNeeded: 9 }, [row('2'), row('1')]).k).toBe(6)
        expect(addSheetsPlan({ sheetsNeeded: 9 }, sheets)).toBeNull()
        const model = capacityPanelModel({ reason: 'partial', unplaced: 2, sheetsNeeded: 9 }, { sheets, spaceMm: 2 })
        expect([model.nextSheets, model.addSheets]).toEqual([null, null])
        expect(model.levers.sheetsNeeded).toBe(9)
    })

    it('borne : les illimitées ne comptent pas', () => {
        expect(declaredSheetCount(sheets)).toBe(2)
        expect(exceedsMaxSheets([row('1000'), row('50', { unlimited: true })])).toBe(false)
    })
})

describe('rapport', () => {
    const line = (widthMm, heightMm, supply, extra = {}) => ({ widthMm, heightMm, supply, ...extra })
    const text = (f) => `${f.count} × ${f.widthMm} × ${f.heightMm}${f.shaped ? ' (import)' : ''}`
    const fr = (key, params) => translate(key, 'fr', params)

    // Espace insécable avant les deux-points, comme tout le dictionnaire français.
    const NB = ' '

    it('« Du stock … — À prévoir … » : deux tôles de même taille restent à part', () => {
        const rows = [line(600, 800, 'stock'), line(1000, 2000, 'stock'), line(1000, 2000, 'new'), line(1000, 2000, 'new')]
        expect(materialBySupply(rows, text, fr))
            .toBe(`Du stock${NB}: 1 × 1000 × 2000 + 1 × 600 × 800 — À prévoir${NB}: 2 × 1000 × 2000`)
    })

    it('les parties vides ne sont pas dites', () => {
        expect(materialBySupply([line(600, 800, 'stock')], text, fr)).toBe(`Du stock${NB}: 1 × 600 × 800`)
        expect(materialBySupply([line(600, 800, 'new')], text, fr)).toBe(`À prévoir${NB}: 1 × 600 × 800`)
    })

    it('tôle importée : mention gardée, jamais confondue avec un rectangle de même boîte', () => {
        const shaped = { shaped: true, outlineAreaMm2: 100, zonesAreaMm2: 0, sheetAreaMm2: 100 }
        const rows = [line(600, 800, 'new', shaped), line(600, 800, 'new', shaped), line(600, 800, 'new')]
        expect(formatsOfSupply(rows, 'new').map(text).sort()).toEqual(['1 × 600 × 800', '2 × 600 × 800 (import)'])
    })

    it('colonne CSV « Origine » seulement avec l\'origine', () => {
        const rows = [line(600, 800, 'stock'), line(1000, 2000, 'new')]
        expect(supplyColumn(rows, fr)).toEqual({ header: 'Origine', cells: ['Stock', 'À prévoir'] })
        const plain = [{ widthMm: 600, heightMm: 800 }]
        expect(hasSupply(plain)).toBe(false)
        expect(supplyColumn(plain, fr)).toBeNull()
    })

    it('la fenêtre de résultat compose bloc, texte et CSV avec ces règles', () => {
        const src = readFileSync(path.join(ROOT, 'components/ResultModal.vue'), 'utf8')
        expect(src).toContain('if (hasSupply(unref(reportSheets))) return materialBySupply(unref(reportSheets), formatText, t)')
        expect(src).toContain('const supply = supplyColumn(sheets, t)')
        expect(src).toContain('...(supply ? [supply.header] : []),')
        expect(src).toContain('...(supply ? [supply.cells[i]] : []),')
    })

    it('bloc et texte copié : « Matière » avec une tôle illimitée, « Matière à prévoir » sinon', () => {
        const plain = materialKeys([{ widthMm: 600, heightMm: 800 }])
        expect(plain).toEqual({ title: 'report.material', text: 'report.text.material' })
        const mixed = materialKeys([line(600, 800, 'stock')])
        expect([fr(plain.title), fr(mixed.title)]).toEqual(['Matière à prévoir', 'Matière'])
        expect(fr(mixed.text, { formats: 'x' })).toBe(`Matière${NB}: x`)
        const view = readFileSync(path.join(ROOT, 'components/ResultReport.vue'), 'utf8')
        expect(view).toContain('t(materialKeys(props.d.reportSheets).title)')
        expect(view).not.toContain('t(\'report.material\')')
        expect(readFileSync(path.join(ROOT, 'components/ResultModal.vue'), 'utf8'))
            .toContain('t(materialKeys(unref(reportSheets)).text, { formats: unref(materialFormats) })')
    })

    it('les textes existent dans les six langues, et le libellé parle de quantité', () => {
        const keys = [
            'settings.sheetUnlimited', 'settings.sheetUnlimitedAria', 'settings.sheetUnlimitedHint', 'settings.sheetUnlimitedLocalOnly',
            'report.supply.fromStock', 'report.supply.toBuy', 'report.supply.column', 'report.supply.stock', 'report.supply.new',
            'report.supply.title', 'report.supply.text',
        ]
        for (const [lang, dict] of Object.entries(DICTS)) {
            for (const key of keys) expect(dict[key], `${lang} ${key}`).toBeTruthy()
        }
        expect(DICTS.fr['settings.sheetUnlimited']).toBe('Quantité illimitée')
        expect(DICTS.en['settings.sheetUnlimited']).toBe('Unlimited quantity')
    })
})

describe('vue live', () => {
    const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]
    const bin = (id, w, h, stock) => ({ id, stock, shape: { data: { outer: rect(w, h) } } })
    // Stock 300 × 300 coupé en deux conteneurs, puis la tôle neuve 1000 × 2000.
    const bins = [bin(0, 300, 300, 1), bin(1, 300, 300, 1), bin(2, 1000, 2000, 998)]
    const parts = [{ id: 0, coords: rect(100, 100) }, { id: 1, coords: rect(900, 900) }]
    const items = [[0, 0, 0, 10, 10], [1, 1, 0, 10, 10]]

    it('le même format en deux conteneurs ne fait pas dessiner la neuve à sa taille', () => {
        const out = liveFormatFields({ instance: { bins }, parts, stockPriority: { unlimitedBins: [2] } }, items)
        expect(out.sheets).toEqual([[300, 300], [1000, 2000]])
    })

    it('sans tôle illimitée ni importée : frame inchangée', () => {
        expect(liveFormatFields({ instance: { bins }, parts }, items)).toEqual({})
    })
})
