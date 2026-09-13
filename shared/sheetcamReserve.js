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
    // `Number(null)` vaut 0, donc un `Start position` ABSENT désignait le
    // coin 0 (bas gauche) au lieu de retomber sur la règle par défaut — le
    // repli documenté juste au-dessus était mort pour `null`, et son verrou
    // passait par coïncidence (sur un rectangle 10 × 5, le coin bas gauche
    // ET la plus longue arête donnent tous deux l'index 0). Défaut trouvé au
    // lot J4 ; le verrou est maintenant DISCRIMINANT (3 × 50 : coin 0, arête 1).
    const corner = startPosition == null
        ? null
        : (START_CORNERS[Number(startPosition)] || null)
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

    return {
        ring: matchClosure(out, ring),
        applied: true,
        reason: null,
        startIndex: index,
        pierceAt: centre,
    }
}

// --- la réserve d'amorce d'un TROU (lot J4) --------------------------------

/**
 * LE DÉFAUT QUE CE BLOC CORRIGE, et pourquoi le lot J3 s'était trompé.
 *
 * Le lot J3 écrivait, en toutes lettres : « les trous ne reçoivent pas de
 * réserve — l'amorce d'un trou mange dans le trou, pas chez la voisine ».
 * C'était un raisonnement, pas une mesure, et LA MACHINE L'A INFIRMÉ : la
 * recette du 13/09 ouverte dans SheetCam montre l'amorce du contour du trou
 * de l'hôte partir VERS L'INTÉRIEUR du trou — c'est-à-dire du côté chute —
 * et couper deux des quatre éventails que NestorCut y avait nichés (verdict
 * du propriétaire, étude §9). La place dans un trou n'est pas prise par la
 * matière de la pièce : c'est précisément là que notre remplissage pose des
 * pièces.
 *
 * ---------------------------------------------------------------------------
 * CE QUE LE FORMAT PERMET, mesuré sur les onze `.job` d'essai.
 *
 * Il n'existe AUCUNE clé « point de départ » par contour : le relevé de
 * toutes les clés ne donne, par OPÉRATION, qu'un `Start position` entier. Et
 * `[OpOrder]` s'arrête à la granularité `pièce,opération` — cinq lignes pour
 * cinq pièces dans la recette, alors qu'une même opération « Outside Offset »
 * coupe le contour extérieur ET le trou. La voie 2 du verdict (« imposer
 * nous-mêmes le point de départ du trou après nesting ») est donc FERMÉE PAR
 * LE FORMAT : on ne peut que prédire le point de départ, et réserver la place.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI PAS L'APPENDICE DU LOT J3, TEL QUEL.
 *
 * Pour le contour extérieur, l'appendice est une BOSSE : l'anneau grossit, le
 * tour se referme proprement, l'aire monte. Retourner simplement la direction
 * vers l'intérieur ne donne PAS une encoche — mesuré sur le trou de la
 * recette (cercle r = 35, amorce 5, perçage 3) : l'aire MONTE de 3 842 à
 * 3 868 mm² et 21 des 32 sommets du disque de perçage restent dans la zone
 * libre. Le tour ré-enferme la zone au lieu de la retrancher.
 *
 * Et l'encoche « épinglée sur un seul sommet » qu'on obtiendrait en inversant
 * le sens de parcours est pire : elle pince l'anneau en un point (sommet
 * dupliqué, goulot d'épaisseur nulle) — exactement la famille de géométries
 * qui tue l'import moteur (pièges AGENTS #2c et #5b).
 *
 * ---------------------------------------------------------------------------
 * LA FORME RETENUE : une MORSURE DE BORD à mâchoire large.
 *
 * On retire de la zone libre un lobe ACCROCHÉ au bord du trou, dont la bouche
 * mesure `2 × mouthMm` le long du contour :
 *
 *   1. point de départ prédit `v` sur l'anneau du trou ;
 *   2. `E` et `X` : les deux points du contour à `mouthMm` de part et d'autre
 *      de `v`, mesurés LE LONG de l'anneau (interpolés sur l'arête, donc
 *      exacts même sur un cercle discrétisé) ;
 *   3. la morsure = enveloppe convexe de `E`, `X` et du disque de perçage
 *      centré à `leadIn` vers l'intérieur ;
 *   4. l'arc du contour entre `E` et `X` est remplacé par le chemin de la
 *      morsure qui CONTOURNE le disque (le plus long des deux tours).
 *
 * Le lobe retiré s'ouvre sur le bord : ni goulot, ni pincement, ni sommet
 * dupliqué — ni dans la zone libre, ni dans la matière de l'hôte, qui gagne
 * ce même lobe (piège #4 : le polygone posé est l'anneau externe MOINS les
 * trous, donc rétrécir le trou épaissit l'hôte là où il faut).
 *
 * Mesuré sur le trou de la recette, amorce 5 + perçage 3, bouche 3 mm :
 *   - disque de perçage strictement dans la zone libre : 0 / 32 ;
 *   - couloir d'amorce (perçage → bord) dans la zone libre : 0 / 101 ;
 *   - prix : 1,14 % de l'aire du trou — contre 40 % pour la couronne
 *     intérieure complète de largeur `amorce + perçage` (rayon libre 27 au
 *     lieu de 35). C'est ce rapport qui justifie la forme.
 */

