/**
 * Rafraîchissement du palier SANS recharger la page (module pur, testé en node).
 *
 * Un onglet laissé ouvert pendant qu'un administrateur accorde Unlimited (ou
 * qu'un abonnement se paie ailleurs) gardait ses cadenas : `useNuxtData('user')`
 * n'est chargé qu'une fois. Ici : la logique d'étranglement et de décision,
 * sans Nuxt ni DOM (horloge et réseau injectés).
 *
 * POURQUOI PAS refreshNuxtData('user') : sur une erreur (réseau coupé, 401),
 * useAsyncData remet `data` à sa valeur par défaut (null) — un payant verrait
 * tous ses boutons se verrouiller, et le store d'authentification (setUser)
 * basculerait en déconnecté. On lit donc /api/user/plan nous-mêmes (champs de
 * palier seuls : jamais le coffre, jamais l'utilisateur entier) et on n'écrit
 * que sur le MÊME utilisateur (même id), champs de palier seulement ; toute
 * autre issue laisse le cache et le store intacts.
 */

/** Au plus un rafraîchissement automatique (retour d'onglet) par minute. */
export const AUTO_REFRESH_MIN_GAP_MS = 60_000
/** Un clic sur un cadenas ne relit que si le dernier relevé RÉUSSI a plus de 5 s. */
export const CLICK_REFRESH_MIN_AGE_MS = 5_000
/** Un clic n'attend jamais la relecture plus de 2 s : ensuite il décide sur l'état courant. */
export const CLICK_WAIT_MS = 2_000

/**
 * Liste blanche des champs de palier réécrits par une relecture (miroir de
 * server/utils/planFields.js). Tout le reste (unité préférée, coffre, nom...)
 * reste celui de l'onglet.
 */
export const PLAN_KEYS = [
    'freeRemaining', 'demoRemaining', 'demoUnlimited', 'subscriptionStatus',
    'trialEligible', 'granted', 'requiresPaywall', 'compute', 'promo',
]

/** Ne garde que les champs de palier présents dans la réponse. */
export function pickPlan(fresh) {
    const out = {}
    if (!fresh || typeof fresh !== 'object') return out
    for (const k of PLAN_KEYS) {
        if (Object.prototype.hasOwnProperty.call(fresh, k)) out[k] = fresh[k]
    }
    return out
}

/**
 * Utilisateur courant + champs de palier frais, ou null si l'onglet ne tient
 * plus ce compte (déconnecté, autre id) : alors rien ne doit être écrit.
 */
export function mergePlan(cur, fresh) {
    if (!cur || !cur.id || !fresh || !fresh.id || cur.id !== fresh.id) return null
    return { ...cur, ...pickPlan(fresh) }
}

/**
 * Écriture d'un relevé, sur l'utilisateur COURANT du cache. Refuse (false) un
 * onglet déconnecté, un autre compte, et un compte devenu payant entre-temps :
 * une réponse partie avant le paiement ne rétrograde personne.
 */
export function writeFreshPlan({ getCurrent, setCurrent, applyUser, isPaid, fresh }) {
    const cur = getCurrent()
    const merged = mergePlan(cur, fresh)
    if (!merged) return false
    if (isPaid(cur) && !isPaid(merged)) return false
    if (applyUser(merged) === false) return false
    setCurrent(merged)
    return true
}

/**
 * @param {{ fetchUser: () => Promise<any>, apply: (fresh: object) => any, now?: () => number,
 *   startedAt?: number|null }} deps
 *   fetchUser lit /api/user/plan ; apply écrit le cache ET le store et rend false
 *   quand il refuse (autre compte, déconnecté).
 */
export function createUserRefresher({ fetchUser, apply, now = Date.now, startedAt = null }) {
    let inflight = null
    // `startedAt` : l'utilisateur vient d'être chargé avec la page, ce chargement
    // compte comme un relevé (pas de relecture inutile au premier retour d'onglet).
    let lastAttemptAt = startedAt
    let lastOkAt = startedAt

    /** Relit le palier ; ne rejette jamais. Résout true si l'écriture a eu lieu. */
    const refresh = () => {
        if (inflight) return inflight
        inflight = (async () => {
            let ok = false
            try {
                const fresh = await fetchUser()
                if (fresh && fresh.id) ok = (await apply(fresh)) !== false
            } catch {
                ok = false
            } finally {
                // Toute tentative compte pour la règle des 60 s ; seul un relevé réussi
                // compte pour la règle des 5 s du clic.
                lastAttemptAt = now()
                if (ok) lastOkAt = lastAttemptAt
                inflight = null
            }
            return ok
        })()
        return inflight
    }

    /** Relit seulement si le dernier relevé RÉUSSI a plus de `maxAgeMs` (ou n'a jamais eu lieu). */
    const refreshIfOlderThan = (maxAgeMs) => {
        if (inflight) return inflight
        if (lastOkAt !== null && now() - lastOkAt < maxAgeMs) return Promise.resolve(false)
        return refresh()
    }

    return { refresh, refreshIfOlderThan, lastRefreshAt: () => lastAttemptAt, lastOkAt: () => lastOkAt }
}

