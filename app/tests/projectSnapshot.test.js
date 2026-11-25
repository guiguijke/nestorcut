import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SNAPSHOT_VERSION, snapshotUnit } from '../utils/projectSnapshot'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const factory = { sheets: [{ width: '1000', height: '2000', count: '1' }], kerf: '0', safety: '2', space: '2' }
const typed = { sheets: [{ width: '48', height: '96', count: '1' }], kerf: '0', safety: '0.08', space: '0.08' }

describe('réglages gardés par un onglet de la V0.9.19 (chiffres en pouces notés « mm »)', () => {
    it('saisis à la main par un compte en pouces : lus en pouces, jamais convertis une seconde fois', () => {
        expect(snapshotUnit({ params: typed, paramsUnit: 'mm' }, 'inch')).toBe('inch')
        // Une seule case corrigée, une tôle importée, deux tôles : même règle.
        expect(snapshotUnit({ params: { ...factory, safety: '0.08' }, paramsUnit: 'mm' }, 'inch')).toBe('inch')
        expect(snapshotUnit({ params: { ...factory, sheets: [{ width: '39.37', height: '35.433', count: '1', shapeId: 's' }] }, paramsUnit: 'mm' }, 'inch')).toBe('inch')
        expect(snapshotUnit({ params: { ...factory, sheets: [...factory.sheets, ...typed.sheets] }, paramsUnit: 'mm' }, 'inch')).toBe('inch')
    })

    it('réglages d’usine intacts : en mm, donc convertis', () => {
        expect(snapshotUnit({ params: factory, paramsUnit: 'mm' }, 'inch')).toBe('mm')
    })

    it('écrits par cette version, ou déjà notés en pouces, ou affichés en mm : l’unité notée fait foi', () => {
        expect(snapshotUnit({ v: SNAPSHOT_VERSION, params: typed, paramsUnit: 'mm' }, 'inch')).toBe('mm')
        expect(snapshotUnit({ params: typed, paramsUnit: 'inch' }, 'inch')).toBe('inch')
        expect(snapshotUnit({ params: typed, paramsUnit: 'mm' }, 'mm')).toBe('mm')
    })

    it('le store note sa version et lit l’unité par cette règle', () => {
        const store = read('../composables/files.js')
        expect(store).toMatch(/projectSnapshots\.set\(state\.projectSlug, \{\s*v: SNAPSHOT_VERSION,/)
        expect(store).toMatch(/state\.paramsUnit = snapshotUnit\(snap, getUnitState\(\)\)/)
        expect(store).toMatch(/syncParamsToUnit\(getUnitState\(\), \{ restored: Boolean\(snap\) \}\)/)
    })
})

describe('liste des résultats lue ou non : rien n’est remplacé sans savoir', () => {
    it('le store le note, le changement de projet le remet à faux, la fenêtre d’import le lit', () => {
        const index = read('../composables/index.js')
        expect(index).toMatch(/resultsLoaded: false,/)
        expect(index).toMatch(/function setResults\(results, loaded = true\) \{\s*state\.resultsList = \[\.\.\.results\]\s*state\.resultsLoaded = loaded/)
        expect(read('../components/UserResults.vue')).toMatch(/setResults\(\[\], false\)/)
        expect(read('../components/SheetImportDialog.vue')).toMatch(/const hasResult = !globalStore\.getters\.resultsLoaded\s*\|\|/)
    })

    it('la fenêtre d’un calcul en échec lit le même drapeau local que la carte', () => {
        expect(read('../components/ResultModal.vue')).toMatch(/localOnly: isLocalJob\(unref\(resultModalData\)\)/)
    })
})
