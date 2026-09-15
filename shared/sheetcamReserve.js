/**
 * Réserve d'amorce et disque de perçage — lots J3, J4 et **J4-bis-2** de
 * `docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` (§8 puis §9.42), mise en œuvre du
 * chantier 3.5 du masterplan (« réserve d'amorce + point de départ, le pont
 * CAM »).
 *
 * ---------------------------------------------------------------------------
 * LE PROBLÈME, tel que le masterplan le pose : le CAM ajoute une amorce HORS
 * contour (ou DANS le trou, pour un contour intérieur), et perce avant de
 * couper. Si la pièce voisine est à 2 mm, l'amorce et le trou de perçage
 * tombent dedans — c'est le défaut que le propriétaire a constaté sur la
 * recette du 13/09 : l'amorce du trou de l'hôte coupait deux des quatre
 * éventails que NestorCut y avait nichés.
 *
 * ---------------------------------------------------------------------------
 * CE QUI A CHANGÉ AU LOT J4-bis-2, ET POURQUOI.
 *
 * Les lots J3 et J4 PRÉDISAIENT le point de départ, à partir de la clé
 * `Start position` du `.job` et d'une table de coins supposée. La série
 * complète des dix-sept fichiers d'essai (§9.42) a démoli les deux moitiés de
 * cette prémisse :
 *
 *   1. `Start position` n'est PAS le coin de départ des contours. Codes
 *      mesurés : centre 0, haut gauche 1, haut droit 2, bas droit 3, bas
 *      gauche 4 — et entre centre, haut gauche et haut droit les points de
 *      départ du G-code sont IDENTIQUES. Le réglage vit dans le cadre « Cut
 *      ordering » : c'est le coin d'où part la SÉQUENCE de coupe.
 *   2. Le point de départ de chaque contour est écrit dans le bloc binaire,
 *      à jour dans les dix-sept fichiers, déplacements à la main compris.
 *
 * La réserve « aux quatre coins candidats » du lot J4 ne protégeait donc la
 * recette que par chance : le trou y est ROND, et sur un trou rectangulaire
 * SheetCam part du MILIEU d'une arête, qu'aucun coin ne désigne. Ce module
 * lit maintenant le point (`jobPathRecords`, `shared/sheetcamJob.js`) et
 * réserve LÀ.
 *
 * ---------------------------------------------------------------------------
 * LA FORME DE LA RÉSERVE, et ce qu'elle couvre exactement.
 *
 * Pas d'anneau d'inflation complet (il tuerait la densité), mais une MORSURE
 * LOCALE au point de départ : on retire de la zone utile l'enveloppe de tout
 * ce que la torche va brûler autour de ce point —
 *
 *   - le disque de perçage (le trou d'amorçage plasma, plus large que le
 *     kerf et non modélisé par SheetCam) ;
 *   - le trajet d'amorce d'ENTRÉE et celui de SORTIE, dont la géométrie est
 *     mesurée sur les `.nc` de la série (§9.41 et vérification du 13/09) ;
 *   - la largeur de kerf autour de ces trajets, et le décalage kerf/2 du
 *     chemin lui-même.
 *
 * Pour un contour EXTÉRIEUR la morsure sort vers la chute : l'anneau grossit,
 * et la place est gardée chez la voisine. Pour un TROU elle rentre dans le
 * trou : la zone libre rétrécit, et nos pièces nichées ne s'y posent plus.
 * C'est le même code — seul change le côté « chute ».
 *
 * Et la réserve ne sort QUE pour le nesting : l'export garde le contour réel,
 * c'est SheetCam qui trace l'amorce avec ses propres réglages.
 *
 * Ce module est de la géométrie pure : aucune dépendance, un seul code pour
 * le navigateur et le serveur.
 */

/**
 * LES MARGES DE LA RÉSERVE DÉRIVENT DU KERF (§9.51, décision du propriétaire).
 *
 * Plus de constante « 3 mm » : le trou de perçage est gros, et la sécurité se
 * compte en kerf. Trois règles, toutes du même argument physique que
 * l'espacement du §9.40 — la bande brûlée déborde d'un kerf entier :
 *
 *   - **perçage** : disque réservé de rayon `2 × kerf` autour du point de
 *     perçage (kerf 1,5 ⇒ 3 mm, exactement l'ancien défaut ; kerf 4 ⇒ 8 mm) ;
 *   - **trajets d'amorce**, entrée ET sortie : bande de `± kerf` de part et
 *     d'autre du trajet, au lieu du demi-kerf ;
 *   - **bouche** de la morsure : au moins le diamètre du disque, `4 × kerf`.
 *
 * Un kerf nul, absent ou illisible ne doit pas rendre une marge NULLE : on
 * retombe sur 3 mm et le constat le dit (`pierceFallback`).
 */
export const PIERCE_FALLBACK_MM = 3

/** Rayon du disque de perçage à réserver, depuis le kerf de l'outil.
 *  Rend aussi `fallback: true` quand le kerf n'est pas exploitable — le
 *  constat doit pouvoir le dire, pas le taire. */
export function pierceRadiusFromKerf(kerf) {
    const k = Number(kerf)
    if (!Number.isFinite(k) || k <= 0) return { radius: PIERCE_FALLBACK_MM, fallback: true }
    return { radius: 2 * k, fallback: false }
}

/** Côtés du polygone qui approche le disque de perçage. 32 comme le repli de
 *  gonflement du lot E0, et CIRCONSCRIT : on ne promet jamais moins de marge
 *  que demandé. */
const PIERCE_DISC_SIDES = 32

/**
 * Sécurité par défaut qui s'ajoute aux deux kerfs, en millimètres.
 *
 * DÉCISION DU PROPRIÉTAIRE, 13/09 (§9.40 de l'étude) : la bande de kerf est
 * centrée sur le chemin d'outil, lui-même à kerf/2 du contour — elle s'étend
 * donc jusqu'à UN KERF ENTIER hors de chaque pièce. Deux pièces à moins de
 * `2 × kerf` ont des bandes qui se recouvrent : la seconde coupe traverse de
 * l'air déjà coupé (perte d'arc, bord rongé). La règle 3.10 (`kerf + 2 ×
 * 0,25`) est REMPLACÉE par `2 × kerf + sécurité`, sécurité à 1 mm par défaut
 * et modifiable — c'est LE paramètre.
 */
export const DEFAULT_KERF_SAFETY_MM = 1

