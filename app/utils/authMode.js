/**
 * Mode initial de /auth/local, lu dans `?mode=`.
 *
 * Un lien « Login » / « Se connecter » doit ouvrir la connexion, un lien
 * d'inscription l'inscription. Sans paramètre (ou avec une valeur inconnue),
 * la page ouvre la connexion : c'est le cas du lien nu `/auth/local` que
 * posent les boutons « Login ». Un lien d'inscription porte `?mode=register`.
 *
 * Fonction pure, appelée à l'identique par le rendu serveur et par le client :
 * le mode est connu avant le premier rendu, donc aucun flash à l'hydratation.
 *
 * @param {unknown} query valeur de `route.query.mode` (chaîne ou tableau)
 * @returns {boolean} true pour l'inscription
 */
export function isRegisterMode(query) {
    const value = Array.isArray(query) ? query[0] : query
    return value === 'register'
}
