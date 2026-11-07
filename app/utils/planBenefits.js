// Ce que chaque offre payante débloque, et ce que le Checkout fait réellement.
// Pur et testable en node. La page /plans ET la fenêtre d'abonnement lisent
// ces listes : une seule source, pas deux textes qui divergent.
import { intlTag } from './i18n'

/** Clés i18n des avantages d'Unlimited (cartes de /plans, fenêtre d'abonnement). */
export const UNLIMITED_FEATURE_KEYS = [
    'plans.unlimited.f1',
    'plans.unlimited.f2',
    'plans.unlimited.f3',
    'plans.unlimited.f4',
    'plans.unlimited.f5',
]

/** Clés i18n des avantages de Pro. */
export const PRO_FEATURE_KEYS = ['plans.pro.f1', 'plans.pro.f2', 'plans.pro.f3']

/** Prix avec SA devise (jamais un symbole en dur). */
export function formatPlanMoney(amount, currency) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(amount)
}

/**
 * Phrase « conditions » affichée AVANT le clic. Le serveur (subscribe.get.js
 * → createSubscriptionCheckout) ouvre un Checkout en mode abonnement : la carte
 * est toujours demandée ; avec `trial_period_days` rien n'est débité
 * aujourd'hui et le premier prélèvement tombe à la fin de l'essai, sauf
 * annulation avant.
 * @param {{ trialEligible: boolean, trialDays: number, amount: number,
 *   currency: string, now?: Date, locale?: string }} o
 * @returns {{ key: string, params: Record<string, string> }}
 */
export function checkoutTerms({ trialEligible, trialDays, amount, currency, now = new Date(), locale = 'en' }) {
    const price = formatPlanMoney(amount, currency)
    const days = Number(trialDays)
    if (trialEligible && Number.isFinite(days) && days > 0) {
        const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
        const date = end.toLocaleDateString(intlTag(locale), {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        })
        return { key: 'sub.terms.trial', params: { zero: formatPlanMoney(0, currency), price, date } }
    }
    return { key: 'sub.terms.noTrial', params: { price } }
}

/**
 * CTA d'une carte de /plans pour un compte connecté.
 * `level` : palier de calcul (free | standard | privacy). `trialEligible` :
 * true/false une fois /api/payment/subscription lu, undefined avant — on ne
 * promet alors JAMAIS d'essai (un compte qui l'a consommé ne le retrouve pas).
 * Les actions passent toutes par le profil, où la fenêtre/carte d'abonnement
 * affiche avantages et conditions avant le clic.
 * @returns {{ labelKey: string, withDays: boolean, disabled: boolean }}
 */
export function signedInPlanCta({ tierKey, level, trialEligible, comingSoon }) {
    const current = level === 'standard' || level === 'privacy' ? level : 'free'
    const rank = { free: 0, standard: 1, privacy: 2 }
    const cardLevel = tierKey === 'standard' ? 'standard' : tierKey === 'privacy' ? 'privacy' : 'free'
    if (cardLevel === current) {
        // Free : rien à gérer, le bouton est inerte. Payant : le profil.
        return { labelKey: 'plans.cta.yourPlan', withDays: false, disabled: current === 'free' }
    }
    if (rank[cardLevel] < rank[current]) {
        return { labelKey: 'plans.cta.manageInProfile', withDays: false, disabled: false }
    }
    // Carte au-dessus de l'offre actuelle.
    if (comingSoon) return { labelKey: 'plans.cta.comingSoon', withDays: false, disabled: true }
    if (current === 'standard') {
        // Abonné Unlimited vers Pro : modification en place, depuis le profil.
        return { labelKey: 'plans.cta.getPro', withDays: false, disabled: false }
    }
    if (trialEligible === true) return { labelKey: 'plans.cta.startTrial', withDays: true, disabled: false }
    if (trialEligible === false) return { labelKey: 'sub.subscribe', withDays: false, disabled: false }
    return { labelKey: 'plans.cta.manageInProfile', withDays: false, disabled: false }
}
