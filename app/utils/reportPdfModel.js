/**
 * Modèle du rapport PDF (`buildReportPdf`, voir reportPdf.js) : PUR, aucun DOM,
 * aucune E/S. Il reçoit les données du résultat, des fonctions déjà prêtes
 * (`t`, `tp`, `fmtLength`, `fmtArea`, `fmtPercent`, `fmtNumber`, `nameOf`), les
 * images déjà rastérisées et les aperçus déjà analysés (`parseSheetSvg`).
 *
 * SÉCURITÉ COMMERCIALE : le contenu AVANCÉ (logo et nom de l'entreprise, champs
 * libres, numéros de pièce, légende, page « Pièces », longueur de coupe,
 * amorçages) n'est construit que si `input.advanced === true`. Ce booléen est
 * tranché par l'appelant, au clic, depuis `reportPdfState(...).advanced ===
 * 'enabled'`. Sans lui, le modèle ne contient AUCUN de ces éléments, même si on
 * les lui passe.
 *
 * @typedef {import('./reportPdf.js').Image} Image
 * @typedef {{ widthMm: number, heightMm: number,
 *   parts: { rings: number[][][], color: string }[] }} ParsedSheet  (parseSheetSvg)
 *
 * @typedef {object} ReportPdfInput
 * @property {boolean} advanced Verrou déjà tranché : true = PDF avancé
 * @property {(key: string, params?: object) => string} t
 * @property {(key: string, n: number) => string} tp Traduction avec pluriel
 * @property {(mm: number) => string} fmtLength
 * @property {(mm2: number) => string} fmtArea
 * @property {(pct: number) => string} fmtPercent
 * @property {(n: number) => string} fmtNumber
 * @property {(slug: string) => string} nameOf Nom affiché d'un fichier
 * @property {'mm'|'inch'} unit
 * @property {string} projectName
 * @property {string} resultId
 * @property {number} optionNumber Option affichée (1, 2, …)
 * @property {string} dateText Date du jour, déjà au format de la langue
 * @property {Date} [creationDate]
 * @property {number} requested Pièces demandées
 * @property {number} placed Pièces posées
 * @property {object|null} report Rapport de l'option (`alternatives[i].report`)
 * @property {object[]} sheets Lignes par tôle du rapport (`report.sheets`)
 * @property {object|null} totals `report.totals`
 * @property {string} materialFormats Chaîne « Matière à prévoir » de l'écran
 * @property {{ ok: boolean|null, label: string }[]} badges Verdicts de l'écran
 * @property {boolean} unfit Résultat non découpable
 * @property {number|null} edgeMm Distance au bord demandée (mm), si connue
 * @property {(ParsedSheet|null)[]} previews Aperçus analysés, un par tôle
 * @property {(Image|null)[]} images Plans rastérisés, un par tôle
 * @property {((string[]|null)|undefined)[]|null} slugs Identifiants de fichier
 *   des formes de chaque aperçu (`svgSlugs`), ou null si inconnus
 * @property {'server'|'old'} slugsMissing Pourquoi `slugs` manque
 * @property {(number[]|null|undefined)[]|null} [poses] Indice de pose de chaque forme
 *   (`svgPoses`) : les formes d'un bloc partagent la pose de leur item, comptée UNE fois
 * @property {([number, number][]|null|undefined)[]} [labelPoints] Points d'étiquette déjà calculés (sinon calculés ici)
 * @property {number|null} [densityPct] Densité de l'option, si `totals` n'en a pas
 * @property {Record<string, number>|null} requestedBySlug Quantité demandée par fichier
 * @property {Image|null} nestorcutLogo
 * @property {{ logo: Image|null, company: string, line: string }|null} branding
 * @property {{ client?: string, reference?: string, material?: string, comment?: string }|null} fields
 */
import { buildPartRefs, labelPoint, ringsBox, cutStats } from './sheetSvgReport.js'
import { showSheetOffcutColumn } from './reportLayout.js'

const arr = (v) => (Array.isArray(v) ? v : [])
const clean = (v) => (v == null ? '' : String(v).trim())

/**
 * Un aperçu est exploitable s'il est lu, sans chemin de pièce écarté et avec au moins
 * autant de formes que de pièces posées : sinon la coupe serait sous-estimée.
 */
function readable(preview, row) {
    if (!preview || !Array.isArray(preview.parts)) return false
    if (Number(preview.ignored) > 0) return false
    const expected = Number(row?.partCount) || 0
    return preview.parts.length >= expected
}

/**
 * @param {ReportPdfInput} input
 * @returns {object} modèle pour `buildReportPdf`
 */
/**
 * Pourquoi les numéros de pièces manquent : « server » pour un résultat serveur ou
 * pour un calcul fait ici sur un payload préparé par nos serveurs (projet « Nos
 * serveurs », par exemple avec une distance au bord) ; « old » pour un record local
 * d'avant les numéros.
 */
