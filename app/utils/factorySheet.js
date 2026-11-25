import { DEFAULT_SHEET } from './units'

/**
 * Tôle d'usine intacte : la liste n'a qu'UNE ligne, sans forme importée, encore
 * égale à la tôle d'usine de l'unité des réglages (1000 × 2000 mm ou 48 × 96 po),
 * en quantité 1. Importer une tôle la REMPLACE alors au lieu de s'y ajouter
 * (sinon un nouvel utilisateur lance sans le savoir un calcul mixte). Code isolé :
 * le propriétaire doit encore valider cette règle.
 * @param {Array<{width, height, count, shapeId?}>} sheets réglages (chaînes d'unité d'affichage)
 * @param {'mm'|'inch'} unit unité dans laquelle les réglages sont exprimés
 */
export function isUntouchedFactorySheet(sheets, unit) {
    if (!Array.isArray(sheets) || sheets.length !== 1) return false
    const row = sheets[0]
    if (!row || row.shapeId) return false
    const factory = DEFAULT_SHEET[unit === 'inch' ? 'inch' : 'mm']
    const num = (v) => Number(String(v ?? '').replace(',', '.'))
    return num(row.width) === Number(factory.width)
        && num(row.height) === Number(factory.height)
        && num(row.count) === 1
}

/** Tôle d'usine de l'unité courante, pour la phrase « la tôle de 1000 × 2000 a été remplacée ». */
export function factorySheetOf(unit) {
    return DEFAULT_SHEET[unit === 'inch' ? 'inch' : 'mm']
}
