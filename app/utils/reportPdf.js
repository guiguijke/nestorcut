/**
 * Mise en page du rapport de nesting en PDF : PUR (aucun DOM, aucune E/S),
 * ne traduit rien et ne formate aucun nombre. Tous les textes arrivent déjà
 * traduits et formatés dans le modèle ; ce module ne fait que les placer.
 *
 * Usage : `const bytes = buildReportPdf(model)` (Uint8Array, prêt à télécharger).
 *
 * @typedef {{ width: number, height: number, rgb: Uint8Array, alpha?: Uint8Array }} Image
 *   Image RVB 8 bits, lignes de haut en bas (`rgb` : largeur*hauteur*3 octets,
 *   `alpha` optionnel : largeur*hauteur octets).
 * @typedef {{ label: string, value: string }} LabelValue
 * @typedef {{ key: string, label: string, align?: 'left'|'center'|'right' }} TableColumn
 * @typedef {{ columns: TableColumn[], rows: Record<string, string>[] }} Table
 *
 * @typedef {object} ReportModel
 * @property {'a4'|'letter'} paper A4 595,28 x 841,89 pt ; Letter 612 x 792 pt
 * @property {string} title Titre de la page 1 (« Rapport de nesting »)
 * @property {string} docTitle Titre des métadonnées du PDF (/Info /Title)
 * @property {boolean} advanced PDF avancé (logo et champs de l'entreprise, etc.)
 * @property {Image|null} nestorcutLogo Logo NestorCut (en-tête en base, pied de page en avancé)
 * @property {{ logo: Image|null, company: string, line: string }|null} branding
 *   En-tête de l'entreprise (avancé seulement ; ignoré en base)
 * @property {LabelValue[]} meta Projet, date, identifiant, option, unité
 * @property {LabelValue[]} fields Avancé : client, référence, matière, commentaire
 *   (non vides seulement ; une valeur longue passe à la ligne)
 * @property {LabelValue} headline Chiffre principal (« Matière à prévoir »)
 * @property {LabelValue[]} figures Chiffres clés, en grille
 * @property {{ label: string, ok: boolean|null }[]} checks true = coche verte,
 *   false = croix rouge, null = tiret gris (non vérifié)
 * @property {string[]} notes Remarques (puces)
 * @property {Table} sheetTable Tableau récapitulatif des tôles (continue sur la
 *   page suivante, en-tête répété)
 * @property {{
 *   title: string, subtitle: string,
 *   plan: { image: Image|null, widthMm: number, heightMm: number,
 *           labels: { x: number, y: number, text: string, boxW?: number, boxH?: number }[] } | null,
 *   legendTitle?: string, legend?: { ref: string|number, name: string, count: string|number }[],
 *   figures?: LabelValue[], note?: string|null,
 * }[]} sheets Une page par tôle. `plan.labels` : points en mm dans le repère du
 *   SVG (origine en haut à gauche, y vers le bas), texte centré sur le point ;
 *   un label qui n'a pas la place est omis (jamais tronqué ni déplacé) ;
 *   `boxW`/`boxH` (mm) : boîte de la pièce, le label doit y tenir à l'échelle du plan.
 *   Page en PAYSAGE si le plan est plus large que haut ; plan absent (null ou
 *   sans image) : la page garde l'en-tête, les chiffres et la note.
 * @property {{ title: string } & Table | null} partsTable Avancé : page « Pièces »
 * @property {{ left: string, right: string,
 *   pageLabel?: string | ((n: number, total: number) => string) }} footer
 *   `pageLabel` : fonction ou chaîne avec {n} et {total} ; défaut « Page n / N ».
 */
import { createPdf } from './pdfWriter.js'

const PAPERS = { a4: [595.28, 841.89], letter: [612, 792] }
const M = 40 // marge
const ACCENT = '#2563EB'
const INK = '#111827'
const GRAY = '#6B7280'
const LIGHT = '#E5E7EB'
const GREEN = '#16A34A'
const RED = '#DC2626'
const FOOTER_H = 52 // hauteur réservée au pied de page

