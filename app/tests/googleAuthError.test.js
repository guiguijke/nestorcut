import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DICTS } from '../utils/i18n'

// Refus de la connexion Google sur l'adresse d'un compte e-mail + mot de
// passe (décision 2026-11-03) : le callback transmet le code, l'accueil
// l'affiche avec « mot de passe oublié » — sinon l'utilisateur lirait
// « réessayez », et réessayer ne change rien.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('connexion Google refusée — adresse d’un compte e-mail', () => {
    it('le callback transmet email_taken_local, lu au bon niveau de l’erreur $fetch', () => {
        const src = read('../pages/auth/google/callback.vue')
        expect(src).toContain('serverErrorData(err).code === "email_taken_local"')
        expect(src).toContain('taken ? "email_taken_local" : "exchange_failed"')
    })

    it('l’accueil a un message dédié et le lien « mot de passe oublié »', () => {
        const src = read('../pages/index.vue')
        expect(src).toContain("email_taken_local: 'auth.googleError.email_taken_local'")
        expect(src).toMatch(/authErrorCode === 'email_taken_local'"\s+to="\/auth\/forgot-password"/)
    })

    it('sans connexion par e-mail : message générique, pas d’impasse vers le mot de passe', () => {
        const src = read('../pages/index.vue')
        expect(src).toContain("code === 'email_taken_local' && !localAuthEnabled.value ? 'generic' : code")
    })

    it('message présent dans les six langues', () => {
        for (const [lang, dict] of Object.entries(DICTS)) {
            expect(dict['auth.googleError.email_taken_local'], lang).toBeTruthy()
        }
    })
})
