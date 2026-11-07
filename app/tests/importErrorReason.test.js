import { describe, expect, it } from 'vitest'
import { importErrorReasonKey } from '../utils/importErrorReason'
import { translate } from '../utils/i18n'

// Lot A-15 — la cause stable d'un échec DWG (`importErrorCode`) devient un
// libellé actionnable ; sans code, rien (la carte garde « Échec de l'import »).

const CODES = [
    'dwg_converter_missing', 'dwg_timeout', 'dwg_version_unsupported',
    'dwg_conversion_failed', 'dwg_output_unreadable', 'paper_space_only',
]

describe('importErrorReasonKey', () => {
    it('chaque code du worker a une clé traduite dans les 6 langues', () => {
        for (const code of CODES) {
            const key = importErrorReasonKey(code)
            expect(key, code).toBeTruthy()
            for (const lang of ['fr', 'en', 'de', 'es', 'it', 'pt']) {
                expect(translate(key, lang), `${lang}:${key}`).not.toBe(key)
            }
        }
    })

    it('un dessin tout en espace papier dit la cause et la sortie (fr, en)', () => {
        const key = importErrorReasonKey('paper_space_only')
        expect(translate(key, 'fr')).toContain('espace papier')
        expect(translate(key, 'fr')).toContain('espace objet')
        expect(translate(key, 'en')).toContain('paper space')
        expect(translate(key, 'en')).toContain('model space')
    })

    it('la version trop récente dit la cause et la sortie (fr, en)', () => {
        const key = importErrorReasonKey('dwg_version_unsupported')
        expect(translate(key, 'fr')).toContain('AutoCAD 2013')
        expect(translate(key, 'fr')).toContain('DXF')
        expect(translate(key, 'en')).toContain('AutoCAD 2013')
    })

    it('sans code, code inconnu ou code libre : null (repli sur le libellé seul)', () => {
        expect(importErrorReasonKey(undefined)).toBeNull()
        expect(importErrorReasonKey(null)).toBeNull()
        expect(importErrorReasonKey('')).toBeNull()
        expect(importErrorReasonKey('Processing made no progress after 3 attempts')).toBeNull()
        expect(importErrorReasonKey('toString')).toBeNull()
    })
})
