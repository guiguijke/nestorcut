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
 * ET qu'il a produit une frame DE CE JOB : la page garde la dernière frame du
 * job précédent jusqu'à la première frame du suivant, donc une frame d'un
 * autre job (`localJobSlug`) ne compte pas.
 */
export function liveScrollSlug({ serverSlug, localRunning, localFrameSlug, localJobSlug }) {
    if (serverSlug) return serverSlug
    if (localRunning && localFrameSlug && localFrameSlug === localJobSlug) return localFrameSlug
    return null
}

/**
 * Garde « une fois par job ». `claim(slug)` rend true la première fois qu'un
 * slug est vu, false ensuite : les frames suivantes, un retour sur le projet ou
 * un changement de projet ne réarment pas le défilement.
 *
 * `seen` est l'ensemble des slugs déjà amenés à l'écran. Une page démontée
 * puis remontée repart d'une garde neuve : pour qu'un retour sur un job déjà
 * défilé ne défile pas de nouveau, la page passe un ensemble qui survit au
 * démontage (côté navigateur seulement : jamais partagé entre requêtes SSR).
 */
export function createLiveScrollGate(seen = new Set()) {
    return {
        claim(slug) {
            if (!slug || seen.has(slug)) return false
            seen.add(slug)
            return true
        },
    }
}

/** Slugs déjà défilés, conservés d'un montage de page à l'autre (navigateur). */
export const scrolledJobSlugs = new Set()
