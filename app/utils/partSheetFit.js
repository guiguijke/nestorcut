/**
 * Garde de la page « chaque pièce tient dans une tôle » (Nest grisé sinon).
 * Une pièce (un bloc compte pour UNE pièce, sa boîte) doit tenir dans au moins
 * une tôle déclarée avec une quantité, dans l'un ou l'autre sens, à 0,1 mm
 * près. Jamais plus stricte que le constructeur de charge : l'espacement n'y
 * entre pas, et un fichier qui permet des rotations hors quart de tour n'est
 * pas testé (la boîte tournée change avec l'angle, le constructeur tranche).
 * Fonction pure, en mm : l'appelant convertit les tôles de l'unité d'affichage.
 */

export const FIT_TOLERANCE_MM = 0.1

/** Écart gardé SOUS l'ajustement exact pour un maximum annoncé : le moteur
 * refuse une pièce qui tient à zéro près (« bande 984,010 pour une limite de
 * 984 ») ; essai du 27/11 avec le vrai moteur : bord 10 refusé, 9,99 posé
 * (pièce 980 sur tôle 1000, espacement 2). */
export const EDGE_FIT_SLACK_MM = 0.02

/**
 * Plus grande distance au bord (mm) avec laquelle la pièce `part` ({ width :
 * côté long, height : côté court }, mm, comme `firstPartFittingNoSheet` la rend)
 * tient dans au moins une tôle active, moins la marge de courbes (comme le
 * constructeur) et EDGE_FIT_SLACK_MM. Boîtes seulement : exacte pour des tôles
 * rectangulaires ; dès qu'une tôle active est importée, sa boîte n'est qu'une
 * borne haute, donc null (aucun chiffre plutôt qu'un maximum refusé ensuite).
 * null aussi si rien ne tient ou si la valeur serait négative.
 */
export function maxEdgeForPartMm(part, { sheets, toMm, marginMm = 0 }) {
    const long = Number(part?.width)
    const short = Number(part?.height)
    if (!Number.isFinite(long) || !Number.isFinite(short)) return null
    let best = -Infinity
    for (const s of sheets || []) {
        const count = s?.count === undefined || s?.count === null ? 1 : Math.trunc(num(s.count))
        if (!(count > 0)) continue
        if (typeof s?.shapeId === 'string' && s.shapeId) return null
        const a = toMm(num(s.width))
        const b = toMm(num(s.height))
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue
        best = Math.max(best, Math.min(Math.max(a, b) - long, Math.min(a, b) - short) / 2)
    }
    if (!Number.isFinite(best)) return null
    const v = best - (Number(marginMm) || 0) - EDGE_FIT_SLACK_MM
    return v >= 0 ? v : null
}

/** N rotations réparties sur le cercle, 0° compris (même règle que le moteur). */
export function rotationAngles(count) {
    const n = Math.min(360, Math.max(1, Math.floor(Number(count) || 4)))
    if (n === 1) return [0]
    const step = 360 / n
    return Array.from({ length: n }, (_, i) => Math.round(i * step))
}

function anglesOf(file, rotationCount) {
    if (typeof file?.rotation === 'string' && file.rotation) {
        try {
            const a = JSON.parse(file.rotation)
            if (Array.isArray(a) && a.length) return a
        } catch { /* repli sur le réglage global */ }
    }
    if (Array.isArray(file?.rotations) && file.rotations.length) return file.rotations
    return rotationAngles(rotationCount)
}

const num = (v) => Number(String(v ?? '').replace(',', '.'))

/**
 * @param {object} args
 * @param {Array} args.files        fichiers du projet ({ name, count, rotation?, block?, parts })
 * @param {Array} args.sheets       tôles des réglages (unité d'affichage : width, height, count)
 * @param {(v:number)=>number} args.toMm  unité d'affichage → mm
 * @param {number|string} [args.rotationCount]  réglage global des rotations
 * @param {number|null} [args.edgeMm]  distance au bord demandée (mm), ou null :
 *   le test d'avant. Donnée, la pièce doit tenir dans la tôle moins 2 × bord
 *   (bord négatif : elle peut la dépasser d'autant), toujours à 0,1 mm près et
 *   sans l'espacement — jamais plus stricte que le constructeur (qui ajoute en
 *   plus la marge de courbes au bord).
 * @returns {null | { name: string, width: number, height: number }}
 *   la première pièce qui ne tient dans aucune tôle (côté long, côté court, mm),
 *   ou null : tout tient, ou le test ne s'applique pas.
 */
