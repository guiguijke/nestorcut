/**
 * Kerf explicite (B.4 / masterplan 3.10) — logique pure, testée.
 *
 * L'espacement entre pièces se règle par ses deux causes : le kerf
 * (largeur de coupe de l'outil) et la sécurité (marge gardée autour de
 * chaque pièce). L'espacement EFFECTIF — la clé `space` comprise par
 * l'API et les deux moteurs — vaut :
 *
 *     space = 2 × kerf + sécurité
 *
 * ---------------------------------------------------------------------------
 * LA RÈGLE A CHANGÉ LE 13/09, ET C'EST UNE DÉCISION DU PROPRIÉTAIRE
 * (`docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §9.40).
 *
 * L'ancienne forme était `kerf + 2 × sécurité`. Elle sous-estimait la place
 * prise par la coupe : la bande de kerf est centrée sur le CHEMIN D'OUTIL,
 * lui-même à kerf/2 du contour de la pièce — elle s'étend donc jusqu'à UN
 * KERF ENTIER hors de chaque pièce. Deux pièces à moins de `2 × kerf` ont des
 * bandes qui se recouvrent : la seconde coupe traverse de l'air déjà coupé —
 * perte d'arc, bord rongé. Le « grignotage » vu par le propriétaire sur une
 * sortie SheetCam était donc réel.
 *
 * La sécurité reste LE paramètre libre (1 mm par défaut). Sur un kerf de
 * 1,5 mm : 4 mm d'espacement au lieu de 2.
 *
 * ---------------------------------------------------------------------------
 * ET AUCUN PROJET EXISTANT NE DOIT CHANGER D'ESPACEMENT POUR AUTANT. Les deux
 * champs sont en production depuis le chantier B.4 : relire `{kerf: 1,5 ;
 * sécurité: 0,25}` avec la nouvelle règle donnerait 3,25 mm là où le projet a
 * été calculé à 2. `withKerfDefaults` migre donc explicitement, en préservant
 * l'espacement EFFECTIF — c'est lui qui gouverne la géométrie livrée, pas la
 * répartition entre les deux champs.
 */

/**
 * Round to 4 decimals — keeps `space = 2 × kerf + safety` free of float
 * noise while preserving every spacing a user can actually type.
 */
export function round4Str(v) {
    const n = Number(v)
    if (!Number.isFinite(n)) return '0'
    return String(Math.round(n * 10000) / 10000)
}

/** Param string ("1,5") -> number (1.5), invalid/absent -> 0. */
export function paramNumber(v) {
    return Number(String(v ?? '0').replace(',', '.')) || 0
}

/** Effective spacing (display unit) from the two explicit settings. */
export function spacingFromKerfSafety(kerf, safety) {
    return round4Str(2 * paramNumber(kerf) + paramNumber(safety))
}

/** Tolérance de reconnaissance d'une règle, en unité d'affichage : les deux
 *  champs sont arrondis au dix-millième, l'écart admissible est le même. */
const RULE_EPS = 1e-4

/**
 * Migration des params écrits avant le chantier kerf (B.4) ET avant le
 * changement de règle du 13/09.
 *
 * Trois cas, dans cet ordre :
 *
 *  1. Pas de kerf ni de sécurité : c'est un params d'avant B.4, il ne porte
 *     que `space`. kerf = 0 et sécurité = space — espacement effectif
 *     identique au dix-millième près.
 *  2. Les deux champs sont là et satisfont DÉJÀ `2 × kerf + sécurité` : rien
 *     à faire (l'objet est rendu tel quel, identité préservée).
 *  3. Ils satisfont l'ANCIENNE règle `kerf + 2 × sécurité` : on recalcule la
 *     SÉCURITÉ pour que l'espacement effectif ne bouge pas. Quand le kerf
 *     seul dépasse déjà l'espacement du projet (`2 × kerf > space`, par
 *     exemple kerf 1,5 pour un espacement de 2), on ne PEUT pas garder les
 *     deux : c'est l'ESPACEMENT qu'on préserve — il gouverne la géométrie
 *     livrée — et le kerf retombe à 0. Le projet garde donc le résultat qu'il
 *     avait, et l'utilisateur ressaisira son kerf s'il le veut.
 *
 * Un params qui ne satisfait AUCUNE des deux règles est laissé intact : on ne
 * réécrit pas ce qu'on ne reconnaît pas.
 */
export function withKerfDefaults(params) {
    const space = paramNumber(params.space)
    if (params.kerf == null || params.safety == null) {
        return { ...params, kerf: '0', safety: round4Str(space) }
    }
    const kerf = paramNumber(params.kerf)
    const safety = paramNumber(params.safety)
    if (Math.abs(2 * kerf + safety - space) <= RULE_EPS) return params
    if (Math.abs(kerf + 2 * safety - space) > RULE_EPS) return params
    if (2 * kerf > space) {
        return { ...params, kerf: '0', safety: round4Str(space) }
    }
    return { ...params, safety: round4Str(space - 2 * kerf) }
}

