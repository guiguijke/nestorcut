import { beforeEach, describe, expect, it } from 'vitest'
import {
    LOGIN_FAIL_LIMIT,
    LOGIN_FAIL_WINDOW_MS,
    _clearLoginBuckets,
    MAX_TRACKED_EMAILS,
    loginRetryAfterMs,
    recordLoginFailure,
    reserveLoginAttempt,
    resetLoginFailures,
    trackedEmailCount,
} from '../../admin/server/utils/loginRateLimit'

// S-6 — limite des échecs de connexion admin (5 / 15 min, IP et identifiant).

beforeEach(() => _clearLoginBuckets())

describe('admin login rate limit', () => {
    it('autorise jusqu\'à 5 échecs puis bloque avec le délai restant', () => {
        const t0 = 1_000_000
        for (let i = 0; i < LOGIN_FAIL_LIMIT; i++) {
            expect(loginRetryAfterMs('1.1.1.1', 'a@x.fr', t0)).toBe(0)
            recordLoginFailure('1.1.1.1', 'a@x.fr', t0)
        }
        expect(loginRetryAfterMs('1.1.1.1', 'a@x.fr', t0 + 1000)).toBe(LOGIN_FAIL_WINDOW_MS - 1000)
    })

    it('le blocage par identifiant vaut pour toute IP', () => {
        for (let i = 0; i < LOGIN_FAIL_LIMIT; i++) recordLoginFailure(`9.9.9.${i}`, 'a@x.fr')
        expect(loginRetryAfterMs('2.2.2.2', 'a@x.fr')).toBeGreaterThan(0)
        expect(loginRetryAfterMs('2.2.2.2', 'b@x.fr')).toBe(0)
    })

    it('le blocage par IP vaut pour tout identifiant', () => {
        for (let i = 0; i < LOGIN_FAIL_LIMIT; i++) recordLoginFailure('1.1.1.1', `u${i}@x.fr`)
        expect(loginRetryAfterMs('1.1.1.1', 'autre@x.fr')).toBeGreaterThan(0)
    })

    it('un succès réinitialise le compteur de l\'identifiant', () => {
        for (let i = 0; i < 4; i++) recordLoginFailure('1.1.1.1', 'a@x.fr')
        resetLoginFailures('a@x.fr')
        recordLoginFailure('3.3.3.3', 'a@x.fr')
        expect(loginRetryAfterMs('3.3.3.3', 'a@x.fr')).toBe(0)
    })

    it('la fenêtre expire', () => {
        const t0 = 5_000_000
        for (let i = 0; i < LOGIN_FAIL_LIMIT; i++) recordLoginFailure('1.1.1.1', 'a@x.fr', t0)
        expect(loginRetryAfterMs('1.1.1.1', 'a@x.fr', t0 + LOGIN_FAIL_WINDOW_MS)).toBe(0)
    })

    it('une rafale parallèle ne dépasse pas la limite (réservation avant bcrypt)', () => {
        const granted = Array.from({ length: 20 }, () => reserveLoginAttempt('1.1.1.1', 'a@x.fr')).filter((w) => w === 0)
        expect(granted).toHaveLength(LOGIN_FAIL_LIMIT)
    })

    it("un succès libère la réservation de l'IP et l'identifiant", () => {
        for (let i = 0; i < 4; i++) reserveLoginAttempt('1.1.1.1', `u${i}@x.fr`)
        expect(reserveLoginAttempt('1.1.1.1', 'a@x.fr')).toBe(0) // 5e, IP à 5
        resetLoginFailures('a@x.fr', '1.1.1.1') // succès
        expect(reserveLoginAttempt('1.1.1.1', 'b@x.fr')).toBe(0)
    })

    it("le nombre d'identifiants suivis est plafonné", () => {
        for (let i = 0; i < MAX_TRACKED_EMAILS + 50; i++) recordLoginFailure('1.1.1.1', `m${i}@x.fr`)
        expect(trackedEmailCount()).toBe(MAX_TRACKED_EMAILS)
    })
})