/**
 * Espacement pré-rempli depuis le kerf de l'outil : `2 × kerf + sécurité`.
 *
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
    return 2 * raw + safety
}

// --- petites briques géométriques -----------------------------------------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1]]
const mul = (a, k) => [a[0] * k, a[1] * k]
const cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1]
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

/** L'anneau porte-t-il son point de fermeture dupliqué ? */
function isClosedRing(ring) {
    return Array.isArray(ring) && ring.length > 1
        && ring[0][0] === ring[ring.length - 1][0]
        && ring[0][1] === ring[ring.length - 1][1]
}

/**
 * Rend `out` dans LA MÊME CONVENTION DE FERMETURE que `source`.
 *
 * CE N'EST PAS DE LA COSMÉTIQUE, ET LE PRIX D'UN OUBLI EST UN JOB REFUSÉ.
 * Le calcul interne travaille sur des anneaux OUVERTS (`openRing`), mais tout
 * le pipeline — et en particulier la validation physique du rapport wasm —
 * attend des anneaux FERMÉS. `nest-report` balaie ses arêtes par
 * `for i in 0..ring.len() - 1` : sur un anneau ouvert, l'arête de fermeture
 * n'existe tout simplement pas pour lui, et son test d'appartenance
 * (`point_in_ring`, un lancer de rayon) en devient FAUX — il déclare des
 * contenances qui n'existent pas, donc des chevauchements qui n'existent pas.
 *
 * Mesuré le 13/09 sur la recette : le lot J4 rendait des anneaux ouverts (27
 * et 41 sommets, `fermé = false` là où le chemin ordinaire donne `true`), et
 * le job à 1 hôte + 4 éventails partait en « toutes les options rejetées par
 * la validation physique (chevauchements mesurés) » — alors que la mesure
 * arête↔arête des mêmes poses donne un écart minimal de 3,501 mm pour un
 * espacement exigé de 3,500. A/B : même `.job`, `Lead in=0` ⇒ le job aboutit ;
 * réserve sur l'hôte seul ⇒ aboutit ; réserve sur les quatre éventails ⇒
 * refusé. Le défaut dormait depuis le lot J3, qui n'avait aucun appelant.
 */
