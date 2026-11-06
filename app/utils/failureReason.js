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
    item_unplaceable: 'localMode.itemUnplaceableUnknown',
    part_too_large: 'localMode.partTooLargePlain',
    spacing_too_large: 'localMode.spacingTooLarge',
    crash: 'localMode.crashError',
    local_interrupted: 'results.localInterrupted',
    payload_build: 'localCompute.error',
    pool_failed: 'localCompute.error',
    merge_failed: 'localCompute.error',
    merge_parse: 'localCompute.error',
    local_unknown: 'localCompute.error',
}

// Plantage du moteur natif : engine.py cite la fin de son stderr (« engine failed
// (rc=…): thread … panicked at crates\… »). Ce texte ne dit rien à l'utilisateur
// et cite des chemins : il n'a pas sa place dans le bandeau.
const ENGINE_TRACE = /\bengine failed \(rc=|\bpanicked at\b/

export function failureReasonKey(information) {
    const code = String(information || '').trim()
    return Object.prototype.hasOwnProperty.call(REASON_KEYS, code) ? REASON_KEYS[code] : null
}

/**
 * Texte du bandeau de la page projet pour un job en échec que le registre local
 * ne connaît pas (job serveur, ou job local après rechargement).
 * `errorCode` n'est posé que pour un calcul navigateur (local-fail, sweeper) : le
 * message est celui du direct, jamais le texte brut du moteur.
 * Job du worker : son texte est la seule cause connue, rendu tel quel, comme dans
 * la fenêtre de résultat, sauf la trace du moteur natif (`ENGINE_TRACE`).
 * `error` n'est pas exposé au client, il peut citer un chemin ou une trace : sans
 * `information`, le libellé d'échec.
 */
export function failureBannerText(job, t, mapLocalError) {
    const code = job?.errorCode
    if (code && code !== 'local_interrupted') return mapLocalError(code === 'engine_error' ? 'crash' : code)
    const information = String(job?.information || '').trim()
    const key = failureReasonKey(information)
    if (key) return t(key)
    if (ENGINE_TRACE.test(information)) return t('result.failed')
    return information || t('result.failed')
}

/**
 * Bandeau d'échec de la page projet : le registre local d'abord (il nomme la
 * pièce), sinon le dernier job vu par le flux serveur (`serverJobState`,
 * `{ phase, job }`), seulement s'il est en erreur. Rien à dire : chaîne vide.
 */
export function jobErrorBannerText({ localErrorText, serverJob, t, mapLocalError }) {
    if (localErrorText) return localErrorText
    if (serverJob?.phase !== 'error') return ''
    return failureBannerText(serverJob.job, t, mapLocalError)
}

/**
 * Note de la carte pour une livraison dégradée (`degraded` du job, posé par
 * local-quota) : les pièces sont posées, mais sans la fusion ni la finition de
 * la dernière tôle. Le job reste un succès, l'utilisateur doit le savoir.
 */
const DEGRADED_NOTES = new Set(['merge_failed', 'merge_unavailable'])

export function degradedNoteKey(code) {
    return DEGRADED_NOTES.has(code) ? 'results.degraded' : null
}
