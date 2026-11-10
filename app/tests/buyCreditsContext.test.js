import { describe, expect, it } from 'vitest'
import { checkoutErrorCode, checkoutReturnPath, checkoutSourceOf, contextMessage } from '../utils/buyCreditsContext'

// O3 / D13 / D14 : contexte de la fenêtre d'abonnement et chemin de retour du
// Checkout. Modules purs : le serveur revalide le chemin (safeReturnPath), ce
// qui est testé ici n'est jamais une garde.

const lockedContext = (over = {}) => ({
    source: 'locked_sheets',
    lockedSheets: { total: 5, cap: 2, resultSlug: 'res-1', projectSlug: 'brave-otter-0123456789ab', ...over },
})

describe('contextMessage', () => {
    it('locked_sheets 5/2 : la clé de la phrase et ses paramètres', () => {
        expect(contextMessage(lockedContext())).toEqual({
            key: 'sub.ctx.lockedSheets',
            params: { n: 5, cap: 2 },
        })
    })

    it('total au plus égal au plafond : aucune phrase', () => {
        expect(contextMessage(lockedContext({ total: 2 }))).toBeNull()
        expect(contextMessage(lockedContext({ total: 1 }))).toBeNull()
    })

    it('une autre source ne porte jamais la phrase', () => {
        expect(contextMessage({ source: 'quota' })).toBeNull()
        expect(contextMessage({ source: 'export' })).toBeNull()
        expect(contextMessage({ source: 'turbo', lockedSheets: { total: 9, cap: 2 } })).toBeNull()
    })

    it('contexte absent ou incomplet : aucune phrase', () => {
        expect(contextMessage(null)).toBeNull()
        expect(contextMessage(undefined)).toBeNull()
        expect(contextMessage({ source: 'locked_sheets' })).toBeNull()
        expect(contextMessage({ source: 'locked_sheets', lockedSheets: { total: 'x', cap: 2 } })).toBeNull()
    })
})

describe('checkoutSourceOf', () => {
    it('une source connue passe telle quelle', () => {
        expect(checkoutSourceOf({ source: 'locked_sheets' })).toBe('locked_sheets')
        expect(checkoutSourceOf({ source: 'quota' })).toBe('quota')
        expect(checkoutSourceOf({ source: 'export' })).toBe('export')
        expect(checkoutSourceOf({ source: 'turbo' })).toBe('turbo')
        expect(checkoutSourceOf({ source: 'plans' })).toBe('plans')
    })

    it('sans contexte : « profile » (carte du profil)', () => {
        expect(checkoutSourceOf(null)).toBe('profile')
        expect(checkoutSourceOf(undefined)).toBe('profile')
        expect(checkoutSourceOf({})).toBe('profile')
    })

    it('une source inconnue devient « other » (liste fermée)', () => {
        expect(checkoutSourceOf({ source: 'n_importe_quoi' })).toBe('other')
    })
})

describe('checkoutReturnPath', () => {
    it('carte cliquée sur /home : le Checkout ramène sur le projet du résultat (O3)', () => {
        expect(checkoutReturnPath(lockedContext(), '/home')).toBe('/project/brave-otter-0123456789ab')
    })

    it('même contexte depuis un autre projet : le projet du RÉSULTAT, pas la page courante', () => {
        expect(checkoutReturnPath(lockedContext(), '/project/autre')).toBe('/project/brave-otter-0123456789ab')
    })

    it('contexte nul ou sans projet : la page courante', () => {
        expect(checkoutReturnPath(null, '/project/p1')).toBe('/project/p1')
        expect(checkoutReturnPath({ source: 'quota' }, '/project/p1')).toBe('/project/p1')
        // Le serveur ramènera /profile à /home : il n'accepte que /project/<slug>.
        expect(checkoutReturnPath(null, '/profile')).toBe('/profile')
    })

    it('slug de projet vide ou non-chaîne : la page courante', () => {
        expect(checkoutReturnPath(lockedContext({ projectSlug: '' }), '/home')).toBe('/home')
        expect(checkoutReturnPath(lockedContext({ projectSlug: null }), '/home')).toBe('/home')
        expect(checkoutReturnPath(lockedContext({ projectSlug: 42 }), '/home')).toBe('/home')
        expect(checkoutReturnPath(lockedContext({ projectSlug: ['a'] }), '/home')).toBe('/home')
    })
})

describe('checkoutErrorCode', () => {
    const known = ['subscription_exists', 'email_not_verified']

    it('un statusMessage connu est suivi tel quel', () => {
        expect(checkoutErrorCode({ data: { statusMessage: 'email_not_verified', statusCode: 403 } }, known)).toBe(
            'email_not_verified',
        )
        expect(checkoutErrorCode({ data: { statusMessage: 'subscription_exists' } }, known)).toBe('subscription_exists')
    })

    it('un message inconnu (texte libre du serveur) devient le statut HTTP', () => {
        expect(
            checkoutErrorCode({ statusCode: 503, data: { statusMessage: 'Subscription plan not available' } }, known),
        ).toBe('503')
        expect(checkoutErrorCode({ data: { statusCode: 401, statusMessage: 'Unauthorized' } }, known)).toBe('401')
        expect(checkoutErrorCode({ status: 500 }, known)).toBe('500')
    })

    it('rien d’exploitable : « error »', () => {
        expect(checkoutErrorCode(new Error('réseau'), known)).toBe('error')
        expect(checkoutErrorCode(null, known)).toBe('error')
        expect(checkoutErrorCode({ data: { statusMessage: 'email_not_verified' } })).toBe('error')
    })
})