function matchClosure(out, source) {
    if (!isClosedRing(source)) return out
    if (isClosedRing(out)) return out
    return [...out, [out[0][0], out[0][1]]]
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

/** Disque CIRCONSCRIT à `radius` — jamais moins que le rayon demandé (même
 *  règle que le repli de gonflement du lot E0). */
export function pierceDisc(centre, radius, sides = PIERCE_DISC_SIDES) {
    const r = radius / Math.cos(Math.PI / sides)
    const out = []
    for (let k = 0; k < sides; k++) {
        const t = (2 * Math.PI * k) / sides
        out.push([centre[0] + r * Math.cos(t), centre[1] + r * Math.sin(t)])
    }
    return out
}

// --- la géométrie des amorces, MESURÉE sur les `.nc` -----------------------

/** Types d'amorce de SheetCam, onglet « Basic » (§9.40). */
export const LEAD_NONE = 0
export const LEAD_ARC = 1
export const LEAD_TANGENT = 2
export const LEAD_PERPENDICULAR = 3

/** Rayon de l'amorce en arc : `0,64 × longueur`. Mesuré sur les `.nc` de la
 *  série — entrée 5 ⇒ r = 3,2 ; sortie 10 ⇒ r = 6,4. */
export const ARC_RADIUS_FACTOR = 0.64

/** Inclinaison MAXIMALE d'une amorce tangente vers la chute, en radians.
 *  Mesurée : 0° quand le point de départ est un coin (le segment prolonge
 *  l'arête), 22,5° à l'entrée et 11,25° à la sortie quand il est au milieu
 *  d'une arête — sinon le segment serait sur le trait. On réserve l'ÉVENTAIL
 *  complet (0 … 22,5°) des deux côtés : la règle exacte qui choisit l'angle
 *  n'est pas mesurée, et parier dessus coûterait une pièce coupée. */
export const TANGENT_MAX_TILT = Math.PI / 8

const ARC_SAMPLES = 8

/**
 * Points du trajet d'amorce, en repère LOCAL `(t, n)` — `t` = sens de coupe
 * au point de départ, `n` = normale vers la chute.
 *
 * `side` : `-1` pour l'entrée (le trajet ARRIVE au point de départ), `+1`
 * pour la sortie (il en PART). Rend `{ points, far }` — `far` étant le bout
 * libre du trajet, c'est-à-dire le point de PERÇAGE pour une entrée.
 *
 * Les quatre formes sont celles des `.nc`, vérifiées une à une le 13/09 sur
 * `Pièce L` (trou rectangulaire, départ au milieu de l'arête basse, kerf 1,5
 * donc chemin décalé de 0,75) :
 *
 *   None (0)          perçage AU point de départ, aucun segment.
 *   Arc (1)           quart de cercle de rayon 0,64 L, centré à `L·0,64` sur
 *                     l'axe `n` ; entrée du perçage `(−r, r)` au point, sortie
 *                     du point à `(+r, r)`.
 *   Tangent (2)       segment droit de longueur L, incliné de 0 à 22,5° vers
 *                     la chute (voir `TANGENT_MAX_TILT`).
 *   Perpendicular (3) segment droit de longueur L le long de `n`.
 */
export function leadPathLocal(type, length, side) {
    const L = Math.max(0, Number(length) || 0)
    const t = Math.trunc(Number(type))
    if (L <= 0 || t === LEAD_NONE || !Number.isFinite(t)) {
        return { points: [[0, 0]], far: [0, 0] }
    }
    if (t === LEAD_PERPENDICULAR) {
        return { points: [[0, 0], [0, L]], far: [0, L] }
    }
    if (t === LEAD_TANGENT) {
        // L'éventail : les deux positions extrêmes du segment, plus le point
        // de départ. Leur enveloppe couvre toutes les inclinaisons entre les
        // deux, la règle exacte n'étant pas mesurée.
        const flat = [side * L, 0]
        const tilted = [side * L * Math.cos(TANGENT_MAX_TILT), L * Math.sin(TANGENT_MAX_TILT)]
        return { points: [[0, 0], flat, tilted], far: tilted }
    }
    // Arc : cercle de centre (0, r), rayon r. Le point de départ (0, 0) y est
    // à l'angle −90° ; le bout libre à 180° (entrée) ou 0° (sortie).
    const r = ARC_RADIUS_FACTOR * L
    const from = -Math.PI / 2
    const to = side < 0 ? -Math.PI : 0
    const pts = []
    for (let k = 0; k <= ARC_SAMPLES; k++) {
        const a = from + ((to - from) * k) / ARC_SAMPLES
        pts.push([r * Math.cos(a), r + r * Math.sin(a)])
    }
    return { points: pts, far: pts[pts.length - 1] }
}

/**
 * L'enveloppe à réserver autour d'un point de départ, en coordonnées du
 * dessin.
 *
 * `point` : le point de départ LU dans le `.job`, sur le contour réel.
 * `tangent` : le sens de coupe en ce point. `normal` : la normale vers la
 * chute. `kerf` : la largeur de kerf de l'outil.
 *
 * TROIS CHOSES S'ADDITIONNENT, et aucune n'est facultative :
 *   1. le chemin d'outil est décalé de `kerf/2` VERS LA CHUTE — tout le
 *      trajet d'amorce part de là, pas du contour ;
 *   2. la torche brûle `kerf/2` de chaque côté de ce trajet ;
 *   3. le perçage ouvre un disque de `2 × kerf` au bout de l'entrée (§9.51).
 *
 * Rend la liste des points dont l'enveloppe convexe est la réserve.
 */
export function leadEnvelopePoints({
    point,
    startFrame,
    endFrame = null,
    leadIn = 0,
    leadInType = LEAD_NONE,
    leadOut = 0,
    leadOutType = LEAD_NONE,
    kerf = 0,
} = {}) {
    const k = Math.max(0, Number(kerf) || 0)
    const margin = pierceRadiusFromKerf(k).radius
    // `half` est le DÉCALAGE du chemin d'outil (kerf/2 du contour) : un fait
    // géométrique, pas une marge. La marge, c'est `band` ci-dessous.
    const half = k / 2
    // Bande réservée autour du trajet : ± kerf (§9.51), et non le demi-kerf
    // de la bande brûlée seule — même argument que l'espacement du §9.40.
    const band = Math.max(k, 0)
    const finish = endFrame || startFrame
    const toWorld = leadWorldMapper(point, half)
    const entry = leadPathLocal(leadInType, leadIn, -1)
    const exit = leadPathLocal(leadOutType, leadOut, +1)
    const out = []
    // Chaque point du trajet est GROSSI du demi-kerf : la somme de ces petits
    // disques contient la bande brûlée, et leur enveloppe convexe la contient
    // donc aussi.
    const push = (pts, frame) => {
        const map = toWorld(frame)
        for (const p of pts) {
            const w = map(p)
            if (band > 0) out.push(...pierceDisc(w, band, 8))
            else out.push(w)
        }
    }
    push(entry.points, startFrame)
    push(exit.points, finish)
    // Le perçage, au bout de l'entrée : `2 × kerf`, planché à la bande (même
    // sans marge de perçage la torche brûle sa largeur).
    out.push(...pierceDisc(toWorld(startFrame)(entry.far), Math.max(margin, band)))
    return out
}

/** Local `(t, n)` → monde : `point + tangent·t + normal·(n + kerf/2)`. Le
 *  calcul commun de la réserve et de l'AFFICHAGE (J8-b) — mis en facteur
 *  pour qu'ils ne puissent pas diverger (même décalage kerf/2, même repère). */
function leadWorldMapper(point, half) {
    return (frame) => (p) => [
        point[0] + frame.tangent[0] * p[0] + frame.normal[0] * (p[1] + half),
        point[1] + frame.tangent[1] * p[0] + frame.normal[1] * (p[1] + half),
    ]
}

/**
 * Lot J8-b (§9.73 point 6) — les TRAJETS d'amorce en coordonnées du dessin,
 * pour l'AFFICHAGE. Même arithmétique que `leadEnvelopePoints` (elles partent
 * le `leadWorldMapper` commun) : une amorce dessinée ici est exactement
 * celle que la réserve garde.
 *
 * Rend `{ inPath, outPath, pierce }` :
 *  - `inPath` / `outPath` : `{ kind, points, zone }`. `points` est la
 *    polyligne CERTAINE (arc échantillonné, perpendiculaire) ; `zone` est
 *    l'éventail d'INCERTITUDE de la tangente (`[départ, extrême à plat,
 *    extrême inclinée]`, triangle à dessiner en translucide — la règle
 *    exacte n'est pas mesurée, une seule droite serait un mensonge).
 *    `kind: 'none'` ⇒ rien à dessiner. Une amorce est un trajet d'outil,
 *    PAS de la matière : trait fin sans remplissage (rendu côté consommateur).
 *  - `pierce` : `{ c, r }` — centre et rayon du disque de perçage
 *    (`2 × kerf`, §9.51), au bout libre de l'entrée.
 */
export function leadWorldPaths({
    point,
    startFrame,
    endFrame = null,
    leadIn = 0,
    leadInType = LEAD_NONE,
    leadOut = 0,
    leadOutType = LEAD_NONE,
    kerf = 0,
} = {}) {
    const k = Math.max(0, Number(kerf) || 0)
    const half = k / 2
    const finish = endFrame || startFrame
    const toWorld = leadWorldMapper(point, half)

    const side = (type, length, sign, frame) => {
        const local = leadPathLocal(type, length, sign)
        const map = toWorld(frame)
        const kind = [LEAD_NONE, LEAD_ARC, LEAD_TANGENT, LEAD_PERPENDICULAR]
            .indexOf(Math.trunc(Number(type)))
        if (kind <= 0 || length <= 0) return { kind: 'none', points: null, zone: null }
        const points = local.points.map(map)
        // Tangente : les trois points locaux sont [départ, à plat, incliné] —
        // l'éventail ENTIER, jamais une droite certaine (§9.73 point 10).
        if (kind === 2) return { kind: 'tangent', points: null, zone: points }
        return { kind: kind === 1 ? 'arc' : 'perpendicular', points, zone: null }
    }
    const entry = leadPathLocal(leadInType, leadIn, -1)
    return {
        inPath: side(leadInType, leadIn, -1, startFrame),
        outPath: side(leadOutType, leadOut, +1, finish),
        pierce: {
            c: toWorld(startFrame)(entry.far),
            r: Math.max(pierceRadiusFromKerf(k).radius, k),
        },
    }
}

/**
 * Lot J8-b — les repères de coupe `(tangent, normale)` au point de départ
 * `start` de l'anneau `ring`, pour dessiner ses amorces. `scrapInside` : la
 * chute est-elle l'INTÉRIEUR de l'anneau (trou). Rend `null` quand le point
 * ne se pose pas (arête dégénérée) : le consommateur ne dessine RIEN, il
 * n'invente pas (§9.73 point 11). C'est la même mécanique que `biteAtStart`,
 * sans la morsure.
 */
export function leadFramesAt(ring, start, scrapInside = false) {
    const src = (ring || []).map((p) => [Number(p[0]), Number(p[1])])
    const base = openRing(src)
    if (base.length < 3) return null
    if (!Array.isArray(start) || !Number.isFinite(Number(start[0]))
        || !Number.isFinite(Number(start[1]))) return null
    const placed = insertOnRing(base, [Number(start[0]), Number(start[1])])
    return cutFramesAt(placed.ring, placed.index, scrapInside)
}

/**
 * Lot J8-b — les amorces à DESSINER pour une fiche issue d'un `.job`.
 *
 * `rings` : tous les anneaux de la fiche (contour + trous, dans l'ordre de
 * `parts`), `isHole` : côté chute de chaque anneau. `starts` : les points de
 * départ lus (`record.sheetcam.starts`, offsets relatifs à `origin`). Rend
 * une entrée par point de départ POSABLE :
 * `{ ringIndex, inPath, outPath, pierce }` — la forme de `leadWorldPaths`.
 * Un point qui ne se pose sur AUCUN anneau est OMIS : jamais d'amorce
 * inventée (§9.73 point 11).
 */
export function drawingLeadShapes({ rings, isHole = [], starts = [], origin = null, kerf = 0, leadIn = 0, leadInType = LEAD_NONE, leadOut = 0, leadOutType = LEAD_NONE } = {}) {
    const out = []
    for (const s of starts || []) {
        const off = s?.offset
        if (!Array.isArray(off) || !Number.isFinite(Number(off[0])) || !Number.isFinite(Number(off[1]))) continue
        // Dessin = origine mémorisée par SheetCam + offset lu (même règle
        // qu'assignJobBlocks).
        const p = [
            off[0] + (Array.isArray(origin) ? Number(origin[0]) || 0 : 0),
            off[1] + (Array.isArray(origin) ? Number(origin[1]) || 0 : 0),
        ]
        let best = -1
        let bestD = Infinity
        for (let i = 0; i < (rings || []).length; i++) {
            if (!Array.isArray(rings[i]) || rings[i].length < 3) continue
            const d = nearestOnRing(p, rings[i]).d
            if (d < bestD) { bestD = d; best = i }
        }
        // Tolérance large (1 mm) : le point lu est sur le contour SIMPLIFIÉ
        // du `.job`, l'anneau affiché vient de notre import.
        if (best < 0 || bestD > 1) continue
        const frames = leadFramesAt(rings[best], p, isHole[best] === true)
        if (!frames) continue
        out.push({
            ringIndex: best,
            ...leadWorldPaths({
                point: p,
                startFrame: frames.start,
                endFrame: frames.end,
                leadIn: Number.isFinite(Number(s.leadIn)) ? s.leadIn : leadIn,
                leadInType: Number.isFinite(Number(s.leadInType)) ? s.leadInType : leadInType,
                leadOut: Number.isFinite(Number(s.leadOut)) ? s.leadOut : leadOut,
                leadOutType: Number.isFinite(Number(s.leadOutType)) ? s.leadOutType : leadOutType,
                kerf,
            }),
        })
    }
    return out
}

// --- la morsure ------------------------------------------------------------

/**
 * Point à la distance `d` le long de l'anneau depuis le sommet `from`, dans
 * le sens `step` (+1 avant, −1 arrière). Rend le point INTERPOLÉ sur l'arête
 * (un cercle discrétisé n'a pas de sommet à 3 mm pile) et le premier sommet
 * DÉPASSÉ, qui sert d'ancre au recollement.
 */
function walkAlongRing(r, from, d, step) {
    const n = r.length
    let cur = from
    let left = d
    for (let k = 0; k < n; k++) {
        const nxt = (cur + step + n) % n
        const seg = norm(sub(r[nxt], r[cur]))
        if (seg >= left) {
            const t = seg === 0 ? 0 : left / seg
            return { point: add(r[cur], mul(sub(r[nxt], r[cur]), t)), anchor: nxt }
        }
        left -= seg
        cur = nxt
    }
    // L'anneau entier est plus court que la bouche demandée : le contour est
    // trop petit pour qu'on y réserve quoi que ce soit proprement.
    return null
}

/** Distance d'un point au segment `[a, b]`, et le paramètre `t` du projeté. */
function pointSegment(p, a, b) {
    const ab = sub(b, a)
    const len2 = dot(ab, ab)
    const t = len2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2)) : 0
    const proj = add(a, mul(ab, t))
    return { d: norm(sub(p, proj)), t, proj }
}

