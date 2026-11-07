import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOCALES, translate } from '../utils/i18n'
import {
    UNLIMITED_FEATURE_KEYS,
    UNLIMITED_DIALOG_FEATURE_KEYS,
    PRO_FEATURE_KEYS,
    formatPlanMoney,
    upgradeTerms,
    DELINQUENT_STATUSES,
    checkoutTerms,
    signedInPlanCta,
    isEndingSubscription,
} from '../utils/planBenefits'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const NOW = new Date('2026-11-07T10:00:00Z')

describe('checkoutTerms : ce que fait le Checkout, dit avant le clic', () => {
    it("essai : 0 maintenant, prix de l'offre, date = aujourd'hui + durée d'essai", () => {
        const terms = checkoutTerms({ trialEligible: true, trialDays: 7, amount: 19, currency: 'eur', now: NOW, locale: 'en' })
        expect(terms.key).toBe('sub.terms.trial')
        expect(terms.params.price).toBe('€19')
        expect(terms.params.zero).toBe('€0')
        expect(terms.params.date).toBe('November 14, 2026')
    })

    it("la durée vient du paramètre, jamais d'un 7 en dur", () => {
        const terms = checkoutTerms({ trialEligible: true, trialDays: 10, amount: 19, currency: 'eur', now: NOW, locale: 'en' })
        expect(terms.params.date).toBe('November 17, 2026')
    })

    it("la devise suit l'offre : dollars pour un prix en usd, prix de Pro pour Pro", () => {
        const usd = checkoutTerms({ trialEligible: true, trialDays: 7, amount: 19, currency: 'usd', now: NOW })
        expect(usd.params.price).toBe('$19')
        expect(usd.params.zero).toBe('$0')
        const pro = checkoutTerms({ trialEligible: true, trialDays: 7, amount: 39, currency: 'eur', now: NOW })
        expect(pro.params.price).toBe('€39')
    })

    it("la date suit la langue de l'app", () => {
        const fr = checkoutTerms({ trialEligible: true, trialDays: 7, amount: 19, currency: 'eur', now: NOW, locale: 'fr' })
        expect(fr.params.date).toBe('14 novembre 2026')
    })

    it("essai déjà consommé : aucune date, aucun 0, prélèvement immédiat annoncé", () => {
        const terms = checkoutTerms({ trialEligible: false, trialDays: 7, amount: 19, currency: 'eur', now: NOW })
        expect(terms.key).toBe('sub.terms.noTrial')
        expect(terms.params).toEqual({ price: '€19' })
    })

    it("durée d'essai nulle ou inconnue : jamais de promesse d'essai", () => {
        for (const trialDays of [0, undefined, NaN]) {
            const terms = checkoutTerms({ trialEligible: true, trialDays, amount: 19, currency: 'eur', now: NOW })
            expect(terms.key).toBe('sub.terms.noTrial')
        }
    })

    it('les 6 langues portent les phrases, avec leurs paramètres', () => {
        for (const locale of LOCALES) {
            const trial = translate('sub.terms.trial', locale, null)
            expect(trial, locale).not.toBe('sub.terms.trial')
            for (const p of ['{zero}', '{price}', '{date}']) expect(trial, `${locale} ${p}`).toContain(p)
            const noTrial = translate('sub.terms.noTrial', locale, null)
            expect(noTrial, locale).not.toBe('sub.terms.noTrial')
            expect(noTrial, locale).toContain('{price}')
            expect(noTrial, locale).not.toContain('{date}')
            expect(translate('plans.cta.yourPlan', locale)).not.toBe('plans.cta.yourPlan')
        }
    })
})

