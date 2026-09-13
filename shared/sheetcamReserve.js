/**
 * Réserve d'amorce et disque de perçage — lot J3 de
 * `docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §8, mise en œuvre du chantier 3.5
 * du masterplan (« réserve d'amorce + point de départ, le pont CAM »).
 *
 * ---------------------------------------------------------------------------
 * LE PROBLÈME, tel que le masterplan le pose : le CAM ajoute une amorce de
 * 3 à 6 mm HORS contour, et perce avant de couper. Si la pièce voisine est à
 * 2 mm, l'amorce et le trou de perçage tombent dedans. Le `.job` nous donne
 * la LONGUEUR et le TYPE de l'amorce, plus le coin de départ — pas sa
 * géométrie, que SheetCam dessine au G-code (§7 de l'étude). On la PRÉDIT
 * donc, et on réserve la place.
 *
 * LA FORME DU CORRECTIF est celle qu'impose le masterplan §3.5 : pas d'anneau
 * d'inflation complet (il tuerait la densité), mais un **appendice
 * d'exclusion LOCAL** au point de départ, soudé au contour. L'algorithme de
 * nesting ne change pas : il reçoit un polygone quelconque, comme toujours.
 *
 * Et l'appendice ne sort QUE pour le nesting : l'export garde le contour
 * réel — pour un job issu d'un `.job`, c'est SheetCam qui trace l'amorce
 * avec ses propres réglages, nous ne faisons que lui garder la place.
 *
 * Ce module est de la géométrie pure : aucune dépendance, un seul code pour
 * le navigateur et le serveur.
 */

/** Rayon du disque de perçage, en millimètres. Défaut à confirmer sur la
 *  machine du propriétaire (plasma : le trou de perçage est plus large que
 *  le kerf, et il n'est pas modélisé par SheetCam — §7 de l'étude). */
export const DEFAULT_PIERCE_MARGIN_MM = 3

/** Côtés du polygone qui approche le disque de perçage. 32 comme le repli de
 *  gonflement du lot E0, et CIRCONSCRIT : on ne promet jamais moins de marge
 *  que demandé. */
const PIERCE_DISC_SIDES = 32

/** Sécurité par défaut de chaque côté du kerf, en millimètres. */
export const DEFAULT_KERF_SAFETY_MM = 0.25

/**
 * Espacement pré-rempli depuis le kerf de l'outil : `kerf + 2 × sécurité`.
 *
 * C'est la règle 3.10 déjà en production (deux champs, kerf et sécurité) —
 * ici on ne fait que lire le kerf dans le `.job` au lieu de le demander.
 * Rend `null` si le `.job` ne porte pas de kerf exploitable : on ne remplit
 * pas un champ avec une valeur inventée.
 */
export function spacingFromKerf(kerfWidth, safetyMm = DEFAULT_KERF_SAFETY_MM) {
    // `Number(null)`, `Number('')` et `Number(undefined ?? '')` valent 0 ou
    // NaN selon le cas : un champ ABSENT n'est pas un kerf de zero, et
    // remplir « 0,5 mm » a partir de rien serait une valeur inventee.
    const raw = typeof kerfWidth === 'number' ? kerfWidth
        : (typeof kerfWidth === 'string' && kerfWidth.trim() !== ''
            ? Number(kerfWidth) : NaN)
    const safety = typeof safetyMm === 'number' ? safetyMm : Number(safetyMm)
    if (!Number.isFinite(raw) || raw < 0) return null
    if (!Number.isFinite(safety) || safety < 0) return null
    return raw + 2 * safety
}

// --- petites briques géométriques -----------------------------------------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1]]
const mul = (a, k) => [a[0] * k, a[1] * k]
const cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const norm = (a) => Math.hypot(a[0], a[1])

function unit(a) {
    const n = norm(a)
    return n > 0 ? [a[0] / n, a[1] / n] : [0, 0]
}