/**
 * Distance d'un point à un anneau, et l'arête la plus proche.
 * Rend `{ d, edge, t }` — `edge` étant l'index du sommet de départ de l'arête.
 */
export function nearestOnRing(point, ring) {
    const r = openRing(ring)
    let best = { d: Infinity, edge: 0, t: 0, proj: r[0] }
    for (let i = 0; i < r.length; i++) {
        const res = pointSegment(point, r[i], r[(i + 1) % r.length])
        if (res.d < best.d) best = { d: res.d, edge: i, t: res.t, proj: res.proj }
    }
    return best
}

/**
 * Insère `point` comme SOMMET de l'anneau ouvert `r`, sur l'arête la plus
 * proche. Rend `{ ring, index, onVertex }` — `onVertex` disant que le point
 * tombait déjà sur un sommet (un coin), ce qui change la normale à prendre.
 */
function insertOnRing(r, point) {
    const near = nearestOnRing(point, r)
    const n = r.length
    const a = r[near.edge]
    const b = r[(near.edge + 1) % n]
    const snap = 1e-9
    if (norm(sub(point, a)) <= snap) return { ring: r.slice(), index: near.edge, onVertex: true }
    if (norm(sub(point, b)) <= snap) {
        return { ring: r.slice(), index: (near.edge + 1) % n, onVertex: true }
    }
    const out = r.slice(0, near.edge + 1)
    out.push([point[0], point[1]])
    out.push(...r.slice(near.edge + 1))
    return { ring: out, index: near.edge + 1, onVertex: false }
}