describe("avantages : une seule source pour /plans et la fenêtre d'abonnement", () => {
    it("la fenêtre liste les avantages d'Unlimited SAUF le coffre, ouvert à toutes les offres", () => {
        expect(UNLIMITED_FEATURE_KEYS).toContain('plans.unlimited.f5')
        expect(UNLIMITED_DIALOG_FEATURE_KEYS).not.toContain('plans.unlimited.f5')
        expect(UNLIMITED_DIALOG_FEATURE_KEYS).toEqual(UNLIMITED_FEATURE_KEYS.filter((k) => k !== 'plans.unlimited.f5'))
    })

    it('/plans et la fenêtre lisent les mêmes listes, sans seconde liste en dur', () => {
        const plans = read('../pages/plans.vue')
        const sub = read('../components/Subscription.vue')
        expect(plans).toContain('UNLIMITED_FEATURE_KEYS')
        expect(sub).toContain('UNLIMITED_DIALOG_FEATURE_KEYS')
        for (const source of [plans, sub]) {
            expect(source).toContain('PRO_FEATURE_KEYS')
            expect(source).not.toMatch(/plans\.unlimited\.f\d/)
            expect(source).not.toMatch(/plans\.pro\.f\d/)
        }
    })

    it("« offre indisponible » ne dépend que du plan Unlimited : jamais sous une offre valide", () => {
        const sub = read('../components/Subscription.vue')
        expect(sub).toMatch(/<div v-if="!data\?\.plan" class="subscription__desc">/)
        expect(sub).not.toMatch(/<div v-else class="subscription__desc">/)
        // La carte d'achat n'est jamais montrée à un abonné Stripe vivant.
        expect(sub).toContain('v-else-if="!isActive && !isPastDue"')
    })

    it('le bouton Pro a son repli « bientôt » quand les offres payantes sont fermées', () => {
        const sub = read('../components/Subscription.vue')
        const proBlock = sub.slice(sub.indexOf('data-testid="subscription-pro-offer"'))
        expect(proBlock.slice(0, proBlock.indexOf('v-if="!data?.plan"'))).toContain("t('sub.comingSoon')")
    })

    it('la fenêtre : durée et prix du plan serveur, aucune durée ni prix en dur', () => {
        const sub = read('../components/Subscription.vue')
        expect(sub).toContain('trialDays: plan?.trialDays')
        expect(sub).toContain('amount: plan?.amount')
        expect(sub).toContain('currency: plan?.currency')
        expect(sub).not.toMatch(/€\s?\d/)
    })

    it('la fenêtre : le bouton Pro de la carte Free déclenche le Checkout Pro', () => {
        const sub = read('../components/Subscription.vue')
        expect(sub).toContain('data-testid="subscription-pro-offer"')
        expect(sub).toMatch(/subscription_start_trial_pro[\s\S]{0,200}@click="subscribePro"/)
    })
})

