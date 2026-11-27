/**
 * Affichage d'une pièce qui dépasse du bord de la tôle (distance au bord
 * négative). Fonctions pures, sans Vue.
 *
 * Le SVG d'une tôle est écrit avec `viewBox="0 0 W H"` : tout ce qui sort de
 * ce cadre est rogné par le navigateur, alors que le DXF est correct. On
 * ÉLARGIT donc le cadre d'une marge (mm) de chaque côté, sans toucher à la
 * ligne du rectangle de la tôle (sheetDraw.js la retrouve par sa forme exacte).
 * Marge 0 (ou invalide) : la chaîne rendue est la même, au caractère près.
 */

/** Marge d'affichage (mm) pour une distance au bord demandée : max(0, -e). */
export function overhangMarginMm(requestedEdgeMm) {
    if (requestedEdgeMm === null || requestedEdgeMm === undefined || requestedEdgeMm === '') return 0
    const e = Number(requestedEdgeMm)
    if (!Number.isFinite(e) || !(e < 0)) return 0
    return -e
}

/** Marge positive et finie, sinon 0. */
function positiveMargin(marginMm) {
    const m = Number(marginMm)
    return Number.isFinite(m) && m > 0 ? m : 0
}

const SVG_TAG = /<svg\b[^>]*>/
const NUM = '[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?'

function trimNum(n) {
    // Pas de notation exponentielle ni de bruit flottant dans l'attribut.
    return String(Number(n.toFixed(6)))
}

/**
 * Élargit le viewBox (et width/height) du premier `<svg>` d'une marge, en mm.
 * La marge est convertie dans l'unité de l'attribut width quand elle est en
 * pouces (« in »). Un SVG sans viewBox « 0 0 W H » lisible est rendu tel quel.
 */
export function widenSvgViewBox(svg, marginMm) {
    const m = positiveMargin(marginMm)
    if (!(m > 0) || typeof svg !== 'string') return svg
    const tag = SVG_TAG.exec(svg)
    if (!tag) return svg
    const open = tag[0]
    const vb = new RegExp(`viewBox="\\s*(${NUM})[\\s,]+(${NUM})[\\s,]+(${NUM})[\\s,]+(${NUM})\\s*"`).exec(open)
    if (!vb) return svg
    const [x, y, vw, vh] = [Number(vb[1]), Number(vb[2]), Number(vb[3]), Number(vb[4])]
    if (![x, y, vw, vh].every(Number.isFinite) || !(vw > 0) || !(vh > 0)) return svg
    const wAttr = new RegExp(`\\swidth="(${NUM})([a-z%]*)"`).exec(open)
    const hAttr = new RegExp(`\\sheight="(${NUM})([a-z%]*)"`).exec(open)
    // Unité du viewBox : celle de l'attribut width (mm par défaut ; « in » : pouces).
    const mu = wAttr && wAttr[2] === 'in' ? m / 25.4 : m
    const nvw = vw + 2 * mu
    const nvh = vh + 2 * mu
    let next = open.replace(vb[0], `viewBox="${trimNum(x - mu)} ${trimNum(y - mu)} ${trimNum(nvw)} ${trimNum(nvh)}"`)
    if (wAttr) next = next.replace(wAttr[0], ` width="${trimNum(Number(wAttr[1]) * nvw / vw)}${wAttr[2]}"`)
    if (hAttr) next = next.replace(hAttr[0], ` height="${trimNum(Number(hAttr[1]) * nvh / vh)}${hAttr[2]}"`)
    return svg.replace(open, next)
}

const DATA_PLAIN = 'data:image/svg+xml,'
const DATA_B64 = 'data:image/svg+xml;base64,'

/**
 * Même chose pour un SVG déjà en data URI (aperçus <img> / <image>). Seuls les
 * data URI à texte (pourcent-encodés ou base64) sont élargis ; une URL blob ou
 * http est rendue telle quelle (on ne peut pas la lire de façon synchrone).
 */
