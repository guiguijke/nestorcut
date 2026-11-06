/**
 * Défilement vers la vue live d'un job (décision J-038) : la section live est
 * en haut de la page, au-dessus de la grille de fichiers ; quand un job se met
 * à diffuser, on l'amène à l'écran UNE fois pour que l'animation ne se joue pas
 * sous la ligne de flottaison (PC comme téléphone).
 *
 * Deux sources de frames : le flux serveur (`liveResult`) et le calcul
 * navigateur (le job du registre local). Les deux portent le slug du job ; la
 * page ne reçoit que les jobs de SON projet (pickers et `progressFor` filtrent
 * par projet, piège 47), donc un job d'un autre projet ne peut pas déclencher
 * le défilement. Le câblage est dans `composables/useJobScroll.js`.
 */
import { isActiveLocalPhase } from './liveJob'

/**
 * Slug du job dont la vue live est à l'écran, ou null.
 * Le serveur passe en premier ; le calcul navigateur compte tant qu'il tourne
 * ET que CE job a produit une frame : `job.frame` est la sienne, jamais celle
 * du job précédent.
 */
export function liveScrollSlug({ serverSlug, job }) {
    if (serverSlug) return serverSlug
    if (job?.frame && isActiveLocalPhase(job.phase)) return job.slug
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

const SCROLL_KEYS = new Set(['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar'])

/**
 * L'utilisateur a-t-il fait défiler la page lui-même depuis `reset()` ?
 * Molette, doigt ou touches de défilement : seuls les gestes de l'utilisateur
 * comptent, pas nos propres défilements (la position ne dit pas qui a bougé).
 * Sert à ne pas ramener au message d'échec un utilisateur qui lisait ailleurs
 * pendant un long calcul.
 */
export function watchUserScroll(target) {
    let moved = false
    const onGesture = () => { moved = true }
    const onKey = (e) => { if (SCROLL_KEYS.has(e?.key)) moved = true }
    target.addEventListener('wheel', onGesture, { passive: true })
    target.addEventListener('touchmove', onGesture, { passive: true })
    target.addEventListener('keydown', onKey)
    return {
        reset() { moved = false },
        moved() { return moved },
        stop() {
            target.removeEventListener('wheel', onGesture)
            target.removeEventListener('touchmove', onGesture)
            target.removeEventListener('keydown', onKey)
        },
    }
}

/** Le rectangle est-il entièrement à l'écran ? (`rect` de getBoundingClientRect) */
export function isWhollyInView(rect, viewportHeight) {
    return Boolean(rect) && rect.top >= 0 && rect.bottom <= viewportHeight
}
