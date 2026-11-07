import { describe, expect, it } from 'vitest'
import { DICTS, LOCALES } from '../utils/i18n'


describe('« Terminé » partout', () => {
    it.each(LOCALES.map((l) => l.code || l))('le badge de la vue en direct dit comme la carte (%s)', (code) => {
        const d = DICTS[code]
        expect(d['live.feasible']).toBe(d['result.state.done'])
    })
})