/**
 * Les DEUX repères de coupe au sommet `i` : `{ start, end }`, chacun
 * `{ tangent, normal }` avec la normale pointant VERS LA CHUTE.
 *
 * LA RÈGLE DE LA NORMALE EST MESURÉE, ET ELLE EST UNIQUE : la matière est à
 * GAUCHE du sens de coupe, la chute à droite — donc `n = (t.y, −t.x)`.
 * Vérifiée sur les deux cas du G-code de `Pièce L` : trou rectangulaire,
 * départ au milieu de l'arête basse, coupe vers −x, chute (= l'intérieur du
 * trou) vers +y ; et contour extérieur, départ au coin (0 ; 0), coupe vers
 * +x, chute (= l'extérieur) vers −y.
 *
 * POURQUOI DEUX REPÈRES ET NON UN. Un contour fermé PART du point de départ
 * par une arête et y REVIENT par une autre. Quand le point est au milieu
 * d'une arête, c'est la même et les deux repères sont identiques — c'est le
 * cas de tous les trous mesurés. Quand il est sur un COIN, ils diffèrent, et
 * l'amorce de sortie suit l'arête d'ARRIVÉE : mesuré sur le contour
 * extérieur de `Pièce L`, départ au coin (0 ; 0), amorce perpendiculaire de
 * 10 mm — la sortie va de (−0,75 ; 0) à (−10,75 ; 0), c'est-à-dire selon la
 * normale de l'arête GAUCHE, pas de l'arête basse par laquelle la coupe a
 * commencé. Avec un seul repère, ce point sortait de la réserve (mesuré :
 * 4 points de trajet sur 36 non couverts, tous des sorties de contour
 * extérieur).
 *
 * Au niveau d'un coin, c'est donc la normale d'une ARÊTE qui gouverne, jamais
 * la bissectrice : l'amorce d'entrée part bien selon −y depuis (0 ; 0), et
 * non en diagonale.
 *
 * `scrapInside` : la chute est-elle À L'INTÉRIEUR de cet anneau ? Vrai pour
 * un trou (la zone libre EST la chute), faux pour un contour extérieur.
 */
function cutFramesAt(r, i, scrapInside) {
    const n = r.length
    const nextP = r[(i + 1) % n]
    const prevP = r[(i - 1 + n) % n]
    const scale = Math.max(norm(sub(nextP, r[i])), norm(sub(prevP, r[i])))
    const step = Math.max(1e-7, 1e-5 * scale)
    const frame = (t) => ({ tangent: t, normal: [t[1], -t[0]] })
    // Les deux sens de parcours possibles ; celui dont la normale droite
    // tombe du côté chute est le sens de coupe.
    for (const [ahead, behind] of [[nextP, prevP], [prevP, nextP]]) {
        const t = unit(sub(ahead, r[i]))
        if (t[0] === 0 && t[1] === 0) continue
        const start = frame(t)
        // Sonde AU MILIEU de l'arête, jamais au sommet : au sommet, un pas le
        // long de la normale peut tomber du mauvais côté d'un coin réflexe.
        const mid = mul(add(r[i], ahead), 0.5)
        if (pointInRing(add(mid, mul(start.normal, step)), r) !== Boolean(scrapInside)) continue
        const tEnd = unit(sub(r[i], behind))
        return {
            start,
            end: (tEnd[0] === 0 && tEnd[1] === 0) ? start : frame(tEnd),
        }
    }
    return null
}

/**
 * La morsure au point de départ `start`, sur l'anneau `ring`.
 *
 * `scrapInside` : la chute est-elle l'intérieur de l'anneau (trou) ou son
 * extérieur (contour de pièce) ?
 *
 * Rend `{ ring, applied, reason, pierceAt }`. `applied: false` laisse
 * l'anneau INTACT et dit pourquoi — on ne livre jamais une zone libre dont on
 * ne sait pas si l'amorce la traverse, ni une géométrie auto-intersectante
 * que l'import moteur refuserait (pièges AGENTS #2c et #5b).
 */
export function biteAtStart(ring, {
    start,
    scrapInside = false,
    leadIn = 0,
    leadInType = LEAD_NONE,
    leadOut = 0,
    leadOutType = LEAD_NONE,
    kerf = 0,
} = {}) {
    const src = (ring || []).map((p) => [Number(p[0]), Number(p[1])])
    const base = openRing(src)
    if (base.length < 3) return { ring, applied: false, reason: 'ringTooSmall' }
    if (!Array.isArray(start) || !Number.isFinite(Number(start[0]))
        || !Number.isFinite(Number(start[1]))) {
        return { ring, applied: false, reason: 'startNotRead' }
    }
    // IL Y A TOUJOURS QUELQUE CHOSE À RÉSERVER (§9.51). Même sans amorce
    // déclarée, la torche PERCE : le disque vaut `2 × kerf`, et un kerf nul ou
    // illisible retombe sur 3 mm plutôt que sur zéro. L'ancien refus
    // `nothingToReserve` est donc devenu inatteignable, et il est retiré —
    // une raison morte dans un dictionnaire est une promesse qu'on ne tient
    // plus.
    const k = Math.max(0, Number(kerf) || 0)
    const margin = pierceRadiusFromKerf(k).radius

    const placed = insertOnRing(base, [Number(start[0]), Number(start[1])])
    const r = placed.ring
    const i = placed.index
    const frames = cutFramesAt(r, i, scrapInside)
    if (!frames) return { ring, applied: false, reason: 'degenerateEdge' }

    const cloud = leadEnvelopePoints({
        point: r[i],
        startFrame: frames.start,
        endFrame: frames.end,
        leadIn,
        leadInType,
        leadOut,
        leadOutType,
        kerf: k,
    })
    if (cloud.length < 3) return { ring, applied: false, reason: 'flatEnvelope' }

    // La bouche doit être au moins aussi large que l'empreinte de l'enveloppe
    // LE LONG du contour — sinon ses deux lèvres tombent DANS l'enveloppe et
    // il n'y a pas de morsure propre à découper. On la calcule, puis on
    // l'élargit tant que les lèvres n'atteignent pas l'enveloppe (un contour
    // courbe s'éloigne de la corde : la longueur d'arc dépasse la projection).
    let reach = 0
    for (const q of cloud) {
        const v = sub(q, r[i])
        reach = Math.max(reach,
            Math.abs(dot(v, frames.start.tangent)),
            Math.abs(dot(v, frames.end.tangent)))
    }
    // La bouche fait au moins le DIAMÈTRE du disque de perçage, 4 × kerf
    // (§9.51) : plus étroite, ses deux lèvres tomberaient dans l'enveloppe.
    let mouth = Math.max(reach + Math.max(k, 1e-3), 4 * k, 1e-3)

    let last = 'holeTooSmall'
    for (let attempt = 0; attempt < 4; attempt++, mouth *= 1.5) {
        const res = spliceBite(r, i, mouth, cloud, src, frames.start.normal)
        if (res.applied) {
            return {
                ...res,
                pierceAt: leadPierceWorld(r[i], frames.start, leadInType, leadIn, k),
                startIndex: i,
                mouthMm: mouth,
            }
        }
        last = res.reason
        if (res.reason !== 'mouthInsideEnvelope') break
    }
    return { ring, applied: false, reason: last }
}