const arr = (v) => (Array.isArray(v) ? v : [])
const str = (v) => (v == null ? '' : String(v))

/**
 * @param {ReportModel} model
 * @returns {Uint8Array} le fichier PDF
 */
export function buildReportPdf(model) {
    const mdl = model || {}
    const [pw, ph] = PAPERS[mdl.paper] || PAPERS.a4
    const doc = createPdf({ title: str(mdl.docTitle || mdl.title), producer: 'NestorCut', creationDate: mdl.creationDate })
    const imageIds = new Map()
    const imageId = (img) => {
        if (!img) return 0
        if (!imageIds.has(img)) imageIds.set(img, doc.addImage(img))
        return imageIds.get(img)
    }
    const pages = []
    const newPage = (w = pw, h = ph) => {
        const p = doc.addPage(w, h)
        pages.push(p)
        return p
    }

    /** Coupe un texte à `maxW` avec « … » (ligne unique). */
    function fit(text, maxW, size, bold = false) {
        const s = str(text).replace(/\s+/g, ' ')
        if (doc.measure(s, size, bold) <= maxW) return s
        let out = ''
        for (const ch of s) {
            if (doc.measure(`${out}${ch}…`, size, bold) > maxW) break
            out += ch
        }
        return `${out.trimEnd()}…`
    }

    /** Paragraphe : (x, top) → nouveau top. Ligne de base = top + 0,85 * size. */
    function para(page, x, top, text, w, { size = 10, bold = false, color = INK, align = 'left', maxLines = 0 } = {}) {
        let lines = doc.wrap(text, w, size, bold)
        if (maxLines && lines.length > maxLines) {
            lines = lines.slice(0, maxLines)
            lines[maxLines - 1] = fit(`${lines[maxLines - 1]} …`, w, size, bold)
        }
        const lh = size * 1.3
        const ax = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x
        lines.forEach((l, i) => page.text(ax, top + i * lh + size * 0.85, l, { size, bold, color, align }))
        return top + lines.length * lh
    }

    /** Dimensions d'une image tenant dans maxW x maxH, proportions gardées. */
    function fitSize(img, maxW, maxH) {
        const s = Math.min(maxW / img.width, maxH / img.height)
        return [img.width * s, img.height * s]
    }

    // ---- grille de cartes (chiffres clés) -----------------------------------

    function cardsPlan(items, width, cols, valSize) {
        const gap = 8
        const cw = (width - gap * (cols - 1)) / cols
        const cards = items.map((it) => {
            const labelLines = doc.wrap(str(it.label), cw - 14, 8, false).slice(0, 2)
            const valueLines = doc.wrap(str(it.value), cw - 14, valSize, true).slice(0, 2)
            return { labelLines, valueLines, h: 14 + labelLines.length * 10.5 + 3 + valueLines.length * valSize * 1.2 }
        })
        const rows = []
        for (let i = 0; i < cards.length; i += cols) {
            const row = cards.slice(i, i + cols)
            rows.push({ row, h: Math.max(...row.map((c) => c.h)) })
        }
        const height = rows.reduce((s, r) => s + r.h + gap, 0) - (rows.length ? gap : 0)
        return { gap, cw, rows, height: Math.max(height, 0), valSize }
    }

    function drawCards(page, x, top, plan) {
        let y = top
        for (const { row, h } of plan.rows) {
            row.forEach((c, i) => {
                const cx = x + i * (plan.cw + plan.gap)
                page.rect(cx, y, plan.cw, h, { stroke: LIGHT, fill: '#F9FAFB', lineWidth: 0.7, radius: 4 })
                let ty = y + 7
                for (const l of c.labelLines) {
                    page.text(cx + 7, ty + 8 * 0.85, l, { size: 8, color: GRAY })
                    ty += 10.5
                }
                ty += 3
                for (const l of c.valueLines) {
                    page.text(cx + 7, ty + plan.valSize * 0.85, l, { size: plan.valSize, bold: true })
                    ty += plan.valSize * 1.2
                }
            })
            y += h + plan.gap
        }
        return y - (plan.rows.length ? plan.gap : 0)
    }

    // ---- tableau --------------------------------------------------------------

    function columnWidths(table, avail) {
        const cols = arr(table.columns)
        const rows = arr(table.rows)
        const pad = 10
        const natural = cols.map((c) => {
            let w = doc.measure(str(c.label), 9, true)
            for (const r of rows) w = Math.max(w, doc.measure(str(r[c.key]), 9, false))
            return w + pad
        })
        const sum = natural.reduce((a, b) => a + b, 0) || 1
        if (sum <= avail) return natural.map((w) => w + ((avail - sum) * w) / sum)
        const min = 28
        let widths = natural.map((w) => Math.max(min, (w * avail) / sum))
        const s2 = widths.reduce((a, b) => a + b, 0)
        widths = widths.map((w) => (w * avail) / s2)
        return widths
    }

    /**
     * Dessine un tableau à partir de (page, top) ; passe à une nouvelle page
     * (en-tête répété) quand la ligne suivante ne tient pas. Renvoie { page, y }.
     */
    function drawTable(page, top, table) {
        const cols = arr(table.columns)
        if (!cols.length) return { page, y: top }
        const x0 = M
        const avail = page.width - 2 * M
        const widths = columnWidths(table, avail)
        const lh = 11.5
        const bottom = (p) => p.height - FOOTER_H
        const cellLines = (c, i, text, bold) => doc.wrap(str(text), widths[i] - 10, 9, bold)

        const drawHeader = (pg, y) => {
            const lines = cols.map((c, i) => cellLines(c, i, c.label, true))
            const h = Math.max(...lines.map((l) => l.length)) * lh + 7
            pg.rect(x0, y, avail, h, { fill: '#F3F4F6' })
            let x = x0
            cols.forEach((c, i) => {
                lines[i].forEach((l, k) => pg.text(cellX(c, x, widths[i]), y + 4 + k * lh + 9 * 0.85, l, { size: 9, bold: true, align: c.align || 'left' }))
                x += widths[i]
            })
            pg.line(x0, y + h, x0 + avail, y + h, { stroke: GRAY, lineWidth: 0.8 })
            return y + h
        }
        const cellX = (c, x, w) => (c.align === 'right' ? x + w - 5 : c.align === 'center' ? x + w / 2 : x + 5)

        let pg = page
        let y = drawHeader(pg, top)
        arr(table.rows).forEach((r, ri) => {
            const lines = cols.map((c, i) => cellLines(c, i, r[c.key], false))
            const h = Math.max(...lines.map((l) => l.length)) * lh + 5
            if (y + h > bottom(pg)) {
                pg = newPage(pg.width, pg.height)
                y = drawHeader(pg, M)
            }
            if (ri % 2 === 1) pg.rect(x0, y, avail, h, { fill: '#F9FAFB' })
            let x = x0
            cols.forEach((c, i) => {
                lines[i].forEach((l, k) => pg.text(cellX(c, x, widths[i]), y + 2.5 + k * lh + 9 * 0.85, l, { size: 9, align: c.align || 'left' }))
                x += widths[i]
            })
            pg.line(x0, y + h, x0 + avail, y + h, { stroke: LIGHT, lineWidth: 0.5 })
            y += h
        })
        return { page: pg, y }
    }

    // ---- page 1 ----------------------------------------------------------------

    let page = newPage()
    const cw = pw - 2 * M
    let y = M
    const branded = !!(mdl.advanced && mdl.branding && (mdl.branding.logo || str(mdl.branding.company)))

    // Bandeau de tête.
    if (branded) {
        const b = mdl.branding
        let tx = M
        let hh = 0
        if (b.logo) {
            const [lw, lh] = fitSize(b.logo, 130, 42)
            page.image(imageId(b.logo), M, y, lw, lh)
            tx = M + lw + 14
            hh = lh
        }
        let ty = y
        if (str(b.company)) ty = para(page, tx, ty, b.company, pw - M - tx, { size: 15, bold: true, maxLines: 2 })
        if (str(b.line)) ty = para(page, tx, ty + 1, b.line, pw - M - tx, { size: 9, color: GRAY, maxLines: 3 })
        y += Math.max(hh, ty - y)
    } else if (mdl.nestorcutLogo) {
        const [lw, lh] = fitSize(mdl.nestorcutLogo, 150, 30)
        page.image(imageId(mdl.nestorcutLogo), M, y, lw, lh)
        y += lh
    } else {
        page.text(M, y + 15, 'NestorCut', { size: 17, bold: true, color: ACCENT })
        y += 20
    }
    y += 10
    page.line(M, y, pw - M, y, { stroke: ACCENT, lineWidth: 1.5 })
    y += 16
    y = para(page, M, y, mdl.title, cw, { size: 20, bold: true }) + 8

    // Blocs étiquette / valeur (meta, champs).
    const labelW = 125
    const kv = (items) => {
        for (const it of arr(items)) {
            const lines = doc.wrap(str(it.value), cw - labelW - 6, 10, false)
            const h = Math.max(lines.length, 1) * 13
            if (y + h > ph - FOOTER_H) {
                page = newPage()
                y = M
            }
            page.text(M, y + 10 * 0.85, fit(it.label, labelW - 6, 9, false), { size: 9, color: GRAY })
            lines.forEach((l, i) => page.text(M + labelW, y + i * 13 + 10 * 0.85, l, { size: 10 }))
            y += h
        }
    }
    kv(mdl.meta)
    if (arr(mdl.fields).length) {
        y += 6
        kv(mdl.fields)
    }
    y += 14

    const ensure = (h) => {
        if (y + h > ph - FOOTER_H) {
            page = newPage()
            y = M
        }
    }

    // Chiffre principal.
    if (mdl.headline && (str(mdl.headline.label) || str(mdl.headline.value))) {
        const vl = doc.wrap(str(mdl.headline.value), cw - 28, 22, true)
        const h = 14 + 12 + vl.length * 27 + 8
        ensure(h)
        page.rect(M, y, cw, h, { fill: '#EFF6FF', stroke: '#BFDBFE', lineWidth: 0.8, radius: 6 })
        page.text(M + 14, y + 14 + 9 * 0.85, str(mdl.headline.label), { size: 9, color: GRAY })
        vl.forEach((l, i) => page.text(M + 14, y + 14 + 12 + i * 27 + 22 * 0.85, l, { size: 22, bold: true, color: ACCENT }))
        y += h + 14
    }

    // Chiffres clés.
    if (arr(mdl.figures).length) {
        const plan = cardsPlan(arr(mdl.figures), cw, 3, 14)
        // La grille tient sur une page ; si elle ne tient pas ici, nouvelle page.
        ensure(Math.min(plan.height, ph - FOOTER_H - M))
        y = drawCards(page, M, y, plan) + 16
    }

    // Contrôles.
    for (const c of arr(mdl.checks)) {
        const lines = doc.wrap(str(c.label), cw - 24, 10, false)
        const h = Math.max(lines.length, 1) * 13 + 3
        ensure(h)
        const cx = M + 2
        const cy = y + 1
        if (c.ok === true) page.polyline([[cx, cy + 6], [cx + 3.5, cy + 9.5], [cx + 10, cy + 1.5]], { stroke: GREEN, lineWidth: 1.8 })
        else if (c.ok === false) {
            page.line(cx + 1, cy + 1, cx + 9, cy + 9, { stroke: RED, lineWidth: 1.8 })
            page.line(cx + 9, cy + 1, cx + 1, cy + 9, { stroke: RED, lineWidth: 1.8 })
        } else page.line(cx + 1, cy + 5, cx + 9, cy + 5, { stroke: '#9CA3AF', lineWidth: 1.8 })
        lines.forEach((l, i) => page.text(M + 22, y + i * 13 + 10 * 0.85, l, { size: 10, color: c.ok == null ? GRAY : INK }))
        y += h
    }
    if (arr(mdl.checks).length) y += 10

    // Remarques.
    for (const note of arr(mdl.notes)) {
        const lines = doc.wrap(str(note), cw - 12, 9, false)
        const h = lines.length * 11.7 + 3
        ensure(h)
        page.text(M + 2, y + 9 * 0.85, '•', { size: 9, color: GRAY })
        lines.forEach((l, i) => page.text(M + 12, y + i * 11.7 + 9 * 0.85, l, { size: 9, color: GRAY }))
        y += h
    }
    if (arr(mdl.notes).length) y += 10

    // Tableau des tôles.
    if (mdl.sheetTable && arr(mdl.sheetTable.columns).length) {
        ensure(60)
        const r = drawTable(page, y, mdl.sheetTable)
        page = r.page
        y = r.y
    }

    // ---- une page par tôle -----------------------------------------------------

    for (const s of arr(mdl.sheets)) {
        const plan = s.plan && s.plan.image ? s.plan : null
        const land = !!(plan && plan.widthMm > plan.heightMm)
        const [W, H] = land ? [ph, pw] : [pw, ph]
        const pg = newPage(W, H)
        const cwid = W - 2 * M
        let ty = M
        ty = para(pg, M, ty, s.title, cwid, { size: 16, bold: true }) + 1
        ty = para(pg, M, ty, s.subtitle, cwid, { size: 10, color: GRAY }) + 10
        const bottom = H - FOOTER_H

        const legend = arr(s.legend)
        const rowsMax = land ? 5 : 9
        let ncols = 1
        while (Math.ceil(legend.length / ncols) > rowsMax && ncols < 3) ncols++
        const cap = ncols * rowsMax
        const shown = legend.slice(0, cap)
        const rest = legend.slice(cap)
        const legendH = shown.length ? 16 + Math.ceil(shown.length / ncols) * 12.5 + 6 : 0
        const figs = arr(s.figures).length ? cardsPlan(arr(s.figures), cwid, land ? 5 : 4, 11) : null
        const noteLines = str(s.note) ? doc.wrap(str(s.note), cwid, 9, false) : []
        const noteH = noteLines.length ? noteLines.length * 11.7 + 4 : 0
        const gap = 10
        const reserved = (legendH ? legendH + gap : 0) + (figs ? figs.height + gap : 0) + (noteH ? noteH + gap : 0)

        if (plan) {
            const areaH = Math.max(bottom - ty - reserved, 90)
            const [iw, ih] = fitSize({ width: plan.widthMm, height: plan.heightMm }, cwid, areaH)
            const ix = M + (cwid - iw) / 2
            const iy = ty
            pg.image(imageId(plan.image), ix, iy, iw, ih)
            pg.rect(ix, iy, iw, ih, { stroke: '#9CA3AF', lineWidth: 0.6 })
            // Labels : centrés sur le point, jamais tronqués ni déplacés ; omis s'ils sortent
            // du cadre, chevauchent un label déjà posé ou ne tiennent pas dans la boîte de
            // leur pièce (`boxW`, `boxH` en mm) à l'échelle du plan. Texte à 9 pt, puis 8 pt
            // quand la place manque.
            const k = iw / plan.widthMm
            const placed = []
            for (const lb of arr(plan.labels)) {
                const text = str(lb.text)
                if (!text || !Number.isFinite(lb.x) || !Number.isFinite(lb.y)) continue
                const hasBox = Number.isFinite(lb.boxW) && Number.isFinite(lb.boxH)
                const size = [9, 8].find((sz) => {
                    if (!hasBox) return sz === 8
                    return doc.measure(text, sz, true) + 5 <= lb.boxW * k && sz + 3.5 <= lb.boxH * k
                })
                if (!size) continue
                const w = doc.measure(text, size, true) + 5
                const h = size + 3.5
                const cx = ix + lb.x * k
                const cy = iy + lb.y * k
                const bx = cx - w / 2
                const by = cy - h / 2
                if (bx < ix || by < iy || bx + w > ix + iw || by + h > iy + ih) continue
                if (placed.some((r) => bx < r.x + r.w && bx + w > r.x && by < r.y + r.h && by + h > r.y)) continue
                placed.push({ x: bx, y: by, w, h })
                pg.rect(bx, by, w, h, { fill: '#FFFFFF', stroke: '#9CA3AF', lineWidth: 0.4, radius: 2 })
                pg.text(cx, cy + size * 0.36, text, { size, bold: true, align: 'center' })
            }
            ty = iy + ih + gap
        }

        const drawLegend = (p, top, entries, nc, w, title) => {
            let yy = top
            if (title) p.text(M, yy + 10 * 0.85, str(title), { size: 10, bold: true })
            yy += 16
            const colW = w / nc
            const per = Math.ceil(entries.length / nc)
            entries.forEach((e, i) => {
                const col = Math.floor(i / per)
                const row = i % per
                const x = M + col * colW
                const by = yy + row * 12.5 + 9 * 0.85
                const countText = str(e.count) === '' ? '' : `× ${e.count}`
                const cwidth = doc.measure(countText, 9, false)
                p.text(x + 18, by, str(e.ref), { size: 9, bold: true, color: ACCENT, align: 'right' })
                p.text(x + colW - 10, by, countText, { size: 9, color: GRAY, align: 'right' })
                p.text(x + 24, by, fit(e.name, colW - 24 - 10 - cwidth - 8, 9, false), { size: 9 })
            })
            return yy + per * 12.5 + 6
        }

        if (shown.length) {
            ty = drawLegend(pg, ty, shown, ncols, cwid, s.legendTitle) + gap
        }
        if (figs) ty = drawCards(pg, M, ty, figs) + gap
        if (noteLines.length) para(pg, M, ty, str(s.note), cwid, { size: 9, color: GRAY })

        // Légende qui ne tient pas : pages de suite (même tôle).
        let left = rest
        while (left.length) {
            const cp = newPage()
            let cy = M
            cy = para(cp, M, cy, s.title, cw, { size: 16, bold: true }) + 1
            cy = para(cp, M, cy, str(s.legendTitle), cw, { size: 10, color: GRAY }) + 10
            const per = Math.floor((ph - FOOTER_H - cy - 22) / 12.5) * 2
            const chunk = left.slice(0, Math.max(per, 2))
            left = left.slice(chunk.length)
            drawLegend(cp, cy, chunk, 2, cw, '')
        }
    }

    // ---- pièces ----------------------------------------------------------------

    if (mdl.partsTable && arr(mdl.partsTable.columns).length) {
        const pp = newPage()
        const ty = para(pp, M, M, mdl.partsTable.title, cw, { size: 16, bold: true }) + 10
        drawTable(pp, ty, mdl.partsTable)
    }

    // ---- pied de page sur chaque page -------------------------------------------

    const total = pages.length
    const pageLabel = (n) => {
        const t = mdl.footer?.pageLabel
        if (typeof t === 'function') return str(t(n, total))
        if (typeof t === 'string' && t) return t.replace('{n}', String(n)).replace('{total}', String(total))
        return `Page ${n} / ${total}`
    }
    pages.forEach((p, i) => {
        const fy = p.height - 26
        p.line(M, p.height - 38, p.width - M, p.height - 38, { stroke: LIGHT, lineWidth: 0.6 })
        const mid = pageLabel(i + 1)
        const midW = doc.measure(mid, 8, false)
        let lx = M
        if (branded && mdl.nestorcutLogo) {
            const [lw, lh] = fitSize(mdl.nestorcutLogo, 60, 10)
            p.image(imageId(mdl.nestorcutLogo), M, fy - lh + 2, lw, lh)
            lx = M + lw + 6
        }
        const side = (p.width - 2 * M - midW) / 2 - 12
        p.text(lx, fy, fit(mdl.footer?.left, Math.max(side - (lx - M), 20), 8), { size: 8, color: GRAY })
        p.text(p.width / 2, fy, mid, { size: 8, color: GRAY, align: 'center' })
        p.text(p.width - M, fy, fit(mdl.footer?.right, Math.max(side, 20), 8), { size: 8, color: GRAY, align: 'right' })
    })

    return doc.save()
}