export function numbersMissingReason(isLocal, record) {
    return isLocal && !record?.serverPrepared ? 'old' : 'server'
}

export function buildReportPdfModel(input) {
    const inp = input || {}
    const advanced = inp.advanced === true
    const t = inp.t
    const rows = arr(inp.sheets)
    const totals = inp.totals || null
    const report = inp.report || null
    const inch = inp.unit === 'inch'
    const previews = rows.map((_, i) => inp.previews?.[i] || null)
    const images = rows.map((_, i) => inp.images?.[i] || null)
    const sheetCount = rows.length

    const model = {
        paper: inch ? 'letter' : 'a4',
        title: t('reportPdf.title'),
        docTitle: `${t('reportPdf.title')} - ${clean(inp.projectName) || clean(inp.resultId)}`,
        advanced,
        nestorcutLogo: inp.nestorcutLogo || null,
        branding: null,
        meta: [
            { label: t('reportPdf.meta.project'), value: clean(inp.projectName) || '—' },
            { label: t('reportPdf.meta.date'), value: clean(inp.dateText) },
            { label: t('reportPdf.meta.id'), value: clean(inp.resultId) },
            { label: t('reportPdf.meta.option'), value: t('result.option', { n: inp.optionNumber }) },
            { label: t('reportPdf.meta.unit'), value: inch ? t('reportPdf.unit.inch') : t('reportPdf.unit.mm') },
        ],
        fields: [],
        headline: { label: t('report.material'), value: clean(inp.materialFormats) || '—' },
        figures: [],
        checks: [],
        notes: [],
        sheetTable: { columns: [], rows: [] },
        sheets: [],
        partsTable: null,
        footer: {
            left: t('reportPdf.footer'),
            right: clean(inp.dateText),
            pageLabel: (n, total) => t('reportPdf.page', { n, total }),
        },
    }
    if (inp.creationDate) model.creationDate = inp.creationDate

    // ---- coupe : par tôle, seulement si avancé et aperçu lisible ---------------
    const cuts = rows.map((row, i) => (advanced && readable(previews[i], row) ? cutStats(previews[i].parts) : null))
    const cutKnown = cuts.filter(Boolean).length
    // Longueur de coupe : mètres (2 décimales) en mm, pieds (1 décimale) en pouces, au format de la langue.
    const cutText = (mm) => (inch ? `${inp.fmtNumber(mm / 304.8, 1)} ft` : `${inp.fmtNumber(mm / 1000, 2)} m`)
    const cutComplete = sheetCount > 0 && cutKnown === sheetCount

    // ---- chiffres clés ---------------------------------------------------------
    const placed = Number(inp.placed) || 0
    const requested = Number(inp.requested) || 0
    const unplaced = Math.max(Number(report?.unplaced) || 0, requested - placed, 0)
    const figures = []
    figures.push({ label: t('reportPdf.fig.placed'), value: `${placed} / ${requested}` })
    if (unplaced > 0) figures.push({ label: t('reportPdf.fig.unplaced'), value: String(unplaced) })
    const density = totals?.densityPct ?? inp.densityPct ?? null
    if (density != null) figures.push({ label: t('result.densityFull'), value: inp.fmtPercent(density) })
    if (totals?.partsAreaMm2 != null) figures.push({ label: t('reportPdf.fig.partsArea'), value: inp.fmtArea(totals.partsAreaMm2) })
    if (totals?.freeAreaMm2 != null) figures.push({ label: t('reportPdf.fig.freeArea'), value: inp.fmtArea(totals.freeAreaMm2) })
    figures.push({ label: t('reportPdf.fig.sheets'), value: String(totals?.sheetCount ?? sheetCount) })
    if (Number.isFinite(inp.edgeMm) && inp.edgeMm !== null) {
        figures.push({ label: t('reportPdf.fig.edge'), value: inp.fmtLength(inp.edgeMm) })
    }
    const anyShaped = rows.some((r) => r?.shaped)
    const off = report?.offcut
    if (!anyShaped && off && off.areaMm2 > 1) {
        const kind = off.reusable ? t('report.offcut.reusable') : t('report.offcut.scrap')
        figures.push({
            // « au moins » dans le libellé : la valeur reste sur deux lignes au plus dans la carte.
            label: `${t('reportPdf.fig.offcut')} (${t('report.offcut.atLeast')})`,
            value: `${inp.fmtLength(off.widthMm)} × ${inp.fmtLength(off.heightMm)} (${kind})`,
        })
    }
    if (Number(report?.holesFilled) > 0) figures.push({ label: t('reportPdf.fig.holes'), value: String(report.holesFilled) })
    if (advanced && cutKnown > 0) {
        const total = cuts.reduce((s, c) => s + (c ? c.cutLengthMm : 0), 0)
        const pierces = cuts.reduce((s, c) => s + (c ? c.pierceCount : 0), 0)
        // Un total partiel dit « au moins » : jamais un faux total présenté comme complet.
        const atLeast = cutComplete ? '' : `${t('report.offcut.atLeast')} `
        figures.push({ label: t('reportPdf.fig.cutLength'), value: `${atLeast}${cutText(total)}` })
        figures.push({ label: t('reportPdf.fig.pierces'), value: `${atLeast}${inp.fmtNumber(pierces)}` })
    }
    model.figures = figures

    // ---- contrôles : les verdicts de l'écran -------------------------------------
    const notVerified = t('report.notVerified')
    if (!report) {
        model.checks = [{ label: notVerified, ok: null }]
    } else {
        model.checks = arr(inp.badges).map((b) => ({ label: String(b.label), ok: b.label === notVerified ? null : b.ok === true ? true : b.ok === false ? false : null }))
        if (inp.unfit) model.checks.unshift({ label: t('report.unfit.title'), ok: false })
    }

    // ---- remarques -----------------------------------------------------------------
    const notes = []
    if (anyShaped) notes.push(t('reportPdf.note.shaped'))
    const plansReadable = previews.filter((p, i) => images[i] && p).length
    if (!sheetCount || plansReadable === 0) notes.push(t('reportPdf.note.noPlans'))
    else if (plansReadable < sheetCount) notes.push(t('reportPdf.note.partialPlans'))
    model.notes = notes

    // ---- tableau des tôles -----------------------------------------------------------
    const withOffcut = showSheetOffcutColumn(rows, report?.offcut && report.offcut.areaMm2 > 1 ? report.offcut : null)
    const columns = [
        { key: 'n', label: t('report.sheet.num'), align: 'left' },
        { key: 'format', label: t('report.sheet.format'), align: 'left' },
        { key: 'parts', label: t('report.sheet.parts'), align: 'right' },
        { key: 'used', label: t('report.sheet.used'), align: 'right' },
        { key: 'free', label: t('report.sheet.free'), align: 'right' },
        { key: 'density', label: t('report.sheet.density'), align: 'right' },
    ]
    if (withOffcut) columns.push({ key: 'offcut', label: t('report.sheet.offcut'), align: 'right' })
    if (advanced) {
        columns.push({ key: 'cut', label: t('reportPdf.col.cut'), align: 'right' })
        columns.push({ key: 'pierces', label: t('reportPdf.col.pierces'), align: 'right' })
    }
    const badge = t('settings.sheetShape.badge')
    model.sheetTable = {
        columns,
        rows: rows.map((s, i) => {
            const r = {
                n: String((Number(s.index) || i) + 1),
                format: `${inp.fmtLength(s.widthMm)} × ${inp.fmtLength(s.heightMm)}${s.shaped ? ` (${badge})` : ''}`,
                parts: String(s.partCount ?? ''),
                used: inp.fmtArea(s.partsAreaMm2),
                free: inp.fmtArea(s.freeAreaMm2),
                density: s.densityPct != null ? inp.fmtPercent(s.densityPct) : '—',
            }
            if (withOffcut) r.offcut = s.offcut ? `${inp.fmtLength(s.offcut.widthMm)} × ${inp.fmtLength(s.offcut.heightMm)}` : '—'
            if (advanced) {
                r.cut = cuts[i] ? cutText(cuts[i].cutLengthMm) : '—'
                r.pierces = cuts[i] ? inp.fmtNumber(cuts[i].pierceCount) : '—'
            }
            return r
        }),
    }

    // ---- numéros de pièce (avancé) -------------------------------------------------------
    // Les numéros n'existent que si les identifiants de fichier de la tôle sont connus ET
    // alignés (même nombre que les pièces lues dans l'aperçu).
    const slugLists = rows.map((row, i) => {
        if (!advanced) return null
        const list = inp.slugs?.[i]
        const p = previews[i]
        if (!Array.isArray(list) || !readable(p, row) || list.length !== p.parts.length) return null
        return list
    })
    // Comptage : une pièce par POSE (les formes d'un bloc partagent leur numéro).
    const countLists = slugLists.map((list, i) => {
        if (!list) return null
        const poses = inp.poses?.[i]
        if (!Array.isArray(poses) || poses.length !== list.length) return list
        return list.filter((_, k) => k === 0 || poses[k] !== poses[k - 1])
    })
    const refs = advanced ? buildPartRefs(countLists) : null

    // ---- une page par tôle -------------------------------------------------------------------
    model.sheets = rows.map((s, i) => {
        const p = previews[i]
        const image = images[i]
        const pct = s.densityPct != null ? inp.fmtPercent(s.densityPct) : '—'
        const sheet = {
            title: t('result.sheet', { n: (Number(s.index) || i) + 1, total: sheetCount }),
            subtitle: `${inp.fmtLength(s.widthMm)} × ${inp.fmtLength(s.heightMm)}${s.shaped ? ` (${badge})` : ''} · ${inp.tp('reportPdf.sheetParts', Number(s.partCount) || 0)} · ${t('report.sheet.density')} ${pct}`,
            plan: p && image ? { image, widthMm: p.widthMm, heightMm: p.heightMm, labels: [] } : null,
            note: p && image ? null : t('reportPdf.note.noPlan'),
        }
        if (!advanced) return sheet
        if (cuts[i]) {
            sheet.figures = [
                { label: t('reportPdf.fig.cutLength'), value: cutText(cuts[i].cutLengthMm) },
                { label: t('reportPdf.fig.pierces'), value: inp.fmtNumber(cuts[i].pierceCount) },
            ]
        }
        const list = slugLists[i]
        if (list && sheet.plan) {
            sheet.plan.labels = p.parts.map((part, k) => {
                const [x, y] = inp.labelPoints?.[i]?.[k] || labelPoint(part.rings)
                const box = ringsBox(part.rings)
                return {
                    x,
                    y,
                    text: String(refs.refOf.get(list[k])),
                    boxW: box ? box.maxX - box.minX : 0,
                    boxH: box ? box.maxY - box.minY : 0,
                }
            })
            sheet.legendTitle = t('reportPdf.legend')
            sheet.legend = (refs.perSheet[i] || []).map((e) => ({ ref: e.ref, name: inp.nameOf(e.slug), count: e.count }))
        } else if (p && image) {
            const reason = !Array.isArray(inp.slugs?.[i])
                ? (inp.slugsMissing === 'server' ? 'reportPdf.note.noNumbersServer' : 'reportPdf.note.noNumbersOld')
                : 'reportPdf.note.noNumbersSheet'
            sheet.note = t(reason)
        }
        return sheet
    })

    // ---- branding et champs libres (avancé) -----------------------------------------------------
    if (advanced) {
        const b = inp.branding
        if (b && (b.logo || clean(b.company) || clean(b.line))) {
            model.branding = { logo: b.logo || null, company: clean(b.company), line: clean(b.line) }
        }
        const f = inp.fields || {}
        const entries = [
            ['client', 'reportPdf.field.client'],
            ['reference', 'reportPdf.field.reference'],
            ['material', 'reportPdf.field.material'],
            ['comment', 'reportPdf.field.comment'],
        ]
        model.fields = entries.filter(([k]) => clean(f[k])).map(([k, key]) => ({ label: t(key), value: clean(f[k]) }))

        // ---- page « Pièces » : seulement si TOUTES les tôles ont leurs numéros -----------------
        const allNumbered = sheetCount > 0 && slugLists.every(Boolean)
        if (allNumbered) {
            const placedBy = new Map()
            const sheetsOf = new Map()
            slugLists.forEach((list, i) => {
                for (const slug of countLists[i]) placedBy.set(slug, (placedBy.get(slug) || 0) + 1)
                for (const e of refs.perSheet[i] || []) {
                    if (!sheetsOf.has(e.slug)) sheetsOf.set(e.slug, [])
                    sheetsOf.get(e.slug).push((Number(rows[i].index) || i) + 1)
                }
            })
            const wanted = inp.requestedBySlug && typeof inp.requestedBySlug === 'object' ? inp.requestedBySlug : null
            const cols = [
                { key: 'ref', label: t('reportPdf.col.ref'), align: 'left' },
                { key: 'name', label: t('reportPdf.col.name'), align: 'left' },
                { key: 'placed', label: t('reportPdf.col.placed'), align: 'right' },
            ]
            if (wanted) {
                cols.push({ key: 'requested', label: t('reportPdf.col.requested'), align: 'right' })
                cols.push({ key: 'missing', label: t('reportPdf.col.missing'), align: 'right' })
            }
            cols.push({ key: 'sheets', label: t('reportPdf.col.sheets'), align: 'left' })
            const list = [...refs.refOf].sort((a, b) => a[1] - b[1])
            model.partsTable = {
                title: t('reportPdf.partsTitle'),
                columns: cols,
                rows: list.map(([slug, ref]) => {
                    const n = placedBy.get(slug) || 0
                    const row = { ref: String(ref), name: inp.nameOf(slug), placed: String(n), sheets: (sheetsOf.get(slug) || []).join(', ') }
                    if (wanted) {
                        const req = Number(wanted[slug])
                        row.requested = Number.isFinite(req) ? String(req) : '—'
                        row.missing = Number.isFinite(req) ? String(Math.max(0, req - n)) : '—'
                    }
                    return row
                }),
            }
        }
    }
    return model
}
