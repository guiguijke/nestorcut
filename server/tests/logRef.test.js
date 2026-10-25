import { describe, expect, it } from 'vitest'
import { logRef } from '~~/server/utils/logRef'

describe('logRef', () => {
    it('est stable et renvoie 8 caractères hexadécimaux', () => {
        const ref = logRef('local:jane@example.com')
        expect(ref).toMatch(/^[0-9a-f]{8}$/)
        expect(logRef('local:jane@example.com')).toBe(ref)
        expect(logRef('local:other@example.com')).not.toBe(ref)
    })

    it('ne contient jamais l\'identifiant brut', () => {
        expect(logRef('local:jane@example.com')).not.toContain('jane')
        expect(logRef('local:jane@example.com')).not.toContain('@')
    })

    it('renvoie null si l\'identifiant est absent', () => {
        expect(logRef(undefined)).toBeNull()
        expect(logRef(null)).toBeNull()
        expect(logRef('')).toBeNull()
    })
})
