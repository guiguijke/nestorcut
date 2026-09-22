/**
 * Lot J11-c (§3 point 10) — le registre des nouveautés visibles.
 *
 * `{ clé, livréLe: 'AAAA-MM-JJ' }` par nouveauté. Le badge « Nouveau »
 * s'affiche TANT QUE aujourd'hui < livréLe + 7 jours, puis ne rend plus
 * rien. AUCUN stockage, aucun suivi par utilisateur : la date de
 * livraison seule décide, elle est écrite au moment de la promotion.
 * Le lint (ou le vérificateur) vide les entrées de plus de 30 jours —
 * pas de dette qui traîne.
 *
 * `livréLe` est la date de PREMIÈRE MISE EN PRODUCTION de la nouveauté.
 */
export const WHATS_NEW = {
    // J11 (déployé avec V0.9.x) :
}

/** La clé est-elle encore « nouvelle » à la date donnée ? (7 jours.) */
export function isNewFeature(key, today = new Date()) {
    const released = WHATS_NEW[key]
    if (!released) return false
    const t = today instanceof Date ? today : new Date(today)
    const limit = new Date(released)
    limit.setDate(limit.getDate() + 7)
    return t.getTime() < limit.getTime()
}
