import { describe, expect, it } from 'vitest'
import { flagOn } from '../utils/runtimeFlag'

// AGENTS #29 : un override runtime NUXT_PUBLIC_* arrive en chaîne.
describe('flagOn', () => {
    it('true booléen et chaîne "true" = vrai', () => {
        expect(flagOn(true)).toBe(true)
        expect(flagOn('true')).toBe(true)
    })

    it('tout le reste = faux (dont la chaîne "false", qui est truthy)', () => {
        expect(flagOn(false)).toBe(false)
        expect(flagOn('false')).toBe(false)
        expect(flagOn(undefined)).toBe(false)
        expect(flagOn(null)).toBe(false)
        expect(flagOn(1)).toBe(false)
        expect(flagOn('1')).toBe(false)
        expect(flagOn('TRUE')).toBe(false)
    })
})
