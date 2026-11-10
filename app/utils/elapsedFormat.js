import { DEFAULT_LOCALE, formatNumber } from './i18n'

/**
 * Temps écoulé d'un calcul, dans la langue courante :
 *   moins d'une minute → « 2.1s » (en) · « 2,1 s » (fr, espace insécable)
 *   une minute ou plus  → « 2m05.3 » (en) · « 2m05,3 » (fr)
 * Le séparateur décimal vient du registre de langues (formatNumber).
 * Une valeur absente, négative ou non numérique s'affiche « 0.0s ».
 */
export function formatElapsed(sec, locale = DEFAULT_LOCALE) {
    const n = Number(sec)
    const value = Number.isFinite(n) && n >= 0 ? n : 0
    // On décide sur le dixième arrondi : 59,96 s doit devenir « 1m00.0 »,
    // jamais « 0m60.0 » ni « 59.96 ».
    const tenths = Math.round(value * 10)
    if (tenths < 600) {
        const unitSpace = locale === 'fr' ? '\u00a0' : ''
        return `${formatNumber(tenths / 10, locale, 1, 1)}${unitSpace}s`
    }
    const min = Math.floor(tenths / 600)
    const remText = formatNumber((tenths - min * 600) / 10, locale, 1, 1)
    const intDigits = remText.match(/^\d+/)[0].length
    return `${min}m${'0'.repeat(Math.max(0, 2 - intDigits))}${remText}`
}
