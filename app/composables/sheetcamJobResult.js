/**
 * Un `.job` SheetCam PAR TÔLE, depuis un résultat de nesting navigateur —
 * lot J4 de `docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §8.
 *
 * Ce module est l'ADAPTATEUR entre la forme d'un résultat local (les poses
 * que rend `layoutTransforms`, les pièces du payload) et la forme qu'attend
 * `shared/sheetcamNest.js` (lot J2). Il ne contient aucune règle de format :
 * lire et écrire un `.job`, c'est J1 ; convertir une pose, c'est J2.
 *
 * ---------------------------------------------------------------------------
 * LES TROIS PIÈGES DE CET ADAPTATEUR, chacun mesuré.
 *
 * 1. LES ANNEAUX PASSÉS À J2 SONT LES ANNEAUX RÉELS, jamais les réservés.
 *    `XPos`/`YPos` est le centre de boîte de la pièce POSÉE, et l'appendice
 *    d'amorce du lot J3 dépasse du contour de `amorce + perçage` — 8 mm sur
 *    le job du propriétaire. Le prendre déplacerait chaque pose de la moitié
 *    de cela. La réserve ne sort que pour le nesting ; le `.job` rendu parle
 *    de la vraie pièce, et c'est SheetCam qui trace l'amorce.
 *
 * 2. LES RANGS SONT PAR TÔLE (piège AGENTS #52 : en BPP les tôles partagent
 *    le repère de coordonnées, donc tout ce qui est poolé à travers les
 *    layouts est faux). `nestedIn` désigne un index DANS SA TÔLE.
 *
 * 3. UN DESSIN ABSENT DU `.job` N'EST PAS UNE PIÈCE QU'ON PEUT ÉCRIRE.
 *    Le bloc binaire du `.job` est la géométrie en cache des dessins
 *    d'origine, liée aux sections `[Part N]` par leur RANG (règle 6 de
 *    l'étude) : on ne peut pas inventer une pièce qui n'y est pas
 *    (« Layer 0 not found », règle 5). Un job qui mélange des fichiers du
 *    `.job` et des DXF déposés à part ne peut donc PAS sortir un `.job`
 *    complet — on le dit, au lieu de livrer un fichier amputé en silence.
 */

import {
    SheetCamJobError, jobDrawingName, jobPathRecords, parseSheetCamJob,
    writeJobStartPoints,
} from '~~/shared/sheetcamJob.js'
import { nestedJobsPerSheet } from '~~/shared/sheetcamNest.js'
import { nearestOnRing, START_MATCH_TOL_MM } from '~~/shared/sheetcamReserve.js'

/**
 * Les tôles d'une alternative, dans la forme qu'attend `buildNestedJobs`.
 *
 * `layouts` : les layouts APRÈS post-pass (expansion meta, remplissage de
 * trous, bandes résiduelles) — c'est l'état livré, pas l'état moteur.
 * `partsById` : `Map(String(item_id) -> { file_slug, … })`, la table du
 * payload.
 *
 * `nestedIn` est fourni par `nestedInForLayout` (localBridge), qui le
 * DÉDUIT des layouts livrés plutôt que de le collecter dans le post-pass :
 * trois chemins nichent sans passer par `applyHoleFill` (l'expansion meta,
 * l'alternative structurelle auto-suffisante du piège #41, et la ceinture
 * par tôle qui peut annuler la passe), si bien qu'une information collectée
 * dans la passe mentirait. Les index sont PAR TÔLE (piège AGENTS #52 : en
 * BPP les tôles partagent le repère de coordonnées, donc tout ce qui est
 * poolé à travers les layouts est faux).
 */
export function sheetsFromLayouts(layouts, partsById, { layoutTransforms, nestedInForLayout }) {
    return (layouts || []).map((layout) => {
        const transforms = layoutTransforms(layout, partsById)
        const nested = nestedInForLayout(layout, partsById)
        return transforms.map((tr, k) => ({
            fileSlug: tr.file_slug,
            pose: { x: tr.x, y: tr.y, angle: tr.angle },
            nestedIn: nested[k] ?? null,
        }))
    })
}

