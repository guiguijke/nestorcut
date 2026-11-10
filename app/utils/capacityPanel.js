import { MAX_SHEETS_PER_JOB } from '~~/shared/constants/payment.constants'

/**
 * Z1 (vérif 2026-09-05) : modèle du bandeau « refus capacité » de la page
 * projet — les trois leviers chiffrés du pré-contrôle (tôles nécessaires,
 * pièces max à cet espacement, espacement max qui tient) et les actions
 * correctives dérivées des réglages courants. Pur et testé ; la page
 * ([slug].vue) ne fait que le rendu.
 *
 * `unfit` vient soit du 422 de l'API (files.js nestUnfit), soit du refus
 * navigateur (localSolverRegistry → localPayloadBuilder), soit d'une
 * solution partielle (reason 'partial').
 */

const finiteOrNull = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * Σ des `count` > 0 (entiers tronqués) — même règle que le serveur
 * (nest.post.js : `Math.floor(count)`, puis `count >= 1`) et que le « premier
 * format actif » de addSheetsPlan. PAS la règle `Number(c) || 1` de
 * capacityClient.js, qui compte un format sans quantité pour une tôle.
 * @param {Array<{count?: any}>} sheets
 * @returns {number}
 */
export function declaredSheetCount(sheets) {
    if (!Array.isArray(sheets)) return 0
    return sheets.reduce((sum, s) => sum + Math.max(0, Math.trunc(Number(s?.count) || 0)), 0)
}

/**
 * d6 : miroir UX de la borne technique serveur (400 `too_many_sheets`) —
 * grise Nest avant le POST. L'autorité reste le serveur.
 */
export function exceedsMaxSheets(sheets, max = MAX_SHEETS_PER_JOB) {
    return declaredSheetCount(sheets) > max
}

/**
 * d7 : « Ajouter environ k tôles et relancer ».
 * k = max(1, ceil(sheetsNeeded) − déclaré) ; sans `sheetsNeeded` fini > 0
 * (cas `strip`, refus partiel), k = 1. Le ceil porte sur une ESTIMATION
 * (ratio d'aire ; plusieurs formats = approximation) d'où « environ ».
 * @param {object|null} unfit payload de refus ({sheetsNeeded?, …})
 * @param {Array<{count?: any}>} sheets réglages courants (chaînes d'unité d'affichage)
 * @param {number} [max] borne technique
 * @returns {{ k: number, nextSheets: object[] } | null}
 *   null si aucun format actif (rien à incrémenter) ou si déclaré + k > max.
 *   nextSheets = sheets avec le count du PREMIER format actif augmenté de k,
 *   en CHAÎNE (les champs de réglage sont des chaînes) ; les autres inchangés.
 */
export function addSheetsPlan(unfit, sheets = [], max = MAX_SHEETS_PER_JOB) {
    if (!Array.isArray(sheets)) return null
    const firstIdx = sheets.findIndex((s) => Math.trunc(Number(s?.count) || 0) > 0)
    if (firstIdx < 0) return null
    const declared = declaredSheetCount(sheets)
    const needed = finiteOrNull(unfit?.sheetsNeeded)
    const k = needed != null && needed > 0 ? Math.max(1, Math.ceil(needed) - declared) : 1
    if (declared + k > max) return null
    const nextSheets = sheets.map((s, i) => (i === firstIdx
        ? { ...s, count: String(Math.trunc(Number(s.count) || 0) + k) }
        : s))
    return { k, nextSheets }
}

/**
 * @param {object|null} unfit {reason, ratio?, sheetsNeeded?,
 *   maxPartsAtSpacing?, maxSpacingForFitMm?, unplaced?}
 * @param {object} ctx {sheets: [{width, height, count}], spaceMm: number|null,
 *   kerfMm?: number|null}
 * @returns {object|null} null quand il n'y a rien à afficher.
 */
