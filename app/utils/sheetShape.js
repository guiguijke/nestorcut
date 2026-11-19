/**
 * Tôle importée depuis un DXF : logique PURE (aucune E/S, pas de Date.now,
 * pas de Math.random) du modèle « contour de tôle + zones interdites ».
 *
 * Entrée : les contours rendus par l'import de tôle (une face bornée de
 * l'arrangement planaire du dessin = un contour). Chaque contour :
 *   { ring: [[x,y]...] FERMÉ (premier point répété en dernier, piège #5c),
 *     depth, parent (index dans le même tableau ou null), areaMm2, bbox }
 * en millimètres, repère propre du DXF, y vers le haut.
 *
 * Le contour de tôle (`outlineIndex`) est l'un des contours ; les zones
 * interdites (`forbidden`) sont des indices de contours descendants de ce
 * contour. Une zone rouge dans une zone rouge est abandonnée (la géométrie
 * du parent la couvre déjà).
 */

export const MAX_SHEET_VERTICES = 5000
export const MAX_SHEET_ZONES = 200

/** Aire absolue (shoelace) d'un anneau, fermé ou non. */
export function ringArea(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return 0
    let sum = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        sum += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1])
    }
    return Math.abs(sum) / 2
}

/** [minx, miny, maxx, maxy] ; null si l'anneau est vide. */
export function ringBbox(ring) {
    if (!Array.isArray(ring) || ring.length === 0) return null
    let minx = Infinity
    let miny = Infinity
    let maxx = -Infinity
    let maxy = -Infinity
    for (const [x, y] of ring) {
        if (x < minx) minx = x
        if (y < miny) miny = y
        if (x > maxx) maxx = x
        if (y > maxy) maxy = y
    }
    return [minx, miny, maxx, maxy]
}

/** Lancer de rayon ; l'anneau fermé (point dupliqué) donne une arête nulle, sans effet. */
export function pointInRing(pt, ring) {
    if (!Array.isArray(ring) || ring.length < 3) return false
    const [px, py] = pt
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
            inside = !inside
        }
    }
    return inside
}

/** Indice du plus grand contour de profondeur 1 ; -1 s'il n'y en a pas. */
export function pickOutlineIndex(contours) {
    if (!Array.isArray(contours)) return -1
    let best = -1
    let bestArea = -Infinity
    contours.forEach((c, i) => {
        if (c?.depth !== 1) return
        const area = ringArea(c.ring)
        if (area > bestArea) {
            bestArea = area
            best = i
        }
    })
    return best
}

function validIndex(contours, index) {
    return Array.isArray(contours) && Number.isInteger(index) && index >= 0 && index < contours.length
}

function hasAncestor(contours, index, ancestor) {
    let cur = contours[index]?.parent
    let guard = contours.length + 1
    while (Number.isInteger(cur) && guard-- > 0) {
        if (cur === ancestor) return true
        cur = contours[cur]?.parent
    }
    return false
}

/** Indices (ordre du tableau) de tous les descendants du contour de tôle, à toute profondeur. */
export function zoneCandidates(contours, outlineIndex) {
    if (!validIndex(contours, outlineIndex)) return []
    const out = []
    for (let i = 0; i < contours.length; i++) {
        if (i !== outlineIndex && hasAncestor(contours, i, outlineIndex)) out.push(i)
    }
    return out
}

/**
 * Indices triés uniques, candidats seulement, sans ceux qui ont un ancêtre
 * lui-même interdit.
 */
export function normalizeForbidden(contours, outlineIndex, forbidden) {
    if (!Array.isArray(forbidden)) return []
    const candidates = new Set(zoneCandidates(contours, outlineIndex))
    const wanted = new Set(forbidden.filter((i) => Number.isInteger(i) && candidates.has(i)))
    const kept = []
    for (const i of wanted) {
        let covered = false
        for (const other of wanted) {
            if (other !== i && hasAncestor(contours, i, other)) {
                covered = true
                break
            }
        }
        if (!covered) kept.push(i)
    }
    return kept.sort((a, b) => a - b)
}

