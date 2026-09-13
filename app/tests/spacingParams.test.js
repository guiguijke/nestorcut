import { describe, expect, it } from 'vitest'
import {
    paramNumber,
    round4Str,
    safetyPatchForTargetMm,
    spacingFromKerfSafety,
    withKerfDefaults,
} from '../utils/spacingParams'

// ---------------------------------------------------------------------------
// Kerf explicite (B.4 / masterplan 3.10), puis CHANGEMENT DE RÈGLE du 13/09
// (étude SheetCam §9.40, décision du propriétaire) : l'espacement effectif
// (`space`, la clé moteur/API inchangée) vaut désormais 2 × kerf + sécurité.
//
// Les deux verrous qui comptent : la règle elle-même, et le fait qu'AUCUN
// projet existant ne change d'espacement en traversant la migration — les
// deux champs sont en production depuis B.4.
// ---------------------------------------------------------------------------

describe('round4Str / paramNumber', () => {
    it('élimine le bruit flottant de la somme', () => {
        expect(round4Str(0.15 * 2)).toBe('0.3')
        expect(round4Str(0.1 + 0.2)).toBe('0.3')
    })
    it('accepte la virgule décimale saisie', () => {
        expect(paramNumber('1,5')).toBe(1.5)
        expect(paramNumber(undefined)).toBe(0)
        expect(paramNumber('abc')).toBe(0)
    })
})

describe('spacingFromKerfSafety (règle affichée)', () => {
    it('space = 2 × kerf + sécurité', () => {
        expect(spacingFromKerfSafety('0', '2')).toBe('2')
        expect(spacingFromKerfSafety('0.5', '1')).toBe('2')
        expect(spacingFromKerfSafety('0', '0.1')).toBe('0.1')
        expect(spacingFromKerfSafety('0.15', '0.15')).toBe('0.45')
    })
    it('le kerf du `.job` du propriétaire : 1,5 + 1 mm de sécurité = 4 mm', () => {
        // §9.40 : « Sur la recette (kerf 1,5) : 4 mm au lieu de 2. »
        expect(spacingFromKerfSafety('1.5', '1')).toBe('4')
    })
})

describe('withKerfDefaults (migration projets existants)', () => {
    it('params d’avant B.4 (space seul) → effectif IDENTIQUE', () => {
        for (const space of ['0.1', '2', '2.4', '0', '1.5']) {
            const migrated = withKerfDefaults({ space })
            expect(migrated.kerf).toBe('0')
            expect(spacingFromKerfSafety(migrated.kerf, migrated.safety)).toBe(space)
        }
    })

    it('params écrit sous l’ANCIENNE règle → effectif IDENTIQUE, kerf gardé', () => {
        // `kerf + 2 × sécurité` = 2,4 ; sous la nouvelle règle il faut
        // sécurité = 2,4 − 2 × 0,4 = 1,6 pour livrer le MÊME espacement.
        const p = { space: '2.4', kerf: '0.4', safety: '1' }
        const m = withKerfDefaults(p)
        expect(m.kerf).toBe('0.4')
        expect(m.safety).toBe('1.6')
        expect(spacingFromKerfSafety(m.kerf, m.safety)).toBe('2.4')
    })

    it('quand le kerf seul dépasse l’espacement, c’est l’ESPACEMENT qu’on garde', () => {
        // Un `.job` importé sous l'ancienne règle : kerf 1,5 + 2 × 0,25 = 2.
        // Deux kerfs valent déjà 3 : impossible de garder les deux. Le projet
        // a été CALCULÉ à 2 mm, c'est ce 2 mm qui doit survivre.
        const m = withKerfDefaults({ space: '2', kerf: '1.5', safety: '0.25' })
        expect(spacingFromKerfSafety(m.kerf, m.safety)).toBe('2')
        expect(m.kerf).toBe('0')
    })

    it('laisse intact un params déjà à la nouvelle règle', () => {
        const p = { space: '2.4', kerf: '0.2', safety: '2' }
        expect(withKerfDefaults(p)).toBe(p)
    })

    it('ne réécrit pas un params qui ne suit AUCUNE des deux règles', () => {
        const p = { space: '7', kerf: '0.4', safety: '1' }
        expect(withKerfDefaults(p)).toBe(p)
    })

    it('est idempotente', () => {
        const once = withKerfDefaults({ space: '2.4', kerf: '0.4', safety: '1' })
        expect(withKerfDefaults(once)).toBe(once)
    })
})

describe("safetyPatchForTargetMm (levier « réduire l'espacement »)", () => {
    it('réduit la sécurité, pas le kerf', () => {
        expect(safetyPatchForTargetMm(0.4, 2)).toEqual({ safetyMm: 1.2 })
        expect(safetyPatchForTargetMm(0, 0)).toBeNull()
    })
    it('cible inférieure ou égale aux DEUX kerfs → impossible (levier masqué)', () => {
        expect(safetyPatchForTargetMm(0.5, 1)).toBeNull()
        expect(safetyPatchForTargetMm(0.5, 0.9)).toBeNull()
    })
})

describe('défauts d\'usine (B.4, règle du 13/09)', () => {
    it('kerf 0 + sécurité 2 mm = espacement effectif 2 mm', () => {
        // Miroir de factoryParams() — le défaut PRODUIT reste 2 mm ; c'est la
        // répartition entre les deux champs qui change avec la règle.
        expect(spacingFromKerfSafety('0', '2')).toBe('2')
    })
})
