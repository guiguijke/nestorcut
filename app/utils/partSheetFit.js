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

/**
 * Surplomb maximal (mm) qu'une distance au bord NÉGATIVE peut demander : la
 * moitié de la plus petite dimension de la plus petite pièce, min(w, h) / 2 —
 * au-delà, une pièce pourrait être posée entièrement hors de la tôle.
 * Accepte les fichiers du projet ({ count, block?, parts: [{ width, height }] } :
 * un bloc compte pour UNE pièce, sa boîte ; quantité 0 ignorée) ou une liste de
 * pièces { width, height }. Mesures en mm. Infinity sans aucune pièce mesurable
 * (rien ne limite alors le surplomb).
 */
export function maxOverhangMm(parts) {
    let best = Infinity
    const visit = (it) => {
        const w = Number(it?.width)
        const h = Number(it?.height)
        if (!Number.isFinite(w) || !Number.isFinite(h)) return
        const m = Math.min(w, h) / 2
        if (m < best) best = m
    }
    for (const entry of parts || []) {
        if (entry && (Array.isArray(entry.parts) || entry.block)) {
            if (entry.count === 0) continue
            for (const it of (entry.block ? [entry.block] : entry.parts)) visit(it)
        } else {
            visit(entry)
        }
    }
    return best
}
