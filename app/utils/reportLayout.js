/**
 * Mise en page du rapport de résultat (logique pure, testée en node).
 */

const NBSP = '\u00a0'

/**
 * « 1000 × 2000 mm » dont aucun espace ne se coupe : sur un écran étroit la
 * dimension reste d'un seul tenant au lieu de se casser après le « × ».
 * @param {string} w — largeur déjà formatée (sans unité)
 * @param {string} h — hauteur déjà formatée (sans unité)
 * @param {string} unit — « mm » ou « " »
 */
export function nbspDims(w, h, unit) {
    const u = unit === '"' ? '"' : `${NBSP}${unit}`
    return `${w}${NBSP}×${NBSP}${h}${u}`
}

/**
 * La chute figure déjà dans le bloc de tête. La colonne « Chute » du tableau
 * ne sert que si elle apporte autre chose : plusieurs tôles (une chute chacune),
 * ou un rapport dont le bloc de tête n'a pas de chute à montrer.
 * @param {Array} sheets — tôles du rapport
 * @param {object|null} headOffcut — la chute montrée dans le bloc de tête
 */
export function showSheetOffcutColumn(sheets, headOffcut) {
    const list = Array.isArray(sheets) ? sheets : []
    if (list.length > 1) return true
    return !headOffcut && list.some((s) => s?.offcut)
}
