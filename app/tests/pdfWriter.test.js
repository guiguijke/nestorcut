import { describe, expect, it } from 'vitest'
import { createPdf, encodeWinAnsi } from '~~/app/utils/pdfWriter'
import { checkPdfStructure, pageStreams } from './pdfTestHelpers'

const sample = (text) => {
    const doc = createPdf({ title: 'T', creationDate: new Date(Date.UTC(2026, 10, 27, 9, 30, 0)) })
    doc.addPage(200, 200).text(10, 20, text)
    return pageStreams(doc.save()).join('\n')
}

describe('createPdf : structure', () => {
    it('en-tête, EOF, xref exacte, startxref juste', () => {
        const doc = createPdf({ title: 'Rapport', creationDate: new Date(Date.UTC(2026, 10, 27, 9, 30, 0)) })
        const p = doc.addPage(595.28, 841.89)
        p.text(40, 60, 'Bonjour', { size: 14, bold: true })
        p.rect(10, 10, 50, 20, { fill: '#2563EB', radius: 4 })
        p.line(0, 0, 100, 100)
        p.polyline([[1, 1], [5, 9], [12, 0]], { stroke: '#16A34A', lineWidth: 2 })
        doc.addPage(100, 100)
        const bytes = doc.save()
        const { s } = checkPdfStructure(bytes)
        expect(s).toContain('/Count 2')
        expect(s).toContain('/BaseFont /Helvetica-Bold')
        expect(s).toContain('/WinAnsiEncoding')
        expect(s).toContain('/Producer (NestorCut)')
        expect(s).toContain('/CreationDate (D:20261127093000Z)')
        expect(s).toContain('/MediaBox [0 0 595.28 841.89]')
    })

    it('titre non ASCII encodé en UTF-16BE avec BOM', () => {
        const doc = createPdf({ title: 'Tôle é', creationDate: new Date(0) })
        doc.addPage(10, 10)
        const { s } = checkPdfStructure(doc.save())
        expect(s).toContain('/Title <FEFF005400F4006C0065002000E9>')
    })

    it('déterministe avec creationDate injectée', () => {
        const mk = () => {
            const d = createPdf({ title: 'x', creationDate: new Date(Date.UTC(2026, 0, 1)) })
            d.addPage(50, 50).text(1, 10, 'a')
            return Buffer.from(d.save()).toString('hex')
        }
        expect(mk()).toBe(mk())
    })

    it('repère haut-gauche converti vers le repère PDF', () => {
        const doc = createPdf({})
        doc.addPage(200, 100).text(10, 20, 'A')
        expect(pageStreams(doc.save())[0]).toContain('10 80 Td')
    })

    it('les flux de contenu sont compressés en Flate', () => {
        const doc = createPdf({})
        doc.addPage(50, 50).text(1, 10, 'abc')
        const bytes = doc.save()
        expect(Buffer.from(bytes).toString('latin1')).toContain('/Filter /FlateDecode')
        expect(pageStreams(bytes)[0]).toContain('(abc) Tj')
    })
})

describe('encodage WinAnsi', () => {
    const bytes = (s) => [...encodeWinAnsi(s)]
    it('accents et symboles cp1252', () => {
        expect(bytes('é')).toEqual([0xe9])
        expect(bytes('€')).toEqual([0x80])
        expect(bytes('×')).toEqual([0xd7])
        expect(bytes('²')).toEqual([0xb2])
        expect(bytes('«»')).toEqual([0xab, 0xbb])
        expect(bytes('–—…’')).toEqual([0x96, 0x97, 0x85, 0x92])
        expect(bytes('ñßçãõìÿ')).toEqual([0xf1, 0xdf, 0xe7, 0xe3, 0xf5, 0xec, 0xff])
    })
    it('espaces fines et insécables', () => {
        for (const sp of [' ', ' ', ' ']) expect([0x20, 0xa0]).toContain(bytes(`1${sp}2`)[1])
        expect(bytes('1 000')).toEqual([0x31, 0xa0, 0x30, 0x30, 0x30])
    })
    it('hors cp1252 : accent retiré, sinon « ? »', () => {
        expect(bytes('ł')).toEqual([0x6c])
        expect(bytes('ő')).toEqual([0x6f])
        expect(bytes('ă')).toEqual([0x61])
        expect(bytes('中')).toEqual([0x3f])
        expect(bytes('😀')).toEqual([0x3f])
    })
    it('échappe ( ) et \\ dans le flux et écrit les octets hauts en octal', () => {
        const c = sample('a(b)c\\d é')
        expect(c).toContain('(a\\(b\\)c\\\\d \\351)')
    })
})

