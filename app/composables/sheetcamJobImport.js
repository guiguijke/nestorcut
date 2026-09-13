/**
 * Dépôt d'un `.job` SheetCam — lot J4 de
 * `docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §8, point 1 de la consigne.
 *
 * ---------------------------------------------------------------------------
 * CE QU'UN `.job` EST, ET CE QU'IL N'EST PAS.
 *
 * Un `.job` porte la MISE EN PAGE d'un job de découpe (quelles pièces, à
 * quelle pose, dans quel ordre, avec quel outil) et un cache binaire de la
 * géométrie des dessins — cache que nous recopions sans jamais le décoder
 * (règle 6 de l'étude). Il ne porte PAS les dessins eux-mêmes : `DrawingFile`
 * est un chemin absolu vers le disque de l'utilisateur (règle 9).
 *
 * Un `.job` déposé seul ne peut donc produire AUCUNE pièce. Ce que l'on peut
 * faire, et qui est honnête, c'est :
 *   - dire exactement quels dessins il réclame, et en quelle quantité ;
 *   - prendre ceux qui sont déposés en même temps ;
 *   - pré-remplir la tôle et l'espacement avec ce que le fichier DIT, jamais
 *     avec une valeur inventée ;
 *   - et nommer ceux qui manquent, au lieu d'importer à moitié en silence.
 *
 * ---------------------------------------------------------------------------
 * L'APPARIEMENT SE FAIT SUR LE NOM DE FICHIER, et c'est la règle 9 qui
 * l'impose : le `.job` ne connaît de ses dessins que leur chemin, dont seul
 * le nom a un sens chez nous. La comparaison est insensible à la casse — un
 * `.job` écrit sous Windows porte `Piece_Trou.DXF` là où le fichier déposé
 * peut s'appeler `piece_trou.dxf`, et refuser pour cette raison serait un
 * refus pour rien.
 */

import { isSheetCamJob, jobSheet } from '~~/shared/sheetcamJob.js'
import {
    DEFAULT_KERF_SAFETY_MM, DEFAULT_PIERCE_MARGIN_MM, spacingFromKerf,
} from '~~/shared/sheetcamReserve.js'

/** Nom comparable : casse et espaces ignorés (voir l'en-tête). */
const key = (name) => String(name || '').trim().toLowerCase()

/**
 * Sépare une dépose en « le `.job` » et « les dessins ».
 *
 * Rend `null` si aucun `.job` n'est déposé — le chemin d'import ordinaire
 * continue alors sans rien payer. Reconnaissance PAR SIGNATURE (piège #31),
 * jamais par l'extension : un `.job` renommé `.dxf` est reconnu, et un `.dxf`
 * renommé `.job` ne l'est pas.
 */
export async function splitSheetCamDrop(files) {
    const list = Array.from(files || [])
    if (!list.length) return null
    const bytesOf = new Map()
    let jobFile = null
    for (const file of list) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        bytesOf.set(file, bytes)
        // Le PREMIER `.job` de la dépose fait foi. Deux `.job` dans la même
        // dépose, ce sont deux jobs de découpe : on ne les fusionne pas.
        if (!jobFile && isSheetCamJob(bytes)) jobFile = file
    }
    if (!jobFile) return null
    return {
        jobFile,
        jobBytes: bytesOf.get(jobFile),
        drawings: list.filter((f) => f !== jobFile),
        extraJobs: list.filter((f) => f !== jobFile && isSheetCamJob(bytesOf.get(f))).length,
    }
}

/**
 * Apparie les dessins réclamés par le `.job` avec ceux qui ont été déposés.
 *
 * `read` : la sortie de `readSheetCamJob` (lot J4, `localImport.js`).
 * Rend `{ matched: [{ drawing, file }], missing: [drawing] }`.
 */
export function matchDrawings(read, droppedFiles) {
    const byName = new Map()
    for (const file of droppedFiles || []) byName.set(key(file.name), file)
    const matched = []
    const missing = []
    for (const drawing of read.drawings || []) {
        const file = byName.get(key(drawing.name))
        if (file) matched.push({ drawing, file })
        else missing.push(drawing)
    }
    return { matched, missing }
}

/**
 * Les réglages que le `.job` pré-remplit — et RIEN d'autre.
 *
 * `space` n'est jamais écrit directement : il se dérive du kerf par la règle
 * de production `kerf + 2 × sécurité` (`spacingFromKerf`), qui est le seul
 * chemin qui garde les trois champs cohérents. Un `.job` sans kerf
 * exploitable ne pré-remplit pas l'espacement : on ne remplit pas un champ
 * avec une valeur inventée.
 */
export function prefillFromJob(read, { safetyMm = DEFAULT_KERF_SAFETY_MM } = {}) {
    const out = {}
    const sheet = read.sheet || jobSheet(read.job)
    if (sheet?.width > 0 && sheet?.height > 0) {
        out.sheet = { width: sheet.width, height: sheet.height, count: 1 }
    }
    // LA SÉCURITÉ PRÉ-REMPLIE EST CELLE DE LA RÈGLE, PAS CELLE DU PROJET.
    // Un projet neuf porte la sécurité d'usine (1 mm), qui donnerait 3,5 mm
    // pour un kerf de 1,5 — alors que l'atelier coupe ce job à 2 mm
    // (kerf + 2 × 0,25, la règle 3.10 déjà en production, §9.11 de l'étude).
    // Et l'écart n'est pas cosmétique : mesuré au harnais, à 3,5 mm les
    // quatre éventails de la recette ne tiennent plus dans le trou de l'hôte
    // et sortent posés à côté ; à 2 mm ils s'y nichent. On pré-remplit donc
    // avec ce que le `.job` IMPLIQUE, et l'utilisateur reste libre de changer
    // les deux champs.
    const space = spacingFromKerf(read.kerfWidth, Number(safetyMm))
    if (space != null) {
        out.kerf = String(read.kerfWidth)
        out.safety = String(safetyMm)
        out.space = space
    }
    return out
}

/**
 * Les réglages de COUPE d'un dessin, tels que le nesting les consommera.
 *
 * `startPositionConfirmed` reste FAUX tant que le propriétaire n'a pas
 * vérifié sur sa machine la correspondance `Start position` → coin (question
 * ouverte §9 de l'étude). Tant qu'il est faux, la réserve d'amorce d'un trou
 * couvre les QUATRE coins candidats : juste quelle que soit la table, pour
 * environ 4,6 % de l'aire du trou au lieu de 40 % qu'aurait coûté une
 * couronne intérieure complète.
 */
export function cutSettingsFor(drawing, {
    pierceMarginMm = DEFAULT_PIERCE_MARGIN_MM,
    jobName = null,
} = {}) {
    return {
        drawingName: drawing.name,
        // Nom du `.job` déposé : il donne son préfixe aux fichiers rendus
        // (`<nom>_tole1.job`), pour que l'utilisateur retrouve son job.
        ...(jobName ? { jobName } : {}),
        leadIn: Number(drawing.leadIn) || 0,
        startPosition: drawing.startPosition ?? null,
        startPositionConfirmed: false,
        pierceMarginMm: Number(pierceMarginMm),
    }
}
