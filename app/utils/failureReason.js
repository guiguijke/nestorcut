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
    strip_height: 'localMode.stripTooSmall',
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
// et cite des chemins : il n'a pas sa place à l'écran, ni dans le bandeau ni dans
// la fenêtre de résultat.
export const ENGINE_TRACE = /\bengine failed \(rc=|\bpanicked at\b/

export function isEngineTrace(information) {
    return ENGINE_TRACE.test(String(information || ''))
}

// Refus du worker serveur : `information` porte une phrase ANGLAISE écrite par
// workers/nesting/core/engine.py (item_geometry_message, item_unplaceable_message)
// ou le message du moteur (`strip_height_below_separation:`), jamais un code.
// On les reconnaît à un fragment stable pour les rendre dans la langue de la
// page ; un job plus ancien, dont la phrase est la même, s'affiche pareil.
// app/tests/failureReason.test.js verrouille ces fragments contre engine.py.
const SERVER_REFUSALS = [
    { code: 'strip_height', pattern: /strip_height_below_separation:/ },
    { code: 'item_geometry', pattern: /has an outline the engine cannot use/ },
    { code: 'item_unplaceable', pattern: /found no valid position for part/ },
]

export function serverRefusalCode(information) {
    // Le worker cite le nom du fichier de l'utilisateur entre guillemets : on le
    // retire avant de chercher un fragment, un nom ne reclasse pas le refus.
    const text = String(information || '').replace(/"[^"]*"/g, '""')
    const hit = SERVER_REFUSALS.find((r) => r.pattern.test(text))
    return hit ? hit.code : null
}

/** Code de refus d'un `information` : un code stable, ou le refus d'un worker. */
function refusalCode(information) {
    const code = String(information || '').trim()
    if (Object.prototype.hasOwnProperty.call(REASON_KEYS, code)) return code
    return serverRefusalCode(code)
}

export function failureReasonKey(information) {
    const code = refusalCode(information)
    return code ? REASON_KEYS[code] : null
}

/**
 * Pièce nommée par un refus (`itemGeometry` du job : { slug, part } 0-based) :
 * { file, part } avec le rang 1-based, ou `null` quand le nom du fichier n'est
 * pas connu (autre projet, fichier retiré) : mieux vaut la phrase sans nom
 * qu'un identifiant interne.
 */
export function failureItemParams(job, files) {
    const target = job?.itemGeometry
    if (!target?.slug || !Array.isArray(files)) return null
    const hit = files.find((f) => f?.slug === target.slug)
    const file = hit?.name || hit?.fileName
    if (!file) return null
    const part = Number(target.part)
    return { file, part: (Number.isFinite(part) ? Math.max(0, Math.trunc(part)) : 0) + 1 }
}

const ITEM_CODES = new Set(['item_geometry', 'item_unplaceable'])

/**
 * Texte du bandeau de la page projet pour un job en échec que le registre local
 * ne connaît pas (job serveur, ou job local après rechargement).
 * `errorCode` n'est posé que pour un calcul navigateur (local-fail, sweeper) : le
 * message est celui du direct, jamais le texte brut du moteur. Un refus qui nomme
 * une pièce (`itemGeometry`) retrouve son fichier et son rang dans `files`.
 * Job du worker : ses refus connus sont rendus dans la langue de la page
 * (`serverRefusalCode`), tout autre texte est la seule cause connue et reste tel
 * quel, sauf la trace du moteur natif (`ENGINE_TRACE`).
 * `error` n'est pas exposé au client, il peut citer un chemin ou une trace : sans
 * `information`, le libellé d'échec.
 */
export function failureBannerText(job, t, mapLocalError, files = []) {
    const errorCode = job?.errorCode
    if (errorCode && errorCode !== 'local_interrupted') {
        const code = errorCode === 'engine_error' ? 'crash' : errorCode
        return mapLocalError(code, ITEM_CODES.has(code) ? failureItemParams(job, files) : null)
    }
    const information = String(job?.information || '').trim()
    const code = refusalCode(information)
    if (code) {
        if (ITEM_CODES.has(code) && typeof mapLocalError === 'function') {
            return mapLocalError(code, failureItemParams(job, files))
        }
        return t(REASON_KEYS[code])
    }
    if (isEngineTrace(information)) return t('result.failed')
    return information || t('result.failed')
}

/**
 * Détail d'échec de la fenêtre de résultat : la même règle que le bandeau, mais
 * la fenêtre dit déjà « aucune solution » — sans cause connue, ni texte libre
 * ni trace du moteur natif, elle n'ajoute rien (chaîne vide).
 */
export function failureDetailText(job, t, mapLocalError, files = []) {
    const information = String(job?.information || '').trim()
    if (!job?.errorCode && !information) return ''
    if (!job?.errorCode && !refusalCode(information) && isEngineTrace(information)) return ''
    // Échec local sans code connu (repli « crash ») mais cause connue par ailleurs
    // (tôle trop petite, aucune solution faisable) : la fenêtre la dit déjà.
    if (job?.errorCode === 'engine_error' && job?.unfit) return ''
    return failureBannerText(job, t, mapLocalError, files)
}

/**
 * Bandeau d'échec de la page projet : le registre local d'abord (il nomme la
 * pièce), sinon le dernier job vu par le flux serveur (`serverJobState`,
 * `{ phase, job }`), seulement s'il est en erreur. Rien à dire : chaîne vide.
 */
export function jobErrorBannerText({ localErrorText, serverJob, t, mapLocalError, files = [] }) {
    if (localErrorText) return localErrorText
    if (serverJob?.phase !== 'error') return ''
    return failureBannerText(serverJob.job, t, mapLocalError, files)
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