export function capacityPanelModel(unfit, { sheets = [], spaceMm = null, kerfMm = null, preflightSheets = null } = {}) {
    if (!unfit || !unfit.reason) return null
    const num = finiteOrNull
    // Une seule source pour « environ N tôles » : le pré-vol du bouton Nest
    // (`preflightSheets`, mêmes réglages) l'emporte sur le chiffre du refus,
    // sinon bouton et panneau pouvaient annoncer 6 et 5 pour le même refus.
    const preflight = num(preflightSheets)
    const sheetsNeeded = preflight != null && preflight > 0 ? preflight : num(unfit.sheetsNeeded)
    const maxParts = num(unfit.maxPartsAtSpacing)
    // Un espacement maximal de 0 mm (ou moins) veut dire « rien ne tient, même
    // sans espacement » : ce n'est pas un levier à chiffrer (« environ 0 mm »).
    // Exception : `maxSpacingZeroFits` (le maximum INTERNE dépassait 0 mais pas
    // la marge de courbes) — 0 mm tient, c'est un vrai levier à 0.
    const rawMaxSpacing = num(unfit.maxSpacingForFitMm)
    const zeroFits = unfit.maxSpacingZeroFits === true && rawMaxSpacing != null && rawMaxSpacing <= 0
    const maxSpacingMm = rawMaxSpacing != null && (rawMaxSpacing > 0 || zeroFits) ? Math.max(0, rawMaxSpacing) : null
    const noFitEvenAtZero = rawMaxSpacing != null && rawMaxSpacing <= 0 && !zeroFits
    if (sheetsNeeded == null && maxParts == null && maxSpacingMm == null
        && num(unfit.unplaced) == null) {
        return null
    }
    // « Ajouter environ k tôles et relancer » (d7) : k tôles d'un coup sur le
    // premier format actif — les leviers disent « environ N tôles », le
    // bouton ajoute l'écart estimé (au moins une) et l'utilisateur relance.
    const plan = addSheetsPlan({ ...unfit, sheetsNeeded }, sheets)
    // « Réduire l'espacement » (C04) : utile seulement si le levier existe
    // ET abaisse réellement l'espacement courant (un maxSpacing ≥ space
    // n'est pas une action) ET qu'il reste quelque chose à gagner —
    // sous 0,5 mm d'espacement courant le levier est MASQUÉ (la marge
    // restante est illusoire), et avec le kerf explicite la cible doit
    // dépasser DEUX kerfs (espacement = 2 × kerf + sécurité : on ne réduit
    // jamais la largeur de coupe de l'outil).
    const SPACING_FLOOR_MM = 0.5
    const spacingAtFloor = !zeroFits && spaceMm != null && spaceMm <= SPACING_FLOOR_MM
    const kerf = num(kerfMm)
    const leverWouldHelp = maxSpacingMm != null && spaceMm != null && maxSpacingMm < spaceMm
    // Cible 0 : bloquée seulement si un kerf > 0 est déclaré (0 = kerf 0 est valide).
    const kerfBlocks = leverWouldHelp && kerf != null && (zeroFits ? kerf > 0 : maxSpacingMm <= 2 * kerf)
    const canReduceSpacing = leverWouldHelp && !spacingAtFloor && !kerfBlocks
    return {
        reason: unfit.reason,
        unplaced: num(unfit.unplaced),
        levers: { sheetsNeeded, maxParts, maxSpacingMm },
        nextSheets: plan?.nextSheets ?? null,
        addSheets: plan?.k ?? null,
        reduceSpacingToMm: canReduceSpacing ? maxSpacingMm : null,
        // C04 : espacement courant déjà au plancher (≤ 0,5 mm) ou kerf
        // bloquant — la page affiche « même sans espacement, ça ne tient
        // pas » au lieu d'un bouton inutile.
        noSpacingGain: !zeroFits && (spacingAtFloor || kerfBlocks || noFitEvenAtZero),
    }
}