/** Direction ENTRANTE au sommet `i` : l'opposée de la sortante. Sur l'anneau
 *  d'un TROU, « entrant » veut dire vers l'intérieur du trou, donc du côté
 *  chute — le côté où SheetCam trace l'amorce d'un contour intérieur. */
export function inwardAt(ring, index) {
    return mul(outwardAt(ring, index), -1)
}

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
    // L'anneau entier est plus court que la bouche demandée : le trou est trop
    // petit pour qu'on y réserve quoi que ce soit proprement.
    return null
}

/**
 * Une morsure, au sommet `startIndex` de l'anneau d'un trou.
 *
 * Rend `{ ring, applied, reason, pierceAt }`. `applied: false` laisse l'anneau
 * INTACT et dit pourquoi — on ne livre jamais une zone libre dont on ne sait
 * pas si l'amorce la traverse.
 */
export function holeBite(ring, {
    startIndex = 0,
    leadIn = 0,
    pierceMarginMm = DEFAULT_PIERCE_MARGIN_MM,
    mouthMm = null,
} = {}) {
    const r = openRing((ring || []).map((p) => [Number(p[0]), Number(p[1])]))
    const lead = Number(leadIn)
    const margin = Number(pierceMarginMm)
    if (r.length < 3) return { ring, applied: false, reason: 'ringTooSmall' }
    if (!Number.isFinite(lead) || !Number.isFinite(margin)
        || (lead <= 0 && margin <= 0)) {
        return { ring, applied: false, reason: 'nothingToReserve' }
    }
    // Bouche par DÉFAUT = le rayon de perçage, donc une bouche totale égale au
    // diamètre du disque : le lobe retiré n'est jamais plus étroit que ce
    // qu'il doit contenir.
    //
    // ET ELLE S'ÉLARGIT QUAND L'AMORCE EST PLUS COURTE QUE LA MARGE. Le disque
    // est centré à `leadIn` du bord : si `leadIn < margin`, il déborde vers
    // l'EXTÉRIEUR du trou et avale les deux lèvres de la bouche — la morsure
    // refuse alors (`mouthInsideDisc`) et l'appelant retire le trou du
    // nesting. Mesuré au lot J4-bis sur le cas réel « amorce 0, perçage 3 »
    // (une opération sans amorce, `Lead in type = 0`) : le trou sortait
    // entièrement du nesting, pour une raison purement géométrique et sans
    // que rien ne s'affiche. On écarte donc les lèvres de ce que le disque
    // déborde, et la morsure s'applique.
    const overhang = Math.max(0, margin - Math.max(0, lead))
    const mouth = Number.isFinite(Number(mouthMm)) && Number(mouthMm) > 0
        ? Number(mouthMm)
        : Math.max(margin + overhang, 1e-3)

    const i = ((Math.trunc(startIndex) % r.length) + r.length) % r.length
    const v = r[i]
    // LE CENTRE DU DISQUE EST POUSSÉ À LA MARGE AU MINIMUM.
    //
    // Le perçage a lieu au DÉBUT de l'amorce, donc à `leadIn` du bord. Quand
    // `leadIn < margin`, ce disque est à CHEVAL sur le bord du trou : sa
    // moitié extérieure est dans la matière de l'hôte (sans importance), mais
    // la construction de la morsure, elle, n'est pas définie pour un centre
    // sur le bord — mesuré à `leadIn = 0` : l'aire du trou MONTAIT de 2,1 %
    // et les 32 sommets du disque restaient dans la zone libre. La morsure
    // s'appliquait sans rien exclure, ce qui est pire qu'un refus.
    //
    // On centre donc à `max(leadIn, margin)`. Le disque rendu couvre alors
    // `0 … 2 × margin` vers l'intérieur, ce qui CONTIENT la moitié intérieure
    // du disque réel (`0 … margin`) : on réserve un peu plus que ce que la
    // torche prend, jamais moins — la règle du 32-gone circonscrit du lot E0.
    const centre = add(v, mul(inwardAt(r, i), Math.max(Math.max(0, lead), margin)))
    const back = walkAlongRing(r, i, mouth, -1)
    const fwd = walkAlongRing(r, i, mouth, +1)
    if (!back || !fwd || back.anchor === fwd.anchor) {
        return { ring, applied: false, reason: 'holeTooSmall' }
    }
    const E = back.point
    const X = fwd.point
    const hull = convexHull([E, X, ...pierceDisc(centre, Math.max(0, margin))])
    const iE = hull.findIndex((p) => p[0] === E[0] && p[1] === E[1])
    const iX = hull.findIndex((p) => p[0] === X[0] && p[1] === X[1])
    if (iE < 0 || iX < 0) {
        // Une des deux lèvres de la bouche est DANS le disque : l'amorce est
        // plus courte que la marge de perçage, il n'y a pas de morsure propre
        // à découper. On refuse (même esprit que `vertexInsideDisc`).
        return { ring, applied: false, reason: 'mouthInsideDisc' }
    }
    // Des deux tours de l'enveloppe entre E et X, celui qui CONTOURNE le
    // disque est le plus long ; l'autre est la corde E→X, qui ne retirerait
    // rien.
    const walk = (step) => {
        const out = []
        for (let k = iE; ; k = (k + step + hull.length) % hull.length) {
            out.push(hull[k])
            if (k === iX) break
        }
        return out
    }
    const pathLen = (p) => p.reduce((s, q, k) => (k ? s + norm(sub(q, p[k - 1])) : 0), 0)
    const ahead = walk(1)
    const behind = walk(-1)
    const path = pathLen(ahead) >= pathLen(behind) ? ahead : behind

    // Recollement : on garde les deux ancres et on jette l'arc entre elles.
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
        return { ring, applied: false, reason: 'holeTooSmall' }
    }

    // Même garde que le contour extérieur (piège #2c) : aucune arête neuve ne
    // doit croiser une arête d'origine. Sur un trou très concave, la morsure
    // peut ressortir par une gorge — auquel cas on refuse plutôt que de livrer
    // un anneau auto-intersectant, que l'import moteur refuse.
    const to = spliceAt + path.length
    for (let s = spliceAt - 1; s < to; s++) {
        const a1 = out[((s % out.length) + out.length) % out.length]
        const a2 = out[(((s + 1) % out.length) + out.length) % out.length]
        for (let t = 0; t < out.length; t++) {
            if (t >= spliceAt - 2 && t < to) continue
            if (segmentsCrossProperly(a1, a2, out[t], out[(t + 1) % out.length])) {
                return { ring, applied: false, reason: 'reserveCrossesContour' }
            }
        }
    }
    return {
        ring: matchClosure(out, ring),
        applied: true,
        reason: null,
        pierceAt: centre,
        startIndex: i,
    }
}

