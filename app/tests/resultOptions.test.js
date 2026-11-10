import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DICTS, LOCALES } from '../utils/i18n'
import { directionWordKey } from '../utils/sheetView'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const codes = LOCALES.map((l) => l.code || l)

describe('onglets d\'options : le sens dit en mots', () => {
    it('tôle en paysage : –X = gauche, –Y = bas', () => {
        expect(directionWordKey('left', 2000, 1000)).toBe('alts.dir.left')
        expect(directionWordKey('bottom', 2000, 1000)).toBe('alts.dir.down')
    })

    it('tôle en portrait : même repère que la flèche affichée', () => {
        expect(directionWordKey('left', 1000, 2000)).toBe('alts.dir.up')
        expect(directionWordKey('bottom', 1000, 2000)).toBe('alts.dir.left')
    })

    it('mixte, grille : pas de sens', () => {
        expect(directionWordKey('balanced', 2000, 1000)).toBeNull()
        expect(directionWordKey('grid', 2000, 1000)).toBeNull()
    })

    it.each(codes)('les trois mots existent et ne sont pas des axes (%s)', (code) => {
        for (const k of ['alts.dir.left', 'alts.dir.up', 'alts.dir.down']) {
            const v = DICTS[code][k]
            expect(v, k).toBeTruthy()
            expect(v).not.toMatch(/[–-][XY]\b/)
        }
    })

    it('le sélecteur utilise ces mots', () => {
        expect(read('../components/ResultModal.vue')).toContain('directionWordKey(strategy')
    })
})

describe('onglets d\'options : pastille lisible sur l\'onglet actif', () => {
    const src = read('../components/ResultAlternatives.vue')

    it('la pastille a un fond clair sur l\'onglet actif', () => {
        const active = src.slice(src.indexOf('&--active'))
        expect(active).toMatch(/\.alts__strategy\s*\{[^}]*background-color:\s*var\(--background-primary\)/)
    })

    it('plus de capitales ni de graisse illisible à petite taille', () => {
        expect(src).not.toContain('text-transform: uppercase')
    })
})

describe('bas de la fenêtre : Download est la seule action principale', () => {
    const src = read('../components/ResultReport.vue')
    const controls = src.slice(src.indexOf('data-testid="report-actions"'), src.indexOf('</script>'))
    const blocks = controls.split('<MainButton').slice(1).map((b) => b.slice(0, b.indexOf('/>')))
    const block = (needle) => blocks.find((b) => b.includes(needle))

    it('copier, CSV et recommencer sont au second plan', () => {
        for (const tag of ['report_copy"', 'report_csv"', 'result_try_again']) {
            expect(block(tag), tag).toMatch(/themeType\.ghost/)
        }
    })

    it('le déblocage n\'est plus principal mais garde cadenas, message et clic', () => {
        const b = block('report-unlock')
        expect(b).toMatch(/themeType\.secondary/)
        expect(b).not.toMatch(/themeType\.primary/)
        expect(b).toContain(':icon="iconType.lock"')
        expect(b).toContain("t('results.unlockSheets'")
        expect(b).toContain("$emit('unlock-sheets', 'modal_actions')")
    })

    it('les exports verrouillés gardent cadenas et clic vers l\'abonnement', () => {
        for (const tag of ['report_copy"', 'report_csv"']) {
            const b = block(tag)
            expect(b).toContain(':icon="exportLocked ? iconType.lock : undefined"')
            expect(b).toContain('onExportClick(')
        }
    })

    it('seuls les boutons de téléchargement restent principaux', () => {
        const primary = blocks.filter((b) => b.includes('themeType.primary'))
        expect(primary.length).toBeGreaterThan(0)
        for (const b of primary) {
            expect(b).toMatch(/trackingTag="result_download/)
        }
    })
})
