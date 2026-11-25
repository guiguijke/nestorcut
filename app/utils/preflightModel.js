import { engineBinShape } from './sheetShape'

/**
 * Modèle PUR de l'estimation « ≈ n tôles » de la page projet : les tôles et les
 * pièces que `capacityReport` doit voir. Aucune lecture du navigateur ici : la
 * page lit IndexedDB et passe `shapeStats`.
 *
 * Sans tôle importée active, tout est EXACTEMENT ce que la page calculait avant
 * (rectangles, boîtes des pièces). Avec une tôle importée, l'estimation prend
 * l'aire utile de son contour et l'aire des contours des pièces.
 *
 * shapeStats : { [shapeId]: { widthMm, heightMm, usableAreaMm2, perimeterMm }   lue
 *                         | null                                               absente ou inutilisable
 *                         | SHAPE_UNREADABLE }                                 lecture refusée
 *   un shapeId absent de la table = pas encore lu.
 */

const toNumber = (v) => Number(String(v ?? '').replace(',', '.')) || 0
const shapeIdOf = (row) => (typeof row?.shapeId === 'string' && row.shapeId ? row.shapeId : null)
const isActive = (row) => Math.trunc(Number(row?.count)) > 0

/** Lecture REFUSÉE (IndexedDB fermée) : autre cas que « pas d'enregistrement ». */
export const SHAPE_UNREADABLE = Object.freeze({ unreadable: true })

/** Anneau d'une pièce de la liste (coordonnées, sinon rectangle de sa boîte). */
export function partCoords(p) {
    return p.coordinates ?? p.coords ?? (
        p.width && p.height
            ? [[0, 0], [p.width, 0], [p.width, p.height], [0, p.height], [0, 0]]
            : []
    )
}

/** Les seuls nombres que l'estimation garde d'une forme (jamais le contour). */
export function shapeStatsFromShape(s) {
    return {
        widthMm: s.widthMm,
        heightMm: s.heightMm,
        usableAreaMm2: s.usableAreaMm2,
        perimeterMm: s.perimeterMm,
    }
}

/** Enregistrement absent ou inutilisable (contour illisible, coupe périmée : engineBinShape lève) : null. */
export function shapeStatsOfRecord(record) {
    if (!record) return null
    try {
        return shapeStatsFromShape(engineBinShape(record))
    } catch {
        return null
    }
}

/** Le projet porte-t-il au moins une tôle importée qui SERVIRA (quantité > 0) ? */
export function hasActiveImportedSheet(settings) {
    return (settings || []).some((row) => shapeIdOf(row) && isActive(row))
}

/**
 * Tôles données à capacityReport.
 * - sans tôle importée active : {width, height, count} de chaque ligne, comme avant ;
 * - avec : les lignes actives seulement (quantité > 0, comme le calcul) ; la tôle
 *   importée donne sa boîte, son aire utile et son périmètre.
 * `state` : 'ready' ; 'pending' (une forme pas encore lue) ; 'unreadable' (une
 * lecture refusée) ; 'missing' (enregistrement absent ou inutilisable, noms dans
 * `missing`) ; 'inactive' (des tôles importées, toutes sans quantité : le champ est
 * vide le temps d'une saisie). Jamais un repli sur la boîte d'une tôle importée.
 * @returns {{ sheets: object[], state: string, missing: string[], imported: boolean }}
 */
export function preflightSheetsOf(settings, shapeStats, toMm) {
    const rows = settings || []
    const imported = hasActiveImportedSheet(rows)
    const inactive = !imported && rows.some((row) => shapeIdOf(row))
    const sheets = []
    const missing = []
    let pending = false
    let unreadable = false
    for (const row of rows) {
        const id = shapeIdOf(row)
        if (!id) {
            if (imported && !isActive(row)) continue
            sheets.push({
                width: toMm(toNumber(row.width)),
                height: toMm(toNumber(row.height)),
                count: Number(row.count) || 1,
            })
            continue
        }
        if (!isActive(row)) continue
        const st = shapeStats ? shapeStats[id] : undefined
        if (st === undefined) {
            pending = true
        } else if (st === null) {
            missing.push(String(row.name || id))
        } else if (st === SHAPE_UNREADABLE) {
            unreadable = true
        } else {
            sheets.push({
                width: st.widthMm,
                height: st.heightMm,
                count: Number(row.count) || 1,
                usableAreaMm2: st.usableAreaMm2,
                perimeterMm: st.perimeterMm,
            })
        }
    }
    const state = inactive ? 'inactive' : missing.length ? 'missing' : unreadable ? 'unreadable' : pending ? 'pending' : 'ready'
    return { sheets, state, missing, imported }
}

/**
 * Pièces données à capacityReport. Sans tôle importée : la boîte de chaque pièce,
 * comme avant. Avec : l'aire et le périmètre du contour quand la fiche les porte
 * (un bloc = UN item, l'enveloppe de toutes ses pièces) ; sinon la boîte, comme avant.
 */
export function preflightParts(files, imported) {
    const parts = []
    for (const f of files || []) {
        const count = Number(f.count) || 0
        if (!count) continue
        const block = f.block
        if (imported && block && Number(block.outlineAreaMm2) > 0) {
            parts.push({
                coords: partCoords({ width: block.width, height: block.height }),
                outlineAreaMm2: block.outlineAreaMm2,
                outlinePerimeterMm: block.outlinePerimeterMm,
                count,
            })
            continue
        }
        for (const p of f.parts || []) {
            const item = { coords: partCoords(p), count }
            if (imported && Number(p.outlineAreaMm2) > 0) {
                item.outlineAreaMm2 = p.outlineAreaMm2
                item.outlinePerimeterMm = p.outlinePerimeterMm
            }
            parts.push(item)
        }
    }
    return parts
}

/**
 * Le chiffre « ≈ n tôles » : sans tôle importée, toujours dit (repli à 1 d'avant).
 * Avec une tôle importée : seulement si toutes les formes sont lues ET que
 * capacityReport a rendu un rapport. Le panneau de refus suit le même chiffre (une
 * seule source, il suit les réglages) ; sans chiffre, il garde celui du refus.
 */
export function sheetFigure({ imported, state, report }) {
    if (state === 'inactive') return { show: false, n: 1, panelSheets: null }
    if (!imported) return { show: true, n: report?.sheetsNeeded ?? 1, panelSheets: report?.sheetsNeeded ?? null }
    const show = state === 'ready' && Boolean(report)
    return { show, n: report?.sheetsNeeded ?? 1, panelSheets: show ? report.sheetsNeeded : null }
}
