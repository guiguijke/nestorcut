import { isUntouchedFactorySheet } from './factorySheet'

/** Version des réglages gardés par onglet (sessionStorage). Sans elle : écrits par la
 * V0.9.19 ou avant, qui notait « mm » des chiffres saisis en pouces. */
export const SNAPSHOT_VERSION = 2

const num = (v) => Number(String(v ?? '').replace(',', '.'))

/**
 * Unité dans laquelle LIRE les réglages gardés d'un projet. Un onglet ouvert avant la
 * mise à jour par un compte en pouces porte des chiffres en pouces notés « mm » (il
 * affichait déjà « 48 × 96 pouces » pour eux) : les convertir une seconde fois
 * donnerait une tôle de 1,9 × 3,8 pouces et un espacement 25 fois trop petit. Seuls
 * les réglages d'usine intacts, que personne n'a saisis, sont bien en mm.
 */
export function snapshotUnit(snap, displayUnit) {
    if (snap?.v >= SNAPSHOT_VERSION || snap?.paramsUnit !== 'mm' || displayUnit !== 'inch') return snap?.paramsUnit
    const p = snap.params || {}
    const untouched = isUntouchedFactorySheet(p.sheets, 'mm') && num(p.kerf ?? 0) === 0 && num(p.safety ?? 2) === 2
    return untouched ? 'mm' : 'inch'
}
