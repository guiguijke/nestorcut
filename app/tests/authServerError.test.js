import { describe, expect, it } from 'vitest'
import { mapAuthServerError } from '../utils/authServerError'

// Erreur $fetch telle que la reçoit app/pages/auth/local.vue : ofetch range
// le CORPS Nitro dans err.data, le payload de createError est en
// err.data.data (forme relevée sur le serveur compilé, 2026-11-03). Lire
// err.data.code affichait « Something went wrong » pour un mauvais mot de
// passe en production.
const fetchError = (statusCode, data) => ({
    name: 'FetchError',
    statusCode,
    data: { error: true, url: '/api/auth/local/login', statusCode, statusMessage: 'x', message: 'x', data },
})
const t = (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key)

describe('mapAuthServerError — code stable → message', () => {
    it('identifiants invalides : message dédié, pas le générique', () => {
        expect(mapAuthServerError(fetchError(401, { code: 'invalid_credentials' }), t)).toEqual({
            text: 'auth.error.invalid_credentials',
            field: undefined,
            code: 'invalid_credentials',
        })
    })

    it('rate limit : minutes arrondies au supérieur', () => {
        expect(mapAuthServerError(fetchError(429, { code: 'rate_limited', retryAfterSec: 61 }), t).text).toBe(
            'auth.rateLimited:{"n":2}',
        )
    })

    it('e-mail d’un compte Google : champ e-mail, code pour le bouton Google', () => {
        expect(mapAuthServerError(fetchError(409, { code: 'email_taken_google', field: 'email' }), t)).toEqual({
            text: 'auth.error.email_taken_google',
            field: 'email',
            code: 'email_taken_google',
        })
    })

    it('sans Google configuré : message « compte existant », pas d’impasse', () => {
        const err = fetchError(409, { code: 'email_taken_google', field: 'email' })
        expect(mapAuthServerError(err, t, { googleEnabled: false })).toEqual({
            text: 'auth.error.email_taken',
            field: 'email',
            code: 'email_taken',
        })
    })

    it('code inconnu ou panne réseau : message générique', () => {
        expect(mapAuthServerError(fetchError(500, undefined), t)).toEqual({ text: 'auth.errorGeneric' })
        expect(mapAuthServerError(new TypeError('Failed to fetch'), t)).toEqual({ text: 'auth.errorGeneric' })
    })
})
