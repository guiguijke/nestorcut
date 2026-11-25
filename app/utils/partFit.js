/**
 * « Cette pièce peut-elle tenir dans la tôle importée ? » : condition
 * NÉCESSAIRE, jamais suffisante. `partMayFitSheet` ne rend `false` que si
 * c'est PROUVÉ impossible ; au moindre doute (anneau dégénéré, nombre
 * illisible, tolérance), il rend `true` : un faux refus est le pire résultat,
 * le moteur tranche ensuite.
 *
 * Le moteur gonfle la pièce de s/2 et dégonfle le conteneur de s/2 (piège 49) :
 * une pièce posée exige hull(pièce) ⊕ disque(s) dans le contour, donc dans
 * son enveloppe convexe. Chaque arête de l'enveloppe de la tôle donne un
 * demi-plan sur la translation t : n·t <= h_tôle(n) - s - h_pièce(n) (h =
 * fonction d'appui). L'intersection de ces demi-plans, par découpage d'une
 * boîte géante, est vide si et seulement si aucune translation ne convient.
 * Zones interdites et défauts ne font que rétrécir la tôle : on les ignore.
 */

// Relâchement du dégagement : la pièce envoyée au moteur est simplifiée
// (Douglas-Peucker 0,05 mm) et ses décalages sont arrondis ; un refus ne doit
// jamais reposer sur un écart de cet ordre.
export const FIT_RELAX_MM = 0.1
// Au-delà de ce nombre d'arêtes, l'enveloppe de la tôle est remplacée par un
// polygone circonscrit à 96 directions : le coût ne dépend plus des sommets.
const MAX_DIRECTIONS = 96
const BIG = 1e9

const finitePoint = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])

function convexHull(points) {
    const pts = points.map(([x, y]) => [x, y]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const uniq = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1])
    if (uniq.length < 3) return uniq
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const lower = []
    for (const p of uniq) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
        lower.push(p)
    }
    const upper = []
    for (let i = uniq.length - 1; i >= 0; i--) {
        const p = uniq[i]
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
        upper.push(p)
    }
    lower.pop()
    upper.pop()
    return lower.concat(upper) // anti-horaire
}

function rotate(pts, deg) {
    if (!deg) return pts
    const r = (deg * Math.PI) / 180
    const c = Math.cos(r)
    const s = Math.sin(r)
    return pts.map(([x, y]) => [c * x - s * y, s * x + c * y])
}

// Normales extérieures des arêtes de l'enveloppe de tôle (<= 96), sinon 96
// directions régulières + les 4 axes : polygone CIRCONSCRIT, qui contient
// l'enveloppe, donc la condition reste nécessaire.
function sheetDirections(hull) {
    const n = hull.length
    if (n <= MAX_DIRECTIONS) {
        const out = []
        for (let i = 0; i < n; i++) {
            const a = hull[i]
            const b = hull[(i + 1) % n]
            const nx = b[1] - a[1]
            const ny = -(b[0] - a[0])
            const l = Math.hypot(nx, ny)
            if (l > 1e-12) out.push([nx / l, ny / l])
        }
        return out
    }
    const out = [[1, 0], [0, 1], [-1, 0], [0, -1]]
    for (let k = 0; k < MAX_DIRECTIONS; k++) {
        out.push([Math.cos((2 * Math.PI * k) / MAX_DIRECTIONS), Math.sin((2 * Math.PI * k) / MAX_DIRECTIONS)])
    }
    return out
}

function support(pts, nx, ny) {
    let m = -Infinity
    for (const p of pts) m = Math.max(m, nx * p[0] + ny * p[1])
    return m
}

function feasibleTranslation(dirs, sheetSupport, partHull, clearance) {
    let poly = [[-BIG, -BIG], [BIG, -BIG], [BIG, BIG], [-BIG, BIG]]
    for (let i = 0; i < dirs.length; i++) {
        const [nx, ny] = dirs[i]
        const bound = sheetSupport[i] - clearance - support(partHull, nx, ny) // n·t <= bound
        const out = []
        for (let k = 0; k < poly.length; k++) {
            const P = poly[k]
            const Q = poly[(k + 1) % poly.length]
            const dp = nx * P[0] + ny * P[1] - bound
            const dq = nx * Q[0] + ny * Q[1] - bound
            if (dp <= 0) out.push(P)
            if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
                const u = dp / (dp - dq)
                out.push([P[0] + u * (Q[0] - P[0]), P[1] + u * (Q[1] - P[1])])
            }
        }
        poly = out
        if (!poly.length) return false
    }
    return true
}

/**
 * @param {Array<[number, number]>} partRing anneau extérieur de la pièce (mm)
 * @param {Array<[number, number]>} sheetOuter contour d'origine de la tôle (mm)
 * @param {number} space espacement interne (mm), le même que celui du moteur
 * @param {number[]} rotations angles permis, en degrés (vide : 0 seul)
 * @returns {boolean} false seulement si la pièce ne peut tenir à AUCUN angle
 */
export function partMayFitSheet(partRing, sheetOuter, space, rotations) {
    if (!Array.isArray(partRing) || !Array.isArray(sheetOuter)) return true
    // Un point illisible ne doit jamais rétrécir la tôle ni la pièce : on ne tranche pas.
    if (!partRing.every(finitePoint) || !sheetOuter.every(finitePoint)) return true
    const sheetHull = convexHull(sheetOuter)
    const partHull = convexHull(partRing)
    if (sheetHull.length < 3 || partHull.length < 3) return true // dégénéré : ne pas refuser
    const dirs = sheetDirections(sheetHull)
    if (!dirs.length) return true
    const sheetSupport = dirs.map(([nx, ny]) => support(sheetHull, nx, ny))
    const s = Number(space)
    const clearance = (Number.isFinite(s) ? Math.max(0, s) : 0) - FIT_RELAX_MM
    const angles = Array.isArray(rotations) && rotations.length ? rotations : [0]
    for (const a of angles) {
        const ang = Number(a)
        if (!Number.isFinite(ang)) return true // angle illisible : ne pas refuser
        // Signe de rotation du moteur non garanti pour une liste libre : l'un OU l'autre.
        for (const sign of ang === 0 ? [1] : [1, -1]) {
            if (feasibleTranslation(dirs, sheetSupport, convexHull(rotate(partHull, sign * ang)), clearance)) return true
        }
    }
    return false
}
