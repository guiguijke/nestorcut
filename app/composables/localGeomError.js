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
 * Lot A : le moteur ne trouve de place pour UNE pièce nulle part (pièce à la
 * cote exacte de la tôle, constructif sans position valide) — message
 * `item_unplaceable:<id>: <raison>` (nest-engine/src/import_error.rs,
 * `item_unplaceable_error`). Même forme que `item_geometry`, autre cause :
 * ce n'est pas le contour qui est faux, c'est qu'il ne reste aucune place.
 */
export function parseItemUnplaceableError(message) {
    const m = /(?:^|[^a-z_])item_unplaceable:(\d+)/.exec(String(message || ''))
    if (!m) return null
    return Number(m[1])
}

/**
 * id moteur → { slug, part } via l'itemMap ; null si l'id est inconnu.
 *
 * Quand la réduction J-085 a réindexé l'instance (`payload.meta.idMap` :
 * id réduit → id d'origine), l'id du message est un id RÉDUIT, alors que
 * l'itemMap porte les ids d'origine : sans `idMap` on nommerait une autre
 * pièce. Un id hors de l'idMap reste inconnu (null), jamais deviné.
 */
function targetOfId(id, itemMap, idMap) {
    if (id === null || !Array.isArray(itemMap)) return null
    let original = id
    if (Array.isArray(idMap)) {
        if (!Number.isInteger(id) || id < 0 || id >= idMap.length) return null
        original = Number(idMap[id])
    }
    const hit = itemMap.find((e) => Number(e?.id) === original)
    if (!hit || !hit.slug) return null
    const part = Number(hit.part)
    return { slug: String(hit.slug), part: Number.isFinite(part) ? part : 0 }
}

/**
 * id moteur → { slug, part } via l'itemMap du job ([{ id, slug, part }]).
 * `part` est l'index de la pièce DANS son fichier (0-based, comme l'itemMap).
 * `idMap` (optionnel) : `meta.idMap` de l'instance réduite.
 * Rend `null` si l'id est inconnu : on préfère un message générique à un
 * numéro inventé.
 */
export function itemGeometryTarget(message, itemMap, idMap) {
    return targetOfId(parseItemGeometryError(message), itemMap, idMap)
}

/** Idem pour le refus `item_unplaceable` (lot A). */
export function itemUnplaceableTarget(message, itemMap, idMap) {
    return targetOfId(parseItemUnplaceableError(message), itemMap, idMap)
}

/**
 * Lot E2 : items « plus fins que l'espacement » (le gonflement d'import a
 * pris le repli du lot E0) → liste [{item, slug, part}], triée et bornée.
 * Le moteur les livre quand même : c'est un CONSTAT, pas une erreur.
 */
export const MAX_THIN_PARTS = 50

/**
 * `idMap` (optionnel) : `meta.idMap` de l'instance réduite (J-085). Le moteur
 * nomme alors des ids RÉDUITS, l'itemMap porte les ids d'origine : même
 * conversion que `targetOfId`, un id hors de l'idMap est écarté (jamais
 * deviné). La liste est triée AVANT d'être bornée ; `count` est le vrai
 * nombre de pièces nommées (sans doublon), au-delà de la borne.
 */
export function thinPartsSummary(items, itemMap, idMap) {
    const map = Array.isArray(itemMap) ? itemMap : []
    const seen = new Set()
    const all = []
    for (const raw of (Array.isArray(items) ? items : [])) {
        let id = Number(raw)
        if (!Number.isFinite(id)) continue
        if (Array.isArray(idMap)) {
            if (!Number.isInteger(id) || id < 0 || id >= idMap.length) continue
            id = Number(idMap[id])
        }
        if (seen.has(id)) continue
        seen.add(id)
        const hit = map.find((e) => Number(e?.id) === id)
        all.push({
            item: id,
            slug: hit?.slug ? String(hit.slug) : null,
            part: Number.isFinite(Number(hit?.part)) ? Number(hit.part) : 0,
        })
    }
    all.sort((a, b) => String(a.slug || '').localeCompare(String(b.slug || '')) || a.part - b.part)
    return {
        parts: all.slice(0, MAX_THIN_PARTS),
        count: all.filter((e) => e.slug).length,
    }
}

export function thinPartsFromItems(items, itemMap, idMap) {
    return thinPartsSummary(items, itemMap, idMap).parts
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
