import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '@vue/compiler-sfc'
import { liveDensity, liveUsedLength } from '~/utils/liveJob'

const source = readFileSync(
    fileURLToPath(new URL('../components/LiveNestingView.vue', import.meta.url)),
    'utf8',
)
const template = parse(source).descriptor.template.content

// Le bloc des statistiques de l'en-tête, du conteneur à sa fermeture.
function statsBlock() {
    const start = template.indexOf('data-testid="live-stats"')
    expect(start).toBeGreaterThan(-1)
    const end = template.indexOf('<div class="live__body">', start)
    expect(end).toBeGreaterThan(start)
    return template.slice(start, end)
}

describe('vue en direct : longueur utilisée', () => {
    it('le gabarit rend la statistique dans .live__stats, sous usedLengthLabel', () => {
        const block = statsBlock()
        expect(block).toContain('data-testid="live-stat-length"')
        expect(block).toMatch(/v-if="usedLengthLabel"[\s\S]*?data-testid="live-stat-length"/)
        expect(block).toContain(":value=\"usedLengthLabel\"")
    })

    it('visible en recherche SPP, absente à l’étape finale et hors SPP', () => {
        const frame = { feasible: true, isSpp: true, strip_width: 1200, sheets: [[2000, 1000]], items: [] }
        expect(liveUsedLength(frame, 'searching')).toBe(1200)
        expect(liveUsedLength(frame, 'final')).toBeNull()
        expect(liveUsedLength(frame, 'reveal')).toBeNull()
        expect(liveUsedLength({ ...frame, isSpp: false }, 'searching')).toBeNull()
    })
})

describe('vue en direct : densité d’un job serveur', () => {
    const serverJob = { status: 'running' }

    it('un ancien worker (pas de densityMeasured) ne montre aucun chiffre', () => {
        expect(liveDensity({ density: 0.728 }, serverJob)).toBeNull()
    })

    it('un worker récent marque la densité mesurée : elle s’affiche', () => {
        expect(liveDensity({ density: 0.15, densityMeasured: true }, serverJob)).toBe(0.15)
    })

    it('le calcul sur l’appareil (pas de statut) garde son chiffre', () => {
        expect(liveDensity({ density: 0.035 }, { slug: 'x' })).toBe(0.035)
    })

    it('le gabarit passe par frameDensity, jamais par density brute', () => {
        expect(template).not.toMatch(/champ\.density/)
        expect(source).toMatch(/liveDensity\(frame, props\.result\)/)
    })
})

describe('vue en direct : statistiques sur téléphone', () => {
    const style = parse(source).descriptor.styles.map((x) => x.content).join('\n')
    const block = (sel) => {
        const i = style.indexOf(sel)
        expect(i).toBeGreaterThan(-1)
        return style.slice(i, i + 700)
    }
    it("l'en-tête et la rangée des statistiques passent à la ligne", () => {
        expect(block('&__header {')).toContain('flex-wrap: wrap')
        expect(block('&__stats {')).toContain('flex-wrap: wrap')
    })
    it('sous une largeur de téléphone, les statistiques prennent toute la ligne', () => {
        expect(block('&__stats {')).toMatch(/@media \(max-width: 640px\)[\s\S]*flex: 1 1 100%/)
    })
})
