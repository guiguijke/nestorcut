/**
 * Raison d'échec d'un job (carte de résultat) : le champ `information` du
 * job porte soit un code stable posé par le navigateur / le serveur
 * (local-fail, sweeper `local_interrupted`), soit le texte du worker.
 * Rend la clé i18n de l'explication destinée à l'utilisateur, ou `null`
 * quand `information` est un texte libre déjà lisible (ou absent).
 *
 * Le repli `localCompute.error` couvre les codes techniques sans message
 * dédié : un échec n'est jamais affiché sans raison.
 */
const REASON_KEYS = {
    memory_cap: 'localMode.memorySuggest',
    entity_limit: 'localMode.entityLimit',
    geometry_missing: 'localImport.missingGeometry',
    all_alternatives_invalid: 'localMode.allInvalid',
    capacity_exceeded: 'localMode.capacityExceeded',
    item_geometry: 'localMode.itemGeometryUnknown',
    part_too_large: 'localMode.partTooLargePlain',
    spacing_too_large: 'localMode.spacingTooLarge',
    crash: 'localMode.crashError',
    local_interrupted: 'results.localInterrupted',
    payload_build: 'localCompute.error',
    pool_failed: 'localCompute.error',
    local_unknown: 'localCompute.error',
}

export function failureReasonKey(information) {
    const code = String(information || '').trim()
    return Object.prototype.hasOwnProperty.call(REASON_KEYS, code) ? REASON_KEYS[code] : null
}
