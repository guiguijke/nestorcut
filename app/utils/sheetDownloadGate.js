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
import { isSheetFileAllowed } from '~~/shared/constants/sheetDownload.constants'
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
export function sheetGateModel(names, state, layoutCount = null) {
    const list = Array.isArray(names) ? names : []
    const maxSheet = maxDownloadableSheet(state)
    const locked = list.map((n) => !isSheetFileAllowed(n, maxSheet))
    const lockedCount = locked.filter(Boolean).length
    return {
        state,
        cap: FREE_DOWNLOAD_SHEET_CAP,
        maxSheet,
        total: Math.max(Number(layoutCount) || 0, list.length),
        locked,
        lockedCount,
        anyLocked: lockedCount > 0,
    }
}

/** Données de suivi, chaînes seulement, sans slug.
 * → { surface, sheets: String(gate.total), cap: String(gate.cap),
 *     compute: isLocal ? 'browser' : 'server' } */
export function lockedSheetsTrackData(surface, gate, isLocal) {
    return {
        surface: String(surface),
        sheets: String(gate?.total ?? 0),
        cap: String(gate?.cap ?? FREE_DOWNLOAD_SHEET_CAP),
        compute: isLocal ? 'browser' : 'server',
    }
}
