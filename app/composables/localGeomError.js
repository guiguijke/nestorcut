/**
 * Lot E0 (docs/PLAN-ECLATEMENT-2026-09-12.md) : l'échec d'import moteur d'UNE
 * pièce, traduit en « quel fichier, quelle pièce ».
 *
 * Le moteur refuse parfois la géométrie d'un item à l'import (contour
 * dégénéré, anneau que le gonflement ne sait pas produire). Il annonce
 * désormais QUEL item — `item_geometry:<id>: <raison>` dans le message, et un
 * évènement `{"type":"error","kind":"item_geometry","item":<id>}` sur le flux
 * (nest-engine/src/import_error.rs). Sans cette traduction, l'utilisateur
 * lisait « le calcul s'est arrêté de façon inattendue » pour une pièce
 * précise, sur un lot de dix-sept.
 *
 * Tout est PUR ici : le parsing et la correspondance sont testables sans
 * navigateur (app/tests/localGeomError.test.js).
 */

/** Extrait l'id d'item d'un message moteur. `null` si ce n'est pas ce cas. */
export function parseItemGeometryError(message) {
    const m = /(?:^|[^a-z_])item_geometry:(\d+)/.exec(String(message || ''))
    if (!m) return null
    return Number(m[1])
}

/**
 * id moteur → { slug, part } via l'itemMap du job ([{ id, slug, part }]).
 * `part` est l'index de la pièce DANS son fichier (0-based, comme l'itemMap).
 * Rend `null` si l'id est inconnu : on préfère un message générique à un
 * numéro inventé.
 */
export function itemGeometryTarget(message, itemMap) {
    const id = parseItemGeometryError(message)
    if (id === null || !Array.isArray(itemMap)) return null
    const hit = itemMap.find((e) => Number(e?.id) === id)
    if (!hit || !hit.slug) return null
    const part = Number(hit.part)
    return { slug: String(hit.slug), part: Number.isFinite(part) ? part : 0 }
}

/**
 * Paramètres du message affiché : nom de fichier (résolu depuis la liste de
 * fichiers du projet, slug en repli) et RANG de la pièce, 1-based — un
 * utilisateur compte ses pièces à partir de 1.
 */
export function itemGeometryParams(target, files) {
    if (!target) return null
    const list = Array.isArray(files) ? files : []
    const hit = list.find((f) => f?.slug === target.slug)
    return {
        file: hit?.name || hit?.fileName || target.slug,
        part: (target.part || 0) + 1,
    }
}
