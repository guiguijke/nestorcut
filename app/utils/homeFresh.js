/**
 * Accueil d'un compte neuf : pas de statistiques à zéro, la démo en avant.
 *
 * Logique pure, testée en node (pas de harness DOM côté app).
 */

/**
 * Les statistiques ne valent d'être montrées que si le compte a une activité.
 * Tant qu'elles ne sont pas chargées, ou quand projets ET calculs sont à zéro,
 * on ne montre rien plutôt que cinq tuiles à zéro.
 * @param {object|null} stats — réponse de /api/user/stats, ou null avant chargement
 */
export function hasActivity(stats) {
    if (!stats || typeof stats !== 'object') return false
    return Number(stats.projects) > 0 || Number(stats.nestings) > 0
}

/**
 * Le projet démo à mettre en avant : seulement pour un compte qui n'a encore
 * aucun projet à lui. Sinon null (la démo reste dans la liste de gauche).
 * @param {Array|null} projects — liste des projets visibles du compte
 */
export function demoToPromote(projects) {
    if (!Array.isArray(projects)) return null
    const demo = projects.find((p) => p?.isDemo && p.slug)
    if (!demo) return null
    const own = projects.filter((p) => p && !p.isDemo)
    return own.length === 0 ? demo : null
}
