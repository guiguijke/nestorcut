import { translate, DEFAULT_LOCALE, LOCALES, formatNumber, formatPercent, pluralSelect } from '~/utils/i18n'

/**
 * Locale state for the whole app.
 *
 * Strategy:
 *  1. If the user has a 'locale' cookie, use it (explicit choice wins).
 *  2. Otherwise, on first visit, the server route /api/locale maps the
 *     Cloudflare cf-ipcountry header to a locale ('FR' -> 'fr', else 'en').
 *     The result is stored in the cookie so it is stable across navigations.
 *  3. The switcher in MainHeader writes the cookie, which re-renders
 *     everything reactively.
 *
 * Lot J11-bis (R9) — LE SERVEUR HONORE LE COOKIE DE LANGUE AU RENDU.
 * Ancien comportement : l'état démarrait à DEFAULT_LOCALE ('en') et le
 * cookie n'était lu que côté client dans detectLocale() — le serveur
 * rendait donc l'anglais même avec `Cookie: locale=fr`, et l'utilisateur
 * français voyait un éclair d'anglais à chaque chargement (mesuré par
 * curl sur la PRODUCTION). Le correctif : `useState` de Nuxt (étât PAR
 * REQUÊTE, jamais partagé entre visiteurs) lu du cookie AVANT le premier
 * rendu, sur le serveur comme sur le client. L'appel asynchrone
 * /api/locale ne reste que pour la première visite sans cookie, côté
 * client seulement.
 */
export function useLocale() {
    // useState = PAR REQUÊTE en SSR (jamais partagé), hydraté en client.
    const localeState = useState('locale', () => DEFAULT_LOCALE)

    // Le cookie est lu SYNCHRONÈMENT, AVANT tout rendu — les deux côtés.
    const cookie = useCookie('locale', { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
    if (cookie.value && LOCALES.includes(cookie.value)) {
        localeState.value = cookie.value
    }

    // Détection pays : uniquement côté client, et seulement sans cookie.
    if (import.meta.client && !cookie.value) {
        $fetch('/api/locale').then((detected) => {
            if (detected?.locale && LOCALES.includes(detected.locale)) {
                localeState.value = detected.locale
                cookie.value = detected.locale
            }
        }).catch(() => {
            // Server route unavailable — fall back to default.
        })
    }

    const locale = computed({
        get: () => localeState.value,
        set: (val) => {
            if (!LOCALES.includes(val)) return
            localeState.value = val
            cookie.value = val
        },
    })

    const setLocale = (val) => {
        locale.value = val
    }

    // Reactive translator bound to the current locale.
    const t = (key, params) => translate(key, localeState.value, params)
    // Lot 3 / U2 : `tp('unit.part', 1)` → `unit.part.one`.
    const tp = (base, n, params = {}) =>
        t(`${base}.${pluralSelect(localeState.value, n)}`, { n, ...params })

    // C20/C21 : formatage localisé des nombres affichés (%, aires).
    const fmtPercent = (v, digits = 1) => formatPercent(v, localeState.value, digits)
    const fmtNumber = (v, digits = 1) => formatNumber(v, localeState.value, digits)

    return { locale, setLocale, t, tp, fmtPercent, fmtNumber }
}
