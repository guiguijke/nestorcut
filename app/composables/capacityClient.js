/**
 * Pré-contrôle de capacité avec espacement — miroir EXACT de
 * workers/nesting/core/capacity.py (plan 2026-09-05 §1.2a), parité
 * chiffrée 1e-9 verrouillée par tests. Voir le docstring Python pour
 * le contexte (job infaisable à 4 mm livré « done » avec bande hors
 * tôle : le test d'aire NUE ignorait le gonflement Minkowski).
 */
import { simplifyRing } from './localPayloadBuilder'

export const REFUSE_RATIO = 0.88
export const REFERENCE_PACKING = 0.85
// Tôle importée : l'aire ne prédit pas le placement (le moteur pose un carré de
// 950 dans une tôle de 1000). On ne refuse que ce qui ne peut pas tenir du tout,
// avec une marge pour l'arrondi des aires de contour.
export const SHAPED_REFUSE_RATIO = 1.001
const EPS = 1e-9

function ringArea(coords) {
    let a = 0
    const n = coords.length
    for (let i = 0; i < n; i++) {
        const [x1, y1] = coords[i]
        const [x2, y2] = coords[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    }
    return Math.abs(a) / 2
}

function ringPerimeter(coords) {
    let p = 0
    const n = coords.length
    for (let i = 0; i < n; i++) {
        const [x1, y1] = coords[i]
        const [x2, y2] = coords[(i + 1) % n]
        p += Math.hypot(x2 - x1, y2 - y1)
    }
    return p
}

export function inflatedArea(part, space) {
    const s = Math.max(0, Number(space) || 0)
    // La page, en projet « cet appareil », n'a pas l'anneau : elle donne l'aire et le
    // périmètre du contour (mêmes nombres que ringArea/ringPerimeter) — même formule.
    const area = Number(part?.outlineAreaMm2)
    const perimeter = Number(part?.outlinePerimeterMm)
    if (Number.isFinite(area) && area > 0 && Number.isFinite(perimeter) && perimeter >= 0) {
        return area + perimeter * s / 2 + Math.PI * s * s / 4
    }
    const coords = (part && part.coords) || []
    if (coords.length < 3) return 0
    return ringArea(coords) + ringPerimeter(coords) * s / 2
        + Math.PI * s * s / 4
}

export function sheetUsableArea(width, height, space) {
    const s = Math.max(0, Number(space) || 0)
    return Math.max(0, (Number(width) - s) * (Number(height) - s))
}

/**
 * Aire utilisable d'un format, à l'espacement s. Rectangle : (L - s)(H - s),
 * inchangé. Tôle importée (`usableAreaMm2` + `perimeterMm` : contour moins
 * zones interdites, et la longueur de tous leurs bords) : même idée — chaque
 * bord perd s/2 de largeur de métal.
 */
function isShapedFormat(sh) {
    return sh != null && sh.usableAreaMm2 !== undefined && sh.usableAreaMm2 !== null
}

function formatUsableArea(sh, s, edge = null) {
    // Une tôle importée ne retombe JAMAIS sur sa boîte englobante : aire
    // utile nulle, négative ou non finie = aucune capacité.
    if (isShapedFormat(sh)) {
        const shaped = Number(sh.usableAreaMm2)
        if (!Number.isFinite(shaped) || shaped <= 0) return 0
        if (edge === null) return Math.max(0, shaped - (Number(sh?.perimeterMm) || 0) * s / 2)
        // Distance au bord : le CONTOUR perd e − s/2 de métal (pièce gonflée de
        // s/2, tenue à e du bord), les ZONES gardent s/2. Sans le partage
        // (forme sans zone, ou lue avant), tout le périmètre est celui du contour.
        const { outline, zones } = perimeterSplit(sh)
        return Math.max(0, shaped - outline * (edge - s / 2) - zones * (s / 2))
    }
    if (edge === null) return sheetUsableArea(sh?.width, sh?.height, s)
    return edgeRectUsableArea(sh?.width, sh?.height, s, edge)
}

/**
 * Distance au bord `e` (mm, convention INTERNE comme `space`) : la pièce gonflée
 * de s/2 doit tenir dans la tôle rétrécie de e − s/2 par côté, soit
 * (L − 2e + s)(H − 2e + s), borné à 0. e = s redonne (L − s)(H − s) ; e < 0
 * agrandit la surface (la pièce peut dépasser du bord).
 */
export function edgeRectUsableArea(width, height, space, edge) {
    const s = Math.max(0, Number(space) || 0)
    const e = Number(edge) || 0
    const a = Number(width) - 2 * e + s
    const b = Number(height) - 2 * e + s
    if (!(a > 0) || !(b > 0)) return 0
    return a * b
}

/** Périmètres du contour et des zones d'une tôle importée (mm). */
function perimeterSplit(sh) {
    const total = Number(sh?.perimeterMm) || 0
    const outlineRaw = Number(sh?.outlinePerimeterMm)
    const zonesRaw = Number(sh?.zonesPerimeterMm)
    if (Number.isFinite(outlineRaw) && outlineRaw >= 0) {
        const zones = Number.isFinite(zonesRaw) && zonesRaw >= 0 ? zonesRaw : Math.max(0, total - outlineRaw)
        return { outline: outlineRaw, zones }
    }
    if (Number.isFinite(zonesRaw) && zonesRaw >= 0) return { outline: Math.max(0, total - zonesRaw), zones: zonesRaw }
    return { outline: total, zones: 0 }
}

/** Distance au bord de `opts` (mm, interne), ou null : comportement d'avant. */
function edgeOption(opts) {
    const e = opts?.edge
    if (e === null || e === undefined || e === '') return null
    const n = Number(e)
    return Number.isFinite(n) ? n : null
}

function bboxGridCapacity(part, width, height, space, edge = null) {
    const coords = (part && part.coords) || []
    if (coords.length < 3) return 0
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity
    for (const [x, y] of coords) {
        if (x < minx) minx = x
        if (x > maxx) maxx = x
        if (y < miny) miny = y
        if (y > maxy) maxy = y
    }
    const w = maxx - minx
    const h = maxy - miny
    const s = Math.max(0, Number(space) || 0)
    const W = Number(width) || 0
    const H = Number(height) || 0
    // Z4 (vérif 2026-09-05) : conteneur déflaté de s/2 par côté (piège #49)
    // → floor(W/(w+s)) exact ; orientations 0° et 90° essayées.
    // Distance au bord e : n pièces de largeur w tiennent si
    // n·w + (n − 1)·s + 2e ≤ L, soit n = floor((L − 2e + s)/(w + s)).
    const spanW = edge === null ? W : W - 2 * edge + s
    const spanH = edge === null ? H : H - 2 * edge + s
    let best = 0
    for (const [bw, bh] of [[w, h], [h, w]]) {
        if (bw + s <= 0 || bh + s <= 0) continue
        const cols = Math.floor(spanW / (bw + s))
        const rows = Math.floor(spanH / (bh + s))
        best = Math.max(best, Math.max(0, cols) * Math.max(0, rows))
    }
    return best
}

// Miroit _constructive_fit : une instance qui tient par construction en
// grilles (bbox + space) est faisable — dérogation du garde #49 (le
// ratio statistique ne refuse jamais un carré 8×8 exact dans sa tôle).
function constructiveFit(parts, sheets, space, edge = null) {
    if (!parts?.length || !sheets?.length) return false
    // Une tôle importée n'est pas un rectangle : la grille de boîtes ne
    // prouve rien sur elle, elle ne compte ni en capacité ni en stock.
    const rect = sheets.filter((sh) => !isShapedFormat(sh))
    if (!rect.length) return false
    let sheetsNeeded = 0
    for (const p of parts) {
        const count = Math.trunc(Number(p?.count) || 0)
        if (count <= 0) continue
        let bestCap = 0
        for (const sh of rect) {
            bestCap = Math.max(bestCap, bboxGridCapacity(p, sh?.width, sh?.height, space, edge))
        }
        if (bestCap <= 0) return false
        sheetsNeeded += Math.ceil(count / bestCap)
    }
    const stock = rect.reduce(
        (n, sh) => n + (Math.trunc(Number(sh?.count) || 1)), 0)
    return sheetsNeeded <= stock
}

/**
 * « ≈ n tôles » d'un projet à tôle à quantité illimitée (ligne marquée
 * `unlimited`) : le stock est rempli d'abord, puis les tôles à prévoir sont
 * comptées. Même aire gonflée, même aire utile et même taux (REFERENCE_PACKING)
 * que `capacityReport`, qui ne change pas : seul `sheetsNeeded` est remplacé, et
 * ni le ratio, ni le refus, ni les leviers.
 *  - Le stock, la plus grande aire utile d'abord, tôle par tôle jusqu'à couvrir
 *    l'aire des pièces ;
 *  - le reste en tôles illimitées, à leur aire utile moyenne.
 * Estimation d'aires seulement. Elle ignore la forme des pièces et des tôles :
 * une pièce trop grande pour les chutes est comptée comme si elle les
 * remplissait, et le moteur peut laisser vide une tôle du stock.
 * @returns le rapport lui-même quand il n'y a rien à remplacer (aucune tôle
 *   illimitée, pas de rapport, aucune aire utile illimitée pour le reste).
 */
export function stockFirstEstimate(report, parts, sheets, space, opts = {}) {
    const open = (sheets || []).filter((sh) => sh?.unlimited === true)
    if (!report || !open.length) return report
    const s = Math.max(0, Number(space) || 0)
    const edge = edgeOption(opts)
    const filled = (sh) => formatUsableArea(sh, s, edge) * REFERENCE_PACKING
    let remaining = (parts || []).reduce(
        (sum, p) => sum + inflatedArea(p, s) * Math.trunc(Number(p?.count) || 0), 0)
    let used = 0
    const stock = sheets.filter((sh) => sh?.unlimited !== true)
        .map((sh) => ({ area: filled(sh), count: Math.trunc(Number(sh?.count) || 1) }))
        .filter((f) => f.area > 0)
        .sort((a, b) => b.area - a.area)
    for (const f of stock) {
        if (remaining <= EPS) break
        const n = Math.min(f.count, Math.ceil(remaining / f.area - EPS))
        used += n
        remaining -= n * f.area
    }
    if (remaining > EPS) {
        const areas = open.map(filled).filter((a) => a > 0)
        if (!areas.length) return report
        used += Math.ceil(remaining / (areas.reduce((a, b) => a + b, 0) / areas.length) - EPS)
    }
    return { ...report, sheetsNeeded: Math.max(1, used) }
}

/**
 * @param {object} [opts]
 * @param {number|null} [opts.edge] distance au bord (mm, convention INTERNE :
 *   demandée + marge de courbes, comme `space`). Absente / null : le bord suit
 *   l'espacement, chaque chiffre est celui d'avant. Donnée : aire utile et
 *   grille de boîtes la prennent pour les bords de la tôle, et la recherche de
 *   l'espacement maximal (`maxSpacingForFitMm`) garde le bord FIXE.
 */
export function capacityReport(parts, sheets, space, opts = {}) {
    const s = Math.max(0, Number(space) || 0)
    const edge = edgeOption(opts)
    let totalInflated = 0
    const counts = []
    for (const p of parts || []) {
        const c = Math.trunc(Number(p?.count) || 0)
        totalInflated += inflatedArea(p, s) * c
        counts.push(c)
    }
    let totalUsable = 0
    let stock = 0
    for (const sh of sheets || []) {
        const n = Math.trunc(Number(sh?.count) || 1)
        totalUsable += formatUsableArea(sh, s, edge) * n
        stock += n
    }
    if (totalInflated <= 0 || totalUsable <= 0) return null
    const ratio = totalInflated / totalUsable

    const sheetsNeeded = Math.max(1, Math.ceil(ratio * stock / REFERENCE_PACKING))

    let maxParts
    if (ratio > REFERENCE_PACKING) {
        const scale = (totalUsable * REFERENCE_PACKING) / totalInflated
        maxParts = {}
        counts.forEach((c, i) => { maxParts[i] = Math.floor(c * scale) })
    } else {
        maxParts = {}
        counts.forEach((c, i) => { maxParts[i] = c })
    }

    const rAt = (sp) => {
        let num = 0
        for (const p of parts || []) {
            num += inflatedArea(p, sp) * (Math.trunc(Number(p?.count) || 0))
        }
        let den = 0
        for (const sh of sheets || []) {
            den += formatUsableArea(sh, sp, edge)
                * (Math.trunc(Number(sh?.count) || 1))
        }
        return den > 0 ? num / den : Infinity
    }

    let maxSpacing = 0
    let lo = 0
    let hi = Math.max(0, s)
    if (rAt(0) <= REFERENCE_PACKING) {
        while (hi < 1000 && rAt(hi) <= REFERENCE_PACKING) {
            hi = hi > 0 ? hi * 2 : 1
        }
        for (let k = 0; k < 40; k++) {
            const mid = (lo + hi) / 2
            if (rAt(mid) <= REFERENCE_PACKING) lo = mid
            else hi = mid
        }
        maxSpacing = Math.round(lo * 100) / 100
    }

    const constructive = constructiveFit(parts, sheets, s, edge)
    // Au moins une tôle importée : le moteur tranche sous l'aire totale, le
    // résultat partiel existant couvre le reste. Rectangles seuls : inchangé
    // (parité avec capacity.py).
    const hasShaped = (sheets || []).some(isShapedFormat)
    const refused = hasShaped
        ? ratio > SHAPED_REFUSE_RATIO
        : ratio > REFUSE_RATIO && !constructive
    return {
        ratio: Math.round(ratio * 10000) / 10000,
        totalInflatedMm2: Math.round(totalInflated * 10) / 10,
        totalUsableMm2: Math.round(totalUsable * 10) / 10,
        sheetsNeeded,
        maxPartsAtSpacing: maxParts,
        maxSpacingForFitMm: maxSpacing,
        refused,
    }
}