export function firstPartFittingNoSheet({ files, sheets, toMm, rotationCount, edgeMm = null }) {
    const edge = edgeMm === null || edgeMm === undefined || edgeMm === '' ? 0 : Number(edgeMm)
    const shrink = Number.isFinite(edge) ? 2 * edge : 0
    const boxes = []
    for (const s of sheets || []) {
        const count = s?.count === undefined || s?.count === null ? 1 : Math.trunc(num(s.count))
        if (!(count > 0)) continue
        const a = toMm(num(s.width))
        const b = toMm(num(s.height))
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue
        boxes.push([Math.max(a, b) - shrink, Math.min(a, b) - shrink])
    }
    // Aucune tôle avec quantité : d'autres gardes le disent, pas celle-ci.
    if (!boxes.length) return null
    for (const file of files || []) {
        if (file?.count === 0) continue
        if (anglesOf(file, rotationCount).some((r) => (Number(r) || 0) % 90 !== 0)) continue
        const items = file.block ? [file.block] : (file.parts || [])
        for (const it of items) {
            const w = Number(it?.width)
            const h = Number(it?.height)
            if (!Number.isFinite(w) || !Number.isFinite(h)) continue
            const long = Math.max(w, h)
            const short = Math.min(w, h)
            const ok = boxes.some(([L, S]) => long <= L + FIT_TOLERANCE_MM && short <= S + FIT_TOLERANCE_MM)
            if (!ok) return { name: file.name || '', width: long, height: short }
        }
    }
    return null
}

/** Plus petit côté possible de la boîte d'une pièce de boîte w × h tournée de
 * `deg` : une borne HAUTE (la boîte tournée de la pièce tient dans celle du
 * rectangle w × h tourné), égale à min(w, h) aux quarts de tour. */
function rotatedShortSideBound(w, h, deg) {
    const a = ((Number(deg) || 0) * Math.PI) / 180
    const c = Math.abs(Math.cos(a))
    const s = Math.abs(Math.sin(a))
    if (s < 1e-12 || c < 1e-12) return Math.min(w, h)
    return Math.min(w * c + h * s, w * s + h * c)
}

/**
 * Surplomb maximal (mm) qu'une distance au bord NÉGATIVE peut demander : la
 * moitié du plus petit côté de la boîte de chaque PIÈCE PHYSIQUE (chaque pièce
 * d'un bloc, pas la boîte du bloc), au plus petit sur ses rotations permises —
 * au-delà, une pièce pourrait être posée entièrement hors de la tôle. Même en
 * deçà, une pièce creuse (équerre, L) peut n'avoir presque plus de matière sur
 * la tôle : le rapport la compte alors hors de la tôle (moins de 1 % de sa
 * matière dessus).
 * Accepte les fichiers du projet ({ count, rotation?/rotations?, block?, parts:
 * [{ width, height }] } : quantité 0 ignorée) ou une liste de pièces
 * { width, height } (sans rotation). La page n'a que les boîtes : hors quart de
 * tour, le côté tourné est une borne haute, donc jamais plus stricte que le
 * constructeur (qui tourne les vrais contours). Mesures en mm. Infinity sans
 * aucune pièce mesurable (rien ne limite alors le surplomb).
 * @param {object} [opts] { rotationCount } : réglage global des rotations.
 */
export function maxOverhangMm(parts, { rotationCount } = {}) {
    let best = Infinity
    const visit = (it, angles) => {
        const w = Number(it?.width)
        const h = Number(it?.height)
        if (!Number.isFinite(w) || !Number.isFinite(h)) return
        let side = Infinity
        for (const a of angles) side = Math.min(side, rotatedShortSideBound(w, h, a))
        const m = side / 2
        if (m < best) best = m
    }
    for (const entry of parts || []) {
        if (entry && (Array.isArray(entry.parts) || entry.block)) {
            if (entry.count === 0) continue
            const angles = anglesOf(entry, rotationCount).map((r) => Number(r) || 0)
            // Un bloc : chacune de ses pièces (la boîte du bloc seulement à défaut).
            const items = Array.isArray(entry.parts) && entry.parts.length ? entry.parts : [entry.block]
            for (const it of items) visit(it, angles)
        } else {
            visit(entry, [0])
        }
    }
    return best
}