/** Le point de perçage, en coordonnées du dessin (pour le constat). */
function leadPierceWorld(point, frame, type, length, kerf) {
    const { far } = leadPathLocal(type, length, -1)
    const half = Math.max(0, kerf) / 2
    return [
        point[0] + frame.tangent[0] * far[0] + frame.normal[0] * (far[1] + half),
        point[1] + frame.tangent[1] * far[0] + frame.normal[1] * (far[1] + half),
    ]
}

/**
 * Le recollement : l'arc du contour entre les deux lèvres est remplacé par le
 * tour de l'enveloppe qui la CONTOURNE (le plus long des deux tours ; l'autre
 * est la corde, qui ne retirerait rien).
 *
 * Le lobe retiré s'ouvre sur le bord : ni goulot, ni pincement, ni sommet
 * dupliqué — ni dans la zone libre, ni dans la matière voisine, qui gagne ce
 * même lobe (piège #4 : le polygone posé est l'anneau externe MOINS les
 * trous, donc rétrécir un trou épaissit son hôte là où il faut).
 */
function spliceBite(r, i, mouth, cloud, source, normal) {
    const back = walkAlongRing(r, i, mouth, -1)
    const fwd = walkAlongRing(r, i, mouth, +1)
    if (!back || !fwd || back.anchor === fwd.anchor) {
        return { ring: source, applied: false, reason: 'holeTooSmall' }
    }
    const E = back.point
    const X = fwd.point
    const hull = convexHull([E, X, ...cloud])
    const iE = hull.findIndex((p) => p[0] === E[0] && p[1] === E[1])
    const iX = hull.findIndex((p) => p[0] === X[0] && p[1] === X[1])
    if (iE < 0 || iX < 0) {
        return { ring: source, applied: false, reason: 'mouthInsideEnvelope' }
    }
    const walk = (step) => {
        const out = []
        for (let k = iE; ; k = (k + step + hull.length) % hull.length) {
            out.push(hull[k])
            if (k === iX) break
        }
        return out
    }
    // DES DEUX TOURS DE L'ENVELOPPE ENTRE E ET X, ON PREND CELUI QUI PART DU
    // CÔTÉ CHUTE — jamais « le plus long ».
    //
    // Le lot J4 prenait le plus long, et cela marchait tant que l'enveloppe
    // était franchement décalée vers la chute (un disque poussé à `leadIn` du
    // bord). Avec l'enveloppe réelle, une amorce de type « None » met le
    // disque de perçage À CHEVAL sur le contour : les deux tours ont alors
    // presque la même longueur, et le mauvais est choisi une fois sur deux.
    // Mesuré : 5 des 32 sommets du disque de perçage restaient dans la zone
    // libre, c'est-à-dire une réserve qui ne réserve pas.
    const side = (p) => p.reduce((s, q) => s + dot(sub(q, r[i]), normal), 0) / p.length
    const ahead = walk(1)
    const behind = walk(-1)
    const path = side(ahead) >= side(behind) ? ahead : behind

    const dropped = new Set()
    for (let k = back.anchor; ; k = (k + 1) % r.length) {
        dropped.add(k)
        if (k === fwd.anchor) break
    }
    dropped.delete(back.anchor)
    dropped.delete(fwd.anchor)
    const out = []
    let spliceAt = -1
    for (let k = 0; k < r.length; k++) {
        if (dropped.has(k)) continue
        out.push(r[k])
        if (k === back.anchor) {
            spliceAt = out.length
            out.push(...path)
        }
    }
    if (out.length < 3 || spliceAt < 0) {
        return { ring: source, applied: false, reason: 'holeTooSmall' }
    }

    // Aucune arête neuve ne doit croiser une arête d'origine : sur un contour
    // très concave la morsure peut ressortir par une gorge — auquel cas on
    // refuse plutôt que de livrer un anneau auto-intersectant.
    const to = spliceAt + path.length
    for (let s = spliceAt - 1; s < to; s++) {
        const a1 = out[((s % out.length) + out.length) % out.length]
        const a2 = out[(((s + 1) % out.length) + out.length) % out.length]
        for (let t = 0; t < out.length; t++) {
            if (t >= spliceAt - 2 && t < to) continue
            if (segmentsCrossProperly(a1, a2, out[t], out[(t + 1) % out.length])) {
                return { ring: source, applied: false, reason: 'reserveCrossesContour' }
            }
        }
    }
    return { ring: matchClosure(out, source), applied: true, reason: null }
}

// --- l'appariement point de départ ↔ contour -------------------------------

/**
 * Tolérance d'appariement d'un point de départ à son contour, en mm.
 *
 * Sur les dix-sept fichiers de la série, chaque point lu est sur son contour
 * à 0,01 mm près. Chez nous le contour a traversé notre propre import DXF et
 * la simplification Douglas-Peucker (`NEST_SIMPLIFY_MM` = 0,05 mm), plus
 * l'échantillonnage des arcs : 0,5 mm laisse dix fois cette marge, et ne peut
 * pas confondre deux contours distincts d'un même dessin — deux contours à
 * moins de 0,5 mm l'un de l'autre ne seraient pas coupables.
 */
export const START_MATCH_TOL_MM = 0.5

/**
 * Apparie chaque point de départ au contour qui le porte.
 *
 * `rings` : `[{ ring, scrapInside }]`. Rend, pour chaque anneau, la liste des
 * points qui lui reviennent — et la liste de ceux qui ne tombent sur AUCUN
 * contour, que l'appelant doit dire plutôt que taire.
 */
export function matchStartsToRings(starts, rings, tol = START_MATCH_TOL_MM) {
    const perRing = rings.map(() => [])
    const unmatched = []
    for (const start of starts || []) {
        const p = [Number(start?.point?.[0]), Number(start?.point?.[1])]
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
            unmatched.push(start)
            continue
        }
        let best = -1
        let bestD = Infinity
        rings.forEach((entry, index) => {
            const d = nearestOnRing(p, entry.ring).d
            if (d < bestD) {
                bestD = d
                best = index
            }
        })
        if (best < 0 || bestD > tol) {
            unmatched.push({ ...start, distanceMm: bestD })
            continue
        }
        perRing[best].push({ ...start, point: p, distanceMm: bestD })
    }
    return { perRing, unmatched }
}

