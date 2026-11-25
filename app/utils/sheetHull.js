/**
 * Tôle importée CONCAVE : contenant donné au moteur = enveloppe convexe + poches.
 *
 * Pourquoi : le moteur érode son contour sans contrôle (`geo_buffer`, 1 à 2 %
 * de contours faux : refus, ou contenant à des mètres du bord) alors qu'il
 * gonfle ses trous AVEC contrôle et repli exact. Un contour concave part donc
 * comme enveloppe convexe (érosion sûre) + une poche par creux, en trou.
 * Une poche est fermée À L'EXTÉRIEUR de l'enveloppe (lèvre + drapeau) : fermée
 * sur son arête de pont, une poche mince fait refuser TOUT le job (« no pole
 * found », le moteur cherche un point intérieur sur une grille 1/1024).
 * Le rapport, le DXF, la vue live et le résultat gardé gardent le VRAI contour :
 * la substitution n'existe que dans le message envoyé au moteur (jamais dans
 * `payload.instance.bins`, que lisent le rapport et le badge : ils compteraient
 * les poches comme des zones interdites).
 * Pur : aucune entrée-sortie, rien n'est modifié.
 */
export const CONVEX_TOL_MM = 5e-3 // creux le plus profond du contour : en dessous, la tôle est convexe -> instance inchangée, même référence
export const DENT_TOL_MM = 1e-3 // dans un contour concave, un sommet à cette distance de l'arête de l'enveloppe est SUR elle (creux ignoré : 1 micron)
const LIP_MM = 0.1 // décrochement hors de l'arête de pont : pas de sliver, rien ne touche le pont
const FLAG_RATIO = 1 / 400 // demi-côté du drapeau / taille de la poche (le moteur cherche un point intérieur sur une grille 1/1024)
const FLAG_MIN_MM = 0.2

const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const shoelace = (p) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return s / 2 }

function hullIndices(p) {
    const ord = [...p.keys()].sort((i, j) => p[i][0] - p[j][0] || p[i][1] - p[j][1] || i - j)
    const chain = (it) => {
        const h = []
        for (const i of it) {
            while (h.length >= 2 && cross(p[h[h.length - 2]], p[h[h.length - 1]], p[i]) <= 0) h.pop()
            h.push(i)
        }
        h.pop()
        return h
    }
    return [...chain(ord), ...chain([...ord].reverse())]
}

/** { outer, pockets } (anneaux fermés) pour un contour CONCAVE ; null = convexe, ou contour illisible ici : on garde le contour tel quel. */
export function hullAndPockets(ring) {
    const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    let p = closed ? ring.slice(0, -1) : ring.slice()
    if (p.length < 4) return null
    const area = shoelace(p)
    if (area < 0) p = p.reverse()
    const idx = hullIndices(p)
    if (idx.length < 3) return null
    const s = idx.indexOf(Math.min(...idx))
    const h = [...idx.slice(s), ...idx.slice(0, s)]
    for (let k = 1; k < h.length; k++) if (h[k] <= h[k - 1]) return null
    const n = p.length
    const chains = []
    let deepest = 0
    let perimeter = 0
    for (let k = 0; k < h.length; k++) {
        const i = h[k]; const j = k + 1 < h.length ? h[k + 1] : h[0] + n
        const A = p[i]; const B = p[j % n]
        const L = Math.hypot(B[0] - A[0], B[1] - A[1])
        perimeter += L
        if (j - i < 2) continue
        const nx = (B[1] - A[1]) / L; const ny = -(B[0] - A[0]) / L
        let start = i
        for (let m = i + 1; m <= j; m++) {
            const q = p[m % n]
            const d = m === j ? 0 : (A[0] - q[0]) * nx + (A[1] - q[1]) * ny
            if (d > deepest) deepest = d
            if (d > DENT_TOL_MM) continue
            if (m - start >= 2) {
                const c = []
                for (let t = start; t <= m; t++) c.push(p[t % n])
                chains.push({ c, nx, ny })
            }
            start = m
        }
    }
    if (deepest <= CONVEX_TOL_MM) return null
    const hull = h.map((i) => p[i])
    // contrôle : enveloppe moins poches EST la tôle (une poche perdue ou comptée deux fois ne sort jamais d'ici)
    const lost = shoelace(hull) - chains.reduce((q, { c }) => q + Math.abs(shoelace(c)), 0) - Math.abs(area)
    if (Math.abs(lost) > 2 * DENT_TOL_MM * perimeter + 1e-9 * Math.abs(area)) return null
    return { outer: [...hull, hull[0]], pockets: chains.map(closeOutside) }
}

