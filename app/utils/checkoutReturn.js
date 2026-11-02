// Retour de Checkout (O3, d10, D15, D17) : pur et testable en node — aucun
// accès direct à window, à l'horloge ni au réseau (tout est injecté).

/** D15 : intention de checkout, écrite juste avant la redirection vers Stripe. */
export const CHECKOUT_INTENT_KEY = 'nestorcut:checkoutIntent'
export const CHECKOUT_INTENT_TTL_MS = 2 * 60 * 60 * 1000
export const CHECKOUT_SOURCES = ['locked_sheets', 'quota', 'export', 'turbo', 'profile', 'account', 'other']
export const CHECKOUT_ID_RE = /^[0-9a-f]{24}$/ // generateRandomString(24), strings.js:10-13

// Slug de projet : <adjectif>-<nom>-<12 hex> ou 'demo' — jamais d'autre forme
// dans le stockage.
const INTENT_PROJECT_SLUG_RE = /^[A-Za-z0-9_-]{1,200}$/
// Slug de résultat = slug de job (buildJobSlug, service.js:356) : trois noms de
// fichier jusqu'à 200 car. chacun + compteurs, donc bien au-delà de 200. Une
// borne de 200 faisait taire la réouverture pour tout job aux longs noms de
// fichier ; 1024 la faisait encore taire pour des noms de 196 car. en щ/ß/æ/ж,
// que standard-slugify allonge jusqu'à 4× (shch, ss, ae, zh : jusqu'à ~2400 car.
// au pire). Ne sort jamais du navigateur : la borne ne protège que le stockage.
const INTENT_RESULT_SLUG_RE = /^[A-Za-z0-9_-]{1,4096}$/
// Une horloge qui retarde de plus d'une minute n'est plus une horloge.
const INTENT_FUTURE_SKEW_MS = 60 * 1000

export function normalizeCheckoutSource(source) {
    return CHECKOUT_SOURCES.includes(source) ? source : 'other'
}

function cleanSlug(value, re) {
    return typeof value === 'string' && re.test(value) ? value : null
}

/** Écrit { v: 1, source, resultSlug, projectSlug, at: now } (resultSlug validé
 * /^[A-Za-z0-9_-]{1,4096}$/, projectSlug /^[A-Za-z0-9_-]{1,200}$/, sinon null).
 * Jamais d'exception (rend false). */
export function writeCheckoutIntent(storage, { source, resultSlug = null, projectSlug = null } = {}, now = Date.now()) {
    try {
        storage.setItem(
            CHECKOUT_INTENT_KEY,
            JSON.stringify({
                v: 1,
                source: normalizeCheckoutSource(source),
                resultSlug: cleanSlug(resultSlug, INTENT_RESULT_SLUG_RE),
                projectSlug: cleanSlug(projectSlug, INTENT_PROJECT_SLUG_RE),
                at: now,
            }),
        )
        return true
    } catch {
        return false
    }
}

/** Lit PUIS supprime la clé (consommée une fois). null si absente, JSON
 * invalide, v ≠ 1, plus vieille que la TTL, ou datée de plus d'1 min dans le
 * futur. Jamais d'exception. → { source, resultSlug, projectSlug } | null */
export function takeCheckoutIntent(storage, now = Date.now()) {
    let raw = null
    try {
        raw = storage.getItem(CHECKOUT_INTENT_KEY)
    } catch {
        return null
    }
    try {
        storage.removeItem(CHECKOUT_INTENT_KEY)
    } catch {
        // La clé reste, la TTL la rendra inoffensive.
    }
    if (typeof raw !== 'string' || raw.length === 0) return null
    let parsed = null
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 1) return null
    const at = parsed.at
    if (typeof at !== 'number' || !Number.isFinite(at)) return null
    if (now - at > CHECKOUT_INTENT_TTL_MS) return null
    if (at - now > INTENT_FUTURE_SKEW_MS) return null
    return {
        source: normalizeCheckoutSource(parsed.source),
        resultSlug: cleanSlug(parsed.resultSlug, INTENT_RESULT_SLUG_RE),
        projectSlug: cleanSlug(parsed.projectSlug, INTENT_PROJECT_SLUG_RE),
    }
}