/**
 * Apparie les blocs du bloc binaire aux DESSINS, par la géométrie.
 *
 * LE DÉFAUT QUE CE BLOC CORRIGE (lot J4-bis-3, §9.45 de l'étude, trouvé par le
 * vérificateur). Le lot J4-bis-2 appariait par RANG : le k-ième bloc au k-ième
 * nom de dessin rencontré dans les sections `[Part N]`. Le rapport disait « un
 * bloc par nom de dessin, dans le même ordre — vérifié sur trente-neuf
 * fichiers » ; ce qui avait été vérifié, c'est le NOMBRE de blocs, pas leur
 * correspondance. Sur un `.job` dont les sections déclarent les dessins dans
 * un autre ordre que le cache binaire, les deux dessins sont INVERSÉS : les
 * points tombent tous à côté, les contours sortent en « point non lu » et les
 * trous quittent le nesting. Dégradation sûre, mais injuste, et pour rien.
 *
 * LA GÉOMÉTRIE TRANCHE, ET ELLE EST SANS AMBIGUÏTÉ : un point de départ est SUR
 * son contour à 0,01 mm près (mesuré sur les dix-sept fichiers de la série),
 * et à des dizaines de millimètres de tout contour de l'autre dessin. On
 * compte donc, pour chaque couple (bloc, dessin), les points qui tombent sur
 * un contour, et on retient l'affectation qui en place le plus.
 *
 * `blocks` : `[{ origin: [x, y], paths: [{ start: [x, y] }] }]`.
 * `drawings` : `[{ name, rings: [anneau, ...] }]` — TOUS les anneaux du dessin,
 * contours et trous, tels que notre import les rend.
 *
 * Rend `{ pairs, ambiguous }`. `pairs[i]` donne, pour le dessin `i`, l'indice
 * de bloc retenu, le nombre de points placés et l'écart d'origine. Un total à
 * ÉGALITÉ entre deux affectations distinctes, ou un total nul, rend
 * `ambiguous: true` et aucune paire : on ne devine pas (l'appelant retombe sur
 * « point non lu », le comportement d'avant).
 *
 * Les chemins qui ne tombent sur AUCUN contour d'AUCUN dessin — une entité
 * POINT, par exemple — ne comptent nulle part : ils ne pèsent donc pas sur le
 * choix, ce qui est exactement ce qu'on veut.
 */
export function assignJobBlocks(blocks, drawings, tol = START_MATCH_TOL_MM) {
    const nb = (blocks || []).length
    const nd = (drawings || []).length
    if (!nb || !nd || nb !== nd) return { pairs: null, ambiguous: true, reason: 'countMismatch' }

    // Score[d][b] : points du bloc `b` qui tombent sur un contour du dessin `d`.
    const score = drawings.map((drawing) => blocks.map((block) => {
        let placed = 0
        for (const path of block.paths || []) {
            const p = [
                Number(block.origin?.[0]) + Number(path?.start?.[0]),
                Number(block.origin?.[1]) + Number(path?.start?.[1]),
            ]
            if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
            let best = Infinity
            for (const ring of drawing.rings || []) {
                if (!Array.isArray(ring) || ring.length < 2) continue
                const d = nearestOnRing(p, ring).d
                if (d < best) best = d
            }
            if (best <= tol) placed += 1
        }
        return placed
    }))

    // AFFECTATION GLOUTONNE, SANS PLAFOND (lot J4-bis-4, §9.49).
    //
    // Le lot J4-bis-3 énumérait les permutations et refusait au-delà de sept
    // dessins. C'était un plafond de complexité déguisé en règle métier : un
    // `.job` d'atelier porte couramment dix à trente dessins, et tous ses
    // points seraient passés « non lus », donc aucun trou nesté. Le
    // vérificateur a eu raison de le nommer avant le déploiement.
    //
    // On prend la MEILLEURE CASE de la matrice, on retire sa ligne et sa
    // colonne, on recommence. Coût : n² cases parcourues n fois, soit n³ dans
    // le pire cas — quelques milliers d'opérations pour trente dessins, rien.
    //
    // Ce n'est pas l'optimum global (le problème d'affectation le serait, par
    // l'algorithme hongrois), et c'est SUFFISANT ici parce que la matrice
    // n'est pas quelconque : un point de départ est SUR son contour à 0,01 mm
    // et à des dizaines de millimètres de tout autre dessin. Une case non
    // nulle désigne donc presque toujours le bon couple, et un dessin qui
    // n'en a aucune ne peut de toute façon être apparié par personne.
    //
    // L'ÉGALITÉ SE JUGE SUR LA CASE RETENUE, ET SEULEMENT CONTRE SES
    // CONCURRENTES DIRECTES — les cases libres de SA LIGNE ou de SA COLONNE.
    //
    // C'est la seule lecture qui a un sens. Deux cases de même valeur dans
    // des lignes ET des colonnes différentes ne sont pas en concurrence :
    // chacune est le meilleur choix de son dessin ET de son bloc, et les
    // prendre toutes les deux ne pose aucune question. Douze dessins
    // distincts marquent tous 2 sur leur propre bloc, et c'est justement le
    // cas normal — un refus global les aurait tous déclarés ambigus (mesuré :
    // douze copies décalées de la pièce L, refus « tie » avec le critère
    // global, 12/12 appariés avec celui-ci).
    //
    // Une vraie ambiguïté, c'est : ce dessin irait aussi bien sur un AUTRE
    // bloc (même ligne), ou ce bloc irait aussi bien à un AUTRE dessin (même
    // colonne). Là, rien ne départage, et on refuse.
    const takenBlock = new Array(nb).fill(false)
    const takenDrawing = new Array(nd).fill(false)
    const chosen = new Array(nd).fill(-1)
    let totalPlaced = 0
    for (let step = 0; step < nd; step++) {
        let best = -1
        let bestD = -1
        let bestB = -1
        for (let d = 0; d < nd; d++) {
            if (takenDrawing[d]) continue
            for (let b = 0; b < nb; b++) {
                if (takenBlock[b]) continue
                if (score[d][b] > best) {
                    best = score[d][b]
                    bestD = d
                    bestB = b
                }
            }
        }
        // Plus rien à placer : les dessins restants n'ont aucun point sur
        // aucun bloc libre. On s'arrête là plutôt que d'affecter au hasard.
        if (best <= 0) break
        for (let b = 0; b < nb; b++) {
            if (b !== bestB && !takenBlock[b] && score[bestD][b] === best) {
                return { pairs: null, ambiguous: true, reason: 'tie' }
            }
        }
        for (let d = 0; d < nd; d++) {
            if (d !== bestD && !takenDrawing[d] && score[d][bestB] === best) {
                return { pairs: null, ambiguous: true, reason: 'tie' }
            }
        }
        takenDrawing[bestD] = true
        takenBlock[bestB] = true
        chosen[bestD] = bestB
        totalPlaced += best
    }

    if (totalPlaced <= 0) return { pairs: null, ambiguous: true, reason: 'noPointPlaced' }
    // Un dessin sans case positive reste sans bloc. Plutôt que de lui en
    // donner un au hasard, on refuse l'ensemble : l'appelant retombe sur
    // « point non lu », qui est sûr, plutôt que sur une réserve posée sur le
    // mauvais dessin, qui ne l'est pas.
    if (chosen.some((b) => b < 0)) {
        return { pairs: null, ambiguous: true, reason: 'noPointPlaced' }
    }

    const pairs = chosen.map((b, d) => ({
        drawing: d,
        block: b,
        placed: score[d][b],
        total: (blocks[b].paths || []).length,
    }))
    return { pairs, ambiguous: false, reason: null, totalPlaced }
}

