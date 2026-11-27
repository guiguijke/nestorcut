/**
 * Générateur PDF 1.4 minimal, PUR (aucun DOM, aucune E/S) : texte Helvetica /
 * Helvetica-Bold standard (non embarquées, WinAnsi), rectangles, traits,
 * polylignes et images RVB (Flate, canal alpha en /SMask).
 *
 * Repère de l'API : origine EN HAUT À GAUCHE, y vers le bas, en points ; la
 * conversion vers le repère PDF (origine en bas à gauche) est interne.
 *
 * Usage :
 *   const doc = createPdf({ title: 'Rapport', creationDate: new Date() })
 *   const page = doc.addPage(595.28, 841.89)
 *   page.text(40, 60, 'Bonjour', { size: 14, bold: true })
 *   const id = doc.addImage({ width, height, rgb, alpha })
 *   page.image(id, 40, 100, 200, 150)
 *   const bytes = doc.save() // Uint8Array
 */
import { zlibSync } from 'fflate'

// Largeurs (1/1000 em) des codes 32 à 255 en WinAnsi (cp1252), reprises des
// métriques AFM Adobe Core 14 de Helvetica et Helvetica-Bold (Core14_AFMs,
// copyright Adobe Systems, redistribution libre avec mention). Les codes
// non définis en cp1252 (0x7F, 0x81, 0x8D, 0x8F, 0x90, 0x9D) valent 556 (défaut
// AFM) ; l'espace insécable (0xA0) vaut celle de l'espace, le trait d'union
// conditionnel (0xAD) celle du trait d'union.
// prettier-ignore
const W_REGULAR = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 556,
    556, 556, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 556, 611, 556,
    556, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 556, 500, 667,
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
]
// prettier-ignore
const W_BOLD = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 556,
    556, 556, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 556, 611, 556,
    556, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 556, 500, 667,
    278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
    611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
]

const CP1252_HIGH = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
    0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
    0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
    0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
    0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
}

// Lettres sans décomposition Unicode : remplacement ASCII explicite.
const LETTER_FALLBACK = {
    ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ı: 'i', ħ: 'h', Ħ: 'H', ŧ: 't', Ŧ: 'T', ĸ: 'k', ŀ: 'l', Ŀ: 'L',
}

const NBSP = 0xa0
const DROPPED = -1

/** Code cp1252 direct d'un point de code, ou DROPPED si aucun. */
function directByte(cp) {
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) return 0x20
    if (cp >= 0x20 && cp < 0x7f) return cp
    if (cp >= 0xa0 && cp <= 0xff) return cp
    if (CP1252_HIGH[cp] !== undefined) return CP1252_HIGH[cp]
    return DROPPED
}

/** Un point de code Unicode → un octet WinAnsi, ou DROPPED (caractère invisible). */
function codePointToByte(cp) {
    // Espaces : fines et insécables (séparateur de milliers de Intl fr) → espace insécable.
    if (cp === 0x202f || cp === 0x2009 || cp === 0x2007 || cp === 0x2008 || cp === 0x2005 || cp === 0x2006) return NBSP
    if (cp >= 0x2000 && cp <= 0x200a) return 0x20
    if (cp === 0x3000) return 0x20
    // Invisibles (largeur nulle, marques directionnelles, BOM).
    if ((cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff || cp === 0x2060 || (cp >= 0x202a && cp <= 0x202e)) return DROPPED
    if (cp === 0x2212) return 0x2d // signe moins
    if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) return DROPPED
    if (cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) return DROPPED
    const d = directByte(cp)
    if (d !== DROPPED) return d
    const ch = String.fromCodePoint(cp)
    if (LETTER_FALLBACK[ch]) return LETTER_FALLBACK[ch].charCodeAt(0)
    // Retire l'accent : décomposition NFD, première lettre de base.
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (base && base !== ch) {
        const b = directByte(base.codePointAt(0))
        if (b !== DROPPED) return b
    }
    return 0x3f // « ? »
}

