/**
 * Positions des pièces posées : liste simple (fichier, X, Y, diamètre) d'une
 * tôle, et son CSV. Fichier PUR (aucune E/S, aucun DOM, aucun Nuxt) : il tourne
 * dans le Worker de finalisation comme dans le navigateur et se teste en node.
 *
 * Tout reste dans le navigateur : ces lignes vivent dans le record IndexedDB
 * d'un calcul « Cet appareil » et n'en sortent que par le CSV que l'utilisateur
 * télécharge. Rien ne part au serveur.
 *
 * Unités : les lignes sont en MILLIMÈTRES, origine = coin bas-gauche de la boîte
 * de la tôle (l'origine du fichier livré), y vers le haut. Le CSV convertit.
 */
import { partShape, shapeCentreAt } from './dxfEntities.js'

/** Une cellule CSV : guillemets seulement si la valeur contient `"`, `,` ou un
 * saut de ligne (CR compris) (même règle que l'export du rapport, dont elle est issue). */
export const csvCell = (v) => {
    const s = String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Un nom de fichier qui commence comme une formule serait EXÉCUTÉ par un
 * tableur à l'ouverture : on le précède d'une apostrophe (OWASP, injection de
 * formule CSV). Réservé aux noms ; les nombres ne sont jamais touchés. */
export const safeNameCell = (name) => {
    const s = String(name ?? '')
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
}

const TWO_PI_DEG = 360

// Anneau d'un CONTOUR DE TÔLE importé (sheetCentre seulement : les PIÈCES, elles,
// se mesurent sur leurs entités, voir dxfEntities.js) : au moins 16 sommets tous
// à max(0,05 mm ; 0,1 %) du rayon moyen, sans trou angulaire de plus de 45° et
// couvrant au moins 95 % du disque.
const ROUND_MIN_VERTICES = 16
const ROUND_ABS_TOL_MM = 0.05
const ROUND_REL_TOL = 0.001
const ROUND_MAX_GAP_RAD = Math.PI / 4
const ROUND_MIN_AREA_RATIO = 0.95
// Tôle ronde : écart admis entre le centre du cercle et celui de la boîte, au
// moins ce plancher (voir sheetCentre).
const SHEET_CENTRE_TOL_MM = 0.02

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** Anneau sans son point de fermeture répété ; null si inutilisable. */
function openRing(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return null
    const pts = []
    for (const p of ring) {
        if (!Array.isArray(p) || !finite(p[0]) || !finite(p[1])) return null
        pts.push([p[0], p[1]])
    }
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (pts.length > 3 && a[0] === b[0] && a[1] === b[1]) pts.pop()
    return pts.length >= 3 ? pts : null
}

/** Cercle qui passe au plus près des sommets (moindres carrés algébriques,
 * Kåsa) puis test de rondeur ; null si l'anneau n'est pas un disque. Exact pour
 * des sommets posés sur un cercle, quelle que soit leur répartition. */
function roundShape(pts) {
    if (pts.length < ROUND_MIN_VERTICES) return null
    // Sommets distincts : un anneau qui répète un sommet ne compte pas double.
    const seen = new Set(pts.map((p) => `${p[0]},${p[1]}`))
    if (seen.size < ROUND_MIN_VERTICES) return null
    const n = pts.length
    let mx = 0
    let my = 0
    for (const p of pts) { mx += p[0]; my += p[1] }
    mx /= n
    my /= n
    let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0
    for (const p of pts) {
        const u = p[0] - mx
        const v = p[1] - my
        suu += u * u; suv += u * v; svv += v * v
        suuu += u * u * u; svvv += v * v * v
        suvv += u * v * v; svuu += v * u * u
    }
    const det = suu * svv - suv * suv
    if (!(Math.abs(det) > 1e-12 * (suu * svv || 1))) return null
    const b1 = (suuu + suvv) / 2
    const b2 = (svvv + svuu) / 2
    const uc = (b1 * svv - b2 * suv) / det
    const vc = (suu * b2 - suv * b1) / det
    const cx = mx + uc
    const cy = my + vc
    if (!finite(cx) || !finite(cy)) return null
    let r = 0
    const radii = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy))
    for (const d of radii) r += d
    r /= n
    if (!(r > 0)) return null
    const tol = Math.max(ROUND_ABS_TOL_MM, ROUND_REL_TOL * r)
    if (radii.some((d) => Math.abs(d - r) > tol)) return null
    // Répartition angulaire : plus grand écart entre deux sommets voisins.
    const angles = pts.map((p) => Math.atan2(p[1] - cy, p[0] - cx)).sort((a, b) => a - b)
    let gap = angles[0] + 2 * Math.PI - angles[n - 1]
    for (let i = 1; i < n; i++) gap = Math.max(gap, angles[i] - angles[i - 1])
    if (gap > ROUND_MAX_GAP_RAD) return null
    // Flèche du polygone : ce que son écart angulaire MÉDIAN explique (un disque
    // tessellé grossièrement a une boîte décentrée d'autant).
    const gaps = []
    for (let i = 1; i < n; i++) gaps.push(angles[i] - angles[i - 1])
    gaps.push(angles[0] + 2 * Math.PI - angles[n - 1])
    gaps.sort((u, v) => u - v)
    const median = gaps[Math.floor(gaps.length / 2)]
    // Aire du polygone (formule des lacets) contre celle du disque.
    let a2 = 0
    for (let i = 0; i < n; i++) {
        const p = pts[i]
        const q = pts[(i + 1) % n]
        a2 += p[0] * q[1] - q[0] * p[1]
    }
    if (Math.abs(a2) / 2 < ROUND_MIN_AREA_RATIO * Math.PI * r * r) return null
    return { cx, cy, r, sag: r * (1 - Math.cos(median / 2)) }
}

