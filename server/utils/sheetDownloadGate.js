import { createError } from 'h3'
import { connectDB } from '../db/mongo'
import { downloadSheetCapForUser, isWithinFreeDownloadCap } from './entitlement'
import { DEMO_PROJECT_SLUG } from '../../shared/constants/demo.constants'
import { isSheetFileAllowed, sheetNumberFromFileName } from '../../shared/constants/sheetDownload.constants'

/**
 * O2 (02/11) — verrou SERVEUR des tôles d'un résultat calculé sur nos
 * serveurs : un Free télécharge les tôles numérotées 1..cap de chaque
 * alternative (numéro lu dans le NOM, d4), le reste avec Unlimited.
 *
 * Ce module ne garde que les fonctions sur les noms et les jobs : il ne lit
 * JAMAIS la constante du plafond Free (AGENTS #34) — le plafond vient du
 * resolver downloadSheetCapForUser / isWithinFreeDownloadCap (entitlement.js),
 * seul lecteur serveur de cette constante.
 */

/** d2 — AGENTS #29 : valeur brute du flag (chaîne ou booléen), transmise au
 * resolver qui la lit string-safe. */
export function paidPlansDisabledFlag(event) {
    return useRuntimeConfig(event)?.public?.paidPlansDisabled
}

/** d3 : job de la démo partagée (projet démo, ou profil de calcul démo). */
export function isDemoJob(job) {
    return job?.projectSlug === DEMO_PROJECT_SLUG || job?.params?.computeLevel === 'demo'
}

/** Filtre en GARDANT l'ordre d'entrée. Nom illisible ⇒ gardé (D2). */
export function filterDownloadableNames(names, cap) {
    return (names || []).filter((n) => isSheetFileAllowed(n, cap))
}

/** 403 stable `sheet_download_locked`. */
export function sheetDownloadLockedError(sheet, cap) {
    return createError({
        statusCode: 403,
        statusMessage: 'sheet_download_locked',
        data: { reason: 'sheet_download_locked', cap, sheet },
    })
}

/** Slug du job lu dans le nom d'un DXF de résultat (worker main.py :
 * `{jobSlug}_alt{rang}_part_{N}.dxf` ; jobs hérités `{jobSlug}_part_{N}.dxf`).
 * null si le nom ne suit aucun des deux formats. */
export const RESULT_DXF_JOB_SLUG_RE = /^(.+?)(?:_alt\d+)?_part_\d+\.dxf$/

export function jobSlugFromResultFile(fileName) {
    if (typeof fileName !== 'string' || fileName.length === 0) return null
    const m = RESULT_DXF_JOB_SLUG_RE.exec(fileName)
    return m ? m[1] : null
}

/** Job du propriétaire qui contient ce fichier, par son slug sur l'index
 * `slug` (scripts/mongo-indexes.mjs) — PAS de `$or` sur `dxf_files` /
 * `alternatives.dxf_files` (aucun index : un appel direct `_part_3+`, jusqu'à
 * 180/min, chargerait tous les jobs du propriétaire). Slug illisible → null. */
export async function findJobForResultFile(userId, fileName) {
    const slug = jobSlugFromResultFile(fileName)
    if (!slug) return null
    const db = await connectDB()
    return db
        .collection('nesting_jobs')
        .findOne({ slug, ownerId: userId }, { projection: { _id: 0, projectSlug: 1, 'params.computeLevel': 1 } })
}

/** Garde de la route DXF. Ne fait RIEN (aucune requête) si la tôle est
 * illisible ou dans le plafond Free, ou sans session (openOwnedFileStream
 * répondra 401). Sinon : plafond résolu pour l'utilisateur ; si la tôle le
 * dépasse et que le job n'est pas démo (job introuvable ⇒ non démo,
 * fail-closed) → 403 sheet_download_locked. */
export async function assertResultDxfDownloadable(event, fileName) {
    const sheet = sheetNumberFromFileName(fileName)
    if (sheet == null || isWithinFreeDownloadCap(sheet)) return
    const userId = event?.context?.auth?.userId
    if (!userId) return
    const cap = await downloadSheetCapForUser(userId, {
        paidPlansDisabled: paidPlansDisabledFlag(event),
    })
    if (sheet <= cap) return
    const job = await findJobForResultFile(userId, fileName)
    if (isDemoJob(job)) return
    throw sheetDownloadLockedError(sheet, cap)
}
