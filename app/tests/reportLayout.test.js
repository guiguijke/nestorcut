import { describe, expect, it } from 'vitest'
import { nbspDims, showSheetOffcutColumn } from '../utils/reportLayout'

describe('mise en page du rapport', () => {
    it('les dimensions ne contiennent aucun espace sécable', () => {
        const s = nbspDims('796', '2000', 'mm')
        expect(s).toBe('796\u00a0×\u00a02000\u00a0mm')
        expect(/ /.test(s)).toBe(false)
    })

    it('en pouces le guillemet colle au chiffre', () => {
        expect(nbspDims('48', '96', '"')).toBe('48\u00a0×\u00a096"')
    })

    it('une seule tôle : la chute est dans le bloc de tête, pas dans le tableau', () => {
        const sheets = [{ offcut: { widthMm: 796, heightMm: 2000 } }]
        expect(showSheetOffcutColumn(sheets, { widthMm: 796, heightMm: 2000 })).toBe(false)
    })

    it('plusieurs tôles : une chute chacune, la colonne reste', () => {
        const sheets = [{ offcut: {} }, { offcut: {} }]
        expect(showSheetOffcutColumn(sheets, { widthMm: 1 })).toBe(true)
    })

    it('une seule tôle sans chute en tête : rien n\'est perdu, la colonne reste', () => {
        expect(showSheetOffcutColumn([{ offcut: { widthMm: 5 } }], null)).toBe(true)
        expect(showSheetOffcutColumn([{ offcut: null }], null)).toBe(false)
    })
})
