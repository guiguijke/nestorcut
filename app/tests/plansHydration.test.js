import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { signedInPlanCta } from '../utils/planBenefits'

const source = readFileSync(fileURLToPath(new URL('../pages/plans.vue', import.meta.url)), 'utf8')

describe('offres : hydratation d’un compte connecté', () => {
    it('avant le montage, ctaFor ignore la réponse d’abonnement (comme le serveur)', () => {
        expect(source).toMatch(/const info = unref\(mountedOnClient\) \? unref\(subscriptionInfo\) : undefined/)
        expect(source).toMatch(/onMounted\(\(\) => \{\s*mountedOnClient\.value = true/)
    })

    it('sans réponse, un compte Free voit « Gérer dans le profil » sur les offres payantes', () => {
        for (const tierKey of ['standard', 'privacy']) {
            const cta = signedInPlanCta({ tierKey, level: 'free', trialEligible: undefined })
            expect(cta.labelKey).toBe('plans.cta.manageInProfile')
        }
        expect(signedInPlanCta({ tierKey: 'standard', level: 'free', trialEligible: true }).labelKey)
            .toBe('plans.cta.startTrial')
    })
})
