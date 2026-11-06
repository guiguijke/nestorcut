import { beforeEach, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ref, watch } from 'vue'
import { createLiveScrollGate, isWhollyInView, liveScrollSlug, watchUserScroll } from '../utils/liveScroll'

describe('liveScrollSlug', () => {
    it('rend le slug du flux serveur en priorité', () => {
        expect(liveScrollSlug({ serverSlug: 'srv', localRunning: true, localFrameSlug: 'loc' })).toBe('srv')
    })
    it('rend le slug du calcul navigateur tant qu\'il tourne et a une frame', () => {
        expect(liveScrollSlug({ serverSlug: null, localRunning: true, localFrameSlug: 'loc', localJobSlug: 'loc' })).toBe('loc')
    })
    it('ignore la frame d’un autre job que celui suivi', () => {
        expect(liveScrollSlug({ serverSlug: null, localRunning: true, localFrameSlug: 'A', localJobSlug: 'B' })).toBeNull()
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

// Même câblage et même enchaînement que la page : `apply` reproduit le
// watcher de progression de [slug].vue (la frame n'est JAMAIS vidée entre deux
// jobs, seul le slug du job suivi change), et `mount` une nouvelle instance de
// page (garde neuve, mais l'ensemble des slugs défilés survit au démontage).
describe('défilement pendant un calcul navigateur', () => {
    const RUNNING = ['queued', 'running', 'finalizing']
    const shared = { seen: new Set() }
    const mount = () => {
        const serverSlug = ref(null)
        const localRunning = ref(false)
        const frame = ref(null)
        const jobSlug = ref(null)
        const gate = createLiveScrollGate(shared.seen)
        const scrolls = []
        watch(
            () => liveScrollSlug({
                serverSlug: serverSlug.value,
                localRunning: localRunning.value,
                localFrameSlug: frame.value?.slug,
                localJobSlug: jobSlug.value,
            }),
            (slug) => { if (gate.claim(slug)) scrolls.push(slug) },
            { flush: 'sync' },
        )
        const apply = (p) => {
            localRunning.value = RUNNING.includes(p.phase)
            jobSlug.value = p.slug
            frame.value = p.frame ? { slug: p.slug } : frame.value
        }
        return { serverSlug, scrolls, apply }
    }
    beforeEach(() => { shared.seen = new Set() })

    it('défile une fois au premier frame, pas à chaque frame', () => {
        const { apply, scrolls } = mount()
        apply({ slug: 'job-1', phase: 'queued' })
        expect(scrolls).toEqual([]) // en file, pas encore de frame
        for (let i = 0; i < 50; i++) apply({ slug: 'job-1', phase: 'running', frame: {} })
        expect(scrolls).toEqual(['job-1'])
    })

    it('ne réarme pas à la fin du calcul ni quand il reprend', () => {
        const { apply, scrolls } = mount()
        apply({ slug: 'job-1', phase: 'running', frame: {} })
        apply({ slug: 'job-1', phase: 'done', frame: {} })
        apply({ slug: 'job-1', phase: 'running', frame: {} })
        expect(scrolls).toEqual(['job-1'])
    })

    it('job B après la fin de A : rien au lancement (frame périmée), une fois à la première frame de B', () => {
        const { apply, scrolls } = mount()
        apply({ slug: 'A', phase: 'running', frame: {} })
        apply({ slug: 'A', phase: 'done', frame: {} })
        expect(scrolls).toEqual(['A'])
        apply({ slug: 'B', phase: 'queued' }) // la frame de A est encore là
        expect(scrolls).toEqual(['A'])
        apply({ slug: 'B', phase: 'running', frame: {} })
        expect(scrolls).toEqual(['A', 'B'])
        apply({ slug: 'B', phase: 'running', frame: {} })
        expect(scrolls).toEqual(['A', 'B'])
    })

    it('retour sur la page avec A fini puis lancement de B : A ne défile pas, B une fois', () => {
        const first = mount()
        first.apply({ slug: 'A', phase: 'running', frame: {} })
        first.apply({ slug: 'A', phase: 'done', frame: {} })
        const back = mount() // nouvelle instance de page, garde neuve
        back.apply({ slug: 'A', phase: 'done', frame: {} })
        back.apply({ slug: 'B', phase: 'queued' })
        back.apply({ slug: 'B', phase: 'running', frame: {} })
        expect(back.scrolls).toEqual(['B'])
    })

    it('retour sur la page pendant que A tourne encore : pas de nouveau défilement', () => {
        const first = mount()
        first.apply({ slug: 'A', phase: 'running', frame: {} })
        expect(first.scrolls).toEqual(['A'])
        const back = mount()
        back.apply({ slug: 'A', phase: 'running', frame: {} })
        expect(back.scrolls).toEqual([])
    })

    it('le flux serveur défile toujours une fois', () => {
        const { serverSlug, scrolls } = mount()
        serverSlug.value = 'srv-1'
        serverSlug.value = 'srv-1'
        expect(scrolls).toEqual(['srv-1'])
    })
})

describe('watchUserScroll', () => {
    it('ne bouge pas sans geste, bouge à la molette, au doigt ou à une touche de défilement', () => {
        for (const [type, init] of [['wheel', {}], ['touchmove', {}], ['keydown', { key: 'PageDown' }]]) {
            const target = new EventTarget()
            const w = watchUserScroll(target)
            expect(w.moved()).toBe(false)
            target.dispatchEvent(Object.assign(new Event(type), init))
            expect(w.moved(), type).toBe(true)
            w.reset()
            expect(w.moved(), `${type} après reset`).toBe(false)
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

describe('câblage de la page projet', () => {
    const src = readFileSync(new URL('../pages/project/[slug].vue', import.meta.url), 'utf8')
    it('le watch lit la frame du calcul navigateur, déclarée avant lui', () => {
        const watchAt = src.indexOf('const liveScrollGate = createLiveScrollGate(')
        expect(watchAt).toBeGreaterThan(0)
        expect(src.indexOf('const localComputeRunning = ref(')).toBeLessThan(watchAt)
        expect(src.indexOf('const localLiveFrame = ref(')).toBeLessThan(watchAt)
        expect(src.indexOf('const localJobSlug = ref(')).toBeLessThan(watchAt)
        expect(src).toMatch(/localFrameSlug: unref\(localLiveFrame\)\?\.slug/)
        expect(src).toMatch(/localJobSlug: unref\(localJobSlug\)/)
        expect(src).toMatch(/createLiveScrollGate\(import\.meta\.client \? scrolledJobSlugs/)
    })
    it('n\'utilise plus le seul slug du flux serveur', () => {
        expect(src).not.toMatch(/lastLiveSlug/)
    })
    it('l’échec n’est amené à l’écran que sur la transition en cours -> erreur, sans geste de l’utilisateur', () => {
        expect(src).toMatch(/const justFailed = localComputeRunning\.value && Boolean\(localComputeError\.value\)/)
        expect(src).toMatch(/justFailed && userScroll && !userScroll\.moved\(\)\) scrollToFailure\(\)/)
        expect(src).toMatch(/ref="localErrorEl" class="content__error"/)
    })
})
