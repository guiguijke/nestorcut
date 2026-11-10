// Avertissement « l'imbrication dans les trous est désactivée ».
//
// Le canal capillaire qui ouvre un trou se referme quand l'espacement INTERNE
// atteint 2,5 mm (CHANNEL_MAX_WIDTH). L'interne est l'espacement demandé plus
// une marge de courbes plafonnée à 0,12 mm : dès 2,5 − 0,12 = 2,38 mm
// demandés, une pièce courbe peut déjà fermer ses canaux.
export const HOLES_CHANNEL_CLOSES_AT_MM = 2.5
export const HOLES_MARGIN_CAP_MM = 0.12
export const HOLES_HINT_FROM_MM = HOLES_CHANNEL_CLOSES_AT_MM - HOLES_MARGIN_CAP_MM

/** @param {number} requestedSpaceMm espacement demandé, en mm */
export function holesDisabledHintVisible(requestedSpaceMm, fillHoles) {
    // 1e-9 : 2,5 − 0,12 n'est pas exactement 2,38 en flottant.
    return Number(requestedSpaceMm) >= HOLES_HINT_FROM_MM - 1e-9 && fillHoles !== false
}
