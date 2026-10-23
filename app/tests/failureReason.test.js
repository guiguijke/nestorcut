import { describe, expect, it } from 'vitest'
import { failureReasonKey } from '../utils/failureReason'
import en from '../utils/i18n/en'
import fr from '../utils/i18n/fr'
import de from '../utils/i18n/de'
import es from '../utils/i18n/es'
import it_ from '../utils/i18n/it'
import pt from '../utils/i18n/pt'

const CODES = [
    'memory_cap', 'entity_limit', 'geometry_missing', 'all_alternatives_invalid',
    'capacity_exceeded', 'item_geometry', 'part_too_large', 'spacing_too_large',
    'crash', 'local_interrupted', 'payload_build', 'pool_failed', 'local_unknown',
]

describe('failureReasonKey', () => {
    it('chaque code stable a une explication traduite dans les 6 langues', () => {
        for (const [name, dict] of Object.entries({ en, fr, de, es, it: it_, pt })) {
            for (const code of CODES) {
                const key = failureReasonKey(code)
                expect(key, code).toBeTruthy()
                expect(dict[key], `${name}:${key}`).toBeTruthy()
            }
        }
    })

    it('texte libre (worker / moteur) ou vide : null, la carte garde son libellé', () => {
        expect(failureReasonKey('This job does not fit the declared sheets')).toBeNull()
        expect(failureReasonKey('')).toBeNull()
        expect(failureReasonKey(null)).toBeNull()
        expect(failureReasonKey('toString')).toBeNull()
    })
})