/**
 * Texte Unicode → octets WinAnsi (cp1252). Caractères invisibles retirés ;
 * hors cp1252 : accent retiré, à défaut « ? ».
 * @param {string} str
 * @returns {Uint8Array}
 */
export function encodeWinAnsi(str) {
    const out = []
    for (const ch of String(str ?? '')) {
        const b = codePointToByte(ch.codePointAt(0))
        if (b !== DROPPED) out.push(b)
    }
    return Uint8Array.from(out)
}

function widthOfByte(b, bold) {
    return (bold ? W_BOLD : W_REGULAR)[b - 32] ?? 556
}

/** Octets latin1 d'une chaîne ASCII/latin1. */
function latin1(s) {
    const u = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff
    return u
}

function concat(chunks, total) {
    const out = new Uint8Array(total)
    let o = 0
    for (const c of chunks) {
        out.set(c, o)
        o += c.length
    }
    return out
}

/** Nombre PDF : 2 décimales, sans zéros inutiles. */
function n(v) {
    const r = Math.round(Number(v) * 100) / 100
    if (!Number.isFinite(r)) return '0'
    return Object.is(r, -0) ? '0' : String(r)
}

/** '#RRGGBB' | '#RGB' → « r g b » (0 à 1). Illisible : noir. */
function rgbOps(color) {
    let h = String(color ?? '#000000').trim().replace(/^#/, '')
    if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.replace(/./g, (c) => c + c)
    if (!/^[0-9a-fA-F]{6}$/.test(h)) h = '000000'
    return [0, 2, 4].map((i) => n(parseInt(h.slice(i, i + 2), 16) / 255 + 0)).join(' ')
}

/** Chaîne littérale PDF depuis des octets WinAnsi (échappe ( ) \ et les octets non ASCII). */
function literal(bytes) {
    let s = '('
    for (const b of bytes) {
        if (b === 0x28 || b === 0x29 || b === 0x5c) s += '\\' + String.fromCharCode(b)
        else if (b < 32 || b > 126) s += '\\' + b.toString(8).padStart(3, '0')
        else s += String.fromCharCode(b)
    }
    return s + ')'
}

/** Chaîne de texte PDF pour /Info : ASCII littéral, sinon UTF-16BE avec BOM en hexadécimal. */
function textString(str) {
    const s = String(str ?? '')
    if (/^[\x20-\x7e]*$/.test(s)) return literal(latin1(s))
    let hex = 'FEFF'
    for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')
    return `<${hex}>`
}

function pdfDate(d) {
    const p = (v, l = 2) => String(v).padStart(l, '0')
    return `D:${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

/**
 * @param {{ title?: string, producer?: string, creationDate?: Date }} [opts]
 */
export function createPdf({ title = '', producer = 'NestorCut', creationDate } = {}) {
    const date = creationDate instanceof Date && !Number.isNaN(creationDate.getTime()) ? creationDate : new Date()
    const images = []
    const pages = []

    /** Largeur en points d'un texte (octets WinAnsi). */
    function measure(str, size = 10, bold = false) {
        let w = 0
        for (const b of encodeWinAnsi(str)) w += widthOfByte(b, bold)
        return (w * size) / 1000
    }

    /**
     * Retour à la ligne : coupe aux espaces (U+0020 ; les insécables ne
     * coupent pas), coupe dure d'un mot plus large que la ligne. `\n` force
     * une coupe. Ne renvoie jamais de ligne vide en fin.
     * @returns {string[]}
     */
    function wrap(str, maxWidth, size = 10, bold = false) {
        const lines = []
        for (const para of String(str ?? '').split(/\r\n|\r|\n/)) {
            let line = ''
            const push = () => {
                lines.push(line)
                line = ''
            }
            for (const word of para.split(' ')) {
                if (word === '') continue
                const cand = line === '' ? word : `${line} ${word}`
                if (measure(cand, size, bold) <= maxWidth) {
                    line = cand
                    continue
                }
                if (line !== '') push()
                if (measure(word, size, bold) <= maxWidth) {
                    line = word
                    continue
                }
                // Mot trop long : coupe dure caractère par caractère (au moins un par ligne).
                for (const ch of word) {
                    if (line !== '' && measure(line + ch, size, bold) > maxWidth) push()
                    line += ch
                }
            }
            lines.push(line)
        }
        while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
        return lines
    }

    /**
     * Enregistre une image RVB 8 bits (lignes de haut en bas).
     * @param {{ width: number, height: number, rgb: Uint8Array, alpha?: Uint8Array }} img
     * @returns {number} identifiant à passer à `page.image`
     */
    function addImage({ width, height, rgb, alpha } = {}) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
            throw new Error('addImage : largeur/hauteur invalides')
        }
        if (!rgb || rgb.length !== width * height * 3) throw new Error('addImage : rgb doit faire largeur*hauteur*3 octets')
        if (alpha && alpha.length !== width * height) throw new Error('addImage : alpha doit faire largeur*hauteur octets')
        images.push({ width, height, rgb, alpha: alpha || null })
        return images.length
    }

    function addPage(widthPt, heightPt) {
        const W = Number(widthPt)
        const H = Number(heightPt)
        if (!(W > 0) || !(H > 0)) throw new Error('addPage : dimensions invalides')
        const ops = []
        const used = new Set()
        const Y = (y) => H - y

        const hasFill = (o) => o.fill != null && o.fill !== false
        const hasStroke = (o) => o.stroke != null && o.stroke !== false
        // Sans fill ni stroke : trait noir.
        function paintOp(o) {
            if (hasFill(o) && hasStroke(o)) return 'B'
            return hasFill(o) ? 'f' : 'S'
        }
        function style(o) {
            let s = ''
            if (hasFill(o)) s += `${rgbOps(o.fill)} rg `
            if (hasStroke(o) || !hasFill(o)) {
                s += `${rgbOps(hasStroke(o) ? o.stroke : '#000000')} RG ${n(o.lineWidth ?? 1)} w `
            }
            return s
        }

        const page = {
            width: W,
            height: H,
            /** y = ligne de base. */
            text(x, y, str, { size = 10, bold = false, color = '#000000', align = 'left' } = {}) {
                const bytes = encodeWinAnsi(str)
                if (!bytes.length) return
                let px = x
                if (align !== 'left') {
                    const w = measure(str, size, bold)
                    px = align === 'center' ? x - w / 2 : x - w
                }
                ops.push(`BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${rgbOps(color)} rg ${n(px)} ${n(Y(y))} Td ${literal(bytes)} Tj ET`)
            },
            /** (x, y) = coin haut gauche. */
            rect(x, y, w, h, o = {}) {
                const r = Math.min(Math.max(Number(o.radius) || 0, 0), Math.min(w, h) / 2)
                const x0 = x
                const y0 = Y(y + h) // bas du rectangle, repère PDF
                let path
                if (r > 0) {
                    const k = r * 0.5523
                    const x1 = x0 + w
                    const y1 = y0 + h
                    path = [
                        `${n(x0 + r)} ${n(y0)} m`,
                        `${n(x1 - r)} ${n(y0)} l`,
                        `${n(x1 - r + k)} ${n(y0)} ${n(x1)} ${n(y0 + r - k)} ${n(x1)} ${n(y0 + r)} c`,
                        `${n(x1)} ${n(y1 - r)} l`,
                        `${n(x1)} ${n(y1 - r + k)} ${n(x1 - r + k)} ${n(y1)} ${n(x1 - r)} ${n(y1)} c`,
                        `${n(x0 + r)} ${n(y1)} l`,
                        `${n(x0 + r - k)} ${n(y1)} ${n(x0)} ${n(y1 - r + k)} ${n(x0)} ${n(y1 - r)} c`,
                        `${n(x0)} ${n(y0 + r)} l`,
                        `${n(x0)} ${n(y0 + r - k)} ${n(x0 + r - k)} ${n(y0)} ${n(x0 + r)} ${n(y0)} c`,
                        'h',
                    ].join(' ')
                } else {
                    path = `${n(x0)} ${n(y0)} ${n(w)} ${n(h)} re`
                }
                ops.push(`q ${style(o)}${path} ${paintOp(o)} Q`)
            },
            line(x1, y1, x2, y2, { stroke = '#000000', lineWidth = 1 } = {}) {
                ops.push(`q ${rgbOps(stroke)} RG ${n(lineWidth)} w ${n(x1)} ${n(Y(y1))} m ${n(x2)} ${n(Y(y2))} l S Q`)
            },
            polyline(points, o = {}) {
                if (!Array.isArray(points) || points.length < 2) return
                const parts = points.map((p, i) => `${n(p[0])} ${n(Y(p[1]))} ${i === 0 ? 'm' : 'l'}`)
                if (o.closed) parts.push('h')
                ops.push(`q ${style(o)}1 j 1 J ${parts.join(' ')} ${paintOp(o)} Q`)
            },
            /** (x, y) = coin haut gauche de l'image dessinée en w × h points. */
            image(id, x, y, w, h) {
                if (!Number.isInteger(id) || id < 1 || id > images.length) throw new Error('image : identifiant inconnu')
                used.add(id)
                ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(Y(y + h))} cm /Im${id} Do Q`)
            },
            _ops: ops,
            _used: used,
        }
        pages.push(page)
        return page
    }

    /** @returns {Uint8Array} le fichier PDF complet. */
    function save() {
        const chunks = []
        let total = 0
        const offsets = []
        const put = (u) => {
            chunks.push(u)
            total += u.length
        }
        const putObj = (id, dict, stream) => {
            offsets[id] = total
            put(latin1(`${id} 0 obj\n${dict}`))
            if (stream) {
                put(latin1('\nstream\n'))
                put(stream)
                put(latin1('\nendstream'))
            }
            put(latin1('\nendobj\n'))
        }

        // Numérotation : 1 catalogue, 2 pages, 3-4 polices, 5 info, puis images, puis pages.
        const imgIds = []
        let next = 6
        for (const im of images) {
            const smask = im.alpha ? next++ : 0
            imgIds.push({ id: next++, smask })
        }
        const pageIds = pages.map(() => ({ page: next++, content: next++ }))
        const count = next

        put(latin1('%PDF-1.4\n'))
        put(Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a))
        putObj(1, '<< /Type /Catalog /Pages 2 0 R >>')
        putObj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((p) => `${p.page} 0 R`).join(' ')}] >>`)
        putObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
        putObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
        putObj(5, `<< /Title ${textString(title)} /Producer ${textString(producer)} /CreationDate (${pdfDate(date)}) >>`)

        images.forEach((im, i) => {
            const { id, smask } = imgIds[i]
            if (smask) {
                const data = zlibSync(im.alpha)
                putObj(
                    smask,
                    `<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>`,
                    data,
                )
            }
            const data = zlibSync(im.rgb)
            putObj(
                id,
                `<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${smask ? ` /SMask ${smask} 0 R` : ''} /Filter /FlateDecode /Length ${data.length} >>`,
                data,
            )
        })

        pages.forEach((pg, i) => {
            const { page, content } = pageIds[i]
            const xobj = [...pg._used].map((id) => `/Im${id} ${imgIds[id - 1].id} 0 R`).join(' ')
            putObj(
                page,
                `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(pg.width)} ${n(pg.height)}] /Contents ${content} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobj ? ` /XObject << ${xobj} >>` : ''} >> >>`,
            )
            const data = zlibSync(latin1(pg._ops.join('\n')))
            putObj(content, `<< /Filter /FlateDecode /Length ${data.length} >>`, data)
        })

        const xrefAt = total
        let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
        for (let id = 1; id < count; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
        xref += `trailer\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
        put(latin1(xref))
        return concat(chunks, total)
    }

    return {
        addPage,
        addImage,
        measure,
        wrap,
        save,
        get pageCount() {
            return pages.length
        },
    }
}
