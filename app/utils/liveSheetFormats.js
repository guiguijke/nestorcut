/**
 * Déduction du FORMAT de chaque tôle dans une frame live.
 *
 * Pourquoi. Un job peut déclarer plusieurs formats de tôle (bins), certains
 * importés d'un DXF avec un vrai contour et des zones interdites. Pendant la
 * recherche, le moteur envoie des frames : une liste de pièces posées
 * `[partId, rang, rotationDeg, x, y]` où `rang` est l'indice d'une TÔLE de la
 * solution courante (0, 1, 2...), PAS l'indice de son format. La frame ne dit
 * pas quel format porte chaque tôle (le résultat final, lui, le sait). Le
 * moteur ouvre volontiers la plus petite tôle en premier : le rang 0 n'est
 * donc pas le format 0. Sans cette déduction, la vue live dessine des
 * rectangles dès que le job a deux formats.
 *
 * On ne touche pas au moteur : on déduit le format de chaque rang à partir des
 * seules pièces posées. Un rang « tient » dans un format si tous les points
 * échantillonnés de ses pièces sont dans le contour et hors des zones
 * interdites (tolérance 0,1 mm). Parmi les affectations compatibles avec les
 * stocks, on préfère : (1) le format de la frame précédente (stabilité),
 * (2) la plus petite aire utile, (3) le plus petit indice.
 *
 * Module d'AFFICHAGE : pur, sans import des composables, ne lève jamais
 * (toute entrée inattendue donne null). Les helpers géométriques sont copiés
 * (anneaux fermés, point dans anneau par lancer de rayon : piège 5c).
 */

const TOL = 0.1 // mm
const MAX_RING = 512 // sommets conservés pour les tests
const MAX_PER_PART = 16
const MAX_RANKS_BACKTRACK = 64
const MAX_RANK = 10000
const MAX_NODES = 20000
const BUCKETS = 64
const ZGRID = 16

/** Échantillonnage uniforme d'un anneau fermé, point de fermeture conservé. */
function decimate(ring) {
    if (ring.length <= MAX_RING) return ring
    const n = ring.length - 1
    const out = []
    for (let k = 0; k < MAX_RING - 1; k++) out.push(ring[Math.floor((k * n) / (MAX_RING - 1))])
    out.push(ring[ring.length - 1])
    return out
}

function validRing(r) {
    if (!Array.isArray(r) || r.length < 4) return false
    for (const p of r) {
        if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false
    }
    return true
}

function closed(r) {
    const a = r[0]; const b = r[r.length - 1]
    return a[0] === b[0] && a[1] === b[1] ? r : [...r, a]
}

function bboxOf(ring) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
    for (const [x, y] of ring) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
    }
    return [x0, y0, x1, y1]
}

function areaAbs(ring) {
    let a = 0
    for (let i = 0; i + 1 < ring.length; i++) {
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    }
    return Math.abs(a) / 2
}

/** Anneau indexé par tranches de y : le lancer de rayon ne voit que les
 *  arêtes de la tranche du point. */
function indexRing(raw) {
    const pts = decimate(closed(raw))
    const bb = bboxOf(pts)
    const h = (bb[3] - bb[1]) / BUCKETS || 1
    const buckets = Array.from({ length: BUCKETS }, () => [])
    for (let i = 0; i + 1 < pts.length; i++) {
        const ya = pts[i][1]; const yb = pts[i + 1][1]
        const lo = Math.max(0, Math.min(BUCKETS - 1, Math.floor((Math.min(ya, yb) - bb[1]) / h)))
        const hi = Math.max(0, Math.min(BUCKETS - 1, Math.floor((Math.max(ya, yb) - bb[1]) / h)))
        for (let b = lo; b <= hi; b++) buckets[b].push(i)
    }
    return { pts, bb, h, buckets }
}

