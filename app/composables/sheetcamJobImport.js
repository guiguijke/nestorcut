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
    DEFAULT_KERF_SAFETY_MM, spacingFromKerf,
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
    // L'ESPACEMENT D'UN `.job` EST `2 x KERF + SECURITE` (§9.40, décision du
    // propriétaire du 13/09). La bande de kerf est centrée sur le chemin
    // d'outil, lui-même à kerf/2 du contour : elle s'étend donc jusqu'à UN
    // KERF ENTIER hors de chaque pièce, et deux pièces à moins de 2 x kerf ont
    // des bandes qui se recouvrent — la seconde coupe traverse de l'air déjà
    // coupé (perte d'arc, bord rongé). La règle 3.10 (`kerf + 2 x 0,25`) est
    // REMPLACÉE ; la sécurité est LE paramètre, 1 mm par défaut.
    //
    // Conséquence assumée sur la recette (kerf 1,5) : 4 mm au lieu de 2, et
    // les quatre éventails ne tiennent plus dans le trou de l'hôte (mesuré dès
    // 3,5 mm au §9.19). C'est un choix de QUALITÉ DE COUPE, pas un réglage de
    // densité — et l'utilisateur reste libre de changer les deux champs.
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
 * `starts` : les points de départ LUS dans le bloc binaire du `.job`, chacun
 * relatif au centre de la boîte englobante du dessin (`offset`). C'est
 * `buildLocalPayload` qui les ramène en coordonnées du dessin, une fois la
 * géométrie importée — lui seul connaît cette boîte.
 *
 * LE LOT J4-bis-2 A RETIRÉ `startPosition` DE CE CHEMIN. La série complète
 * (§9.42) a montré que ce réglage désigne le coin d'où part la SÉQUENCE de
 * coupe, pas le départ d'un contour : entre « centre », « haut gauche » et
 * « haut droit », les points de départ du G-code sont identiques. La table de
 * coins des lots J3 et J4 n'existait pas, et la réserve aux quatre coins ne
 * couvrait pas le vrai départ d'un trou rectangulaire (milieu d'arête). Le
 * champ reste LU (`drawing.startPosition`) pour l'affichage et l'étude, il ne
 * gouverne plus rien.
 */
export function cutSettingsFor(drawing, {
    jobName = null,
    kerfWidth = null,
    allowOverlappingLeads = false,
} = {}) {
    return {
        drawingName: drawing.name,
        // Nom du `.job` déposé : il donne son préfixe aux fichiers rendus
        // (`<nom>_tole1.job`), pour que l'utilisateur retrouve son job.
        ...(jobName ? { jobName } : {}),
        leadIn: Number(drawing.leadIn) || 0,
        leadInType: Number(drawing.leadInType) || 0,
        leadOut: Number(drawing.leadOut) || 0,
        leadOutType: Number(drawing.leadOutType) || 0,
        startPosition: drawing.startPosition ?? null,
        // Lot J4-ter — L'ÉCHAPPATOIRE, ET ELLE EST EXPLICITE. Allumée, la
        // réserve d'amorce n'est pas appliquée : les pièces se serrent, et
        // les amorces peuvent se croiser. C'est un choix d'atelier (chutes
        // sans valeur, tôle chère), jamais un défaut par défaut — éteinte, la
        // place de l'amorce est gardée comme le lot J4-bis-2 l'établit.
        allowOverlappingLeads: allowOverlappingLeads === true,
        // §9.51 : le kerf est la SEULE entrée des marges de la réserve — plus
        // de constante de perçage à transporter.
        kerfWidth: Number.isFinite(Number(kerfWidth)) ? Number(kerfWidth) : null,
        // VIDES À CE STADE, ET C'EST VOULU (lot J4-bis-3, §9.45). Le cache
        // binaire ne dit pas à quel dessin appartient chacun de ses blocs ; le
        // lot précédent l'a supposé par le RANG des sections, et cela inverse
        // les dessins dès qu'un `.job` les déclare dans un autre ordre que son
        // cache. L'appariement se fait par la GÉOMÉTRIE, donc après l'import :
        // `assignJobStarts` (`localImport.js`) les remplit, `files.js` les
        // pose sur la fiche. Un `.job` non tranchable les laisse vides, et
        // c'est le comportement « point non lu ».
        starts: (drawing.starts || []),
        origin: drawing.origin ?? null,
    }
}
