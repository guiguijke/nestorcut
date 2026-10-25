import { describe, expect, it } from 'vitest'
import { csvCell } from '../../admin/server/utils/csv'

describe('csvCell', () => {
    it.each(['=1+1', '+33', '-2', '@SUM(A1)', '\tx', '\rx'])('neutralise la formule %j', (v) => {
        expect(csvCell(v).replace(/^"/, '')[0]).toBe("'")
    })

    it('laisse le texte ordinaire et vide intacts', () => {
        expect(csvCell('Jean Dupont')).toBe('Jean Dupont')
        expect(csvCell(null)).toBe('')
        expect(csvCell('2026-09-01')).toBe('2026-09-01')
    })

    it('échappe guillemets, virgules et sauts de ligne', () => {
        expect(csvCell('a,"b"')).toBe('"a,""b"""')
        expect(csvCell('=HYPERLINK("x",y)')).toBe('"\'=HYPERLINK(""x"",y)"')
    })
})
