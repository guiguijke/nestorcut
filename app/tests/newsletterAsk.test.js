import { describe, expect, it } from 'vitest'

// C1-c — horloge de la re-demande newsletter (D5/D6) : fonction pure
// partagée app/serveur, les 6 cas du plan.

import { shouldAskNewsletter, NEWSLETTER_ASK_INTERVAL_MS } from '~~/shared/newsletterAsk'

const days = (n) => new Date(Date.now() - n * 24 * 3600 * 1000)
const now = Date.now()

describe('shouldAskNewsletter — 90 jours (C1-c)', () => {
    it('déjà opté in → jamais redemandé', () => {
        expect(shouldAskNewsletter({ newsletterOptIn: true, createdAt: days(400) }, now)).toBe(false)
    })

    it('Google (null) créé hier → pas de carte (la modale première demande vit encore)', () => {
        expect(shouldAskNewsletter({ newsletterOptIn: null, createdAt: days(1) }, now)).toBe(false)
    })

    it('local « non » coché-il-y-a-100-j → carte', () => {
        expect(shouldAskNewsletter({ newsletterOptIn: false, newsletterOptInAt: days(100), createdAt: days(100) }, now)).toBe(true)
    })

    it('demandée il y a 89 j → pas encore', () => {
        expect(shouldAskNewsletter({ newsletterOptIn: null, createdAt: days(200), newsletterAskedAt: days(89) }, now)).toBe(false)
    })

    it('demandée il y a 91 j → carte', () => {
        expect(shouldAskNewsletter({ newsletterOptIn: null, createdAt: days(200), newsletterAskedAt: days(91) }, now)).toBe(true)
    })

    it('askedAt absent mais optInAt il y a 100 j → carte', () => {
        expect(shouldAskNewsletter({ newsletterOptIn: false, createdAt: days(120), newsletterOptInAt: days(100) }, now)).toBe(true)
    })

    it('l\'intervalle vaut 90 jours, et un utilisateur vide ne déclenche rien', () => {
        expect(NEWSLETTER_ASK_INTERVAL_MS).toBe(90 * 24 * 3600 * 1000)
        expect(shouldAskNewsletter(null, now)).toBe(false)
        expect(shouldAskNewsletter({}, now)).toBe(false)
    })
})
