import { convexHullRing } from '../composables/localPayloadBuilder' // relatif : en vitest, `~` = racine du dépôt

/**
 * Deux nombres par pièce pour l'estimation de la page : aire et périmètre du
 * contour EXTÉRIEUR (trous non déduits), comme ce que le calcul donne à
 * `inflatedArea`. Mesurés sur l'anneau BRUT : le calcul le simplifie d'abord
 * (écart d'un cheveu), mais cette simplification coûte des secondes sur des
 * centaines de pièces détaillées, et ceci tourne à chaque chargement.
 */

function ringMeasures(ring) {
    let twice = 0
    let perimeter = 0
    for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[(i + 1) % ring.length]
        twice += x1 * y2 - x2 * y1
        perimeter += Math.hypot(x2 - x1, y2 - y1)
    }
    return { outlineAreaMm2: Math.abs(twice) / 2, outlinePerimeterMm: perimeter }
}

const usable = (ring) => Array.isArray(ring) && ring.length >= 3
    && ring.every((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))

/** Nombres d'une pièce seule, ou null si son anneau est illisible (le repli reste la boîte). */
export function partOutlineNumbers(ring) {
    if (!usable(ring)) return null
    const m = ringMeasures(ring)
    return m.outlineAreaMm2 > 0 ? m : null
}

/** Nombres d'un bloc : l'enveloppe convexe de tous ses anneaux, à leur place réelle
 * (l'item unique que le calcul pose pour une fiche à plusieurs pièces). */
export function blockOutlineNumbers(rings) {
    const lists = (rings || []).filter(usable)
    if (lists.length < 2) return null
    const hull = convexHullRing(lists.flat())
    if (hull.length < 4) return null
    const m = ringMeasures(hull)
    return m.outlineAreaMm2 > 0 ? m : null
}
