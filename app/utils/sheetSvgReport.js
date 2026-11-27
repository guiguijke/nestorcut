/**
 * Lecture des aperçus couleur d'une tôle (SVG produit par
 * workers/geometry/crates/nest-export/src/svg.rs, `build_colored_sheet_svg`)
 * pour le rapport PDF : PUR, sans DOM (analyse par expressions régulières, doit
 * tourner en node).
 *
 * Format lu : un `<rect>` de tôle, puis un `<path>` par pièce posée
 * (`d="M x y x y … Z M … Z"` : contour puis trous ; `transform="translate(tx ty)
 * scale(1 -1) rotate(deg)"` ; `fill="#RRGGBB"`). Pour une tôle importée,
 * `withSheetShapeSvg` (sheetDraw.js) ajoute le contour et les zones interdites
 * sous forme de `<path>` SANS `transform` : ce ne sont pas des pièces. Seul un
 * `<path>` portant `transform="translate(…"` est une pièce.
 */

const FALLBACK_COLOR = '#2563EB'
const UNIT_TO_MM = { mm: 1, cm: 10, in: 25.4, '': 1, px: 1 }

/**
 * Texte SVG d'une data URI `data:image/svg+xml[;charset=…][;base64],…`
 * (encodeURIComponent côté navigateur, voir `svgToDataUri`).
 * @param {unknown} src
 * @returns {string|null} null si ce n'est pas une data URI SVG lisible
 */
export function svgTextFromDataUri(src) {
    if (typeof src !== 'string') return null
    const m = /^data:image\/svg\+xml((?:;[^,]*)?),/i.exec(src)
    if (!m) return null
    const body = src.slice(m[0].length)
    try {
        if (/;base64/i.test(m[1])) {
            const bin = atob(body)
            const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
            return new TextDecoder().decode(bytes)
        }
        return decodeURIComponent(body)
    } catch {
        return null
    }
}

// ---- transformations --------------------------------------------------------

// Matrice [a, b, c, d, e, f] : x' = a x + c y + e ; y' = b x + d y + f.
const IDENTITY = [1, 0, 0, 1, 0, 0]

function mul(m, n) {
    return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ]
}

function numbers(s) {
    const out = s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
    return out ? out.map(Number) : []
}

/** `translate(..) scale(..) rotate(..)` (et `matrix`) → matrice, ou null si illisible. */
function parseTransform(text) {
    let m = IDENTITY
    const re = /(translate|scale|rotate|matrix)\s*\(([^)]*)\)/g
    let seen = false
    let t
    while ((t = re.exec(text))) {
        const v = numbers(t[2])
        let k = null
        if (t[1] === 'translate') k = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0]
        else if (t[1] === 'scale') k = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]
        else if (t[1] === 'matrix' && v.length === 6) k = v
        else if (t[1] === 'rotate') {
            const a = ((v[0] ?? 0) * Math.PI) / 180
            const c = Math.cos(a)
            const s = Math.sin(a)
            k = [c, s, -s, c, 0, 0]
            if (v.length >= 3) k = mul(mul([1, 0, 0, 1, v[1], v[2]], k), [1, 0, 0, 1, -v[1], -v[2]])
        }
        if (!k || k.some((x) => !Number.isFinite(x))) return null
        m = mul(m, k) // la transformation la plus à droite s'applique en premier
        seen = true
    }
    return seen ? m : null
}

// ---- chemin -----------------------------------------------------------------

