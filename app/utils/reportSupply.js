/**
 * Rapport d'un calcul à tôle illimitée : chaque ligne `report.sheets[i]` porte
 * `supply` ('stock' : tôle à quantité fixe ; 'new' : tôle illimitée, à prévoir).
 * Sans ce champ (tout autre calcul), chaque fonction ne dit rien : le rapport,
 * le texte copié et le CSV restent ceux d'avant. Module PUR.
 */
const ORDER = ['stock', 'new']
const LINE_KEY = { stock: 'report.supply.fromStock', new: 'report.supply.toBuy' }
const CELL_KEY = { stock: 'report.supply.stock', new: 'report.supply.new' }

export function hasSupply(rows) {
    return Array.isArray(rows) && rows.some((r) => ORDER.includes(r?.supply))
}

/**
 * Formats distincts des tôles d'UNE origine, regroupés comme `totals.formats`
 * du rapport (même boîte ; une tôle importée ne se confond ni avec un rectangle
 * ni avec une autre forme de même boîte), la plus grande boîte d'abord. Regroupés
 * depuis les lignes : `totals.formats` réunit deux tôles de même taille, quelle
 * que soit leur origine.
 * @returns {Array<{widthMm: number, heightMm: number, count: number, shaped?: true}>}
 */
export function formatsOfSupply(rows, supply) {
    const formats = new Map()
    for (const row of rows || []) {
        if (row?.supply !== supply) continue
        const shape = row.shaped ? [row.outlineAreaMm2, row.zonesAreaMm2, row.sheetAreaMm2] : null
        const key = JSON.stringify([row.widthMm, row.heightMm, shape])
        const known = formats.get(key)
        if (known) known.count += 1
        else {
            formats.set(key, {
                widthMm: row.widthMm,
                heightMm: row.heightMm,
                count: 1,
                ...(row.shaped ? { shaped: true } : {}),
            })
        }
    }
    return [...formats.values()].sort((a, b) => b.widthMm * b.heightMm - a.widthMm * a.heightMm)
}

/**
 * « Du stock : 1 × 600 × 800 mm — À prévoir : 3 × 1000 × 2000 mm » (les parties
 * vides ne sont pas dites).
 * @param {(f: object) => string} formatText un format → son texte, celui du
 *   bloc « Matière nécessaire » (unité, mention « tôle importée »).
 */
export function materialBySupply(rows, formatText, t) {
    return ORDER.map((supply) => {
        const formats = formatsOfSupply(rows, supply)
        return formats.length ? t(LINE_KEY[supply], { formats: formats.map(formatText).join(' + ') }) : ''
    }).filter(Boolean).join(' — ')
}

/** Colonne « Origine » du CSV : { header, cells } alignées sur les lignes, ou
 * null quand le rapport n'a pas d'origine (CSV d'avant). */
export function supplyColumn(rows, t) {
    if (!hasSupply(rows)) return null
    return {
        header: t('report.supply.column'),
        cells: rows.map((r) => (CELL_KEY[r?.supply] ? t(CELL_KEY[r.supply]) : '')),
    }
}
