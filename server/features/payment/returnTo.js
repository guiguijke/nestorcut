/**
 * URL de retour du Checkout Stripe (pures, sans I/O — testables telles quelles).
 *
 * d10 / D14 (02/11) : le client propose un `returnTo` (le projet du résultat
 * qui a déclenché l'achat) ; le serveur n'accepte QU'UN chemin de projet
 * relatif — tout le reste retombe sur /home. Jamais d'URL absolue, de `//`
 * (protocole relatif), de `..`, ni de caractère de contrôle : la redirection
 * Stripe ne doit jamais devenir une redirection ouverte.
 */

/** Slugs réels `<adjectif>-<nom>-<12 hex>` et 'demo' (service.js,
 * demo.constants.js). */
export const RETURN_PROJECT_RE = /^\/project\/([a-z0-9][a-z0-9_-]{0,199})$/

/**
 * @param {any} raw valeur brute de la query (chaîne, tableau, absente…)
 * @returns {string|null} `/project/<slug>` si valide, sinon null
 */
export function safeReturnPath(raw) {
    if (typeof raw !== 'string') return null
    const m = RETURN_PROJECT_RE.exec(raw)
    return m ? `/project/${m[1]}` : null
}

/**
 * @param {string} baseUrl origine publique de l'app (runtimeConfig.public.baseUrl)
 * @param {any} returnTo chemin proposé par le client (revalidé ici)
 * @param {string} internalId identifiant interne du checkout (24 hex)
 * @returns {{ successUrl: string, cancelUrl: string }}
 */
export function checkoutUrls(baseUrl, returnTo, internalId) {
    const path = safeReturnPath(returnTo) || '/home'
    return {
        successUrl: `${baseUrl}${path}?subscriptionInternalId=${internalId}`,
        cancelUrl: `${baseUrl}${path}?checkout=cancelled`,
    }
}
