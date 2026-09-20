// Lot L0 (docs/PLAN-LANGUES-2026-09-16.md §2) — le REGISTRE des langues.
//
// Un fichier par langue à côté de celui-ci (`<code>.js`, export default
// plat) ; l'anglais est la RÉFÉRENCE du verrou de parité
// (app/tests/i18nParity.test.js) : toute clé de l'anglais doit exister
// dans chaque langue livrée, sans valeur vide, sans copie de l'anglais
// hors liste blanche. Ajouter une langue = un fichier + une ligne au
// registre DICTS + le nom natif dans LANGUAGE_LABELS — et le verrou de
// parité doit être VERT avant qu'elle apparaisse au menu.
import en from './en.js'
import fr from './fr.js'
import pt from './pt.js'
import it from './it.js'
import de from './de.js'

/** Les dictionnaires livrés. L'ordre est celui du menu. */
export const DICTS = { en, fr, pt, it, de }

/** Codes de langues livrées (dérivé — jamais saisi à la main). */
export const LOCALES = Object.keys(DICTS)

/** La langue par défaut est la référence du verrou. */
export const DEFAULT_LOCALE = 'en'

/** Le nom de chaque langue DANS SA LANGUE — c'est ce que le menu montre. */
export const LANGUAGE_LABELS = {
    en: 'English',
    fr: 'Français',
    pt: 'Português',
    it: 'Italiano',
    de: 'Deutsch',
}

/** Balise Intl par code — formatage des nombres (virgule décimale, etc.).
 *  L2 (piège du plan) : LA table unique locale ⇒ balise — units.js
 *  l'importe au lieu d'en garder une copie. */
export const INTL_TAGS = {
    en: 'en-US',
    fr: 'fr-FR',
    pt: 'pt-BR',
    it: 'it-IT',
    de: 'de-DE',
}

/** La balise Intl d'un code de langue (repli : le code lui-même). */
export function intlTag(locale) {
    return INTL_TAGS[locale] || locale
}

/** Sélecteur de pluriel par langue ('one' | 'other'). */
export function pluralSelect(locale, n) {
    if (locale === 'fr') return n === 0 || n === 1 ? 'one' : 'other'
    // pt, it, de, es : seul 1 est singulier, 0 est pluriel (« 0 peças »,
    // « 0 pezzi », « 0 Teile »)
    return n === 1 ? 'one' : 'other'
}

export function translate(key, locale = DEFAULT_LOCALE, params = {}) {
    let value = DICTS[locale]?.[key]
    if (value === undefined) {
        // Fall back to English, then to the raw key.
        value = DICTS[DEFAULT_LOCALE][key] ?? key
    }
    if (params && typeof value === 'string') {
        for (const [k, v] of Object.entries(params)) {
            value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
        }
    }
    return value
}

/**
 * C20/C21 (lot 3) : nombres formatés selon la locale — « 55,4 » en FR,
 * « 55.4 » en EN, via Intl.NumberFormat (pas de toFixed affiché brut).
 * Lot L0 : la balise Intl vient du REGISTRE — une langue nouvelle hérite
 * de sa virgule décimale en ajoutant une ligne à INTL_TAGS.
 */
export function formatNumber(v, locale = DEFAULT_LOCALE, digits = 1) {
    const n = Number(v)
    if (!Number.isFinite(n)) return '—'
    return new Intl.NumberFormat(intlTag(locale), {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
    }).format(n)
}

/** Pourcentage localisé : « 55.4% » EN / « 55,4 % » FR. */
export function formatPercent(v, locale = DEFAULT_LOCALE, digits = 1) {
    const n = Number(v)
    if (!Number.isFinite(n)) return '—'
    return formatNumber(n, locale, digits) + (locale === 'fr' ? ' %' : '%')
}
