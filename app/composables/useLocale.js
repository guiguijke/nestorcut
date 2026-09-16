import { translate, DEFAULT_LOCALE, LOCALES, formatNumber, formatPercent, pluralSelect } from '~/utils/i18n'

/**
 * Locale state for the whole app.
 *
 * Lot L0 (docs/PLAN-LANGUES-2026-09-16.md §2.4) — la détection du premier
 * passage lit ACCEPT-LANGUAGE, côté SERVEUR, parmi les langues livrées :
 * plus d'éclair, plus d'appel client, et la langue du navigateur est
 * honorée même sans JavaScript. Ordre : cookie explicite > Accept-Language
 * > anglais. Le commutateur écrit le cookie, qui prime ensuite toujours.
 *
 * (Historique R9/J11-bis : le cookie est lu SYNCHRONÉMENT avant le
 * premier rendu, des deux côtés — c'est ce qui supprimait l'éclair
 * d'anglais. L'appel asynchrone /api/locale (pays Cloudflare) est
 * retiré : Accept-Language le remporte — la langue du navigateur dit
 * mieux la langue que l'adresse IP.)
 */
export function useLocale() {
    // useState = PAR REQUÊTE en SSR (jamais partagé), hydraté en client.
    const localeState = useState('locale', () => DEFAULT_LOCALE)

    // Le cookie est lu SYNCHRONÉMENT, AVANT tout rendu — les deux côtés.
    const cookie = useCookie('locale', { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
    if (cookie.value && LOCALES.includes(cookie.value)) {
        localeState.value = cookie.value
    } else if (import.meta.server) {
        // Premier passage sans cookie : la langue du NAVIGATEUR, parmi
        // les langues livrées, par ordre de préférence (q). Repli anglais.
        // Côté CLIENT on ne re-détecte PAS : l'état servi (Accept-Language
        // = la liste du navigateur) est hydraté tel quel — le re-détecter
        // ici rouvrirait le mismatch d'hydratation que R9 avait fermé.
        const headers = useRequestHeaders(['accept-language'])
        const header = headers?.['accept-language'] || ''
        const preferred = header
            .split(',')
            .map((part) => {
                const [tag, ...params] = part.trim().split(';')
                const q = Number((params.find((p) => p.trim().startsWith('q=')) || 'q=1').split('=')[1])
                return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 1 }
            })
            .sort((a, b) => b.q - a.q)
        for (const { tag } of preferred) {
            const base = tag.split('-')[0]
            const hit = LOCALES.find((l) => tag === l || base === l)
            if (hit) { localeState.value = hit; break }
        }
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