/**
 * Centre d'une tôle (mm, repère du fichier : coin bas-gauche de sa boîte), celui
 * que « Centre de la tôle » met en (0, 0). Tôle RONDE (contour importé d'un
 * disque) : le vrai centre du cercle. Le lecteur décrit un disque par un polygone
 * à nombre de côtés souvent IMPAIR, dont la boîte n'est pas centrée sur le cercle
 * (jusqu'à 0,005 mm). Toute autre tôle (disque à méplat compris), ou contour
 * illisible : centre de la boîte, celui du repère dessiné à l'écran.
 */
export function sheetCentre(box, outline = null) {
    const centre = [box[0] / 2, box[1] / 2]
    const ring = openRing(outline)
    const round = ring ? roundShape(ring) : null
    // Tolérance : la flèche que le polygone explique (médiane des écarts), au
    // moins SHEET_CENTRE_TOL_MM. Un disque lu avec l'interrupteur « pouces » est
    // tessellé à 0,25 mm : sa boîte est décentrée de plus de 0,02 mm, pas du
    // cercle. Un méplat décentre de bien plus : il garde le centre de la boîte.
    const tol = round ? Math.max(SHEET_CENTRE_TOL_MM, round.sag) : 0
    if (!round || Math.hypot(round.cx - centre[0], round.cy - centre[1]) > tol) return centre
    return [round.cx, round.cy]
}

/** Le centre GARDÉ d'une tôle (`center`), sinon celui de sa boîte ; null si rien
 * n'est lisible. Le DXF recentré et le CSV lisent la même fonction. */
export function storedCentre(center, box) {
    if (Array.isArray(center) && finite(center[0]) && finite(center[1])) return [center[0], center[1]]
    if (Array.isArray(box) && finite(box[0]) && finite(box[1])) return [box[0] / 2, box[1] / 2]
    return null
}

/** Angle en degrés dans [0, 360) : 360 et -0 donnent 0, le bruit de la
 * conversion radians-degrés (89,99999999999999) est arrondi. */
