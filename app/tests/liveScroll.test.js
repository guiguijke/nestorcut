import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createLiveScrollGate, isPartlyInView, isWhollyInView, liveScrollSlug, watchUserScroll } from '../utils/liveScroll'

describe('liveScrollSlug', () => {
    it('rend le slug du flux serveur en priorité', () => {
        expect(liveScrollSlug({ serverSlug: 'srv', job: { slug: 'loc', phase: 'running', frame: {} } })).toBe('srv')
    })
    it('rend le slug du job local tant qu’il tourne et a produit une frame', () => {
        for (const phase of ['queued', 'running', 'finalizing']) {
            expect(liveScrollSlug({ serverSlug: null, job: { slug: 'loc', phase, frame: {} } }), phase).toBe('loc')
        }
    })
    it('rend null sans frame, ou une fois le job arrêté', () => {
        expect(liveScrollSlug({ serverSlug: null, job: { slug: 'loc', phase: 'running', frame: null } })).toBeNull()
        for (const phase of ['done', 'error', 'cancelled']) {
            expect(liveScrollSlug({ serverSlug: undefined, job: { slug: 'loc', phase, frame: {} } }), phase).toBeNull()
        }
        expect(liveScrollSlug({ job: null })).toBeNull()
        expect(liveScrollSlug({})).toBeNull()
    })
})

describe('createLiveScrollGate', () => {
    it('laisse passer un job une seule fois', () => {
        const gate = createLiveScrollGate()
        expect(gate.claim('a')).toBe(true)
        expect(gate.claim('a')).toBe(false)
        expect(gate.claim('b')).toBe(true)
        // retour sur le premier job : pas de nouveau défilement
        expect(gate.claim('a')).toBe(false)
    })
    it('ignore les slugs vides', () => {
        const gate = createLiveScrollGate()
        expect(gate.claim(null)).toBe(false)
        expect(gate.claim(undefined)).toBe(false)
        expect(gate.claim('')).toBe(false)
    })
})

describe('watchUserScroll', () => {
    it('ne bouge pas sans geste, bouge à la molette, au doigt ou à chaque touche de défilement', () => {
        const keys = ['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar']
        for (const [type, init] of [['wheel', {}], ['touchmove', {}], ...keys.map((key) => ['keydown', { key }])]) {
            const target = new EventTarget()
            const w = watchUserScroll(target)
            expect(w.moved()).toBe(false)
            target.dispatchEvent(Object.assign(new Event(type), init))
            expect(w.moved(), `${type} ${init.key ?? ''}`).toBe(true)
            w.reset()
            expect(w.moved(), `${type} ${init.key ?? ''} après reset`).toBe(false)
            w.stop()
        }
    })
    it('une frappe sans rapport avec le défilement ne compte pas, et stop() détache', () => {
        const target = new EventTarget()
        const w = watchUserScroll(target)
        target.dispatchEvent(Object.assign(new Event('keydown'), { key: 'a' }))
        expect(w.moved()).toBe(false)
        w.stop()
        target.dispatchEvent(new Event('wheel'))
        expect(w.moved()).toBe(false)
    })
})

describe('isWhollyInView', () => {
    it('vrai seulement si le haut ET le bas sont à l’écran', () => {
        expect(isWhollyInView({ top: 10, bottom: 80 }, 900)).toBe(true)
        expect(isWhollyInView({ top: -1, bottom: 80 }, 900)).toBe(false)
        expect(isWhollyInView({ top: 850, bottom: 910 }, 900)).toBe(false)
        expect(isWhollyInView(null, 900)).toBe(false)
    })
})

describe('isPartlyInView', () => {
    it('vrai dès qu’un pixel touche l’écran, faux au ras des bords', () => {
        expect(isPartlyInView({ top: -500, bottom: 1 }, 900)).toBe(true)
        expect(isPartlyInView({ top: 899, bottom: 2000 }, 900)).toBe(true)
        expect(isPartlyInView({ top: -500, bottom: 0 }, 900)).toBe(false)
        expect(isPartlyInView({ top: 900, bottom: 2000 }, 900)).toBe(false)
        expect(isPartlyInView(null, 900)).toBe(false)
    })
})

// Le comportement est verrouillé par useJobScroll.test.js (vrai composable, vrai
// registre). Il ne reste à la page que ce fil, que seul le navigateur exécute :
// scripts/qa-e2e-failure-scroll.mjs.
describe('câblage de la page projet', () => {
    const src = readFileSync(new URL('../pages/project/[slug].vue', import.meta.url), 'utf8')
    it('branche useJobScroll sur le job du projet affiché et sur les deux éléments du gabarit', () => {
        expect(src).toMatch(/useJobScroll\(\{\s*projectSlug: \(\) => unref\(pageSlug\),\s*progress: \(\) => progressFor\(unref\(pageSlug\)\),\s*serverSlug: \(\) => unref\(liveResult\)\?\.slug,\s*serverJob: \(\) => unref\(serverJob\),\s*liveEl: liveSection,\s*failureEl: jobErrorEl,(?:\s*\/\/[^\n]*)*\s*refusal: \(\) => filesStore\.getters\.nestRefusals,\s*refusalEl: nestRefusalEl,\s*target: import\.meta\.client \? window : null,/)
        expect(src).toMatch(/serverJobState\(unref\(resultsList\), unref\(pageSlug\)\)/)
        expect(src).toMatch(/onFailed: \(\) => resetLastParams\(\)/)
        expect(src).toMatch(/if \(busy\) jobScroll\.expectJob\(\)/)
        expect(src).toMatch(/<section ref="liveSection" class="atelier">/)
        expect(src).toMatch(/v-if="jobErrorText && !capacityPanel" ref="jobErrorEl" class="content__error"/)
        expect(src).toMatch(/v-if="nestSubmitError" ref="nestRefusalEl" class="content__error"/)
    })
    it('ne garde plus de défilement propre', () => {
        expect(src).not.toMatch(/scrollToFailure|watchUserScroll|lastLiveSlug/)
    })
})
