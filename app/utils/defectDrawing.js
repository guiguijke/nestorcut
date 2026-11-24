/**
 * Dessin des défauts à la main : outils PURS (aucune E/S, pas de Date.now, pas
 * de Math.random). L'écran (SheetImportDrawing.vue) ne fait que brancher les
 * événements du pointeur sur ces fonctions.
 *
 * Repères : « écran » = unités du viewBox du dessin (1 unité = 1 px tant que le
 * viewBox suit la taille du cadre) ; « mm » = repère de la tôle (celui du
 * DXF), y vers le haut. `fit` est le résultat de `fitTransform`
 * (x' = s·x + tx ; y' = -s·y + ty).
 */
import { MAX_SHEET_ZONES } from './sheetShape.js'

/** Outils de la barre ; `pointer` = choisir les formes (comportement d'avant). */
export const TOOLS = ['pointer', 'free', 'circle', 'rect']
export const DRAW_TOOLS = ['free', 'circle', 'rect']

/** Glissé minimal (px) d'un cercle ou d'un rectangle : en deçà, rien n'est créé. */
export const MIN_DRAG_PX = 3
/** Distance (px) du premier point sous laquelle un clic ferme le contour libre. */
export const CLOSE_NEAR_PX = 12
/** Deux points libres plus proches que ça (px) n'en font qu'un (double clic). */
export const DEDUPE_PX = 4
/** Profondeur de l'historique (annuler). */
export const HISTORY_MAX = 100

export const isDrawTool = (tool) => DRAW_TOOLS.includes(tool)

/** Point de l'écran (unités du viewBox) -> mm (y vers le haut). */
export function screenToMm(x, y, fit) {
    return [(x - fit.tx) / fit.scale, (fit.ty - y) / fit.scale]
}

/** Point en mm -> écran. */
export function mmToScreen(p, fit) {
    return [p[0] * fit.scale + fit.tx, fit.ty - p[1] * fit.scale]
}

/** Distance (px écran) entre deux points en mm. */
export function distPx(a, b, scale) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]) * scale
}

/** Le point `p` ferme-t-il le contour libre (au moins 3 points, premier point à <= 12 px) ? */
export function nearFirst(points, p, scale, px = CLOSE_NEAR_PX) {
    return Array.isArray(points) && points.length >= 3 && distPx(points[0], p, scale) <= px
}

/**
 * Ajoute `p` au contour libre ; un point à moins de 4 px du précédent est
 * abandonné (les deux clics d'un double clic ne laissent pas de doublon).
 * Rend le MÊME tableau si rien n'est ajouté.
 */
export function pushPoint(points, p, scale, minPx = DEDUPE_PX) {
    const last = points[points.length - 1]
    if (last && distPx(last, p, scale) < minPx) return points
    return [...points, [p[0], p[1]]]
}

/** Sans le dernier point (annuler au milieu d'un contour libre). */
export function popPoint(points) {
    return points.slice(0, -1)
}

/** Glissé d'un cercle (centre, point courant) : { r } ou null sous 3 px. */
export function circleDrag(center, p, scale) {
    const d = distPx(center, p, scale)
    return d < MIN_DRAG_PX ? null : { cx: center[0], cy: center[1], r: d / scale }
}

/** Glissé d'un rectangle (coin, point courant) : { a, b } ou null sous 3 px. */
export function rectDrag(a, p, scale) {
    return distPx(a, p, scale) < MIN_DRAG_PX ? null : { a: [a[0], a[1]], b: [p[0], p[1]] }
}

/**
 * Taille vivante pendant le tracé : { kind: 'circle', diameter } ou
 * { kind: 'rect', width, height } (mm), null si rien à dire.
 */
export function liveSize(tool, start, p) {
    if (!start || !p) return null
    if (tool === 'circle') return { kind: 'circle', diameter: 2 * Math.hypot(p[0] - start[0], p[1] - start[1]) }
    if (tool === 'rect') return { kind: 'rect', width: Math.abs(p[0] - start[0]), height: Math.abs(p[1] - start[1]) }
    return null
}

/** Identifiant libre suivant (`d1`, `d2`… ; jamais un identifiant déjà pris). */
export function nextDefectId(drawn) {
    let max = 0
    for (const d of drawn || []) {
        const m = /^d(\d+)$/.exec(d?.id || '')
        if (m) max = Math.max(max, Number(m[1]))
    }
    return `d${max + 1}`
}

/** Peut-on encore ajouter un défaut ? (zones interdites + défauts <= 200) */
export function canAddDefect(forbiddenCount, drawnCount) {
    return (Number(forbiddenCount) || 0) + (Number(drawnCount) || 0) < MAX_SHEET_ZONES
}

// ---------------------------------------------------------------- historique
// Pile d'instantanés du tableau `drawn` (ajout, suppression). Jamais modifiée
// en place : chaque fonction rend une nouvelle pile.

/** Empile l'état d'avant (profondeur bornée). */
export function historyPush(history, snapshot, max = HISTORY_MAX) {
    const next = [...history, snapshot]
    return next.length > max ? next.slice(next.length - max) : next
}

/** Dépile : { history, snapshot } ; snapshot null si la pile est vide. */
export function historyPop(history) {
    if (!history.length) return { history, snapshot: null }
    return { history: history.slice(0, -1), snapshot: history[history.length - 1] }
}

/** Mise à l'échelle de toute la pile (réglage « pouces »), via `scale` (scaleDrawn). */
export function historyScale(history, factor, scale) {
    return history.map((snap) => scale(snap, factor))
}