function degreesOf(angle) {
    let deg = (angle * 180) / Math.PI
    deg = Math.round(deg * 1e9) / 1e9
    deg = ((deg % TWO_PI_DEG) + TWO_PI_DEG) % TWO_PI_DEG
    if (deg >= TWO_PI_DEG || deg === 0) deg = 0
    return deg
}

/** Forme d'une pièce (jeu de poignées) : mesurée UNE fois par (source, poignées),
 * mémoire portée par l'index d'entités. null si une poignée ou l'enveloppe de
 * l'anneau d'origine manque, ou si la forme est ambiguë (voir partShape). */
function shapeOf(entityIndex, slug, handles, hull) {
    if (!Array.isArray(handles) || !handles.length || !Array.isArray(hull)) return null
    const cache = entityIndex.cache || (entityIndex.cache = new Map())
    const key = `${slug}|${handles.join(',')}`
    if (cache.has(key)) return cache.get(key)
    let shape = null
    const index = entityIndex(slug)
    if (index) {
        const entities = []
        let missing = false
        for (const h of handles) {
            const found = index.get(String(h))
            if (!found) { missing = true; break }
            entities.push(...found)
        }
        if (!missing) shape = partShape(entities, hull)
    }
    cache.set(key, shape)
    return shape
}

/**
 * Lignes de positions d'UNE tôle, une par pièce posée (un bloc « E4-a » donne
 * une ligne par pièce du dessin, chacune avec SES poignées et SON enveloppe ;
 * les pièces rangées dans un trou sont déjà des poses à part dans `transforms`),
 * dans l'ordre de `container.transforms`.
 *
 * Mesure sur les ENTITÉS RÉELLES de la source (celles que l'écrivain DXF livre,
 * par poignée, sous R·p + t) : jamais sur les anneaux du payload, simplifiés,
 * cordés (arcs de polyligne) ou élargis (réserve d'amorce SheetCam). Ce qu'est la
 * pièce vient de l'enveloppe de son anneau d'origine (`ringHull`) ; ses entités
 * l'affinent (dxfEntities.partShape) : axes, cotes et arête voisine ne comptent pas.
 *  - contour extérieur = UN cercle entier : x, y, d exacts, rot null ;
 *  - sinon : x, y = centre de la boîte EXACTE de la pièce posée (arcs et courbes
 *    compris), d null, rot en degrés.
 * x, y sont donc le CENTRE de chaque pièce ; pour une pièce non ronde, le centre
 * du rectangle qui l'entoure tel qu'elle est posée.
 *
 * @param {object}   container  { bin_width, bin_height, transforms:[{item_id,
 *                              file_slug, handles, angle (radians), x, y}] }
 * @param {Map}      partsById  id (chaîne) -> pièce { handles, ringHull, blockParts? }
 * @param {Function} entityIndex slug -> index d'entités (entityIndexOf) | null
 * @returns {Array|null} [{ fileSlug, x, y, d, rot }] en mm ; `null` pour TOUTE
 *   la tôle dès qu'une pose, une source, une poignée, une enveloppe d'anneau ou
 *   une forme n'est pas lisible : jamais un nombre deviné.
 */