/** `d` (M, L, H, V, Z absolus) → anneaux de points bruts, ou null si commande non gérée. */
function parsePathRings(d) {
    const tokens = d.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
    if (!tokens) return null
    const rings = []
    let cur = null
    let cmd = ''
    let nums = []
    let x = 0
    let y = 0
    const flush = () => {
        if (cmd === 'M' || cmd === 'L') {
            for (let i = 0; i + 1 < nums.length; i += 2) {
                x = nums[i]
                y = nums[i + 1]
                if (cmd === 'M' && i === 0) {
                    if (cur && cur.length) rings.push(cur)
                    cur = [[x, y]]
                } else {
                    if (!cur) cur = []
                    cur.push([x, y])
                }
            }
        } else if (cmd === 'H' || cmd === 'V') {
            for (const v of nums) {
                if (cmd === 'H') x = v
                else y = v
                if (!cur) cur = []
                cur.push([x, y])
            }
        }
        nums = []
    }
    for (const tk of tokens) {
        if (/[A-Za-z]/.test(tk)) {
            flush()
            const up = tk.toUpperCase()
            if (up === 'Z') {
                if (cur && cur.length) rings.push(cur)
                cur = null
                cmd = ''
            } else if (tk !== up || !'MLHV'.includes(up)) {
                return null // relatif ou courbe : hors du format produit
            } else {
                cmd = up
            }
        } else {
            nums.push(Number(tk))
        }
    }
    flush()
    if (cur && cur.length) rings.push(cur)
    return rings
}

function attr(tag, name) {
    const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(tag)
    return m ? m[1] : null
}

/**
 * Lit un SVG couleur de tôle.
 * @param {string} svgText
 * @returns {{ widthMm: number, heightMm: number,
 *   parts: { rings: number[][][], color: string }[] } | null}
 *   Coordonnées des anneaux APRÈS transformation, en mm, repère du SVG
 *   (origine en haut à gauche, y vers le bas) ; pièces dans l'ordre du fichier.
 *   null si le SVG est illisible (jamais d'exception).
 */
export function parseSheetSvg(svgText) {
    try {
        if (typeof svgText !== 'string') return null
        const root = /<svg\b[^>]*>/i.exec(svgText)
        if (!root) return null
        const wAttr = /^\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)\s*$/i.exec(attr(root[0], 'width') ?? '')
        const hAttr = /^\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)\s*$/i.exec(attr(root[0], 'height') ?? '')
        const vb = numbers(attr(root[0], 'viewBox') ?? '')
        if (!wAttr || !hAttr || vb.length !== 4 || !(vb[2] > 0) || !(vb[3] > 0)) return null
        const factor = UNIT_TO_MM[wAttr[2].toLowerCase()]
        if (factor === undefined) return null
        const widthMm = vb[2] * factor
        const heightMm = vb[3] * factor
        if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm)) return null

        const parts = []
        const re = /<path\b([^>]*)>/gi
        let m
        while ((m = re.exec(svgText))) {
            const tag = m[1]
            const tr = attr(tag, 'transform')
            if (!tr || !/translate\s*\(/.test(tr)) continue // contour de tôle ou zone interdite
            const d = attr(tag, 'd')
            const mat = parseTransform(tr)
            if (!d || !mat) continue
            const raw = parsePathRings(d)
            if (!raw) continue
            const rings = raw
                .filter((r) => r.length > 2)
                .map((r) => r.map(([x, y]) => [(mat[0] * x + mat[2] * y + mat[4]) * factor, (mat[1] * x + mat[3] * y + mat[5]) * factor]))
            if (!rings.length) continue
            const fill = attr(tag, 'fill')
            parts.push({ rings, color: fill && /^#[0-9a-fA-F]{6}$/.test(fill) ? fill.toUpperCase() : FALLBACK_COLOR })
        }
        return { widthMm, heightMm, parts }
    } catch {
        return null
    }
}

/**
 * Longueur de coupe et amorçages : périmètre de TOUS les anneaux (contours et
 * trous, fermés), un amorçage par anneau.
 * @param {{ rings: number[][][] }[]} parts
 * @returns {{ cutLengthMm: number, pierceCount: number }}
 */
export function cutStats(parts) {
    let cutLengthMm = 0
    let pierceCount = 0
    for (const p of parts || []) {
        for (const r of p.rings || []) {
            if (!r || r.length < 2) continue
            pierceCount += 1
            for (let i = 0; i < r.length; i++) {
                const a = r[i]
                const b = r[(i + 1) % r.length]
                cutLengthMm += Math.hypot(b[0] - a[0], b[1] - a[1])
            }
        }
    }
    return { cutLengthMm, pierceCount }
}

/** Boîte englobante de tous les anneaux, ou null si vide. */
export function ringsBox(rings) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const r of rings || []) {
        for (const [x, y] of r) {
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
        }
    }
    return minX === Infinity ? null : { minX, minY, maxX, maxY }
}