/**
 * Levier « réduire l'espacement à X mm » : réduit la SÉCURITÉ, jamais le
 * kerf (il décrit l'outil physique). Retourne le patch {safety} (en
 * millimètres) qui amène l'effectif exactement à `targetMm`, ou null si
 * la cible ne permet même pas les deux kerfs courants. Cible 0 sans kerf :
 * sécurité 0, le contact est un réglage valide.
 */
export function safetyPatchForTargetMm(kerfMm, targetMm) {
    if (targetMm === 0 && kerfMm === 0) return { safetyMm: 0 }
    if (!(targetMm > 2 * kerfMm)) return null
    return { safetyMm: targetMm - 2 * kerfMm }
}

/*
 * ---------------------------------------------------------------------------
 * DISTANCE AU BORD (lot du 26/11/2026, demande de Josh).
 *
 * Réglage séparé de l'espacement entre pièces. À l'écran c'est une chaîne en
 * unité d'affichage, comme le kerf et la sécurité :
 *   - '' / null / undefined : « comme l'espacement », le comportement d'avant ;
 *   - un nombre positif : les pièces restent à cette distance du bord ;
 *   - un nombre négatif : une pièce peut dépasser du bord d'autant.
 *
 * Le moteur ne connaît que l'espacement `s`, appliqué entre pièces ET au bord.
 * La tôle lui part donc décalée de d = e − s : W − 2d × H − 2d (contour
 * importé décalé de −d), et une pose moteur (x, y) vaut (x + d, y + d) sur la
 * vraie tôle. d = 0 exactement quand le bord n'est pas réglé ou vaut
 * l'espacement : le calcul est alors identique au bit près.
 */

/** Saisie acceptée pour la distance au bord : décimal signé, point ou virgule. */
export const EDGE_DISTANCE_RE = /^-?\d+([.,]\d+)?$/

/** Sous cet écart (mm), bord et espacement sont confondus : d = 0. */
export const EDGE_EPS_MM = 1e-6

/** Le champ est-il rempli ? (vide, null, undefined = comme l'espacement) */
export function isEdgeDistanceSet(v) {
    return v !== undefined && v !== null && String(v).trim() !== ''
}

/** Vide (= comme l'espacement) ou décimal signé valide. */
export function isValidEdgeDistance(v) {
    return !isEdgeDistanceSet(v) || EDGE_DISTANCE_RE.test(String(v).trim())
}

/** Chaîne de l'écran -> nombre (même unité), ou null si vide ou illisible. -0 rendu 0. */
export function edgeDistanceNumber(v) {
    if (!isEdgeDistanceSet(v)) return null
    const s = String(v).trim()
    if (!EDGE_DISTANCE_RE.test(s)) return null
    const n = Number(s.replace(',', '.'))
    if (!Number.isFinite(n)) return null
    return n === 0 ? 0 : n
}

/**
 * Décalage moteur d = bord − espacement (mm). 0 exact quand le bord n'est pas
 * réglé (null / undefined / non fini) ou vaut l'espacement à EDGE_EPS_MM près.
 */
export function edgeShiftMm(spaceMm, edgeMm) {
    if (edgeMm === null || edgeMm === undefined) return 0
    const e = Number(edgeMm)
    if (!Number.isFinite(e)) return 0
    const d = e - (Number(spaceMm) || 0)
    return Math.abs(d) < EDGE_EPS_MM ? 0 : d
}

/**
 * Pourquoi le champ « distance au bord » est grisé, ou null quand il est actif.
 * Un projet « Cet appareil » : toujours actif. Sinon le calcul se fait dans le
 * navigateur : pas dans la démo, pas avec un fichier DWG (converti sur nos
 * serveurs), pas si le calcul navigateur est coupé. Même règle que le serveur
 * (`nest.post.js`) : la page n'envoie jamais un réglage qu'il refuserait.
 * @returns {null|'demo'|'dwg'|'off'}
 */
export function edgeDistanceBlock({ local, isDemo, hasDwg, browserCompute }) {
    if (local) return null
    if (isDemo) return 'demo'
    if (hasDwg) return 'dwg'
    if (!browserCompute) return 'off'
    return null
}

/** Un des fichiers demandés (quantité > 0) est-il un DWG ? (même test que le serveur : le slug) */
export function hasDwgToNest(files) {
    return (files || []).some(
        (f) => Number(f?.count) > 0 && String(f?.slug || '').toLowerCase().endsWith('.dwg')
    )
}