function inRing(r, x, y) {
    const bb = r.bb
    if (y < bb[1] || y > bb[3] || x < bb[0] || x > bb[2]) return false
    const b = Math.max(0, Math.min(BUCKETS - 1, Math.floor((y - bb[1]) / r.h)))
    const pts = r.pts
    let inside = false
    for (const i of r.buckets[b]) {
        const xi = pts[i][0]; const yi = pts[i][1]
        const xj = pts[i + 1][0]; const yj = pts[i + 1][1]
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
}

/** Vrai si le point est à moins de TOL d'une arête de l'anneau. */
function nearRing(r, x, y) {
    const pts = r.pts
    const t2 = TOL * TOL
    for (let i = 0; i + 1 < pts.length; i++) {
        const ax = pts[i][0]; const ay = pts[i][1]
        const dx = pts[i + 1][0] - ax; const dy = pts[i + 1][1] - ay
        const l2 = dx * dx + dy * dy
        let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const ex = x - (ax + t * dx); const ey = y - (ay + t * dy)
        if (ex * ex + ey * ey <= t2) return true
    }
    return false
}

const _cache = new WeakMap()

function prepareFormats(bins) {
    let prep = _cache.get(bins)
    if (prep) return prep
    prep = bins.map((bin, index) => {
        const data = bin?.shape?.data
        const rawStock = Number(bin?.stock)
        const stock = Number.isFinite(rawStock) && rawStock >= 0 ? Math.floor(rawStock) : 1
        const out = { index, stock: bin?.stock == null ? 1 : stock, ok: false, w: 0, h: 0, area: 0 }
        if (!validRing(data?.outer)) return out
        const full = closed(data.outer)
        const bb = bboxOf(full)
        out.ok = true
        out.w = bb[2] - bb[0]
        out.h = bb[3] - bb[1]
        out.outer = indexRing(full)
        out.bb = bb
        const zones = []
        let zoneArea = 0
        for (const z of Array.isArray(data.inner) ? data.inner : []) {
            if (!validRing(z)) continue
            const zr = indexRing(z)
            zones.push(zr)
            zoneArea += areaAbs(closed(z))
        }
        out.zones = zones
        out.area = Math.max(0, areaAbs(full) - zoneArea)
        // Grille des zones : chaque cellule liste les zones dont la boîte la touche.
        if (zones.length) {
            const gw = (bb[2] - bb[0]) / ZGRID || 1
            const gh = (bb[3] - bb[1]) / ZGRID || 1
            const cells = Array.from({ length: ZGRID * ZGRID }, () => [])
            const cl = (v) => Math.max(0, Math.min(ZGRID - 1, v))
            zones.forEach((z, zi) => {
                const cx0 = cl(Math.floor((z.bb[0] - TOL - bb[0]) / gw))
                const cx1 = cl(Math.floor((z.bb[2] + TOL - bb[0]) / gw))
                const cy0 = cl(Math.floor((z.bb[1] - TOL - bb[1]) / gh))
                const cy1 = cl(Math.floor((z.bb[3] + TOL - bb[1]) / gh))
                for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) cells[cy * ZGRID + cx].push(zi)
            })
            out.grid = { cells, gw, gh }
        }
        return out
    })
    _cache.set(bins, prep)
    return prep
}

/** Anneau posé : rotation (degrés) autour de l'origine de la pièce, puis translation. */
function placeRing(coords, rotDeg, tx, ty) {
    const r = (rotDeg * Math.PI) / 180
    const c = Math.cos(r); const s = Math.sin(r)
    return coords.map(([x, y]) => [c * x - s * y + tx, s * x + c * y + ty])
}

function ringContains(ring, x, y) {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0]; const yi = ring[i][1]
        const xj = ring[j][0]; const yj = ring[j][1]
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
}

/** Points échantillonnés d'une pièce posée (+ boîte), ou null. */
function samplePart(part, rotDeg, x, y) {
    const coords = part?.coords ?? part?.coordinates
    if (!validRing(coords)) return null
    const placed = placeRing(closed(coords), rotDeg, x, y)
    const bb = bboxOf(placed)
    const n = placed.length - 1
    const pts = []
    const k = Math.min(n, MAX_PER_PART)
    for (let i = 0; i < k; i++) pts.push(placed[Math.floor((i * n) / k)])
    const cx = (bb[0] + bb[2]) / 2; const cy = (bb[1] + bb[3]) / 2
    if (ringContains(placed, cx, cy)) pts.push([cx, cy])
    return { pts, bb }
}

function fits(fmt, rank) {
    if (!fmt.ok || !rank.pts.length) return false
    const f = fmt.bb; const b = rank.bb
    if (b[0] < f[0] - TOL || b[1] < f[1] - TOL || b[2] > f[2] + TOL || b[3] > f[3] + TOL) return false
    const grid = fmt.grid
    for (const [x, y] of rank.pts) {
        if (!inRing(fmt.outer, x, y) && !nearRing(fmt.outer, x, y)) return false
        if (grid) {
            const cx = Math.floor((x - f[0]) / grid.gw); const cy = Math.floor((y - f[1]) / grid.gh)
            const ccx = Math.max(0, Math.min(ZGRID - 1, cx)); const ccy = Math.max(0, Math.min(ZGRID - 1, cy))
            for (const zi of grid.cells[ccy * ZGRID + ccx]) {
                const z = fmt.zones[zi]
                if (inRing(z, x, y) && !nearRing(z, x, y)) return false
            }
        }
    }
    return true
}

/**
 * @param {{bins: Array, items: Array, parts: Array, hint?: number[]}} args
 * @returns {{binFormats: number[], sheets: number[][]} | null}
 */
