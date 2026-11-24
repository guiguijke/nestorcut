/**
 * Défauts marqués à la main sur une tôle importée : logique PURE (aucune E/S,
 * pas de Date.now, pas de Math.random).
 *
 * Un défaut dessiné est `{ id, kind, ring }` : anneau FERMÉ (premier point
 * répété en dernier, piège #5c), millimètres, repère de la tôle (celui du
 * DXF), y vers le haut. Un cercle porte aussi `cx, cy, r` (l'écran trace un
 * vrai cercle). Un défaut est de la matière interdite ; la géométrie
 * (`geoCutSheet`, wasm) en tire le contour restant. Ici on ne l'appelle
 * jamais : on prépare son entrée (`cutInput`) et on lit son RÉSULTAT
 * (`normalizeCut`). Pas de test d'auto-intersection : la géométrie remplit
 * à la règle non nulle.
 */
import { closedValidRing, normalizeForbidden, ringBbox } from './sheetShape.js'

export const DEFECT_KINDS = ['free', 'circle', 'rect']

/** Excès de rayon toléré du polygone circonscrit au cercle (mm). */
const CIRCLE_MAX_EXCESS_MM = 0.02
const CIRCLE_MIN_SIDES = 24
const CIRCLE_MAX_SIDES = 128

const finite2 = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])

/**
 * Polygone CIRCONSCRIT au cercle (rayon des sommets r / cos(pi/n)) : le
 * disque entier est couvert. n tel que l'excès de rayon reste <= 0,02 mm,
 * borné à [24, 128]. Anneau fermé ; null si non fini ou r <= 0.
 */
export function circleRing(cx, cy, r) {
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || !(r > 0)) return null
    let n = Math.ceil(Math.PI * Math.sqrt(r / (2 * CIRCLE_MAX_EXCESS_MM)))
    n = Math.min(CIRCLE_MAX_SIDES, Math.max(CIRCLE_MIN_SIDES, n))
    while (n < CIRCLE_MAX_SIDES && r / Math.cos(Math.PI / n) - r > CIRCLE_MAX_EXCESS_MM) n++
    const rv = r / Math.cos(Math.PI / n)
    const pts = []
    for (let k = 0; k < n; k++) {
        const a = (2 * Math.PI * k) / n
        pts.push([cx + rv * Math.cos(a), cy + rv * Math.sin(a)])
    }
    return [...pts, [pts[0][0], pts[0][1]]]
}

/** Rectangle de deux coins opposés (ordre libre), fermé ; null si un côté < 1e-6 mm ou non fini. */
export function rectRing(a, b) {
    if (!finite2(a) || !finite2(b)) return null
    const x0 = Math.min(a[0], b[0])
    const x1 = Math.max(a[0], b[0])
    const y0 = Math.min(a[1], b[1])
    const y1 = Math.max(a[1], b[1])
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return null
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
}

/**
 * Polygone libre : doublons consécutifs et dernier point répété retirés,
 * puis fermé. null si moins de 3 points distincts ou un point non fini.
 */
export function freeRing(points) {
    if (!Array.isArray(points) || !points.every(finite2)) return null
    const pts = []
    for (const p of points) {
        const last = pts[pts.length - 1]
        if (last && last[0] === p[0] && last[1] === p[1]) continue
        pts.push([p[0], p[1]])
    }
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop()
    if (new Set(pts.map(([x, y]) => `${x},${y}`)).size < 3) return null
    return [...pts, [pts[0][0], pts[0][1]]]
}

/**
 * Défaut `{ id, kind, ring }` (+ cx, cy, r pour un cercle) ou null.
 * data : free { points } ; circle { cx, cy, r } ; rect { a, b }.
 */
export function makeDefect(id, kind, data) {
    if (typeof id !== 'string' || !id || !DEFECT_KINDS.includes(kind) || !data || typeof data !== 'object') return null
    if (kind === 'circle') {
        const ring = circleRing(data.cx, data.cy, data.r)
        return ring ? { id, kind, ring, cx: data.cx, cy: data.cy, r: data.r } : null
    }
    const ring = kind === 'rect' ? rectRing(data.a, data.b) : freeRing(data.points)
    return ring ? { id, kind, ring } : null
}

