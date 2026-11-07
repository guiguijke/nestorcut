// Ce que chaque offre payante débloque, et ce que le Checkout fait réellement.
// Pur et testable en node. La page /plans ET la fenêtre d'abonnement lisent
// ces listes : une seule source, pas deux textes qui divergent.
import { intlTag } from './i18n'

/** Statuts d'un abonnement dont le paiement a échoué : l'accès est coupé, le
 * palier vaut « free », mais l'abonnement existe et le serveur refuse tout
 * second Checkout (409). */
export const DELINQUENT_STATUSES = ['past_due', 'unpaid', 'incomplete']

/** Clés i18n des avantages d'Unlimited (cartes de /plans, fenêtre d'abonnement). */
export const UNLIMITED_FEATURE_KEYS = [
    'plans.unlimited.f1',
    'plans.unlimited.f2',
    'plans.unlimited.f3',
    'plans.unlimited.f4',
    'plans.unlimited.f5',
]

/**
 * Avantages listés dans la fenêtre d'abonnement : ceux d'Unlimited SAUF le
 * coffre zero-knowledge, ouvert à toutes les offres (Free compris) — dans la
 * fenêtre, sans comparaison, il se lirait comme un gain payant. /plans le
 * garde, car la carte Free y porte la même ligne.
 */
export const UNLIMITED_DIALOG_FEATURE_KEYS = UNLIMITED_FEATURE_KEYS.filter((key) => key !== 'plans.unlimited.f5')

/** Clés i18n des avantages de Pro. */
export const PRO_FEATURE_KEYS = ['plans.pro.f1', 'plans.pro.f2', 'plans.pro.f3']

/** Prix avec SA devise (jamais un symbole en dur), au format de la langue. */
export function formatPlanMoney(amount, currency, locale = 'en') {
    return new Intl.NumberFormat(intlTag(locale), {
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
    const price = formatPlanMoney(amount, currency, locale)
    const days = Number(trialDays)
    if (trialEligible && Number.isFinite(days) && days > 0) {
        const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
        const date = end.toLocaleDateString(intlTag(locale), {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        })
        return { key: 'sub.terms.trial', params: { zero: formatPlanMoney(0, currency, locale), price, date } }
    }
    return { key: 'sub.terms.noTrial', params: { price } }
}

/**
 * Ce que dit le passage d'un abonné Unlimited vers Pro (modification en place,
 * sans page Stripe récapitulative). Côté Stripe : `create_prorations` — la
 * différence n'est PAS facturée tout de suite, elle part en éléments de
 * facture en attente sur la prochaine facture ; un essai en cours continue.
 * Jamais pour un abonnement résilié (isEndingSubscription) : aucune facture ne
 * suit, ces phrases seraient fausses.
 * @returns {{ key: string, params: Record<string, string> }}
 */
export function upgradeTerms({ status, amount, currency, locale = 'en' }) {
    const price = formatPlanMoney(amount, currency, locale)
    return status === 'trialing'
        ? { key: 'sub.terms.upgradeTrial', params: { price } }
        : { key: 'sub.terms.upgradeActive', params: { price } }
}

/**
 * Abonnement vivant dont la résiliation est programmée : il s'arrête à
 * `currentPeriodEnd` et rien ne le reprend depuis l'interface. Aucune montée en
 * Pro n'est offerte. Une fois l'échéance passée (statut « canceled », l'indicateur
 * peut rester vrai), c'est un compte sans abonnement, qui peut en reprendre un.
 * @param {{ subscriptionStatus?: string|null, cancelAtPeriodEnd?: boolean }|null|undefined} info
 *   réponse de /api/payment/subscription
 * @returns {boolean}
 */
export function isEndingSubscription(info) {
    return Boolean(info?.cancelAtPeriodEnd) && ['trialing', 'active'].includes(info?.subscriptionStatus)
}

/**
 * CTA d'une carte de /plans pour un compte connecté.
 * `level` : palier de calcul (free | standard | privacy). `trialEligible` :
 * true/false une fois /api/payment/subscription lu, undefined avant — on ne
 * promet alors JAMAIS d'essai (un compte qui l'a consommé ne le retrouve pas).
 * `subscriptionStatus` : statut Stripe de la même réponse ; un paiement
 * échoué laisse le palier à « free » sans effacer l'abonnement.
 * `cancelAtPeriodEnd` : même réponse, undefined avant lecture — la montée n'est
 * alors pas promise, pas plus qu'à un abonnement résilié.
 * `action` : 'dialog' ouvre la fenêtre d'abonnement (avantages et conditions,
 * sans changer de page) ; 'profile' va au profil, seul chemin qui gère la
 * montée en place et la gestion d'un abonnement existant.
 * @returns {{ labelKey: string, disabled: boolean, action: 'dialog'|'profile' }}
 */
export function signedInPlanCta({ tierKey, level, trialEligible, comingSoon, subscriptionStatus, cancelAtPeriodEnd }) {
    const cardLevel = tierKey === 'standard' ? 'standard' : tierKey === 'privacy' ? 'privacy' : 'free'
    if (DELINQUENT_STATUSES.includes(subscriptionStatus)) {
        // Abonnement existant, carte à régulariser : la fenêtre porte le bouton.
        if (cardLevel === 'free') return { labelKey: 'plans.cta.manageInProfile', disabled: false, action: 'profile' }
        return { labelKey: 'sub.updateCard', disabled: false, action: 'dialog' }
    }
    const current = level === 'standard' || level === 'privacy' ? level : 'free'
    const rank = { free: 0, standard: 1, privacy: 2 }
    if (cardLevel === current) {
        // Free : rien à gérer, le bouton est inerte. Payant : le profil.
        return { labelKey: 'plans.cta.yourPlan', disabled: current === 'free', action: 'profile' }
    }
    if (rank[cardLevel] < rank[current]) {
        return { labelKey: 'plans.cta.manageInProfile', disabled: false, action: 'profile' }
    }
    // Carte au-dessus de l'offre actuelle.
    if (comingSoon) return { labelKey: 'plans.cta.comingSoon', disabled: true, action: 'profile' }
    if (current === 'standard') {
        // Résilié, ou pas encore lu : le profil dit l'état exact, rien n'est promis.
        if (cancelAtPeriodEnd === undefined || isEndingSubscription({ subscriptionStatus, cancelAtPeriodEnd })) {
            return { labelKey: 'plans.cta.manageInProfile', disabled: false, action: 'profile' }
        }
        // Abonné Unlimited vers Pro : modification en place, depuis le profil.
        return { labelKey: 'plans.cta.getPro', disabled: false, action: 'profile' }
    }
    if (trialEligible === true) return { labelKey: 'plans.cta.startTrial', disabled: false, action: 'dialog' }
    if (trialEligible === false) return { labelKey: 'sub.subscribe', disabled: false, action: 'dialog' }
    // Éligibilité inconnue : rien n'est promis, le profil dit l'état exact.
    return { labelKey: 'plans.cta.manageInProfile', disabled: false, action: 'profile' }
}
