import { describe, expect, it } from 'vitest'
import { DXF_ORIGIN_UNSUPPORTED, dxfUnitScale, shiftDxf } from '../utils/dxfOrigin'

// Lot positions : durcissement de shiftDxf et de la lecture de l'unité.

const HEAD = (units = '4') => `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n9\n$INSUNITS\n70\n${units}\n9\n$MEASUREMENT\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n0\nLAYER\n2\n0\n70\n0\n62\n7\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n`
const doc = (body, units) => `${HEAD(units)}${body}0\nENDSEC\n0\nEOF\n`

describe('$INSUNITS d\'un record ancien', () => {
    it('« 4.0 » et « 1.0 » (entiers écrits en flottant avant le 12/09) sont lus', () => {
        expect(dxfUnitScale(doc('', '4.0'))).toBe(1)
        expect(dxfUnitScale(doc('', '1.0'))).toBe(1 / 25.4)
        expect(dxfUnitScale(doc('', '4'))).toBe(1)
        expect(() => dxfUnitScale(doc('', '5.0'))).toThrow(DXF_ORIGIN_UNSUPPORTED)
        expect(() => dxfUnitScale(doc('', 'mm'))).toThrow(DXF_ORIGIN_UNSUPPORTED)
    })
})

describe('shiftDxf refuse élévation, épaisseur et extrusion', () => {
    const circle = (extra) => doc(`0\nCIRCLE\n5\n1\n8\n0\n10\n5.0\n20\n5.0\n40\n3.0\n${extra}`)
    it('groupes 38, 39 et 210 à 239 : refus ; un cercle ordinaire passe', () => {
        expect(() => shiftDxf(circle(''), 1, 1)).not.toThrow()
        for (const g of ['38\n2.0\n', '39\n1.0\n', '210\n0.0\n', '220\n0.0\n', '230\n-1.0\n', '239\n0\n']) {
            expect(() => shiftDxf(circle(g), 1, 1), g).toThrow(DXF_ORIGIN_UNSUPPORTED)
        }
    })
    it('les mêmes groupes ailleurs que dans ENTITIES (en-tête, tables) ne sont pas confondus', () => {
        const ok = HEAD().replace('9\n$MEASUREMENT', '9\n$TEXTSIZE\n40\n2.5\n9\n$MEASUREMENT')
        expect(() => shiftDxf(`${ok}0\nENDSEC\n0\nEOF\n`, 1, 1)).not.toThrow()
    })
})
