/**
 * Défilement vers la vue live d'un job (décision J-038) : la section live est
 * en haut de la page, au-dessus de la grille de fichiers ; quand un job se met
 * à diffuser, on l'amène à l'écran UNE fois pour que l'animation ne se joue pas
 * sous la ligne de flottaison (PC comme téléphone).
 *
 * Deux sources de frames : le flux serveur (`liveResult`) et le calcul
 * navigateur (`localLive`, alimenté par le registre local). Les deux portent
 * le slug du job ; la page ne reçoit que les jobs de SON projet (pickers et
 * `progressFor` filtrent par projet, piège 47), donc un job d'un autre projet
 * ne peut pas déclencher le défilement.
 */

/**
 * Slug du job dont la vue live est à l'écran, ou null.
 * Le serveur passe en premier ; le calcul navigateur compte tant qu'il tourne
 * ET qu'il a produit une frame (avant, la scène est vide : rien à montrer).
 */
export function liveScrollSlug({ serverSlug, localRunning, localFrameSlug }) {
    if (serverSlug) return serverSlug
    if (localRunning && localFrameSlug) return localFrameSlug
    return null
}

/**
 * Garde « une fois par job ». `claim(slug)` rend true la première fois qu'un
 * slug est vu, false ensuite : les frames suivantes, un retour sur le projet ou
 * un changement de projet ne réarment pas le défilement.
 */
export function createLiveScrollGate() {
    const seen = new Set()
    return {
        claim(slug) {
            if (!slug || seen.has(slug)) return false
            seen.add(slug)
            return true
        },
    }
}