export function widenSvgDataUri(uri, marginMm) {
    if (!(positiveMargin(marginMm) > 0) || typeof uri !== 'string') return uri
    try {
        if (uri.startsWith(DATA_PLAIN)) {
            const svg = decodeURIComponent(uri.slice(DATA_PLAIN.length))
            const wide = widenSvgViewBox(svg, marginMm)
            if (wide === svg) return uri
            return `${DATA_PLAIN}${encodeURIComponent(wide).replace(/'/g, '%27').replace(/"/g, '%22')}`
        }
        if (uri.startsWith(DATA_B64) && typeof atob === 'function' && typeof btoa === 'function') {
            const bytes = atob(uri.slice(DATA_B64.length))
            const svg = decodeURIComponent(escape(bytes))
            const wide = widenSvgViewBox(svg, marginMm)
            if (wide === svg) return uri
            return `${DATA_B64}${btoa(unescape(encodeURIComponent(wide)))}`
        }
    } catch {
        // SVG illisible : l'aperçu reste celui d'avant.
    }
    return uri
}

/** Cadre `x y w h` du viewBox d'aperçu, élargi de la marge (mm) de chaque côté. */
export function viewBoxWithMargin(viewW, viewH, marginMm) {
    const m = positiveMargin(marginMm)
    if (!(m > 0)) return `0 0 ${viewW} ${viewH}`
    return `${-m} ${-m} ${viewW + 2 * m} ${viewH + 2 * m}`
}

/** Tolérance (mm) des contrôles de bord : celle du rapport (edgeOk). */
export const EDGE_BADGE_EPS_MM = 0.01

/**
 * Ce que le rapport dit du bord, pour les pastilles de la fenêtre de résultat.
 * `null` quand le rapport n'a pas de champs de bord (résultat d'avant, ou bord
 * non réglé) : l'appelant garde alors ses pastilles d'origine, inchangées.
 *   - edge : { ok, kind: 'atLeast' | 'overhang', valueMm } (valeur absolue demandée),
 *     ou null si la distance demandée n'est pas connue ;
 *   - outsideMm : profondeur de dépassement AU-DELÀ du permis, ou null ;
 */
export function edgeReportModel(report, requestedEdgeMm) {
    if (!report || typeof report.edgeOk !== 'boolean') return null
    const e = requestedEdgeMm === null || requestedEdgeMm === undefined || requestedEdgeMm === ''
        ? NaN : Number(requestedEdgeMm)
    const known = Number.isFinite(e)
    const allowed = known ? Math.max(0, -e) : 0
    const gap = report.edgeGapMm === null || report.edgeGapMm === undefined ? NaN : Number(report.edgeGapMm)
    const beyond = Number.isFinite(gap) ? -gap - allowed : 0
    return {
        edge: known ? { ok: report.edgeOk, kind: e < 0 ? 'overhang' : 'atLeast', valueMm: Math.abs(e) } : null,
        outsideMm: beyond > EDGE_BADGE_EPS_MM ? beyond : null,
    }
}

/**
 * Quel message « pièce trop grande » et quelle pièce nommer. `withEdge` : la
 * première pièce qui ne tient pas AVEC le bord demandé ; `plain` : la même
 * recherche sans bord. Le message « bord » ne vaut que si le bord est la cause
 * (bord positif ET toute pièce tient sans lui) ; sinon c'est la pièce trop
 * grande de toute façon qu'il faut changer d'abord, comme le constructeur.
 * Bord non réglé : un seul appel, mêmes valeurs.
 */
export function minSheetCase(edgeMm, withEdge, plain) {
    const hasEdge = edgeMm !== null && edgeMm !== undefined && edgeMm !== ''
    const edgeIsCause = hasEdge && Number(edgeMm) > 0 && !plain
    return edgeIsCause
        ? { edge: true, part: withEdge }
        : { edge: false, part: plain ?? withEdge }
}