/**
 * Les sommets candidats au départ d'un contour, UN PAR COIN de `START_CORNERS`.
 *
 * Pourquoi les quatre, et pas seulement le coin lu dans le `.job` : la
 * correspondance `Start position` → coin n'est PAS CONFIRMÉE sur la machine
 * (non-fait 3 du lot J3, question ouverte §9 de l'étude). Réserver le seul
 * coin prédit reviendrait à parier sur une table non mesurée — et le prix
 * d'un mauvais pari, c'est la pièce coupée par l'amorce, le défaut même que
 * ce lot corrige. Réserver les QUATRE candidats est juste QUEL QUE SOIT le
 * sens de la table.
 *
 * Le prix mesuré sur le trou de la recette : ≈ 4 × 1,14 % de l'aire du trou,
 * contre 40 % pour la couronne complète — dix fois moins cher qu'un repli
 * conservateur, et sans hypothèse. Quand le propriétaire aura confirmé la
 * table, `startPositionConfirmed` fera tomber la réserve au seul coin lu.
 */
export function cornerStartIndices(ring) {
    const r = openRing(ring)
    const seen = new Set()
    const out = []
    for (let k = 0; k < START_CORNERS.length; k++) {
        const i = predictedStartIndex(r, k)
        if (!seen.has(i)) {
            seen.add(i)
            out.push(i)
        }
    }
    return out
}

