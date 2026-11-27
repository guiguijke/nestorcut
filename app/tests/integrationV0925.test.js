import { describe, expect, it } from 'vitest'
import { numbersMissingReason } from '../utils/reportPdfModel'
import { parseSheetSvg } from '../utils/sheetSvgReport'
import { widenSvgViewBox } from '../utils/overhangView'

// Sortie groupée V0.9.25 : défauts trouvés en réunissant le rapport PDF et la
// distance au bord sur « Nos serveurs ».

describe('rapport PDF : raison des numéros de pièces absents', () => {
    it('record local d’avant les numéros : « old »', () => {
        expect(numbersMissingReason(true, { alternatives: [] })).toBe('old')
    })
    it('calcul fait ici sur un payload préparé par nos serveurs : « server », pas « avant cette version »', () => {
        expect(numbersMissingReason(true, { serverPrepared: true })).toBe('server')
    })
    it('résultat serveur : « server »', () => {
        expect(numbersMissingReason(false, null)).toBe('server')
    })
})

describe('rapport PDF : plan d’une tôle dont une pièce dépasse du bord', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">'
        + '<rect x="0" y="0" width="100" height="50" />'
        + '<path d="M0 0 10 0 10 10 0 10Z" transform="translate(-3 20)" fill="#ff0000" /></svg>'

    it('sans dépassement : coordonnées inchangées', () => {
        const p = parseSheetSvg(svg)
        expect(p.widthMm).toBe(100)
        expect(p.parts[0].rings[0][0]).toEqual([-3, 20])
    })
    it('cadre élargi de 5 mm : image de 110 × 60 et pièce décalée de 5 mm, donc dans l’image', () => {
        const p = parseSheetSvg(widenSvgViewBox(svg, 5))
        expect(p.widthMm).toBe(110)
        expect(p.heightMm).toBe(60)
        expect(p.parts[0].rings[0][0]).toEqual([2, 25])
        const xs = p.parts[0].rings[0].map(([x]) => x)
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    })
})