/** Anneau fermé sans point de fermeture dupliqué. */
function openRing(ring) {
    const out = ring.slice()
    while (out.length > 1
        && out[0][0] === out[out.length - 1][0]
        && out[0][1] === out[out.length - 1][1]) {
        out.pop()
    }
    return out
}

/** Aire signée : > 0 = sens trigonométrique. */
export function signedArea(ring) {
    const r = openRing(ring)
    let a = 0
    for (let i = 0; i < r.length; i++) {
        const p = r[i]
        const q = r[(i + 1) % r.length]
        a += p[0] * q[1] - q[0] * p[1]
    }
    return a / 2
}

/** Point strictement dans l'anneau (lancer de rayon, impair = dedans). */
export function pointInRing(p, ring) {
    const r = openRing(ring)
    let inside = false
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i]
        const b = r[j]
        if ((a[1] > p[1]) !== (b[1] > p[1])
            && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
            inside = !inside
        }
    }
    return inside
}

/** Les deux segments se croisent-ils PROPREMENT (hors extrémités) ? */
function segmentsCrossProperly(a1, a2, b1, b2) {
    const d1 = cross(sub(a2, a1), sub(b1, a1))
    const d2 = cross(sub(a2, a1), sub(b2, a1))
    const d3 = cross(sub(b2, b1), sub(a1, b1))
    const d4 = cross(sub(b2, b1), sub(a2, b1))
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
        && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Enveloppe convexe (Andrew monotone chain), déterministe. */
export function convexHull(points) {
    const pts = points
        .map((p) => [Number(p[0]), Number(p[1])])
        .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .sort((u, v) => (u[0] - v[0]) || (u[1] - v[1]))
    if (pts.length < 3) return pts
    const half = (list) => {
        const out = []
        for (const p of list) {
            while (out.length >= 2
                && cross(sub(out[out.length - 1], out[out.length - 2]),
                    sub(p, out[out.length - 2])) <= 0) {
                out.pop()
            }
            out.push(p)
        }
        return out
    }
    const lower = half(pts)
    const upper = half(pts.slice().reverse())
    return lower.slice(0, -1).concat(upper.slice(0, -1))
}

// --- le point de départ ----------------------------------------------------

/**
 * Coin de la boîte englobante désigné par `Start position` de SheetCam.
 *
 * **Correspondance à confirmer sur la machine du propriétaire** : le `.job`
 * porte un entier (0 sur la fixture) et l'étude n'a pas mesuré la
 * sémantique. La table ci-dessous est l'ordre naturel de SheetCam (bas
 * gauche, bas droite, haut droite, haut gauche) ; un `Start position`
 * inconnu retombe sur la règle par DÉFAUT du masterplan §3.5 (début de la
 * plus longue arête droite), qui ne dépend d'aucune convention.
 */
export const START_CORNERS = ['bottom-left', 'bottom-right', 'top-right', 'top-left']

function bbox(ring) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of ring) {
        if (p[0] < minX) minX = p[0]
        if (p[0] > maxX) maxX = p[0]
        if (p[1] < minY) minY = p[1]
        if (p[1] > maxY) maxY = p[1]
    }
    return { minX, minY, maxX, maxY }
}

/**
 * Index du sommet où l'amorce est prédite.
 *
 * `startPosition` connu ⇒ le sommet le plus proche du coin désigné (à
 * distance égale, le plus petit index : déterminisme). Sinon ⇒ le début de
 * la plus longue arête droite (règle par défaut du masterplan §3.5).
 */