/**
 * Décision du plugin d'onglet : faut-il relire le palier ? Jamais pour un
 * visiteur ni pour un compte qui paie déjà (rien à découvrir, et une réponse
 * transitoire « free » en plein renouvellement écraserait un bon relevé).
 * @param {{ signedIn: boolean, paidAccess?: boolean, event: 'visibilitychange'|'focus'|'pageshow',
 *   visibilityState: string, persisted?: boolean, lastAt: number|null, now: number,
 *   minGapMs?: number }} p
 */
export function shouldAutoRefresh({ signedIn, paidAccess = false, event, visibilityState, persisted = false, lastAt, now, minGapMs = AUTO_REFRESH_MIN_GAP_MS }) {
    if (!signedIn || paidAccess) return false
    if (event === 'pageshow') {
        if (persisted !== true) return false
    } else if (visibilityState !== 'visible') {
        return false
    }
    return lastAt === null || now - lastAt >= minGapMs
}

/**
 * Clic sur un cadenas : relit le palier si le relevé est ancien (attente
 * plafonnée à `waitMs`), puis dit quoi faire sur l'état COURANT. Une réponse
 * tardive s'applique seule. 'proceed' = le compte est ouvert ; 'paywall' =
 * ouvrir la fenêtre d'abonnement comme avant (aussi quand la relecture échoue).
 * @param {{ refreshIfOlderThan: (ms: number) => Promise<any>, readState: () => string,
 *   maxAgeMs?: number, waitMs?: number, enabledState?: string }} p
 * @returns {Promise<'proceed'|'paywall'>}
 */
export async function resolveLockedClick({ refreshIfOlderThan, readState, maxAgeMs = CLICK_REFRESH_MIN_AGE_MS, waitMs = CLICK_WAIT_MS, enabledState = 'enabled' }) {
    let timer
    try {
        const read = Promise.resolve().then(() => refreshIfOlderThan(maxAgeMs)).catch(() => false)
        const cap = new Promise((resolve) => { timer = setTimeout(resolve, waitMs) })
        await Promise.race([read, cap])
    } catch {
        // Relecture impossible : on se comporte comme avant.
    } finally {
        clearTimeout(timer)
    }
    return readState() === enabledState ? 'proceed' : 'paywall'
}

/** Garde d'un contrôle : `busy` tant qu'un clic sur cadenas est en cours de résolution. */
export function createLockedClickGuard() {
    return { busy: false }
}

/**
 * Clic sur un cadenas, protégé : ignoré tant qu'un clic précédent du même
 * contrôle attend ; après l'attente, ne fait rien si le contexte a changé
 * (composant démonté, fenêtre fermée, autre résultat : `isCurrent()` faux).
 * @param {{ guard: {busy: boolean}, resolve: () => Promise<'proceed'|'paywall'>,
 *   isCurrent?: () => boolean, onProceed?: () => void, onPaywall: () => void }} p
 * @returns {Promise<'ignored'|'stale'|'proceed'|'paywall'>}
 */
export async function guardedLockedClick({ guard, resolve, isCurrent = () => true, onProceed = () => {}, onPaywall }) {
    if (guard.busy) return 'ignored'
    guard.busy = true
    let outcome
    try {
        outcome = await resolve()
    } finally {
        guard.busy = false
    }
    if (!isCurrent()) return 'stale'
    if (outcome === 'proceed') onProceed()
    else onPaywall()
    return outcome
}

/**
 * Téléchargement local qui peut lever `sheet_locked` (filet) : le chemin normal
 * reste SYNCHRONE (run est appelé avant tout await). Au premier refus, palier
 * relu (resolve) ; compte ouvert → UN nouvel essai, jamais plus. Un second
 * refus, ou un compte toujours verrouillé, ouvre la fenêtre d'abonnement.
 * Toute autre erreur est seulement signalée (warn). `run` est appelé au plus 2 fois.
 * Garde et contexte : voir guardedLockedClick.
 * @returns {Promise<'done'|'paywall'|'failed'|'ignored'|'stale'>}
 */
export async function runLockedDownload({ run, resolve, paywall, warn, guard = createLockedClickGuard(), isCurrent = () => true }) {
    const locked = (e) => e?.message === 'sheet_locked'
    try {
        run()
        return 'done'
    } catch (e) {
        if (!locked(e)) {
            warn(e)
            return 'failed'
        }
    }
    let result = 'paywall'
    const state = await guardedLockedClick({
        guard,
        resolve,
        isCurrent,
        onProceed: () => {
            try {
                run()
                result = 'done'
            } catch (e2) {
                if (locked(e2)) {
                    paywall()
                } else {
                    warn(e2)
                    result = 'failed'
                }
            }
        },
        onPaywall: paywall,
    })
    return state === 'ignored' || state === 'stale' ? state : result
}