/**
 * Réserve d'amorce d'un TROU : une morsure à chaque point de départ candidat.
 *
 * Les morsures s'appliquent l'une après l'autre sur l'anneau déjà mordu. Les
 * index se décalent à chaque passe (la morsure change le nombre de sommets) :
 * les points de départ sont donc RECALCULÉS sur l'anneau courant à chaque
 * tour, jamais mémorisés.
 *
 * Une morsure refusée fait échouer la réserve ENTIÈRE du trou : on ne garde
 * pas une zone libre à moitié sûre. L'appelant décide alors quoi faire —
 * `partWithReserve` retire le trou du nesting plutôt que d'y nicher à
 * l'aveugle.
 */
export function holeWithLeadInReserve(hole, {
    startPosition = null,
    startPositionConfirmed = false,
    leadIn = 0,
    pierceMarginMm = DEFAULT_PIERCE_MARGIN_MM,
    mouthMm = null,
} = {}) {
    const lead = Number(leadIn)
    const margin = Number(pierceMarginMm)
    if (!Number.isFinite(lead) || !Number.isFinite(margin)
        || (lead <= 0 && margin <= 0)) {
        return { ring: hole, applied: false, reason: 'nothingToReserve', bites: 0 }
    }
    let ring = openRing((hole || []).map((p) => [Number(p[0]), Number(p[1])]))
    if (ring.length < 3) {
        return { ring: hole, applied: false, reason: 'ringTooSmall', bites: 0 }
    }

    const rounds = startPositionConfirmed ? 1 : START_CORNERS.length
    const pierceAt = []
    let bites = 0
    for (let k = 0; k < rounds; k++) {
        const index = startPositionConfirmed
            ? predictedStartIndex(ring, startPosition)
            : predictedStartIndex(ring, k)
        const res = holeBite(ring, {
            startIndex: index,
            leadIn: lead,
            pierceMarginMm: margin,
            mouthMm,
        })
        if (!res.applied) {
            // Deux coins peuvent désigner le même sommet sur un anneau déjà
            // mordu : la place y est DÉJÀ réservée, ce n'est pas un échec.
            if (res.reason === 'mouthInsideDisc' && bites > 0) continue
            return { ring: hole, applied: false, reason: res.reason, bites: 0 }
        }
        ring = res.ring
        pierceAt.push(res.pierceAt)
        bites += 1
    }
    return { ring: matchClosure(ring, hole), applied: true, reason: null, bites, pierceAt }
}

/**
 * Réserve appliquée à une PIÈCE (contour + trous) d'un job `.job`.
 *
 * Le contour extérieur reçoit l'appendice du lot J3 (une bosse vers
 * l'extérieur, qui garde la place chez la voisine). Les TROUS reçoivent la
 * morsure de bord du lot J4 (un lobe retiré vers l'intérieur, qui garde la
 * place au milieu de nos propres pièces nichées) — le lot J3 croyait la
 * réserve inutile dans un trou, la machine l'a démenti (verdict du 13/09).
 *
 * Un trou dont la réserve est REFUSÉE est retiré de `holes` : la zone libre
 * disparaît, plus rien ne s'y niche, et le fait est dit dans `reserve.holes[]`
 * pour que l'UI le constate. C'est la dégradation sûre — nicher dans un trou
 * dont on ne sait pas où l'amorce passe, c'est livrer le défaut de la recette.
 * Le contour réel, lui, n'est pas touché : le `.job` rendu garde le trou
 * entier, c'est SheetCam qui le coupe.
 */
export function partWithReserve(part, options = {}) {
    const res = withLeadInReserve(part.coordinates, options)
    const holes = []
    const holeReports = []
    ;(part.holes || []).forEach((hole, index) => {
        const hres = holeWithLeadInReserve(hole, options)
        if (hres.applied) {
            holes.push(hres.ring)
            holeReports.push({ index, applied: true, reason: null, bites: hres.bites, dropped: false })
            return
        }
        if (hres.reason === 'nothingToReserve') {
            // Ni amorce ni perçage à réserver (le `.job` ne déclare rien) :
            // le trou reste entier, il n'y a aucun risque à y nicher.
            holes.push(hole)
            holeReports.push({ index, applied: false, reason: hres.reason, bites: 0, dropped: false })
            return
        }
        holeReports.push({ index, applied: false, reason: hres.reason, bites: 0, dropped: true })
    })
    return {
        ...part,
        coordinates: res.ring,
        holes,
        reserve: {
            applied: res.applied,
            reason: res.reason,
            pierceMarginMm: Number(options.pierceMarginMm ?? DEFAULT_PIERCE_MARGIN_MM),
            leadIn: Number(options.leadIn ?? 0),
            startIndex: res.startIndex ?? null,
            pierceAt: res.pierceAt ?? null,
            holes: holeReports,
            holesDropped: holeReports.filter((h) => h.dropped).length,
        },
    }
}
