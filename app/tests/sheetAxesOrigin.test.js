import { describe, expect, it } from 'vitest'
import { engineToDisplay, sheetAxesDisplay } from '../utils/sheetView'
import {
    ORIGIN_KEY,
    effectiveOrigin,
    originChoiceOffered,
    readOrigin,
    writeOrigin,
} from '../utils/originChoice'

// Lot positions : le repère X/Y de l'aperçu suit le zéro choisi pour les fichiers.

describe('sheetAxesDisplay : origine au centre', () => {
    it('par défaut (coin) : sortie inchangée, même objet de valeurs', () => {
        for (const [w, h] of [[400, 300], [300, 400], [153, 153]]) {
            expect(sheetAxesDisplay(w, h, 'corner')).toEqual(sheetAxesDisplay(w, h))
            expect(sheetAxesDisplay(w, h, 'autre')).toEqual(sheetAxesDisplay(w, h))
        }
    })

    it('paysage : le repère part du centre, X vers la droite, Y vers le haut de l\'écran', () => {
        const a = sheetAxesDisplay(400, 300, 'center')
        expect(a.origin).toEqual({ x: 200, y: 150 })
        expect(a.xTo.y).toBe(a.origin.y)
        expect(a.xTo.x).toBeGreaterThan(a.origin.x)
        expect(a.yTo.x).toBe(a.origin.x)
        expect(a.yTo.y).toBeLessThan(a.origin.y)
        expect(a.xTo.x - a.origin.x).toBeCloseTo(a.origin.y - a.yTo.y, 9)
    })

    it('portrait tourné : X vers le BAS de l\'écran, Y vers la droite, comme le tracé au coin', () => {
        const a = sheetAxesDisplay(300, 400, 'center')
        const corner = sheetAxesDisplay(300, 400)
        expect(a.origin).toEqual({ x: 200, y: 150 })
        // mêmes directions que le repère au coin : seule l'origine change
        const dir = (ax) => [Math.sign(ax.xTo.x - ax.origin.x), Math.sign(ax.xTo.y - ax.origin.y), Math.sign(ax.yTo.x - ax.origin.x), Math.sign(ax.yTo.y - ax.origin.y)]
        expect(dir(a)).toEqual(dir(corner))
        expect(dir(a)).toEqual([0, 1, 1, 0])
        expect(a.len).toBe(corner.len)
    })

    it('le centre affiché est l\'image du centre de la tôle par la transformation d\'affichage', () => {
        for (const [w, h] of [[400, 300], [300, 400], [153, 153]]) {
            const [ex, ey] = engineToDisplay(w / 2, h / 2, w, h)
            const a = sheetAxesDisplay(w, h, 'center')
            expect(a.origin.x).toBeCloseTo(ex, 9)
            expect(a.origin.y).toBeCloseTo(ey, 9)
            // les pointes restent dans la tôle affichée
            for (const p of [a.xTo, a.yTo]) {
                expect(p.x).toBeGreaterThan(0)
                expect(p.x).toBeLessThan(a.viewW)
                expect(p.y).toBeGreaterThan(0)
                expect(p.y).toBeLessThan(a.viewH)
            }
        }
    })
})

describe('origine retenue par navigateur', () => {
    const store = (init = {}, { throws = false } = {}) => {
        const m = { ...init }
        return {
            getItem: (k) => { if (throws) throw new Error('denied'); return k in m ? m[k] : null },
            setItem: (k, v) => { if (throws) throw new Error('denied'); m[k] = String(v) },
            m,
        }
    }

    it('défaut coin ; valeur inconnue, vide, stockage absent ou qui lève : coin', () => {
        expect(readOrigin(store())).toBe('corner')
        expect(readOrigin(store({ [ORIGIN_KEY]: 'diagonal' }))).toBe('corner')
        expect(readOrigin(store({ [ORIGIN_KEY]: '' }))).toBe('corner')
        expect(readOrigin(undefined)).toBe('corner')
        expect(readOrigin(null)).toBe('corner')
        expect(readOrigin(store({}, { throws: true }))).toBe('corner')
    })

    it('écriture puis relecture ; un stockage qui lève ne casse rien', () => {
        const s = store()
        writeOrigin(s, 'center')
        expect(readOrigin(s)).toBe('center')
        writeOrigin(s, 'n\'importe quoi')
        expect(readOrigin(s)).toBe('corner')
        expect(() => writeOrigin(store({}, { throws: true }), 'center')).not.toThrow()
        expect(() => writeOrigin(undefined, 'center')).not.toThrow()
    })

    it('le choix n\'est proposé que pour un résultat local sans .job et utilisable', () => {
        expect(originChoiceOffered({ isLocal: true, hasJobs: false, usable: true })).toBe(true)
        expect(originChoiceOffered({ isLocal: true, hasJobs: true, usable: true })).toBe(false)
        expect(originChoiceOffered({ isLocal: false, hasJobs: false, usable: true })).toBe(false)
        expect(originChoiceOffered({ isLocal: true, hasJobs: false, usable: false })).toBe(false)
        expect(originChoiceOffered()).toBe(false)
    })

    it('origine effective : jamais un centre sur un résultat qui ne l\'offre pas', () => {
        expect(effectiveOrigin(true, 'center')).toBe('center')
        expect(effectiveOrigin(true, 'corner')).toBe('corner')
        expect(effectiveOrigin(false, 'center')).toBe('corner')
        expect(effectiveOrigin(true, 'x')).toBe('corner')
    })
})
