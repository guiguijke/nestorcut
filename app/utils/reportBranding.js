/**
 * Marque de l'entreprise pour le rapport PDF avancé : nom, ligne libre et logo.
 * Gardée DANS CE NAVIGATEUR seulement (localStorage), jamais envoyée au serveur.
 * Une clé versionnée ; le logo y est une data URI PNG déjà réduite.
 * Chaque accès au stockage est protégé : navigation privée, quota plein ou
 * stockage bloqué ne cassent jamais la page.
 */

export const BRANDING_KEY = 'nestorcut.reportBranding.v1'
export const LOGO_MAX_BYTES = 5 * 1024 * 1024

const EMPTY = Object.freeze({ company: '', line: '', logo: null })

function defaultStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null
    } catch {
        return null
    }
}

/** @returns {{ company: string, line: string, logo: string|null }} */
export function loadBranding(storage = defaultStorage()) {
    try {
        const raw = storage?.getItem(BRANDING_KEY)
        if (!raw) return { ...EMPTY }
        const v = JSON.parse(raw)
        if (!v || typeof v !== 'object') return { ...EMPTY }
        return {
            company: typeof v.company === 'string' ? v.company : '',
            line: typeof v.line === 'string' ? v.line : '',
            logo: typeof v.logo === 'string' && v.logo.startsWith('data:image/png;base64,') ? v.logo : null,
        }
    } catch {
        return { ...EMPTY }
    }
}

/**
 * @returns {{ ok: true } | { ok: false, reason: 'quota' | 'unavailable' }}
 *   `quota` : le navigateur n'a plus de place (message clair côté interface).
 */
export function saveBranding(value, storage = defaultStorage()) {
    if (!storage) return { ok: false, reason: 'unavailable' }
    try {
        storage.setItem(BRANDING_KEY, JSON.stringify({
            company: String(value?.company ?? ''),
            line: String(value?.line ?? ''),
            logo: value?.logo || null,
        }))
        return { ok: true }
    } catch (e) {
        const quota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014)
        return { ok: false, reason: quota ? 'quota' : 'unavailable' }
    }
}

/** Efface tout (déconnexion, bouton « retirer »). Ne lève jamais. */
export function clearBranding(storage = defaultStorage()) {
    try {
        storage?.removeItem(BRANDING_KEY)
    } catch {
        // stockage inaccessible : rien à effacer
    }
}