/** Aire de la tôle moins celle des zones interdites normalisées (jamais négative). */
export function usableAreaMm2(contours, outlineIndex, forbidden) {
    if (!validIndex(contours, outlineIndex)) return 0
    const outline = ringArea(contours[outlineIndex].ring)
    const zones = normalizeForbidden(contours, outlineIndex, forbidden)
        .reduce((sum, i) => sum + ringArea(contours[i].ring), 0)
    return Math.max(0, outline - zones)
}

function vertexCountOf(ring) {
    if (!Array.isArray(ring) || ring.length === 0) return 0
    const first = ring[0]
    const last = ring[ring.length - 1]
    const closed = ring.length > 1 && first[0] === last[0] && first[1] === last[1]
    return closed ? ring.length - 1 : ring.length
}

/** Plafonds de la tôle : sommets (contour + zones normalisées) et nombre de zones. */
export function sheetLimits(contours, outlineIndex, forbidden) {
    const zones = normalizeForbidden(contours, outlineIndex, forbidden)
    let vertexCount = validIndex(contours, outlineIndex) ? vertexCountOf(contours[outlineIndex].ring) : 0
    for (const i of zones) vertexCount += vertexCountOf(contours[i].ring)
    const zoneCount = zones.length
    let reason = null
    if (vertexCount > MAX_SHEET_VERTICES) reason = 'too_many_vertices'
    else if (zoneCount > MAX_SHEET_ZONES) reason = 'too_many_zones'
    return { ok: reason === null, reason, vertexCount, zoneCount }
}

/** Disque (>= 16 sommets tous sur un même cercle) ou boîte englobante. */
export function describeOutline(contours, outlineIndex) {
    const ring = validIndex(contours, outlineIndex) ? contours[outlineIndex].ring : null
    const bbox = ringBbox(ring)
    if (!bbox) return { kind: 'box', widthMm: 0, heightMm: 0 }
    const [minx, miny, maxx, maxy] = bbox
    const n = vertexCountOf(ring)
    if (n >= 16) {
        const cx = (minx + maxx) / 2
        const cy = (miny + maxy) / 2
        const radii = ring.slice(0, n).map(([x, y]) => Math.hypot(x - cx, y - cy))
        const mean = radii.reduce((s, r) => s + r, 0) / radii.length
        const tol = Math.max(0.05, 0.001 * mean)
        if (radii.every((r) => Math.abs(r - mean) <= tol)) {
            return { kind: 'disc', diameterMm: 2 * mean }
        }
    }
    return { kind: 'box', widthMm: maxx - minx, heightMm: maxy - miny }
}

/** Anneaux pour le moteur : contour de tôle + zones interdites normalisées. */
export function engineRings(record) {
    const contours = record?.contours
    const outlineIndex = record?.outlineIndex
    if (!validIndex(contours, outlineIndex)) return { outer: null, holes: [] }
    const holes = normalizeForbidden(contours, outlineIndex, record.forbidden)
        .map((i) => contours[i].ring)
    return { outer: contours[outlineIndex].ring, holes }
}

function round3(v) {
    const r = Math.round(v * 1000) / 1000
    return r === 0 ? 0 : r // pas de -0
}

function signedArea(ring) {
    let sum = 0
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        sum += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1])
    }
    return sum / 2
}

// Le sens de l'anneau ne change pas l'empreinte (un même contour horaire ou
// anti-horaire se déduplique).
function ringKey(ring) {
    const ccw = signedArea(ring) < 0 ? [...ring].reverse() : ring
    return ccw.map(([x, y]) => `${round3(x).toFixed(3)},${round3(y).toFixed(3)}`).join(';')
}

// FNV-1a 32 bits, deux graines : pas de crypto (tourne sous vitest/SSR).
function fnv1a(str, seed) {
    let h = seed >>> 0
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
}