describe("upgradeTerms : le passage Unlimited vers Pro dit ce qu'il fait", () => {
    it("à l'essai : l'essai continue, le prix de Pro prend le relais ensuite", () => {
        expect(upgradeTerms({ status: 'trialing', amount: 39, currency: 'eur' })).toEqual({
            key: 'sub.terms.upgradeTrial',
            params: { price: '€39' },
        })
    })

    it('abonnement actif : prorata sur la PROCHAINE facture, pas un prélèvement immédiat', () => {
        const terms = upgradeTerms({ status: 'active', amount: 39, currency: 'eur' })
        expect(terms.key).toBe('sub.terms.upgradeActive')
        for (const locale of LOCALES) {
            const text = translate('sub.terms.upgradeActive', locale, null)
            expect(text, locale).toContain('{price}')
            expect(text, locale).not.toMatch(/immédiat|immediate|sofort|inmediat|immediat/i)
        }
    })

    it('les 2 phrases existent dans les 6 langues avec leur prix', () => {
        for (const locale of LOCALES) {
            for (const key of ['sub.terms.upgradeTrial', 'sub.terms.upgradeActive']) {
                const text = translate(key, locale, null)
                expect(text, `${locale} ${key}`).not.toBe(key)
                expect(text, `${locale} ${key}`).toContain('{price}')
            }
        }
    })

    it('la montée en place est confirmée avant l’appel', () => {
        const sub = read('../components/Subscription.vue')
        expect(sub).toMatch(/window\.confirm\([\s\S]{0,120}upgradePro[\s\S]{0,800}payment\/subscription\/change/)
    })
})

describe('isEndingSubscription : résilié et encore vivant', () => {
    it('seulement à l’essai ou actif, avec la résiliation programmée', () => {
        for (const subscriptionStatus of ['trialing', 'active']) {
            expect(isEndingSubscription({ subscriptionStatus, cancelAtPeriodEnd: true })).toBe(true)
            expect(isEndingSubscription({ subscriptionStatus, cancelAtPeriodEnd: false })).toBe(false)
        }
        for (const subscriptionStatus of ['canceled', 'past_due', 'unpaid', 'incomplete', null]) {
            expect(isEndingSubscription({ subscriptionStatus, cancelAtPeriodEnd: true })).toBe(false)
        }
        expect(isEndingSubscription(null)).toBe(false)
    })
})

describe('formatPlanMoney : suit la langue', () => {
    it('anglais : symbole devant ; français : montant puis symbole', () => {
        expect(formatPlanMoney(19, 'eur', 'en')).toBe('€19')
        const fr = formatPlanMoney(19, 'eur', 'fr')
        expect(fr.startsWith('19')).toBe(true)
        expect(fr.endsWith('€')).toBe(true)
    })
})

describe('signedInPlanCta : /plans connecté, matrice clic / destination', () => {
    const cta = (tierKey, level, trialEligible, comingSoon = false, subscriptionStatus = undefined, cancelAtPeriodEnd = undefined) =>
        signedInPlanCta({ tierKey, level, trialEligible, comingSoon, subscriptionStatus, cancelAtPeriodEnd })

    it("« Votre offre » sur la carte de son offre : inerte pour Free, profil pour un abonné", () => {
        expect(cta('free', 'free', true)).toEqual({ labelKey: 'plans.cta.yourPlan', disabled: true, action: 'profile' })
        expect(cta('standard', 'standard', false)).toEqual({ labelKey: 'plans.cta.yourPlan', disabled: false, action: 'profile' })
        expect(cta('privacy', 'privacy', false)).toEqual({ labelKey: 'plans.cta.yourPlan', disabled: false, action: 'profile' })
    })

    it("un Free éligible : l'essai d'Unlimited ET de Pro ouvre la fenêtre, sans changer de page", () => {
        for (const tierKey of ['standard', 'privacy']) {
            expect(cta(tierKey, 'free', true)).toEqual({ labelKey: 'plans.cta.startTrial', disabled: false, action: 'dialog' })
        }
    })

    it("un Free qui a consommé son essai : « S'abonner » ouvre la fenêtre, jamais de jours", () => {
        for (const tierKey of ['standard', 'privacy']) {
            expect(cta(tierKey, 'free', false)).toEqual({ labelKey: 'sub.subscribe', disabled: false, action: 'dialog' })
        }
    })

    it("éligibilité pas encore connue : rien n'est promis, le clic va au profil", () => {
        for (const tierKey of ['standard', 'privacy']) {
            expect(cta(tierKey, 'free', undefined)).toEqual({ labelKey: 'plans.cta.manageInProfile', disabled: false, action: 'profile' })
        }
    })

    it("un abonné Unlimited vers Pro : le profil (modification en place), pas d'essai", () => {
        expect(cta('privacy', 'standard', true, false, 'active', false)).toEqual({ labelKey: 'plans.cta.getPro', disabled: false, action: 'profile' })
    })

    it('un abonné Unlimited résilié, ou pas encore lu : la montée n’est pas promise', () => {
        const manage = { labelKey: 'plans.cta.manageInProfile', disabled: false, action: 'profile' }
        for (const status of ['trialing', 'active']) {
            expect(cta('privacy', 'standard', false, false, status, true)).toEqual(manage)
        }
        expect(cta('privacy', 'standard', false)).toEqual(manage)
        // Offres fermées : « bientôt » reste la réponse.
        expect(cta('privacy', 'standard', false, true, 'active', true).labelKey).toBe('plans.cta.comingSoon')
    })

    it("après l'échéance (canceled, indicateur resté vrai) : un compte Free qui se réabonne, sans essai", () => {
        for (const tierKey of ['standard', 'privacy']) {
            expect(cta(tierKey, 'free', false, false, 'canceled', true)).toEqual({ labelKey: 'sub.subscribe', disabled: false, action: 'dialog' })
        }
        // Accès offert par-dessus un ancien abonnement : la montée passe par Checkout.
        expect(cta('privacy', 'standard', false, false, 'canceled', true).labelKey).toBe('plans.cta.getPro')
    })

    it('les cartes en dessous de son offre renvoient au profil', () => {
        expect(cta('free', 'standard', true)).toEqual({ labelKey: 'plans.cta.manageInProfile', disabled: false, action: 'profile' })
        expect(cta('standard', 'privacy', true)).toEqual({ labelKey: 'plans.cta.manageInProfile', disabled: false, action: 'profile' })
    })

    it("paiement échoué (palier « free », abonnement existant) : jamais « Votre offre » ni « S'abonner »", () => {
        for (const status of DELINQUENT_STATUSES) {
            expect(cta('free', 'free', true, false, status)).toEqual({ labelKey: 'plans.cta.manageInProfile', disabled: false, action: 'profile' })
            for (const tierKey of ['standard', 'privacy']) {
                expect(cta(tierKey, 'free', true, false, status)).toEqual({ labelKey: 'sub.updateCard', disabled: false, action: 'dialog' })
            }
        }
        // Un statut sain ne change rien.
        expect(cta('standard', 'free', true, false, 'canceled').labelKey).toBe('plans.cta.startTrial')
    })

    it('offres payantes fermées : « bientôt » inerte, même pour un Free', () => {
        expect(cta('standard', 'free', true, true)).toMatchObject({ labelKey: 'plans.cta.comingSoon', disabled: true })
        expect(cta('privacy', 'free', true, true)).toMatchObject({ labelKey: 'plans.cta.comingSoon', disabled: true })
    })

    it("/plans passe par signedInPlanCta, lit l'éligibilité et le statut côté client, et ouvre la fenêtre avec la source « plans »", () => {
        const plans = read('../pages/plans.vue')
        expect(plans).toContain('signedInPlanCta')
        expect(plans).toContain('subscriptionStatus: info?.subscriptionStatus')
        expect(plans).toContain("openBuyCredits({ source: 'plans' })")
        expect(read('../layouts/default.vue')).toContain('<BuyCreditsDialog')
        expect(plans).toContain("'/api/payment/subscription'")
        expect(plans).not.toContain("userIsSet ? t('plans.cta.manageInProfile')")
    })
})