/** Défauts mis à l'échelle (mêmes gardes que `scaleContours`) : anneaux et cx, cy, r. */
export function scaleDrawn(drawn, factor) {
    if (!Array.isArray(drawn) || !Number.isFinite(factor) || factor <= 0 || factor === 1) return drawn
    return drawn.map((d) => {
        const out = { ...d, ring: d.ring.map(([x, y]) => [x * factor, y * factor]) }
        if (d.kind === 'circle') {
            out.cx = d.cx * factor
            out.cy = d.cy * factor
            out.r = d.r * factor
        }
        return out
    })
}

/** Anneaux à donner à geoCutSheet (`defects`). */
export function defectRings(drawn) {
    return Array.isArray(drawn) ? drawn.map((d) => d.ring) : []
}

/** [minx, miny, maxx, maxy] d'un défaut ; null si vide. */
export function defectBbox(defect) {
    return ringBbox(defect?.ring)
}

/**
 * Copies simples et validées. Rien n'est abandonné en silence : une entrée
 * invalide lève sheet_bad_defect. Absent/null -> [].
 */
export function normalizeDrawn(drawn) {
    if (drawn === undefined || drawn === null) return []
    if (!Array.isArray(drawn)) throw new Error('sheet_bad_defect')
    const seen = new Set()
    return drawn.map((d) => {
        if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !d.id || seen.has(d.id)
            || !DEFECT_KINDS.includes(d.kind)) {
            throw new Error('sheet_bad_defect')
        }
        seen.add(d.id)
        let ring
        try {
            ring = closedValidRing(d.ring)
        } catch {
            throw new Error('sheet_bad_defect')
        }
        const out = { id: d.id, kind: d.kind, ring: ring.map(([x, y]) => [x, y]) }
        if (d.kind === 'circle') {
            if (![d.cx, d.cy, d.r].every(Number.isFinite) || !(d.r > 0)) throw new Error('sheet_bad_defect')
            out.cx = d.cx
            out.cy = d.cy
            out.r = d.r
        }
        return out
    })
}

/**
 * Entrée de geoCutSheet : contour de tôle ORIGINAL, zones interdites
 * normalisées (trous) et anneaux des défauts. Lève sheet_no_outline,
 * sheet_bad_geometry, sheet_bad_defect.
 */
export function cutInput(contours, outlineIndex, forbidden, drawn) {
    if (!Array.isArray(contours) || !Number.isInteger(outlineIndex) || !contours[outlineIndex]
        || !Array.isArray(contours[outlineIndex].ring)) {
        throw new Error('sheet_no_outline')
    }
    const zones = normalizeForbidden(contours, outlineIndex, forbidden)
    return {
        outer: closedValidRing(contours[outlineIndex].ring),
        holes: zones.map((i) => closedValidRing(contours[i].ring)),
        defects: defectRings(normalizeDrawn(drawn)),
    }
}

function cutRing(ring) {
    try {
        return closedValidRing(ring).map(([x, y]) => [x, y])
    } catch {
        throw new Error('sheet_bad_cut')
    }
}

function cutRings(list) {
    if (!Array.isArray(list)) throw new Error('sheet_bad_cut')
    return list.map(cutRing)
}

// Morceau perdu : { outer, holes } (anneaux fermés). Les dangers peuvent se
// partager des arêtes (une zone en anneau arrive en deux moitiés) : aucune
// disjonction n'est vérifiée.
function cutPieces(list) {
    if (!Array.isArray(list)) throw new Error('sheet_bad_cut')
    return list.map((p) => {
        if (!p || typeof p !== 'object') throw new Error('sheet_bad_cut')
        return { outer: cutRing(p.outer), holes: cutRings(p.holes ?? []) }
    })
}

/**
 * Résultat de geoCutSheet lu en copie simple : anneaux fermés, finis, d'au
 * moins 3 points distincts ; nombres finis ; aire utile > 0. Lève
 * sheet_bad_cut sinon (un `ok: false` aussi).
 */
export function normalizeCut(result) {
    if (!result || typeof result !== 'object' || result.ok === false) throw new Error('sheet_bad_cut')
    const num = (v, min) => {
        if (!Number.isFinite(v) || v < min) throw new Error('sheet_bad_cut')
        return v
    }
    const usableArea = num(result.usableArea, 0)
    if (!(usableArea > 0)) throw new Error('sheet_bad_cut')
    return {
        outer: cutRing(result.outer),
        holes: cutRings(result.holes),
        hazards: cutRings(result.hazards),
        lostPieces: cutPieces(result.lostPieces),
        usableArea,
        lostArea: num(result.lostArea, 0),
        removedArea: num(result.removedArea, 0),
        pieces: num(result.pieces, 1),
    }
}