/**
 * Rang `[Part N]` de chaque dessin du `.job`, par NOM de dessin.
 *
 * Les copies (`copyOf >= 0`) ne comptent pas : elles n'ont pas de géométrie
 * propre, seul l'original en a une dans le bloc binaire.
 */
export function jobRanksByDrawing(job) {
    const out = new Map()
    for (const part of job.parts || []) {
        if (part.copyOf >= 0) continue
        const name = part.drawingName || jobDrawingName(part.drawingFile)
        if (!out.has(name)) out.set(name, part.index)
    }
    return out
}

/**
 * Est-ce que TOUTES les pièces posées viennent de ce `.job` ?
 *
 * Rend `{ ok, missing }` — `missing` étant les noms de fichiers posés qui ne
 * correspondent à aucun dessin du `.job`. Voir le piège 3 ci-dessus : on ne
 * peut pas écrire une pièce dont le bloc binaire n'a pas la géométrie.
 */
export function jobCoversPlacedFiles(job, fileNamesBySlug, placedSlugs) {
    const ranks = jobRanksByDrawing(job)
    const missing = []
    for (const slug of new Set(placedSlugs)) {
        const name = fileNamesBySlug[slug]
        if (!name || !ranks.has(name)) missing.push(name || slug)
    }
    return { ok: missing.length === 0, missing }
}

/**
 * Construit les `.job` d'un résultat, un par tôle.
 *
 * `sheets` : une liste de tôles, chacune une liste de pièces posées
 *   `{ fileSlug, pose: { x, y, angle }, nestedIn }` — `nestedIn` étant l'index
 *   de l'hôte DANS CETTE TÔLE, ou `null`.
 * `ringsByFileSlug` : `{ [slug]: [anneau, ...] }` — la géométrie RÉELLE du
 *   dessin (contour + trous), telle qu'importée, JAMAIS la géométrie réservée.
 * `fileNamesBySlug` : `{ [slug]: 'Piece_Trou.DXF' }`, pour retrouver le rang.
 * `baseName` : préfixe des fichiers rendus (`<baseName>_tole1.job`).
 *
 * Rend `[{ sheet, fileName, bytes, placements, order }]`.
 */
