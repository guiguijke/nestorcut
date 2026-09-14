/**
 * DXF canonique d'un dessin décodé du bloc binaire d'un `.job` — lot J6 de
 * `docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §9.62.
 *
 * UN SEUL CODE pour le navigateur et le serveur : entrée `Uint8Array`, sortie
 * `Uint8Array`, aucune dépendance (même discipline que `sheetcamJob.js`).
 *
 * ---------------------------------------------------------------------------
 * POURQUOI UN DXF, ET POURQUOI SI MINCE.
 *
 * Toute la chaîne produit (fiches, pièces, trous, aperçu, échelle,
 * éclatement, export par handle, points de départ du `.job`) part de
 * l'IMPORT ORDINAIRE. Plutôt que d'une chaîne parallèle « géométrie .job » —
 * qui divergerait dès la première évolution de l'importeur — on écrit pour
 * chaque dessin un DXF canonique LINE/ARC et on le repasse PAR L'IMPORT
 * ORDINAIRE. Le `.job` devient une source de géométrie parmi les sources,
 * pas un cas à part.
 *
 * Ce que le format du binaire garantit, et que ce writer respecte :
 *  - des LIGNES et des ARCS, rien d'autre (§9.61 : les splines et ellipses
 *    du DXF d'origine sont DÉJÀ approchées en arcs par SheetCam) ;
 *  - les segments dégénérés (l'entité POINT : ligne a = b) sont OMIS —
 *    l'import ordinaire ne retient pas non plus une entité POINT, le compte
 *    de pièces coïncide ;
 *  - `$INSUNITS = 4` (millimètres) et `$MEASUREMENT = 1`, posés
 *    EXPLICITEMENT : un document reconstruit ne doit jamais hériter des
 *    mètres par défaut d'un `new()` (piège AGENTS #27). Le binaire est en
 *    millimètres comme tout le pipeline (AGENTS #25) ;
 *  - pleine précision, ZÉRO arrondi géométrique (piège AGENTS #28) : les
 *    coordonnées écrites sont les doubles lus, au chiffre près ;
 *  - handles FRAIS en séquence hexadécimale depuis 2F — la convention des
 *    copies canoniques (AGENTS #33b) ; l'import en réassigne de toute façon.
 *
 * Le sens d'un arc : le balayage du binaire est NÉGATIF pour le sens
 * trigonométrique (mesure §9.61, quatre quarts à −π/2 pour le cercle). Or
 * une entité DXF ARC est TOUJOURS parcourue dans le sens trigonométrique de
 * son angle de départ vers son angle d'arrivée : un arc horaire de a vers b
 * s'écrit donc comme l'arc trigonométrique de b vers a. L'étendue est
 * portée par |balayage|, jamais par la différence des angles d'extrémités
 * (ambiguë à 2π près).
 */

import { SheetCamJobError } from './sheetcamJob.js'

/** Tolérance du segment dégénéré : l'entité POINT est écrite a = b exactement
 *  dans le binaire ; on tolère un micron de bruit flottant, pas plus. */
const DEGENERATE_TOL_MM = 1e-6

/** Un flottant DXF : pleine précision, jamais de notation exponentielle (un
 *  parseur DXF ne la garantit pas), toujours un point décimal. */
function dxfFloat(x) {
    const n = Number(x)
    if (!Number.isFinite(n)) {
        throw new SheetCamJobError('sheetcamJob.badNumber', { value: String(x) })
    }
    let s = n.toString()
    if (s.includes('e') || s.includes('E')) {
        s = n.toFixed(20).replace(/0+$/, '')
        if (s.endsWith('.')) s += '0'
    }
    return s.includes('.') ? s : s + '.0'
}

/** Angle en degrés dans [0, 360). */
function degrees(rad) {
    const d = (rad * 180) / Math.PI
    const wrapped = d - Math.floor(d / 360) * 360
    return wrapped
}

/** Handle frais en hexadécimal majuscule, séquence depuis 2F. */
function* freshHandles() {
    let h = 0x2f
    while (true) {
        yield h.toString(16).toUpperCase()
        h += 1
    }
}

/**
 * Écrit le DXF canonique d'un dessin rendu par `jobDrawings`.
 *
 * Rend `null` si le dessin porte une erreur de décodage (on n'écrit JAMAIS
 * la géométrie d'un dessin refusé) ou s'il ne porte aucune entité utile
 * (dessin réduit à des entités POINT).
 */
export function drawingCanonicalDxf(drawing) {
    if (!drawing || drawing.error) return null
    const handles = freshHandles()
    const entities = []
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1])

    for (const path of drawing.paths || []) {
        for (const seg of path.segments || []) {
            if (!seg.a || !seg.b) continue
            if (seg.kind === 'line') {
                if (dist(seg.a, seg.b) <= DEGENERATE_TOL_MM) continue
                entities.push([
                    '0', 'LINE',
                    '5', handles.next().value,
                    '8', '0',
                    '10', dxfFloat(seg.a[0]), '20', dxfFloat(seg.a[1]), '30', '0.0',
                    '11', dxfFloat(seg.b[0]), '21', dxfFloat(seg.b[1]), '31', '0.0',
                ])
                continue
            }
            if (seg.kind !== 'arc' || !seg.c) continue
            if (!(seg.r > 0) || dist(seg.a, seg.b) <= DEGENERATE_TOL_MM
                || !(Math.abs(seg.sweep ?? 0) > 0)) continue
            // Sens : trigonométrique ⇒ de a vers b ; horaire ⇒ de b vers a.
            // L'étendue vaut |balayage| — un tour complet se coupe en deux
            // demi-tours, une entité ARC ne pouvant pas le porter seule.
            const from = seg.ccw ? seg.a : seg.b
            const extentRad = Math.abs(seg.sweep)
            const startDeg = degrees(Math.atan2(from[1] - seg.c[1], from[0] - seg.c[0]))
            const pieces = extentRad >= 2 * Math.PI - 1e-9 ? 2 : 1
            for (let k = 0; k < pieces; k++) {
                const endDeg = startDeg + (degrees(extentRad) / pieces) * (k + 1)
                const pieceStart = startDeg + (degrees(extentRad) / pieces) * k
                entities.push([
                    '0', 'ARC',
                    '5', handles.next().value,
                    '8', '0',
                    '10', dxfFloat(seg.c[0]), '20', dxfFloat(seg.c[1]), '30', '0.0',
                    '40', dxfFloat(seg.r),
                    '50', dxfFloat(pieceStart),
                    '51', dxfFloat(endDeg),
                ])
            }
        }
    }
    if (!entities.length) return null

    const lines = [
        '0', 'SECTION',
        '2', 'HEADER',
        '9', '$ACADVER', '1', 'AC1009',
        '9', '$INSUNITS', '70', '4',
        '9', '$MEASUREMENT', '70', '1',
        '0', 'ENDSEC',
        '0', 'SECTION',
        '2', 'ENTITIES',
        ...entities.flat(),
        '0', 'ENDSEC',
        '0', 'EOF',
    ]
    const text = lines.join('\r\n') + '\r\n'
    const out = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
    return out
}