export function sheetPositions(container, partsById, entityIndex) {
    try {
        if (!container || !Array.isArray(container.transforms)) return null
        if (!finite(container.bin_width) || !finite(container.bin_height)) return null
        const rows = []
        for (const t of container.transforms) {
            const angle = Number(t?.angle)
            const x = Number(t?.x)
            const y = Number(t?.y)
            if (!finite(angle) || !finite(x) || !finite(y)) return null
            const part = partsById?.get?.(String(t.item_id))
            if (!part) return null
            const fileSlug = String(t.file_slug || '')
            // Un bloc : une ligne par pièce ; sans poignées ni enveloppe par pièce, le
            // dessin ne se décompose pas (null).
            const sets = part.blockParts?.length
                ? part.blockParts.map((bp) => ({ handles: bp?.handles, hull: bp?.ringHull }))
                : [{ handles: t.handles?.length ? t.handles : part.handles, hull: part.ringHull }]
            const c = Math.cos(angle)
            const s = Math.sin(angle)
            for (const set of sets) {
                const shape = shapeOf(entityIndex, fileSlug, set.handles, set.hull)
                if (!shape) return null
                if (shape.round) {
                    const { cx, cy, d } = shape.round
                    rows.push({ fileSlug, x: c * cx - s * cy + x, y: s * cx + c * cy + y, d, rot: null })
                } else {
                    const ct = shapeCentreAt(shape, angle)
                    if (!ct) return null
                    rows.push({ fileSlug, x: ct[0] + x, y: ct[1] + y, d: null, rot: degreesOf(angle) })
                }
            }
        }
        return rows.every((r) => finite(r.x) && finite(r.y)) ? rows : null
    } catch {
        return null
    }
}

/** Décimales fixes, jamais « -0.0000 », jamais d'exposant. */
export function fixedDecimals(v, decimals) {
    let s
    if (Math.abs(v) < 1e21) {
        s = v.toFixed(decimals)
    } else {
        // toFixed passe en notation scientifique au-delà de 1e21.
        s = BigInt(Math.round(v)).toString() + (decimals > 0 ? `.${'0'.repeat(decimals)}` : '')
    }
    return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s
}

const MM_PER_INCH = 25.4
const DEFAULT_HEADERS = { sheet: 'Sheet', part: 'Part', x: 'X', y: 'Y', diameter: 'Diameter', rotation: 'Rotation' }

/**
 * CSV des positions : BOM, CRLF, séparateur virgule, point décimal.
 * Colonnes : Tôle, Pièce, X (unité), Y (unité), Diamètre (unité), Rotation (deg).
 *
 * @param {object}   args
 * @param {Array}    args.sheets   [{ sheet, box: [w, h] (mm), center?, rows }]
 * @param {string}   args.origin   'corner' (coin bas-gauche, défaut) | 'center'
 *                                 (centre DE CETTE TÔLE, voir `sheetCentre`)
 * @param {string}   args.unit     'mm' (4 décimales) | 'inch' (5 décimales) :
 *                                 l'unité du DXF livré, pas celle de l'écran
 * @param {Function} args.nameOf   slug du fichier -> nom affiché (repli : le slug)
 * @param {object}   args.headers  { sheet, part, x, y, diameter, rotation }
 */
export function positionsCsv({ sheets, origin = 'corner', unit = 'mm', nameOf, headers = DEFAULT_HEADERS }) {
    const inch = unit === 'inch'
    const decimals = inch ? 5 : 4
    const u = inch ? 'in' : 'mm'
    const conv = (mm) => fixedDecimals(inch ? mm / MM_PER_INCH : mm, decimals)
    const head = [
        headers.sheet,
        headers.part,
        `${headers.x} (${u})`,
        `${headers.y} (${u})`,
        `${headers.diameter} (${u})`,
        `${headers.rotation} (deg)`,
    ]
    const lines = [head.map(csvCell).join(',')]
    for (const sh of sheets || []) {
        const [dx, dy] = origin === 'center' ? (storedCentre(sh.center, sh.box) || [0, 0]) : [0, 0]
        for (const r of sh.rows || []) {
            const name = (typeof nameOf === 'function' ? nameOf(r.fileSlug) : null) || r.fileSlug
            lines.push([
                csvCell(sh.sheet),
                csvCell(safeNameCell(name)),
                conv(r.x - dx),
                conv(r.y - dy),
                r.d == null ? '' : conv(r.d),
                r.rot == null ? '' : fixedDecimals(r.rot, 4),
            ].join(','))
        }
    }
    // BOM : Excel lit l'UTF-8 (accents des noms de fichiers) correctement.
    return '\uFEFF' + lines.join('\r\n')
}