export function predictedStartIndex(ring, startPosition = null) {
    const r = openRing(ring)
    if (r.length < 3) return 0
    const corner = START_CORNERS[Number(startPosition)] || null
    if (corner) {
        const { minX, minY, maxX, maxY } = bbox(r)
        const target = [
            corner.endsWith('left') ? minX : maxX,
            corner.startsWith('bottom') ? minY : maxY,
        ]
        let best = 0
        let bestD = Infinity
        for (let i = 0; i < r.length; i++) {
            const d = norm(sub(r[i], target))
            if (d < bestD - 1e-12) {
                bestD = d
                best = i
            }
        }
        return best
    }
    let best = 0
    let bestLen = -1
    for (let i = 0; i < r.length; i++) {
        const len = norm(sub(r[(i + 1) % r.length], r[i]))
        if (len > bestLen + 1e-12) {
            bestLen = len
            best = i
        }
    }
    return best
}

/** Direction SORTANTE au sommet `i` : la bissectrice extérieure, orientée
 *  par un test d'appartenance (l'orientation de l'anneau ne suffit pas —
 *  un sommet réflexe inverse la bissectrice). */
export function outwardAt(ring, index) {
    const r = openRing(ring)
    const n = r.length
    const p = r[index % n]
    const prev = r[(index - 1 + n) % n]
    const next = r[(index + 1) % n]
    const a = unit(sub(p, prev))
    const b = unit(sub(next, p))
    let dir = unit([a[0] - b[0], a[1] - b[1]])
    if (dir[0] === 0 && dir[1] === 0) {
        // Sommet aligné : la normale de l'arête suffit.
        dir = unit([-a[1], a[0]])
    }
    // Un pas MINUSCULE vers l'extérieur doit sortir du polygone.
    const step = Math.max(1e-6, 1e-4 * norm(sub(next, prev)))
    if (pointInRing(add(p, mul(dir, step)), r)) dir = mul(dir, -1)
    return dir
}

// --- l'appendice -----------------------------------------------------------

/** Disque CIRCONSCRIT à `radius`, 32 côtés — jamais moins que le rayon
 *  demandé (même règle que le repli de gonflement du lot E0). */
export function pierceDisc(centre, radius, sides = PIERCE_DISC_SIDES) {
    const r = radius / Math.cos(Math.PI / sides)
    const out = []
    for (let k = 0; k < sides; k++) {
        const t = (2 * Math.PI * k) / sides
        out.push([centre[0] + r * Math.cos(t), centre[1] + r * Math.sin(t)])
    }
    return out
}

/**
 * Anneau de nesting d'une pièce, avec sa réserve d'amorce.
 *
 * `leadIn` : longueur de l'amorce lue dans le `.job` (mm). `pierceMarginMm` :
 * rayon du disque de perçage. Le point de perçage est le DÉBUT de l'amorce,
 * donc à `leadIn` du contour, vers l'extérieur.
 *
 * L'appendice est l'enveloppe convexe du sommet de départ et du disque : une
 * forme en trou de serrure qui couvre le couloir d'amorce ET le perçage,
 * sans jamais rentrer dans la pièce. Il est épinglé en remplaçant le sommet
 * de départ par le tour de l'appendice.
 *
 * Rend `{ ring, applied, reason }`. `applied: false` laisse l'anneau INTACT
 * quand la réserve croiserait le contour ailleurs (pièce très concave, ou
 * amorce plus longue que la pièce) : on ne livre pas une géométrie
 * auto-intersectante, et la raison est dite.
 */
