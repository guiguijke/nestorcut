import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ref, watch } from 'vue'
import { createLiveScrollGate, liveScrollSlug } from '../utils/liveScroll'

describe('liveScrollSlug', () => {
    it('rend le slug du flux serveur en priorité', () => {
        expect(liveScrollSlug({ serverSlug: 'srv', localRunning: true, localFrameSlug: 'loc' })).toBe('srv')
    })
    it('rend le slug du calcul navigateur tant qu\'il tourne et a une frame', () => {
        expect(liveScrollSlug({ serverSlug: null, localRunning: true, localFrameSlug: 'loc' })).toBe('loc')
    })
    it('rend null sans frame, ou une fois le calcul navigateur arrêté', () => {
        expect(liveScrollSlug({ serverSlug: null, localRunning: true, localFrameSlug: undefined })).toBeNull()
        expect(liveScrollSlug({ serverSlug: undefined, localRunning: false, localFrameSlug: 'loc' })).toBeNull()
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

// Même câblage que la page : un watch sur le slug calculé, derrière la garde.
describe('défilement pendant un calcul navigateur', () => {
    const setup = () => {
        const serverSlug = ref(null)
        const localRunning = ref(false)
        const frame = ref(null)
        const gate = createLiveScrollGate()
        const scrolls = []
        watch(
            () => liveScrollSlug({
                serverSlug: serverSlug.value,
                localRunning: localRunning.value,
                localFrameSlug: frame.value?.slug,
            }),
            (slug) => { if (gate.claim(slug)) scrolls.push(slug) },
            { flush: 'sync' },
        )
        return { serverSlug, localRunning, frame, scrolls }
    }

    it('défile une fois au premier frame, pas à chaque frame', () => {
        const { localRunning, frame, scrolls } = setup()
        localRunning.value = true
        expect(scrolls).toEqual([]) // en file, pas encore de frame
        frame.value = { slug: 'job-1', liveLayout: { n: 1 } }
        for (let i = 2; i <= 50; i++) frame.value = { slug: 'job-1', liveLayout: { n: i } }
        expect(scrolls).toEqual(['job-1'])
    })

    it('ne réarme pas à la fin du calcul ni au retour de la même frame', () => {
        const { localRunning, frame, scrolls } = setup()
        localRunning.value = true
        frame.value = { slug: 'job-1' }
        localRunning.value = false
        localRunning.value = true
        expect(scrolls).toEqual(['job-1'])
    })

    it('défile à nouveau pour un nouveau job du même projet', () => {
        const { localRunning, frame, scrolls } = setup()
        localRunning.value = true
        frame.value = { slug: 'job-1' }
        localRunning.value = false
        frame.value = null
        localRunning.value = true
        frame.value = { slug: 'job-2' }
        expect(scrolls).toEqual(['job-1', 'job-2'])
    })

    it('un changement de projet qui vide la frame ne déclenche rien', () => {
        const { localRunning, frame, scrolls } = setup()
        localRunning.value = true
        frame.value = { slug: 'job-A' }
        // la page remet à zéro (watch pageSlug) puis revient sur A : même job
        localRunning.value = false
        frame.value = null
        localRunning.value = true
        frame.value = { slug: 'job-A' }
        expect(scrolls).toEqual(['job-A'])
    })

    it('le flux serveur défile toujours une fois', () => {
        const { serverSlug, scrolls } = setup()
        serverSlug.value = 'srv-1'
        serverSlug.value = 'srv-1'
        expect(scrolls).toEqual(['srv-1'])
    })
})

describe('câblage de la page projet', () => {
    const src = readFileSync(new URL('../pages/project/[slug].vue', import.meta.url), 'utf8')
    it('le watch lit la frame du calcul navigateur, déclarée avant lui', () => {
        const watchAt = src.indexOf('const liveScrollGate = createLiveScrollGate()')
        expect(watchAt).toBeGreaterThan(0)
        expect(src.indexOf('const localComputeRunning = ref(')).toBeLessThan(watchAt)
        expect(src.indexOf('const localLiveFrame = ref(')).toBeLessThan(watchAt)
        expect(src).toMatch(/localFrameSlug: unref\(localLiveFrame\)\?\.slug/)
    })
    it('n\'utilise plus le seul slug du flux serveur', () => {
        expect(src).not.toMatch(/lastLiveSlug/)
    })
})
