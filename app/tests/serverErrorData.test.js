import { describe, expect, it } from 'vitest'
import { serverErrorData } from '../utils/serverErrorData'

// Forme relevée sur le serveur compilé (2026-11-03) : POST
// /api/auth/local/register avec un e-mail invalide répond
// { error, url, statusCode, statusMessage, message, data: { code, field } },
// et ofetch range ce corps dans FetchError.data.
const fetchError = (data) => ({
    name: 'FetchError',
    statusCode: 409,
    data: {
        error: true,
        url: '/api/auth/local/register',
        statusCode: 409,
        statusMessage: 'An account with this email already exists',
        message: 'An account with this email already exists',
        data,
    },
})

describe('serverErrorData — code stable d’une erreur $fetch', () => {
    it('lit le code imbriqué du corps Nitro', () => {
        expect(serverErrorData(fetchError({ code: 'email_taken_google', field: 'email' }))).toEqual({
            code: 'email_taken_google',
            field: 'email',
        })
        expect(serverErrorData(fetchError({ code: 'rate_limited', retryAfterSec: 120 })).retryAfterSec).toBe(120)
    })

    it('repli sur la forme plate, puis objet vide', () => {
        expect(serverErrorData({ data: { code: 'invalid_credentials' } }).code).toBe('invalid_credentials')
        expect(serverErrorData(new Error('network'))).toEqual({})
        expect(serverErrorData(undefined)).toEqual({})
    })
})