/**
 * Réserve appliquée à une PIÈCE (contour + trous) d'un job `.job`.
 *
 * `starts` : les points de départ LUS dans le `.job`, en coordonnées du
 * dessin — `[{ point: [x, y], leadIn, leadInType, leadOut, leadOutType }]`.
 *
 * CE QUI SE PASSE QUAND ON NE SAIT PAS. Un contour sans point de départ
 * apparié n'est pas réservé « au jugé » : le lot J4 l'a fait (quatre coins
 * candidats) et la série a montré que la table sur laquelle il pariait
 * n'existe pas. Ici :
 *   - un TROU sans point lu, ou dont la morsure est refusée, SORT du nesting
 *     (il disparaît de `holes`) : la zone libre n'existe plus, plus rien ne
 *     s'y niche, et le fait est dit dans `reserve.holes[]` ;
 *   - le CONTOUR EXTÉRIEUR, lui, reste tel quel avec sa raison : le rétrécir
 *     n'aurait aucun sens, et le gonfler au hasard promettrait une place que
 *     l'amorce ne prendra pas là.
 *
 * Le contour réel n'est jamais touché : le `.job` rendu garde la pièce
 * entière, c'est SheetCam qui la coupe.
 */
export function partWithReserve(part, options = {}) {
    const {
        starts = [],
        kerf = 0,
        matchTolMm = START_MATCH_TOL_MM,
    } = options
    const pierce = pierceRadiusFromKerf(kerf)
    const outer = part.coordinates
    const holeRings = part.holes || []
    const entries = [
        { ring: outer, scrapInside: false },
        ...holeRings.map((h) => ({ ring: h, scrapInside: true })),
    ]
    const { perRing, unmatched } = matchStartsToRings(starts, entries, matchTolMm)

    const applyAll = (ring, list, scrapInside) => {
        let cur = ring
        let applied = 0
        let reason = null
        for (const start of list) {
            const res = biteAtStart(cur, {
                start: start.point,
                scrapInside,
                leadIn: start.leadIn,
                leadInType: start.leadInType,
                leadOut: start.leadOut,
                leadOutType: start.leadOutType,
                kerf,
            })
            if (!res.applied) return { ring, applied: 0, reason: res.reason }
            cur = res.ring
            applied += 1
            reason = null
        }
        return { ring: cur, applied, reason }
    }

    const outerRes = perRing[0].length
        ? applyAll(outer, perRing[0], false)
        : { ring: outer, applied: 0, reason: 'startNotRead' }

    // UN CHEMIN DU BINAIRE QUI N'ATTERRIT SUR AUCUN CONTOUR EST IGNORÉ, ET
    // COMPTÉ — IL NE RETIRE PLUS RIEN (§9.50, mesure du propriétaire).
    //
    // Le lot J4-bis-2 faisait sortir du nesting le trou qui contenait un tel
    // point : les deux DXF de la recette portent une entité POINT que notre
    // import ne retient pas, et SheetCam lui fabrique un chemin dont le
    // départ est le point lui-même — au centre du trou de l'hôte. Faute de
    // savoir si SheetCam y perçait, on retirait le trou. C'était une
    // dégradation sûre, et elle coûtait tout le nichage de la recette.
    //
    // LE G-CODE DU PROPRIÉTAIRE A TRANCHÉ : `Piece_Trou+Fill_x4_OK.nc` compte
    // SIX descentes de torche pour SIX contours — quatre éventails, le trou,
    // le contour extérieur. Aucune au centre du trou. SheetCam ne perce pas
    // sur une entité POINT. Le chemin est donc du bruit de cache : on le
    // compte (`ignoredPaths`) et on passe.
    const holes = []
    const holeReports = []
    holeRings.forEach((hole, index) => {
        const list = perRing[index + 1]
        if (!list.length) {
            holeReports.push({ index, applied: false, reason: 'startNotRead', bites: 0, dropped: true })
            return
        }
        const res = applyAll(hole, list, true)
        if (res.applied) {
            holes.push(res.ring)
            holeReports.push({ index, applied: true, reason: null, bites: res.applied, dropped: false })
            return
        }
        holeReports.push({ index, applied: false, reason: res.reason, bites: 0, dropped: true })
    })

    return {
        ...part,
        coordinates: outerRes.ring,
        holes,
        reserve: {
            applied: outerRes.applied > 0,
            reason: outerRes.reason,
            pierceRadiusMm: pierce.radius,
            pierceFallback: pierce.fallback,
            kerf: Number(kerf),
            starts: starts.length,
            unmatched: unmatched.length,
            ignoredPaths: unmatched.length,
            holes: holeReports,
            holesDropped: holeReports.filter((h) => h.dropped).length,
            // §9.59 (règle 3) : le constat dit, par pièce, lequel des deux cas
            // s'applique — les points APPARIÉS seulement (un point égaré ne
            // décide de rien). `userPoints` : conservés tels quels, la réserve
            // s'y est posée ; `nestorcutPoints` : automatiques, choisis par
            // NestorCut et réécrits avec le drapeau.
            userPoints: perRing.flat().filter((s) => s.moved === true).length,
            nestorcutPoints: perRing.flat().filter((s) => s.moved !== true).length,
        },
    }
}