/** query.subscriptionInternalId conforme → { kind: 'success', id } ; présent
 * mais non conforme → { kind: 'invalid' } ; query.checkout === 'cancelled' →
 * { kind: 'cancel' } ; sinon null. */
export function checkoutReturnMarker(query) {
    const q = query || {}
    const id = q.subscriptionInternalId
    if (id !== undefined && id !== null) {
        return typeof id === 'string' && CHECKOUT_ID_RE.test(id) ? { kind: 'success', id } : { kind: 'invalid' }
    }
    if (q.checkout === 'cancelled') return { kind: 'cancel' }
    return null
}

/** Copie de query sans `subscriptionInternalId` ni `checkout`. */
export function queryWithoutCheckoutMarkers(query) {
    const out = {}
    for (const [key, value] of Object.entries(query || {})) {
        if (key === 'subscriptionInternalId' || key === 'checkout') continue
        out[key] = value
    }
    return out
}

/** '/project/…' → 'project', '/home' → 'home', '/profile' → 'profile', sinon 'other'. */
export function returnPageKind(path) {
    if (typeof path !== 'string') return 'other'
    if (/^\/project\/[^/]+/.test(path)) return 'project'
    if (/^\/home\/?$/.test(path)) return 'home'
    if (/^\/profile\/?$/.test(path)) return 'profile'
    return 'other'
}

/** Statuts /check : actifs, en attente (on réessaie), le reste est terminal non actif. */
export const CHECKOUT_ACTIVE_STATUSES = ['trialing', 'active']
export const CHECKOUT_RETRY_STATUSES = ['pending', 'error']

/**
 * D17 : interroge /check jusqu'à un statut terminal. Pur et testable : aucune
 * horloge ni réseau implicite.
 *   check()      → Promise<string> statut ; une exception compte comme 'error'.
 *   sleep(ms)    → Promise<void> ; l'appelant peut la résoudre plus tôt
 *                  (visibilitychange → visible).
 *   now()        → ms (défaut Date.now).
 *   onSlow()     → appelé UNE fois, quand la phase rapide se termine sur un
 *                  statut de CHECKOUT_RETRY_STATUSES (toast sub.return.pending).
 * Phase rapide : `fastTries` essais séparés de `fastDelayMs` ; phase lente :
 * un essai toutes les `slowDelayMs` tant que now() − début < `maxMs`.
 * → { status, attempts, timedOut } : status = premier statut hors
 *   CHECKOUT_RETRY_STATUSES, ou le dernier statut si le délai est épuisé
 *   (timedOut = true). Ne jette jamais.
 */
export async function pollCheckoutStatus(
    { check, sleep, now = Date.now, onSlow = () => {} },
    { fastTries = 3, fastDelayMs = 2000, slowDelayMs = 5000, maxMs = 120000 } = {},
) {
    const startedAt = now()
    let attempts = 0
    let status = 'error'

    const probe = async () => {
        attempts += 1
        try {
            const value = await check()
            status = typeof value === 'string' && value ? value : 'error'
        } catch {
            status = 'error'
        }
        return !CHECKOUT_RETRY_STATUSES.includes(status)
    }
    const wait = async (ms) => {
        try {
            await sleep(ms)
        } catch {
            // Une attente qui échoue ne doit pas interrompre la vérification.
        }
    }

    // Phase rapide : le webhook Stripe arrive le plus souvent en moins de 7 s.
    for (let i = 0; i < fastTries; i += 1) {
        if (i > 0) await wait(fastDelayMs)
        if (await probe()) return { status, attempts, timedOut: false }
    }

    try {
        onSlow()
    } catch {
        // Le toast ne doit pas interrompre la vérification.
    }

    // Phase lente : bornée par maxMs depuis le début.
    while (now() - startedAt < maxMs) {
        await wait(slowDelayMs)
        if (await probe()) return { status, attempts, timedOut: false }
    }
    return { status, attempts, timedOut: true }
}
