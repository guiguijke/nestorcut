/**
 * d4 (02/11) : l'identité d'une tôle de résultat se lit dans le NOM du
 * fichier, jamais dans l'index d'un tableau (côté navigateur, `dxfs[]` saute
 * les tôles dont le DXF n'a pas été construit — finalizeLocal.js:247).
 *   DXF  : `{jobSlug}_alt{rang}_part_{N}.dxf` (worker main.py:303, navigateur
 *          localBridge.js:1908) — N 1-based ;
 *   .job : `{baseName}_tole{N}.job` (sheetcamJobResult.js:201).
 * Nom sans numéro lisible → null (D2 : jamais verrouillé).
 */
export const SHEET_DXF_NAME_RE = /_part_(\d+)\.dxf$/
export const SHEET_JOB_NAME_RE = /_tole(\d+)\.job$/

export function sheetNumberFromFileName(name) {
    if (typeof name !== 'string' || name.length === 0) return null
    const m = SHEET_DXF_NAME_RE.exec(name) || SHEET_JOB_NAME_RE.exec(name)
    if (!m) return null
    const n = Number(m[1])
    return Number.isSafeInteger(n) && n >= 1 ? n : null
}

/** true si le fichier est téléchargeable avec ce plafond (Infinity = tout).
 * Plafond 0 (tôle importée, compte Free) : RIEN n'est livré, pas même un nom
 * illisible (sinon un fichier sans numéro passerait par la règle D2). */
export function isSheetFileAllowed(name, maxSheet) {
    if (typeof maxSheet === 'number' && maxSheet <= 0) return false
    const n = sheetNumberFromFileName(name)
    return n == null || n <= maxSheet
}

/** Plafond effectif d'un résultat : un compte verrouillé (plafond fini) qui
 * télécharge un résultat portant une tôle importée n'obtient AUCUN fichier
 * (0) ; un compte ouvert (Infinity) ou un résultat sans tôle importée garde
 * le plafond reçu, à l'identique. */
export function effectiveSheetCap(maxSheet, hasImportedSheet) {
    return hasImportedSheet && Number.isFinite(maxSheet) ? 0 : maxSheet
}
