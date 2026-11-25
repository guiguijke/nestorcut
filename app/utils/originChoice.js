/**
 * Zéro des fichiers livrés (lot positions) : le choix « coin bas-gauche » /
 * « centre de la tôle », retenu par navigateur. Module pur (le stockage est
 * passé en paramètre) : testé en node, jamais d'accès direct au DOM.
 */
export const ORIGIN_KEY = 'nestorcut.fileOrigin'
export const ORIGINS = ['corner', 'center']

/** Valeur retenue, ou 'corner' (défaut) : stockage absent, vide, illisible ou
 * valeur inconnue — le localStorage peut lever (navigation privée). */
export function readOrigin(storage) {
    try {
        const v = storage?.getItem(ORIGIN_KEY)
        return ORIGINS.includes(v) ? v : 'corner'
    } catch {
        return 'corner'
    }
}

export function writeOrigin(storage, origin) {
    try {
        storage?.setItem(ORIGIN_KEY, ORIGINS.includes(origin) ? origin : 'corner')
    } catch {
        // stockage indisponible : le choix vaut pour la session seulement
    }
}

/**
 * Le choix du zéro est-il proposé pour ce résultat ? Résultat local (Cet
 * appareil) SANS fichiers `.job` (un `.job` ne se recentre pas : coin
 * seulement) et utilisable. Un résultat serveur ou un ancien écran : jamais.
 */
export function originChoiceOffered({ isLocal, hasJobs, usable = true } = {}) {
    return Boolean(isLocal) && !hasJobs && Boolean(usable)
}

/** Origine EFFECTIVE d'un téléchargement : le choix retenu quand il est
 * proposé, 'corner' sinon (jamais un centre sur un résultat qui ne l'offre pas). */
export function effectiveOrigin(offered, choice) {
    return offered && choice === 'center' ? 'center' : 'corner'
}
