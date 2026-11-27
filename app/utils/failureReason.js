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
    sheet_shape_missing: 'localImport.missingSheetShape',
    sheet_shape_unreadable: 'localImport.unreadableSheetShape',
    all_alternatives_invalid: 'localMode.allInvalid',
    capacity_exceeded: 'localMode.capacityExceeded',
    item_geometry: 'localMode.itemGeometryUnknown',
    item_unplaceable: 'localMode.itemUnplaceableUnknown',
    part_too_large: 'localMode.partTooLargePlain',
    spacing_too_large: 'localMode.spacingTooLarge',
    strip_height: 'localMode.stripTooSmall',
    edge_overhang_too_large: 'localMode.edgeOverhangTooLargePlain',
    edge_too_large: 'localMode.edgeTooLargePlain',
    edge_offset_failed: 'localMode.edgeOffsetFailed',
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
    // Pré-vol du worker : « Part(s) too large for the sheet: "a.dxf" (2000x50mm, x1) — … ».
    { code: 'part_too_large', pattern: /^\s*Part\(s\) too large for the sheet:/ },
]

export function serverRefusalCode(information) {
    // Le worker cite le nom du fichier de l'utilisateur entre guillemets : on le
    // retire avant de chercher un fragment, un nom ne reclasse pas le refus.
    // Glouton : un nom qui contient lui-même un guillemet disparaît en entier
    // (les fragments reconnus sont avant ou après le nom, jamais dedans).
    const text = String(information || '').replace(/"[\s\S]*"/g, '""')
    const hit = SERVER_REFUSALS.find((r) => r.pattern.test(text))
    return hit ? hit.code : null
}

/**
 * Pièce trop grande citée par le refus de pré-vol du worker : { file, w, h }
 * pour la PREMIÈRE pièce nommée, ou `null` (nom inconnu, ancien worker qui
 * citait un identifiant interne entre apostrophes) : mieux vaut la phrase sans
 * nom qu'un identifiant.
 */
export function tooLargeParams(information) {
    const text = String(information || '')
    const m = /^\s*Part\(s\) too large for the sheet: "(.+?)" \((\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm/
        .exec(text)
    if (!m) return null
    // Marge de courbes (le worker la dit quand elle est > 0) : lue après le
    // nom, jamais dedans — le nom du fichier est retiré avant.
    const tail = text.replace(/"[\s\S]*"/g, '""')
    const k = /spacing: (\d+(?:\.\d+)?)mm \(plus (\d+(?:\.\d+)?)mm margin for curves\)/.exec(tail)
    return k ? { file: m[1], w: m[2], h: m[3], space: k[1], margin: k[2] } : { file: m[1], w: m[2], h: m[3] }
}

/** Code de refus d'un `information` : un code stable, ou le refus d'un worker. */
function refusalCode(information) {
    const code = String(information || '').trim()
    if (Object.prototype.hasOwnProperty.call(REASON_KEYS, code)) return code
    return serverRefusalCode(code)
}

// Projet « cet appareil » : le serveur n'a aucune géométrie, « réessayez en mode
// serveur » est impossible à suivre. Mêmes variantes que le bandeau (mapError).
const LOCAL_ONLY_KEYS = {
    memory_cap: 'localMode.memoryLocal',
    entity_limit: 'localMode.entityLimitLocal',
    all_alternatives_invalid: 'localMode.allInvalidLocal',
    crash: 'localMode.crashLocal',
}

/** Un job est calculé dans ce navigateur : résultat local, job `localOnly` du serveur, ou
 * job (même en échec) d'un projet « cet appareil ». */
export function isLocalJob(job) {
    return Boolean(job?.isLocal || job?.localOnly || job?.projectLocal)
}

export function failureReasonKey(information, { localOnly = false } = {}) {
    const code = refusalCode(information)
    if (!code) return null
    return (localOnly && LOCAL_ONLY_KEYS[code]) || REASON_KEYS[code]
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
const EDGE_CODES = new Set(['edge_too_large', 'edge_overhang_too_large'])

/** Paramètres de la phrase d'un refus « distance au bord » : `edgeParams` (fournie
 * par la page, elle met les mm dans l'unité d'affichage) appliquée au détail
 * chiffré du job (`edgeDetail`). `null` : la phrase sans chiffre. */
function edgeRefusalParamsOf(job, edgeParams) {
    if (typeof edgeParams !== 'function' || !job?.edgeDetail) return null
    return edgeParams(job.edgeDetail) || null
}

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
 * Refus « distance au bord » d'un job « Nos serveurs » : le worker écrit le code nu
 * et `edgeDetail` ({ maxEdgeMm } ou { maxOverhangMm, part }) ; avec `edgeParams`
 * (optionnel) la phrase porte le chiffre, sinon elle n'en a pas.
 */
export function failureBannerText(job, t, mapLocalError, files = [], edgeParams = null) {
    const errorCode = job?.errorCode
    if (errorCode && errorCode !== 'local_interrupted') {
        const code = errorCode === 'engine_error' ? 'crash' : errorCode
        return mapLocalError(code, ITEM_CODES.has(code)
            ? failureItemParams(job, files)
            : EDGE_CODES.has(code) ? edgeRefusalParamsOf(job, edgeParams) : null)
    }
    const information = String(job?.information || '').trim()
    const code = refusalCode(information)
    if (code) {
        if (ITEM_CODES.has(code) && typeof mapLocalError === 'function') {
            return mapLocalError(code, failureItemParams(job, files))
        }
        if (code === 'part_too_large' && typeof mapLocalError === 'function') {
            return mapLocalError(code, tooLargeParams(information))
        }
        if (EDGE_CODES.has(code) && typeof mapLocalError === 'function' && typeof edgeParams === 'function' && job?.edgeDetail) {
            return mapLocalError(code, edgeRefusalParamsOf(job, edgeParams))
        }
        return t(failureReasonKey(information, { localOnly: isLocalJob(job) }))
    }
    if (isEngineTrace(information)) return t('result.failed')
    return information || t('result.failed')
}

/**
 * Détail d'échec de la fenêtre de résultat : la même règle que le bandeau, mais
 * la fenêtre dit déjà « aucune solution » — sans cause connue, ni texte libre
 * ni trace du moteur natif, elle n'ajoute rien (chaîne vide).
 */
export function failureDetailText(job, t, mapLocalError, files = [], edgeParams = null) {
    const information = String(job?.information || '').trim()
    if (!job?.errorCode && !information) return ''
    if (!job?.errorCode && !refusalCode(information) && isEngineTrace(information)) return ''
    // Échec local sans code connu (repli « crash ») mais cause connue par ailleurs
    // (tôle trop petite, aucune solution faisable) : la fenêtre la dit déjà.
    if (job?.errorCode === 'engine_error' && job?.unfit) return ''
    return failureBannerText(job, t, mapLocalError, files, edgeParams)
}

/**
 * Bandeau d'échec de la page projet : le registre local d'abord (il nomme la
 * pièce), sinon le dernier job vu par le flux serveur (`serverJobState`,
 * `{ phase, job }`), seulement s'il est en erreur. Rien à dire : chaîne vide.
 */
export function jobErrorBannerText({ localErrorText, serverJob, t, mapLocalError, files = [], edgeParams = null }) {
    if (localErrorText) return localErrorText
    if (serverJob?.phase !== 'error') return ''
    return failureBannerText(serverJob.job, t, mapLocalError, files, edgeParams)
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
