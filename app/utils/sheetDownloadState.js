import { FREE_DOWNLOAD_SHEET_CAP } from '~~/shared/constants/payment.constants'
import { DEMO_PROJECT_SLUG } from '~~/shared/constants/demo.constants'
import { hasPaidAccess } from './entitlementUi'
import { flagOn } from './runtimeFlag'

/**
 * O2/d1 (02/11) : état du verrou de téléchargement des tôles, côté interface.
 * Module pur (testé en node). Partagé par la carte, la fenêtre de résultat et
 * la page projet (information D26) : aucun ne le duplique.
 *
 * @param {object|null|undefined} user payload /api/user (useNuxtData('user').data)
 * @param {{ paidPlansDisabled?: any, projectSlug?: string|null }} [ctx]
 * @returns {'enabled'|'locked'}
 *   Ordre : flag paidPlansDisabled vrai (d2) → enabled ; projet démo (d3) →
 *   enabled ; payant (d1) → enabled ; tout le reste, utilisateur absent
 *   compris → locked (fail-closed, D3). K et démo passent AVANT le test de
 *   l'utilisateur : `sheetDownloadState(null, { projectSlug: 'demo' })` vaut
 *   'enabled'.
 * Tout appelant passe le contexte EXPLICITEMENT : les valeurs par défaut
 * (false, null) verrouillent la démo et K en silence.
 */
export function sheetDownloadState(user, { paidPlansDisabled = false, projectSlug = null } = {}) {
    if (flagOn(paidPlansDisabled)) return 'enabled'
    if (projectSlug === DEMO_PROJECT_SLUG) return 'enabled'
    return hasPaidAccess(user) ? 'enabled' : 'locked'
}

/** 'locked' → FREE_DOWNLOAD_SHEET_CAP ; 'enabled' → Infinity. */
export function maxDownloadableSheet(state) {
    return state === 'locked' ? FREE_DOWNLOAD_SHEET_CAP : Infinity
}

/** D26 : true si state === 'locked' et Number(sheetsNeeded) > FREE_DOWNLOAD_SHEET_CAP
 * (fini). Sert au ctaHint (pré-vol) et à la prop `freeNote` de CapacityPanel. */
export function freeDownloadNoteVisible(state, sheetsNeeded) {
    if (state !== 'locked') return false
    const n = Number(sheetsNeeded)
    return Number.isFinite(n) && n > FREE_DOWNLOAD_SHEET_CAP
}

/** Essai Free d'une tôle importée (20/11) : true si le compte est verrouillé
 * ET que le projet (ou le résultat) porte une tôle importée — alors le
 * calcul et l'aperçu restent ouverts, seul l'export demande Unlimited. */
export function importedSheetLockVisible(state, hasImportedSheet) {
    return state === 'locked' && Boolean(hasImportedSheet)
}

/** Note Free montrée avant de RELANCER un calcul depuis un résultat (D26).
 * Règle du propriétaire (20/11) : en Free, les 2 premières tôles d'un calcul à
 * tôles rectangulaires ; les fichiers d'un calcul à tôle importée sont pour
 * les comptes payants.
 *  - compte ouvert : aucune note ;
 *  - tôle importée reconnue SUR le résultat : la phrase du verrou le dit déjà,
 *    aucune seconde note ;
 *  - sinon, si le projet qui sera relancé porte une tôle importée qui servira
 *    (cas du refus de capacité, qui n'a ni rapport ni frame) : 'imported' ;
 *  - sinon 'first_sheets' si le calcul demande plus de tôles que le plafond. */
export function relaunchFreeNoteKind(state, { sheetsNeeded, resultImported = false, projectImported = false } = {}) {
    if (state !== 'locked') return null
    if (resultImported) return null
    if (projectImported) return 'imported'
    return freeDownloadNoteVisible(state, sheetsNeeded) ? 'first_sheets' : null
}