// Distance signée au contour (positive à l'intérieur, règle pair-impair sur tous les anneaux).
function signedDist(px, py, rings) {
    let inside = false
    let min = Infinity
    for (const r of rings) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
            const [ax, ay] = r[i]
            const [bx, by] = r[j]
            if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside
            let dx = bx - ax
            let dy = by - ay
            let t = 0
            const l2 = dx * dx + dy * dy
            if (l2 > 0) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
            dx = ax + t * dx - px
            dy = ay + t * dy - py
            const d2 = dx * dx + dy * dy
            if (d2 < min) min = d2
        }
    }
    const d = Math.sqrt(min)
    return inside ? d : -d
}

/**
 * Point le plus à l'intérieur de la matière (pôle d'inaccessibilité, méthode
 * « polylabel ») en tenant compte des trous. Précision ~1 % de la plus grande
 * dimension de la boîte. Repli : centre de la boîte.
 * @param {number[][][]} rings contour puis trous
 * @returns {[number, number]}
 */
export function labelPoint(rings) {
    const box = ringsBox(rings)
    if (!box) return [0, 0]
    const w = box.maxX - box.minX
    const h = box.maxY - box.minY
    const center = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2]
    const size = Math.min(w, h)
    if (!(size > 0)) return center
    const precision = Math.max(w, h) * 0.01
    const cell = (x, y, half) => {
        const d = signedDist(x, y, rings)
        return { x, y, half, d, max: d + half * Math.SQRT2 }
    }
    const queue = []
    let half = size / 2
    for (let x = box.minX; x < box.maxX; x += size) {
        for (let y = box.minY; y < box.maxY; y += size) queue.push(cell(x + half, y + half, half))
    }
    let best = cell(center[0], center[1], 0)
    for (const c of queue) if (c.d > best.d) best = c
    let guard = 0
    while (queue.length && guard++ < 20000) {
        // Extraction du plus prometteur (file petite : tri partiel suffisant).
        let bi = 0
        for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[bi].max) bi = i
        const c = queue[bi]
        queue[bi] = queue[queue.length - 1]
        queue.pop()
        if (c.d > best.d) best = c
        if (c.max - best.d <= precision) continue
        half = c.half / 2
        queue.push(cell(c.x - half, c.y - half, half), cell(c.x + half, c.y - half, half), cell(c.x - half, c.y + half, half), cell(c.x + half, c.y + half, half))
    }
    // Aucun point à l'intérieur (contour dégénéré) : centre de la boîte.
    return best.d > 0 ? [best.x, best.y] : center
}

/**
 * Numéros de repère des pièces, communs à toutes les tôles : même fichier =
 * même numéro, attribué par ordre de première apparition.
 * @param {(string[]|null)[]} sheetsSlugs par tôle : identifiant de fichier de
 *   chaque pièce posée (dans l'ordre des pièces), ou null si inconnu
 * @returns {{ refOf: Map<string, number>,
 *   perSheet: ({ ref: number, slug: string, count: number }[] | null)[] }}
 *   `perSheet[i]` : un élément par fichier distinct de la tôle, trié par
 *   numéro ; null si la tôle n'a pas de liste.
 */
export function buildPartRefs(sheetsSlugs) {
    const refOf = new Map()
    const perSheet = (sheetsSlugs || []).map((slugs) => {
        if (!Array.isArray(slugs)) return null
        const counts = new Map()
        for (const slug of slugs) {
            if (!refOf.has(slug)) refOf.set(slug, refOf.size + 1)
            counts.set(slug, (counts.get(slug) || 0) + 1)
        }
        return [...counts].map(([slug, count]) => ({ ref: refOf.get(slug), slug, count })).sort((a, b) => a.ref - b.ref)
    })
    return { refOf, perSheet }
}
