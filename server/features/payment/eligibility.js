/**
 * Règles d'éligibilité au Checkout (pures, sans I/O — testables telles quelles).
 */

/**
 * Statuts Stripe d'un abonnement « vivant » : il existe déjà côté Stripe et
 * peut encore facturer. Ouvrir un second Checkout par-dessus créerait un
 * SECOND abonnement sur le même customer (double facturation) — la mise à
 * niveau passe par subscription/change.post.js, le reste par le portail.
 * `unpaid` (relances épuisées, abonnement conservé par Stripe) en fait partie :
 * il existe encore et se règle via le portail.
 */
export const LIVE_SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'incomplete', 'unpaid']

/**
 * @param {any} user
 * @returns {boolean} true si l'utilisateur a un abonnement vivant
 */
export function hasLiveSubscription(user) {
    const subscription = user?.subscription
    return Boolean(
        subscription?.stripeSubscriptionId &&
            LIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)
    )
}

/**
 * L'essai gratuit n'est accordé qu'une fois : le signal est l'existence d'un
 * stripeSubscriptionId (posé à la création de l'abonnement), JAMAIS
 * stripeCustomerId — le customer est créé dès l'ouverture d'un Checkout, même
 * abandonné. Le champ `subscription` n'est jamais effacé (même résilié).
 * @param {any} user
 * @returns {boolean}
 */
export function isTrialEligible(user) {
    return !user?.subscription?.stripeSubscriptionId
}
