import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from '@vue/compiler-sfc'

const source = readFileSync(
    fileURLToPath(new URL('../components/DialogWrapper.vue', import.meta.url)),
    'utf8',
)
const style = parse(source).descriptor.styles.map((s) => s.content).join('\n')

describe('fenêtre : croix de fermeture', () => {
    const i = style.indexOf('&__close {')
    const rule = style.slice(i, style.indexOf('}', i))

    it('reste visible quand la boîte défile (collante, pas absolue)', () => {
        expect(i).toBeGreaterThan(-1)
        expect(rule).toContain('position: sticky')
        expect(rule).not.toContain('position: absolute')
        expect(rule).toContain('top: 8.5px')
    })

    it('ne prend pas de place dans le flux de la fenêtre', () => {
        expect(rule).toMatch(/margin:\s*8\.5px 8\.5px -38\.5px auto/)
    })
})
