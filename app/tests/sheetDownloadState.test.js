import { describe, expect, it } from 'vitest'
import { FREE_DOWNLOAD_SHEET_CAP } from '~~/shared/constants/payment.constants'
import { freeDownloadNoteVisible, maxDownloadableSheet, sheetDownloadState } from '../utils/sheetDownloadState'

// O2/d1 (02/11) : état du verrou de téléchargement des tôles côté interface.
describe('sheetDownloadState', () => {
    const FREE = { compute: { level: 'free' } }

    it('utilisateur absent ou Free = locked (fail-closed)', () => {
        expect(sheetDownloadState(null)).toBe('locked')
        expect(sheetDownloadState(undefined)).toBe('locked')
        expect(sheetDownloadState(FREE)).toBe('locked')
    })

    it('grant, abonnement trialing/active, palier payant = enabled', () => {
        expect(sheetDownloadState({ granted: true })).toBe('enabled')
        expect(sheetDownloadState({ subscriptionStatus: 'trialing' })).toBe('enabled')
        expect(sheetDownloadState({ subscriptionStatus: 'active' })).toBe('enabled')
        expect(sheetDownloadState({ compute: { level: 'standard' } })).toBe('enabled')
        expect(sheetDownloadState({ compute: { level: 'privacy' } })).toBe('enabled')
    })

    it('un abonnement qui lapse reverrouille (d1)', () => {
        expect(sheetDownloadState({ subscriptionStatus: 'past_due', compute: { level: 'free' } })).toBe('locked')
        expect(sheetDownloadState({ subscriptionStatus: 'canceled', compute: { level: 'free' } })).toBe('locked')
    })

    it('d2 : paidPlansDisabled vrai (booléen ou chaîne) = enabled, "false" = locked', () => {
        expect(sheetDownloadState(FREE, { paidPlansDisabled: true })).toBe('enabled')
        expect(sheetDownloadState(FREE, { paidPlansDisabled: 'true' })).toBe('enabled')
        expect(sheetDownloadState(FREE, { paidPlansDisabled: 'false' })).toBe('locked')
        expect(sheetDownloadState(FREE, { paidPlansDisabled: false })).toBe('locked')
    })

    it('d3 : projet démo = enabled', () => {
        expect(sheetDownloadState(FREE, { projectSlug: 'demo' })).toBe('enabled')
        expect(sheetDownloadState(FREE, { projectSlug: 'brave-otter-0123456789ab' })).toBe('locked')
        expect(sheetDownloadState(FREE, { projectSlug: null })).toBe('locked')
    })

    it('K et démo passent AVANT le fail-closed sur un utilisateur absent', () => {
        expect(sheetDownloadState(null, { projectSlug: 'demo' })).toBe('enabled')
        expect(sheetDownloadState(null, { paidPlansDisabled: 'true' })).toBe('enabled')
        expect(sheetDownloadState(undefined, { paidPlansDisabled: true })).toBe('enabled')
    })

    it('sans contexte, le défaut verrouille (tout appelant passe le contexte)', () => {
        expect(sheetDownloadState({ compute: { level: 'free' } })).toBe('locked')
    })
})

describe('maxDownloadableSheet', () => {
    it('locked = plafond Free, enabled = tout', () => {
        expect(maxDownloadableSheet('locked')).toBe(FREE_DOWNLOAD_SHEET_CAP)
        expect(maxDownloadableSheet('locked')).toBe(2)
        expect(maxDownloadableSheet('enabled')).toBe(Infinity)
    })
})

// D26 : l'information « vous téléchargez les 2 premières tôles » avant le calcul.
describe('freeDownloadNoteVisible', () => {
    it('verrouillé et plus de tôles que le plafond = visible', () => {
        expect(freeDownloadNoteVisible('locked', 3)).toBe(true)
        expect(freeDownloadNoteVisible('locked', 27.4)).toBe(true)
    })

    it('au plafond ou en deçà = masquée', () => {
        expect(freeDownloadNoteVisible('locked', 2)).toBe(false)
        expect(freeDownloadNoteVisible('locked', 1)).toBe(false)
    })

    it('jamais pour un compte déverrouillé', () => {
        expect(freeDownloadNoteVisible('enabled', 30)).toBe(false)
    })

    it('valeur absente ou non finie = masquée', () => {
        expect(freeDownloadNoteVisible('locked', null)).toBe(false)
        expect(freeDownloadNoteVisible('locked', undefined)).toBe(false)
        expect(freeDownloadNoteVisible('locked', NaN)).toBe(false)
        expect(freeDownloadNoteVisible('locked', Infinity)).toBe(false)
    })
})
