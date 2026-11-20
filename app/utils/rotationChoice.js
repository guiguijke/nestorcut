/**
 * Réglage « Rotations » : logique PURE du contrôle segmenté (1, 2, 4, 8,
 * « Autre »). Le segment ne peut pas se déduire de la valeur seule : en
 * tapant « 12 » dans le champ « Autre », le « 1 » intermédiaire est un
 * préréglage, le champ disparaissait et « 12 » devenait impossible.
 * « Autre » reste donc choisi tant que l'utilisateur y est (état collant).
 */

export const ROT_PRESETS = [1, 2, 4, 8]
export const ROT_MIN = 1
export const ROT_MAX = 360
export const ROT_DEFAULT = 4
/** Valeur posée quand on passe sur « Autre » depuis un préréglage (champ ouvert sur 3). */
export const ROT_OTHER_START = 3

/**
 * Valeur EFFECTIVE, celle que le serveur et le moteur utilisent (même formule
 * que nest.post.js et files.js : vide, 0 ou illisible → 4, puis 1..360).
 */
export function effectiveRotationCount(raw) {
    return Math.min(ROT_MAX, Math.max(ROT_MIN, Math.floor(Number(raw) || ROT_DEFAULT)))
}

/** « Autre » dès le chargement quand la valeur enregistrée n'est pas un préréglage. */
export function initialOtherMode(raw) {
    return !ROT_PRESETS.includes(effectiveRotationCount(raw))
}

/** Segment à afficher : « other » tant que le mode est collant, sinon d'après la valeur. */
export function rotationSegment(raw, otherMode) {
    if (otherMode) return 'other'
    const n = effectiveRotationCount(raw)
    return ROT_PRESETS.includes(n) ? n : 'other'
}

/**
 * Clic sur un segment : { otherMode, count }. `count` est undefined quand la
 * valeur enregistrée ne change pas. Un préréglage ferme « Autre » ; « Autre »
 * depuis un préréglage ouvre le champ sur 3, depuis « Autre » ne touche à rien.
 */
export function pickRotationSegment(choice, raw, otherMode) {
    if (choice !== 'other') return { otherMode: false, count: choice }
    if (otherMode || !ROT_PRESETS.includes(effectiveRotationCount(raw))) {
        return { otherMode: true, count: undefined }
    }
    return { otherMode: true, count: ROT_OTHER_START }
}