describe('mesure et retour à la ligne', () => {
    const doc = createPdf({})
    it('mesure cohérente avec la table AFM', () => {
        expect(doc.measure(' ', 1000)).toBe(278)
        expect(doc.measure('a', 1000)).toBe(556)
        expect(doc.measure('m', 1000)).toBe(833)
        expect(doc.measure('W', 1000)).toBe(944)
        expect(doc.measure('m', 1000, true)).toBe(889)
        expect(doc.measure('é', 1000)).toBe(556)
        expect(doc.measure('€', 1000)).toBe(556)
        expect(doc.measure('aa', 10)).toBeCloseTo(11.12, 6)
        expect(doc.measure('1 000', 1000)).toBe(556 + 278 + 556 * 3)
    })
    it('wrap coupe aux espaces', () => {
        const lines = doc.wrap('un deux trois quatre cinq', doc.measure('un deux', 10) + 0.1, 10)
        expect(lines).toEqual(['un deux', 'trois', 'quatre', 'cinq'])
        for (const l of lines) expect(doc.measure(l, 10)).toBeLessThanOrEqual(doc.measure('un deux', 10) + 0.1)
    })
    it('wrap : coupe dure d un mot trop long, retour forcé', () => {
        const w = doc.measure('aaaa', 10)
        const lines = doc.wrap('aaaaaaaaaa bb', w, 10)
        expect(lines.join('')).toBe('aaaaaaaaaabb')
        for (const l of lines) expect(doc.measure(l, 10)).toBeLessThanOrEqual(w + 1e-9)
        expect(doc.wrap('a\nb', 500, 10)).toEqual(['a', 'b'])
        expect(doc.wrap('', 100, 10)).toEqual([''])
    })
    it('wrap ne coupe pas une espace insécable', () => {
        expect(doc.wrap('12 345 kg', 10000, 10)).toEqual(['12 345 kg'])
    })
})

describe('images', () => {
    it('RVB seul : pas de /SMask', () => {
        const doc = createPdf({})
        const id = doc.addImage({ width: 2, height: 1, rgb: new Uint8Array(6) })
        doc.addPage(100, 100).image(id, 0, 0, 50, 25)
        const { s } = checkPdfStructure(doc.save())
        expect(s).toContain('/ColorSpace /DeviceRGB')
        expect(s).not.toContain('/SMask')
        expect(s).toContain('/XObject << /Im1 ')
    })
    it('avec alpha : /SMask en DeviceGray', () => {
        const doc = createPdf({})
        const id = doc.addImage({ width: 2, height: 2, rgb: new Uint8Array(12).fill(200), alpha: Uint8Array.of(0, 128, 255, 255) })
        doc.addPage(100, 100).image(id, 5, 5, 40, 40)
        const { s } = checkPdfStructure(doc.save())
        expect(s).toMatch(/\/SMask \d+ 0 R/)
        expect(s).toContain('/ColorSpace /DeviceGray')
    })
    it('refuse une image incohérente et un identifiant inconnu', () => {
        const doc = createPdf({})
        expect(() => doc.addImage({ width: 2, height: 2, rgb: new Uint8Array(3) })).toThrow()
        expect(() => doc.addPage(10, 10).image(9, 0, 0, 1, 1)).toThrow()
    })
})