// La poche est fermée À L'EXTÉRIEUR de l'enveloppe (pas de matière là), pas sur son arête de pont.
function closeOutside({ c, nx, ny }) {
    const a = c[0]; const b = c[c.length - 1]
    // Direction de l'arête de l'ENVELOPPE, pas celle de a vers b : sur une bouche de
    // quelques microns aux lèvres décalées, a -> b tourne vers la tôle et le drapeau
    // y entrerait (job refusé par le moteur).
    const tx = -ny; const ty = nx
    const L = (b[0] - a[0]) * tx + (b[1] - a[1]) * ty
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
    for (const [x, y] of c) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    const f = Math.max(FLAG_MIN_MM, Math.max(x1 - x0, y1 - y0) * FLAG_RATIO)
    const at = (u, v) => [a[0] + tx * u + nx * v, a[1] + ty * u + ny * v]
    const m = L / 2
    return [...c, at(L, LIP_MM), at(m + f, LIP_MM), at(m + f, LIP_MM + 2 * f), at(m - f, LIP_MM + 2 * f), at(m - f, LIP_MM), at(0, LIP_MM), a]
}

/**
 * Instance envoyée au moteur. Aucune tôle concave : `payload.instance` LUI-MÊME
 * (même référence). Sinon une copie dont seuls les bins concaves portent
 * { outer: enveloppe, inner: [...inner existants, ...poches] } (les défauts
 * dessinés restent dans `inner`).
 */
export function engineInstanceOf(payload) {
    const shaped = payload?.shapedSheets
    const bins = payload?.instance?.bins
    if (!Array.isArray(shaped) || !shaped.length || !Array.isArray(bins)) return payload?.instance
    const ids = new Set(shaped.map((s) => s?.id))
    let changed = false
    const out = bins.map((b) => {
        const d = ids.has(b?.id) ? b.shape?.data : null
        const h = Array.isArray(d?.outer) ? hullAndPockets(d.outer) : null
        if (!h) return b
        changed = true
        return { ...b, shape: { ...b.shape, data: { outer: h.outer, inner: [...(d.inner ?? []), ...h.pockets] } } }
    })
    return changed ? { ...payload.instance, bins: out } : payload.instance
}

const sends = new WeakMap()

/**
 * { instance, swapped } d'un payload, calculé UNE fois : un pool relance des
 * walks et refait la fusion plusieurs fois, toujours sur le même contenant.
 */
export function engineSendOf(payload) {
    if (!payload || typeof payload !== 'object') return { instance: payload?.instance, swapped: false }
    let r = sends.get(payload)
    // `from` : une instance remplacée sur le même payload est recalculée, jamais l'ancienne.
    if (!r || r.from !== payload.instance) {
        const instance = engineInstanceOf(payload)
        r = { instance, swapped: instance !== payload.instance, from: payload.instance }
        sends.set(payload, r)
    }
    return r
}

/** Config moteur d'un envoi substitué : la fermeture des concavités étroites du moteur coupe un trou gonflé (bruit f32). */
export const withSwappedCutoff = (cfg, swapped) => (swapped ? { ...cfg, narrow_concavity_cutoff: null } : cfg)