export function inferLiveFormats({ bins, items, parts, hint } = {}) {
    try {
        if (!Array.isArray(bins) || bins.length < 2 || !Array.isArray(items) || !items.length) return null
        const byId = new Map()
        for (const p of Array.isArray(parts) ? parts : []) if (p && p.id != null) byId.set(String(p.id), p)
        const formats = prepareFormats(bins)

        const ranks = new Map() // rang -> { pts, bb }
        let maxRank = -1
        for (const it of items) {
            if (!Array.isArray(it) || it.length < 5) continue
            const rank = it[1]
            const rot = Number(it[2]); const x = Number(it[3]); const y = Number(it[4])
            if (!Number.isInteger(rank) || rank < 0 || rank > MAX_RANK) continue
            if (!Number.isFinite(rot) || !Number.isFinite(x) || !Number.isFinite(y)) continue
            const part = byId.get(String(it[0]))
            if (!part) continue
            const s = samplePart(part, rot, x, y)
            if (!s) continue
            let r = ranks.get(rank)
            if (!r) { r = { pts: [], bb: [Infinity, Infinity, -Infinity, -Infinity] }; ranks.set(rank, r) }
            for (const p of s.pts) r.pts.push(p)
            r.bb = [Math.min(r.bb[0], s.bb[0]), Math.min(r.bb[1], s.bb[1]), Math.max(r.bb[2], s.bb[2]), Math.max(r.bb[3], s.bb[3])]
            if (rank > maxRank) maxRank = rank
        }
        if (maxRank < 0) return null

        const nb = bins.length
        const legacy = (rank) => {
            const f = formats[Math.min(rank, nb - 1)]
            return [f.w, f.h]
        }
        // Ordre de préférence global : plus petite aire utile, puis indice.
        const byArea = formats.filter((f) => f.ok).sort((a, b) => a.area - b.area || a.index - b.index)
        const fitMemo = new Map()
        const fitsMemo = (rank, fi) => {
            const k = rank * nb + fi
            let v = fitMemo.get(k)
            if (v === undefined) { v = fits(formats[fi], ranks.get(rank)); fitMemo.set(k, v) }
            return v
        }
        const orderFor = (rank) => {
            const h = Array.isArray(hint) ? hint[rank] : undefined
            const order = []
            if (Number.isInteger(h) && h >= 0 && h < nb && formats[h].ok) order.push(h)
            for (const f of byArea) if (f.index !== order[0]) order.push(f.index)
            return order
        }

        const present = [...ranks.keys()].sort((a, b) => a - b)
        const assign = new Array(maxRank + 1).fill(-1)
        let done = false
        if (present.length <= MAX_RANKS_BACKTRACK) {
            const used = new Array(nb).fill(0)
            let nodes = 0
            const dfs = (k) => {
                if (k === present.length) return true
                if (++nodes > MAX_NODES) return false
                const rank = present[k]
                const cands = orderFor(rank).filter((fi) => fitsMemo(rank, fi))
                if (!cands.length) { assign[rank] = -1; return dfs(k + 1) }
                for (const fi of cands) {
                    if (used[fi] >= formats[fi].stock) continue
                    used[fi]++; assign[rank] = fi
                    if (dfs(k + 1)) return true
                    used[fi]--
                }
                assign[rank] = -1
                return false
            }
            done = dfs(0)
        }
        if (!done) {
            for (const rank of present) {
                assign[rank] = orderFor(rank).find((fi) => fitsMemo(rank, fi)) ?? -1
            }
        }

        const binFormats = []
        const sheets = []
        for (let r = 0; r <= maxRank; r++) {
            const fi = ranks.has(r) ? assign[r] : -1
            binFormats.push(fi)
            sheets.push(fi >= 0 ? [formats[fi].w, formats[fi].h] : legacy(r))
        }
        return { binFormats, sheets }
    } catch {
        return null
    }
}

/**
 * Champs à ajouter à une frame live d'un job à tôle importée et à PLUSIEURS
 * formats : `binFormats` (format de chaque rang) et `sheets` (boîte de chaque
 * rang), les mêmes que sur la frame finale — la vue dessine alors chaque tôle
 * avec SA forme dès les premières frames. `{}` pour tout autre job (un seul
 * format, ou aucune tôle importée) : la frame reste celle d'avant.
 * `hints` : Map walk -> dernier choix, pour qu'il ne saute pas d'une frame à
 * l'autre ; elle est mise à jour ici.
 */
export function liveFormatFields(payload, items, hints = null, worker = 0) {
    const shaped = payload?.shapedSheets
    const bins = payload?.instance?.bins
    if (!Array.isArray(shaped) || !shaped.length || !Array.isArray(bins) || bins.length < 2) return {}
    const inferred = inferLiveFormats({
        bins,
        items,
        parts: payload?.parts,
        hint: hints?.get?.(worker),
    })
    if (!inferred) return {}
    hints?.set?.(worker, inferred.binFormats)
    return { binFormats: inferred.binFormats, sheets: inferred.sheets }
}