export function buildNestedJobs(job, {
    sheets,
    ringsByFileSlug,
    fileNamesBySlug,
    startsByFileSlug = null,
    baseName = 'nestorcut',
    maskPaths = true,
} = {}) {
    if (!Array.isArray(sheets) || sheets.length === 0) {
        throw new SheetCamJobError('sheetcamNest.noSheets')
    }
    const ranks = jobRanksByDrawing(job)

    // Traduction vers la forme du lot J2 : `part` y est le RANG `[Part N]` du
    // dessin dans le `.job` d'origine.
    const j2Sheets = sheets.map((items, sheetIndex) => items.map((item, k) => {
        const name = fileNamesBySlug[item.fileSlug]
        const rank = ranks.get(name)
        if (rank == null) {
            // Piège 3 : mieux vaut refuser que livrer un `.job` amputé.
            throw new SheetCamJobError('sheetcamNest.drawingNotInJob', {
                drawing: String(name || item.fileSlug),
                sheet: String(sheetIndex + 1),
            })
        }
        const nested = item.nestedIn
        if (nested != null && (nested < 0 || nested >= items.length || nested === k)) {
            throw new SheetCamJobError('sheetcamNest.nestingCycle', { item: String(k) })
        }
        return { part: rank, pose: item.pose, op: item.op ?? 0, nestedIn: nested ?? null }
    }))

    // Les anneaux, indexés par RANG de dessin : `nestedJobsPerSheet` en tire
    // le centre de boîte du dessin NON tourné, seule entrée de la formule de
    // pose du lot J2 (§9.42 — le lot J4 avait mesuré la boîte TOURNÉE, faux
    // de 45 mm dès qu'une rotation n'est pas un quart de tour).
    const rings = {}
    for (const [name, rank] of ranks) {
        const slug = Object.keys(fileNamesBySlug).find((s) => fileNamesBySlug[s] === name)
        if (slug && ringsByFileSlug[slug]) rings[rank] = ringsByFileSlug[slug]
    }

    // LOT J4-ter — ON ÉCRIT LE POINT DE DÉPART, ET ON LÈVE LE DRAPEAU.
    //
    // Un point `moved = false` du cache binaire est une INDICATION, pas une
    // garantie : SheetCam le RECALCULE à l'ouverture (§9.50, vérifié en
    // rouvrant et re-sauvegardant le fichier du propriétaire — le point du
    // trou passe d'un bout du cercle à l'autre). Réserver la place au point lu
    // et laisser SheetCam en choisir un autre, c'est le défaut de la recette
    // sous une autre forme.
    //
    // On réécrit donc, pour chaque contour où la réserve a été posée, le point
    // que NestorCut a retenu, avec le drapeau « déplacé à la main ». SheetCam
    // ne le recalcule plus, et le G-code amorce là où la place est gardée —
    // c'est ce que la recette machine vérifie.
    //
    // On n'écrit QUE pour les chemins qui tombent sur un contour du dessin : un
    // chemin sans contour chez nous (une entité POINT, par exemple) n'a pas été
    // réservé, et figer un point qu'on ne modélise pas serait un pari.
    const withStarts = startsByFileSlug
        ? applyChosenStarts(job, { startsByFileSlug, fileNamesBySlug, ringsByFileSlug })
        : job

    return nestedJobsPerSheet(withStarts, { sheets: j2Sheets, rings, maskPaths })
        .map((file) => ({
            ...file,
            fileName: `${baseName}_tole${file.sheet}.job`,
        }))
}

// Re-export : l'appelant du resultat (localJobPrivate) a besoin du lecteur,
// et un import DYNAMIQUE relatif vers `../../shared/…` ne resout pas dans le
// bundle serveur (Rollup resout depuis l'emplacement du chunk). Passer par ce
// module, qui l'importe STATIQUEMENT, est la voie sure.
export { parseSheetCamJob }


/**
 * Réécrit dans le cache binaire les points de départ que NestorCut a retenus,
 * drapeau « déplacé à la main » levé (lot J4-ter).
 *
 * Rend un `job` dont seul `binary` change — deux doubles et un octet par
 * contour réservé, le reste du cache intact (c'est ce que le harnais vérifie).
 */
export function applyChosenStarts(job, { startsByFileSlug, fileNamesBySlug, ringsByFileSlug }) {
    const blocks = jobPathRecords(job.binary)
    if (!blocks) return job
    const edits = []
    for (const [slug, entry] of Object.entries(startsByFileSlug || {})) {
        const block = blocks[entry?.blockIndex]
        if (!block || !Array.isArray(entry?.starts)) continue
        const rings = ringsByFileSlug?.[slug] || []
        if (!rings.length) continue
        for (const start of entry.starts) {
            const path = block.paths?.[start?.pathIndex]
            if (!path || !Array.isArray(start?.offset)) continue
            const point = [
                Number(block.origin[0]) + Number(start.offset[0]),
                Number(block.origin[1]) + Number(start.offset[1]),
            ]
            if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue
            let best = Infinity
            for (const ring of rings) {
                if (!Array.isArray(ring) || ring.length < 2) continue
                const d = nearestOnRing(point, ring).d
                if (d < best) best = d
            }
            if (best > START_MATCH_TOL_MM) continue
            edits.push({ at: path.at, point: start.offset })
        }
    }
    if (!edits.length) return job
    return { ...job, binary: writeJobStartPoints(job.binary, edits) }
}