export function withLeadInReserve(ring, {
    startPosition = null,
    startIndex = null,
    leadIn = 0,
    pierceMarginMm = DEFAULT_PIERCE_MARGIN_MM,
} = {}) {
    const r = openRing((ring || []).map((p) => [Number(p[0]), Number(p[1])]))
    const lead = Number(leadIn)
    const margin = Number(pierceMarginMm)
    if (r.length < 3) return { ring, applied: false, reason: 'ringTooSmall' }
    if (!Number.isFinite(lead) || !Number.isFinite(margin)
        || (lead <= 0 && margin <= 0)) {
        return { ring, applied: false, reason: 'nothingToReserve' }
    }

    // `startIndex` impose le sommet (un appelant qui SAIT ou l'amorce part) ;
    // sinon on predit.
    const index = Number.isInteger(startIndex) && startIndex >= 0 && startIndex < r.length
        ? startIndex
        : predictedStartIndex(r, startPosition)
    const vertex = r[index]
    const dir = outwardAt(r, index)
    const centre = add(vertex, mul(dir, Math.max(0, lead)))
    const appendix = convexHull([vertex, ...pierceDisc(centre, Math.max(0, margin))])
    if (appendix.length < 3) return { ring, applied: false, reason: 'flatAppendix' }

    // Tourner l'appendice pour qu'il commence ET finisse au sommet épinglé.
    const at = appendix.findIndex((p) => p[0] === vertex[0] && p[1] === vertex[1])
    if (at < 0) {
        // Le sommet est à l'INTÉRIEUR du disque (amorce plus courte que la
        // marge de perçage) : l'appendice l'avale, il n'y a rien à épingler
        // proprement. On refuse plutôt que de produire un anneau douteux.
        return { ring, applied: false, reason: 'vertexInsideDisc' }
    }
    const walk = appendix.slice(at).concat(appendix.slice(0, at))

    // Orientation : l'appendice doit tourner dans le MÊME sens que l'anneau,
    // sinon le tour se replie sur lui-même.
    const ringCcw = signedArea(r) > 0
    const walkCcw = signedArea(walk) > 0
    const spliced = walkCcw === ringCcw ? walk : [walk[0], ...walk.slice(1).reverse()]

    const out = []
    for (let i = 0; i < r.length; i++) {
        if (i === index) out.push(...spliced)
        else out.push(r[i])
    }

    // Les arêtes NEUVES ne doivent croiser aucune arête d'origine : sinon la
    // pièce rendue serait auto-intersectante et l'import moteur la refuserait
    // (piège AGENTS #2c — c'est exactement le défaut qui a tué un job).
    const newFrom = index
    const newTo = index + spliced.length
    for (let i = newFrom; i < newTo; i++) {
        const a1 = out[i % out.length]
        const a2 = out[(i + 1) % out.length]
        for (let j = 0; j < out.length; j++) {
            // On ne compare pas une arete neuve a elle-meme ni a sa voisine
            // immediate (elles se TOUCHENT, ce qui n'est pas un croisement).
            // La borne haute est `< newTo` : a `<= newTo` on sautait la
            // PREMIERE arete d'origine d'apres l'appendice — exactement celle
            // que l'appendice traverse quand il ressort (mesure sur un C).
            if (j >= newFrom - 1 && j < newTo) continue
            const b1 = out[j % out.length]
            const b2 = out[(j + 1) % out.length]
            if (segmentsCrossProperly(a1, a2, b1, b2)) {
                return { ring, applied: false, reason: 'reserveCrossesContour' }
            }
        }
    }

    return { ring: out, applied: true, reason: null, startIndex: index, pierceAt: centre }
}

/**
 * Réserve appliquée à une PIÈCE (contour + trous) d'un job `.job`.
 *
 * Les trous ne reçoivent pas de réserve : SheetCam perce aussi pour un trou
 * intérieur, mais la place y est prise par la matière de la pièce elle-même —
 * l'amorce d'un trou mange dans le trou, pas chez la voisine. Le jour où le
 * contraire sera mesuré, ce sera un lot à part.
 */
export function partWithReserve(part, options = {}) {
    const res = withLeadInReserve(part.coordinates, options)
    return {
        ...part,
        coordinates: res.ring,
        holes: part.holes || [],
        reserve: {
            applied: res.applied,
            reason: res.reason,
            pierceMarginMm: Number(options.pierceMarginMm ?? DEFAULT_PIERCE_MARGIN_MM),
            leadIn: Number(options.leadIn ?? 0),
            startIndex: res.startIndex ?? null,
            pierceAt: res.pierceAt ?? null,
        },
    }
}
