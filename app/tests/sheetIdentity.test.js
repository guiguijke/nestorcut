import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isSheetFileAllowed, sheetNumberFromFileName } from '../../shared/constants/sheetDownload.constants'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (rel) => readFileSync(root + rel, 'utf8')

// d4 (02/11) : l'identité d'une tôle se lit dans le NOM du fichier.
describe('sheetNumberFromFileName', () => {
    it("lit le numéro d'un DXF de résultat", () => {
        expect(sheetNumberFromFileName('job-1_alt0_part_1.dxf')).toBe(1)
        expect(sheetNumberFromFileName('job-1_alt3_part_12.dxf')).toBe(12)
        expect(sheetNumberFromFileName('old-job_part_3.dxf')).toBe(3)
    })

    it("lit le numéro d'un .job", () => {
        expect(sheetNumberFromFileName('base_tole3.job')).toBe(3)
    })

    it("est ancré en fin de nom : le dernier numéro l'emporte", () => {
        expect(sheetNumberFromFileName('a_part_3_part_4.dxf')).toBe(4)
    })

    it('rend null pour un nom sans numéro lisible', () => {
        expect(sheetNumberFromFileName('x_part_3.dxf.bak')).toBeNull()
        expect(sheetNumberFromFileName('x_part_3.DXF')).toBeNull()
        expect(sheetNumberFromFileName('x_part_0.dxf')).toBeNull()
        expect(sheetNumberFromFileName('x.dxf')).toBeNull()
        expect(sheetNumberFromFileName('')).toBeNull()
        expect(sheetNumberFromFileName(null)).toBeNull()
        expect(sheetNumberFromFileName(undefined)).toBeNull()
        expect(sheetNumberFromFileName(42)).toBeNull()
    })

    it("refuse un numéro qui n'est pas un entier sûr", () => {
        expect(sheetNumberFromFileName('x_part_99999999999999999999.dxf')).toBeNull()
    })
})

describe('isSheetFileAllowed', () => {
    it('une tôle au-delà du plafond est refusée, en deçà acceptée', () => {
        expect(isSheetFileAllowed('x_part_3.dxf', 2)).toBe(false)
        expect(isSheetFileAllowed('x_part_2.dxf', 2)).toBe(true)
        expect(isSheetFileAllowed('x_part_1.dxf', 2)).toBe(true)
        expect(isSheetFileAllowed('x_tole3.job', 2)).toBe(false)
        expect(isSheetFileAllowed('x_tole2.job', 2)).toBe(true)
    })

    it('Infinity laisse tout passer', () => {
        expect(isSheetFileAllowed('x_part_3.dxf', Infinity)).toBe(true)
        expect(isSheetFileAllowed('x_part_999.dxf', Infinity)).toBe(true)
    })

    it("D2 : un nom illisible n'est jamais verrouillé", () => {
        expect(isSheetFileAllowed('weird.dxf', 2)).toBe(true)
        expect(isSheetFileAllowed('', 2)).toBe(true)
        expect(isSheetFileAllowed(null, 2)).toBe(true)
    })
})

// Verrou des formats des générateurs : si l'un change de forme, les noms
// deviennent illisibles pour la regex, donc NON verrouillés (D2) — en silence.
describe('formats de noms des générateurs', () => {
    it('le navigateur écrit {jobSlug}_part_{N}.dxf', () => {
        expect(read('app/composables/localBridge.js')).toContain('_part_${')
    })

    it('le générateur de .job écrit {baseName}_tole{N}.job', () => {
        expect(read('app/composables/sheetcamJobResult.js')).toContain('_tole${')
    })

    it('le worker écrit {slug}_part_{container_id}.dxf', () => {
        expect(read('workers/nesting/core/main.py')).toContain('_part_{result_container.container_id}.dxf')
    })

    it('un nom produit par chaque générateur est lu par la regex', () => {
        expect(sheetNumberFromFileName('slug-0123456789ab_part_4.dxf')).toBe(4)
        expect(sheetNumberFromFileName('slug-0123456789ab_alt1_part_4.dxf')).toBe(4)
        expect(sheetNumberFromFileName('nesting_tole4.job')).toBe(4)
    })
})