/** Empreinte déterministe du contour + zones normalisées (arrondis 1e-3 mm), pour dédupliquer. */
function geometryKeyOf(contours, outlineIndex, zones) {
    const parts = [ringKey(contours[outlineIndex].ring)]
    parts.push(...zones.map((i) => ringKey(contours[i].ring)).sort())
    const text = parts.join('|')
    return `g1-${zones.length}-${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01000193)}`
}

/**
 * Valide un anneau et le rend fermé : sommets [x, y] aux coordonnées finies,
 * au moins 3 sommets distincts. Un anneau donné sans point de fermeture est
 * accepté (le point est ajouté). Rend l'anneau lui-même s'il est déjà fermé.
 * Lève sheet_bad_geometry sinon.
 */
function closedValidRing(ring) {
    if (!Array.isArray(ring)) throw new Error('sheet_bad_geometry')
    for (const pt of ring) {
        if (!Array.isArray(pt) || pt.length < 2
            || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
            throw new Error('sheet_bad_geometry')
        }
    }
    const closed = ring.length > 1
        && ring[0][0] === ring[ring.length - 1][0]
        && ring[0][1] === ring[ring.length - 1][1]
    const open = closed ? ring.slice(0, -1) : ring
    if (new Set(open.map(([x, y]) => `${x},${y}`)).size < 3) throw new Error('sheet_bad_geometry')
    return closed ? ring : [...ring, ring[0]]
}

/**
 * Construit l'enregistrement de tôle (champs dérivés calculés). Lève une
 * Error nommée : sheet_no_outline, sheet_bad_geometry (coordonnée non finie
 * ou moins de 3 sommets distincts), sheet_too_many_vertices, sheet_too_many_zones.
 */
export function makeSheetRecord({
    id, projectSlug, name, sourceFileName, sourceUnits, contours, outlineIndex, forbidden, addedAt,
}) {
    if (!validIndex(contours, outlineIndex) || !Array.isArray(contours[outlineIndex]?.ring)) {
        throw new Error('sheet_no_outline')
    }
    const zones = normalizeForbidden(contours, outlineIndex, forbidden)
    // Seuls le contour de tôle et les zones retenues sont validés et fermés ;
    // le tableau d'origine est gardé tel quel si aucun anneau n'a changé.
    let stored = contours
    for (const i of [outlineIndex, ...zones]) {
        const ring = closedValidRing(contours[i].ring)
        if (ring !== contours[i].ring) {
            if (stored === contours) stored = [...contours]
            stored[i] = { ...contours[i], ring }
        }
    }
    contours = stored
    const limits = sheetLimits(contours, outlineIndex, zones)
    if (limits.reason === 'too_many_vertices') throw new Error('sheet_too_many_vertices')
    if (limits.reason === 'too_many_zones') throw new Error('sheet_too_many_zones')
    const bbox = ringBbox(contours[outlineIndex].ring)
    return {
        slug: id,
        kind: 'sheet',
        projectSlug: projectSlug ?? null,
        name,
        sourceFileName,
        sourceUnits,
        addedAt,
        lastUsedAt: addedAt,
        contours,
        outlineIndex,
        forbidden: zones,
        bbox,
        widthMm: bbox[2] - bbox[0],
        heightMm: bbox[3] - bbox[1],
        areaMm2: usableAreaMm2(contours, outlineIndex, zones),
        vertexCount: limits.vertexCount,
        geometryKey: geometryKeyOf(contours, outlineIndex, zones),
    }
}

/**
 * Contours mis à l'échelle (facteur strictement positif) autour de l'origine
 * du dessin : anneaux, aires (× f²) et boîtes. Un facteur inutilisable rend
 * le tableau d'origine. Sert au réglage « ce fichier est en pouces » : la
 * lecture est refaite par personne, seule la géométrie déjà lue change.
 */
export function scaleContours(contours, factor) {
    if (!Array.isArray(contours) || !Number.isFinite(factor) || factor <= 0 || factor === 1) return contours
    return contours.map((c) => ({
        ...c,
        ring: c.ring.map(([x, y]) => [x * factor, y * factor]),
        areaMm2: c.areaMm2 * factor * factor,
        bbox: c.bbox.map((v) => v * factor),
    }))
}
