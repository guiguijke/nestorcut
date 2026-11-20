/**
 * O2/d4 (02/11) : modèle du verrou de téléchargement d'un résultat, PAR NOMS
 * de fichiers. Module pur (testé en node), sur le modèle de reportExport.js.
 *
 * L'identité d'une tôle se lit dans le NOM (`_part_N.dxf`, `_toleN.job`),
 * jamais dans l'index d'un tableau : côté navigateur, `dxfs[]` saute les
 * tôles dont le DXF n'a pas été construit (finalizeLocal.js:247). L'état du
 * palier (`'enabled'|'locked'`) vient de sheetDownloadState (WP-0) : ce
 * module ne le recalcule jamais.
 */
import { FREE_DOWNLOAD_SHEET_CAP } from '~~/shared/constants/payment.constants'
import { effectiveSheetCap, isSheetFileAllowed } from '~~/shared/constants/sheetDownload.constants'
import { maxDownloadableSheet } from './sheetDownloadState'

/** Dernier segment d'une URL serveur (/api/files/result/dxf/<nom>), décodé
 * (decodeURIComponent, repli brut si malformé). 'blob:', 'data:', 'local:',
 * vide ou non-chaîne → null. Un nom nu est rendu tel quel. */
export function fileNameFromUrl(value) {
    if (typeof value !== 'string' || value.length === 0) return null
    if (/^(blob|data|local):/i.test(value)) return null
    const path = value.split(/[?#]/)[0]
    const segment = path.slice(path.lastIndexOf('/') + 1)
    if (!segment) return null
    try {
        return decodeURIComponent(segment)
    } catch {
        return segment
    }
}

/** Une liste d'alternatives (record local ou résultat) porte-t-elle une tôle
 * importée ? Lu dans le RAPPORT STOCKÉ du résultat — report.totals.
 * shapedSheetCount > 0 ou une ligne de tôle `shaped: true` (nest-report) —,
 * jamais dans les réglages du projet ni dans la fiche de la tôle : un résultat
 * rouvert plus tard, ou dont la tôle a été supprimée, reste verrouillé. Un
 * ancien résultat sans ces champs vaut false (règle d'aujourd'hui, 2 tôles). */
export function alternativesHoldImportedSheet(alternatives) {
    if (!Array.isArray(alternatives)) return false
    return alternatives.some((alt) => {
        const report = alt?.report
        if (!report || typeof report !== 'object') return false
        if (Number(report.totals?.shapedSheetCount) > 0) return true
        if (Array.isArray(report.sheets) && report.sheets.some((s) => s?.shaped === true)) return true
        // Rapport de calcul en échec (markUnresolvedShapes : totals null, aucune
        // tôle) : les champs de vérification, écrits SEULEMENT pour un job à
        // tôle importée (nest-report lib.rs:570-573, localBridge.js:1070 et
        // toServerShapeAlternatives qui les recopie à plat), disent la même chose.
        if (Number(report.shapedSheets) > 0) return true
        return typeof report.shapeVerified === 'boolean'
    })
}

/** La frame finale du record (finalizeLocal.js buildLiveLayout) porte
 * `binFormats` pour tout job à tôle importée, même quand le rapport a échoué :
 * second signal, lu sur le record et non sur le rapport. Un ancien record, ou
 * un job rectangulaire (frame inchangée), n'a pas ce champ. */
export function recordHoldsImportedSheet(record) {
    return Array.isArray(record?.liveLayout?.binFormats)
}

/** Même lecture sur un résultat (forme resultcontroller ou hydratée) : ses
 * alternatives, puis celles de son record local, puis la frame finale du
 * record (hydrateLocalItem recopie le record entier dans `localRecord`). */
export function resultHasImportedSheet(result) {
    if (!result) return false
    return alternativesHoldImportedSheet(result.alternatives)
        || alternativesHoldImportedSheet(result.localRecord?.alternatives)
        || recordHoldsImportedSheet(result.localRecord)
}

const altAt = (list, altIndex) => (Array.isArray(list) ? list[altIndex] : undefined)

/** Noms DXF (ordre d'affichage) de l'alternative `altIndex` d'un item de
 * résultat (forme resultcontroller.js ou hydratée localHydrate.js) :
 *  - local (`isLocal && localRecord`) : localRecord.alternatives[altIndex].dxfs
 *    filtré `d?.content` (MÊME filtre que localHydrate.js:125 → indices
 *    alignés sur currentDxfs), map `d.fileName` (non-chaîne → null) ;
 *  - serveur : alternatives[altIndex].dxfs si `alternatives` non vide, sinon
 *    `dxfs` (jobs hérités), map fileNameFromUrl. */
export function altSheetNames(result, altIndex = 0) {
    if (!result) return []
    if (result.isLocal && result.localRecord) {
        const alt = altAt(result.localRecord.alternatives, altIndex)
        return (alt?.dxfs || [])
            .filter((d) => d?.content)
            .map((d) => (typeof d.fileName === 'string' ? d.fileName : null))
    }
    const alts = Array.isArray(result.alternatives) ? result.alternatives : []
    const urls = alts.length ? altAt(alts, altIndex)?.dxfs : result.dxfs
    return (Array.isArray(urls) ? urls : []).map(fileNameFromUrl)
}

/** Noms des `.job` (local seulement) : localRecord.alternatives[altIndex].jobs
 * filtrés `j?.bytes`, map fileName ; [] sinon. */
export function altJobNames(result, altIndex = 0) {
    if (!result?.isLocal || !result.localRecord) return []
    const alt = altAt(result.localRecord.alternatives, altIndex)
    return (alt?.jobs || [])
        .filter((j) => j?.bytes)
        .map((j) => (typeof j.fileName === 'string' ? j.fileName : null))
}

/** alternatives[altIndex].layoutCount s'il est > 0, sinon null. */
export function altLayoutCount(result, altIndex = 0) {
    const n = Number(altAt(result?.alternatives, altIndex)?.layoutCount)
    return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * @param {Array<string|null>} names noms (ordre d'affichage) d'UNE alternative
 * @param {'enabled'|'locked'} state
 * @param {number|null} [layoutCount]
 * @returns {{ state, cap: number, maxSheet: number, total: number,
 *            locked: boolean[], lockedCount: number, anyLocked: boolean }}
 *   locked[i] = !isSheetFileAllowed(names[i], maxSheet) ;
 *   total = max(layoutCount || 0, names.length) ; cap = FREE_DOWNLOAD_SHEET_CAP.
 */
export function sheetGateModel(names, state, layoutCount = null, { importedSheet = false } = {}) {
    const list = Array.isArray(names) ? names : []
    // Tôle importée + compte verrouillé : plafond 0, toutes les tôles (et tous
    // les .job) sont verrouillés, y compris sur un nom illisible.
    const importedLock = importedSheet && state === 'locked'
    const maxSheet = effectiveSheetCap(maxDownloadableSheet(state), importedLock)
    const locked = list.map((n) => !isSheetFileAllowed(n, maxSheet))
    const lockedCount = locked.filter(Boolean).length
    const total = Math.max(Number(layoutCount) || 0, list.length)
    return {
        state,
        cap: FREE_DOWNLOAD_SHEET_CAP,
        maxSheet,
        total,
        locked,
        lockedCount,
        anyLocked: lockedCount > 0 || (importedLock && total > 0),
        importedLock,
    }
}

/** Données de suivi, chaînes seulement, sans slug.
 * → { surface, sheets: String(gate.total), cap: String(gate.cap),
 *     compute: isLocal ? 'browser' : 'server' } */
export function lockedSheetsTrackData(surface, gate, isLocal) {
    return {
        ...(gate?.importedLock ? { reason: 'imported_sheet' } : {}),
        surface: String(surface),
        sheets: String(gate?.total ?? 0),
        cap: String(gate?.cap ?? FREE_DOWNLOAD_SHEET_CAP),
        compute: isLocal ? 'browser' : 'server',
    }
}
