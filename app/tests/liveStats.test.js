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
