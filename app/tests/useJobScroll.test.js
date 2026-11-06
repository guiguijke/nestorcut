import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, watch } from 'vue'
import { useJobScroll } from '~/composables/useJobScroll'

// Exécute le vrai composable sur le vrai registre local (seul le runner est
// remplacé, comme dans localSolverRegistry.test.js) : ce sont les transitions
// réelles d'un job qui font défiler. Le navigateur est remplacé par une page à
// une seule coordonnée, `y` ; `scrollIntoView` y amène la position là où le
// navigateur la mettrait, sauf `liveInFlight` : le défilement live est parti et
// la page n'a pas encore bougé (il est animé, l'échec peut arriver pendant).
//
// Géométrie mesurée dans le navigateur, build du lot A, 1440x900, réglages
// d'usine : atelier 200-1210 en page, bandeau 1228-1310.
function fakePage({ vh = 900, y = 641, liveInFlight = false } = {}) {
    const target = new EventTarget()
    const page = { y, vh, calm: false, calls: [], target }
    target.innerHeight = vh
    target.matchMedia = () => ({ matches: page.calm })
    const element = (name, top, height, landing) => ({
        getBoundingClientRect: () => ({ top: top - page.y, bottom: top + height - page.y }),
        scrollIntoView: (opts) => {
            page.calls.push({ name, ...opts })
            if (!(name === 'section' && liveInFlight)) page.y = landing(top, height)
        },
    })
    page.section = element('section', 200, 1010, (top) => top)
    page.banner = element('banner', 1228, 82, (top, height) => top + height / 2 - vh / 2)
    page.bannerWhole = () => {
        const r = page.banner.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= vh
    }
    page.wheel = (dy) => {
        page.y += dy
        target.dispatchEvent(new Event('wheel'))
    }
    return page
}

const flush = async () => {
    await new Promise((r) => setTimeout(r, 0))
    await nextTick()
    await nextTick()
}

const names = (page) => page.calls.map((c) => c.name)

describe('useJobScroll, sur le vrai registre local', () => {
    let registry
    let runs

    beforeEach(async () => {
        vi.resetModules()
        registry = await import('../composables/localSolverRegistry')
        runs = new Map()
        registry.configureSolver({
            run: (slug, opts) => new Promise((resolve) => {
                runs.set(slug, { onLive: opts.onLive, resolve })
            }),
            cancel: async () => {},
        })
    })

    const start = (slug, projectSlug = 'p1', maxConcurrent = 1) =>
        registry.ensureJob({ slug }, { projectSlug, maxConcurrent })
    const frame = async (slug) => {
        runs.get(slug).onLive({ bins: 1, density: 0.5 })
        await flush()
    }
    const finish = async (slug, res) => {
        runs.get(slug).resolve(res)
        await flush()
    }
    const fail = (slug) => finish(slug, { ok: false, error: 'item_unplaceable' })

    // Monte comme la page : le bandeau n'existe qu'une fois rendu, donc après
    // les watchers de la transition (`v-if`, d'où le watch post-flush).
    function mount(page, { projectSlug = ref('p1'), serverSlug = ref(null), seen = new Set(), panel = false, staleBanner = false } = {}) {
        const scope = effectScope()
        const failureEl = ref(null)
        scope.run(() => {
            useJobScroll({
                progress: () => registry.progressFor(projectSlug.value),
                serverSlug: () => serverSlug.value,
                liveEl: ref(page.section),
                failureEl,
                target: page.target,
                seen,
            })
            watch(
                () => {
                    const p = registry.progressFor(projectSlug.value)
                    return staleBanner || (p?.phase === 'error' && p?.error !== 'cancelled' && !panel)
                },
                (show) => { failureEl.value = show ? page.banner : null },
                { flush: 'post', immediate: true },
            )
        })
        return { scope, projectSlug, serverSlug, seen }
    }

    describe('vue live', () => {
        it('défile une fois à la première frame, pas au lancement ni aux frames suivantes', async () => {
            const page = fakePage()
            mount(page)
            start('a')
            await flush()
            expect(page.calls).toEqual([])
            await frame('a')
            expect(page.calls).toEqual([{ name: 'section', behavior: 'smooth', block: 'start' }])
            for (let i = 0; i < 5; i++) await frame('a')
            expect(names(page)).toEqual(['section'])
        })

        it('job B après A : la frame de A ne compte pas, une fois à la première frame de B', async () => {
            const page = fakePage()
            mount(page)
            start('a')
            await frame('a')
            await finish('a', { ok: true })
            expect(names(page)).toEqual(['section'])
            start('b')
            await flush()
            expect(names(page)).toEqual(['section'])
            await frame('b')
            await frame('b')
            expect(names(page)).toEqual(['section', 'section'])
        })

        it('retour sur la page pendant que A tourne : pas de nouveau défilement', async () => {
            const seen = new Set()
            const first = fakePage()
            const a = mount(first, { seen })
            start('a')
            await frame('a')
            a.scope.stop()
            const back = fakePage()
            mount(back, { seen })
            await frame('a')
            expect(names(first)).toEqual(['section'])
            expect(back.calls).toEqual([])
        })

        it('une frame d’un autre projet ne fait pas défiler la page', async () => {
            const page = fakePage()
            mount(page, { projectSlug: ref('p2') })
            start('a', 'p1')
            await frame('a')
            expect(page.calls).toEqual([])
        })

        it('le flux serveur défile une fois', async () => {
            const page = fakePage()
            const { serverSlug } = mount(page)
            serverSlug.value = 'srv'
            await flush()
            serverSlug.value = null
            await flush()
            serverSlug.value = 'srv'
            await flush()
            expect(names(page)).toEqual(['section'])
        })
    })

    describe('vue live, page remontée', () => {
        it('le flux serveur revient après le remontage (SSE reconnecté) : pas de second défilement', async () => {
            const seen = new Set()
            const first = fakePage()
            const a = mount(first, { seen })
            a.serverSlug.value = 'srv'
            await flush()
            expect(names(first)).toEqual(['section'])
            a.scope.stop()
            const back = fakePage()
            const b = mount(back, { seen })
            b.serverSlug.value = 'srv'
            await flush()
            expect(back.calls).toEqual([])
        })
    })

    describe('échec du job', () => {
        it('sans geste : le bandeau finit entier à l’écran, centré, après la vue live', async () => {
            const page = fakePage()
            mount(page)
            start('a')
            await frame('a')
            await fail('a')
            expect(page.calls).toEqual([
                { name: 'section', behavior: 'smooth', block: 'start' },
                { name: 'banner', behavior: 'smooth', block: 'center' },
            ])
            expect(page.bannerWhole()).toBe(true)
        })

        it('échec avant toute frame : le bandeau hors écran est amené', async () => {
            const page = fakePage({ y: 0 })
            mount(page)
            start('a')
            await fail('a')
            expect(names(page)).toEqual(['banner'])
        })

        it('bandeau déjà entier à l’écran et page immobile : aucun défilement', async () => {
            const page = fakePage({ y: 800 })
            mount(page)
            start('a')
            await fail('a')
            expect(page.bannerWhole()).toBe(true)
            expect(page.calls).toEqual([])
        })

        it('fin normale, annulation, panneau de capacité : aucun défilement', async () => {
            for (const [slug, res, panel] of [
                ['ok', { ok: true }, false],
                ['annule', { ok: false, error: 'cancelled' }, false],
                ['capacite', { ok: false, error: 'capacity_exceeded' }, true],
            ]) {
                const page = fakePage({ y: 0 })
                const { scope } = mount(page, { panel, projectSlug: ref(`p-${slug}`) })
                start(slug, `p-${slug}`, 5)
                await finish(slug, res)
                expect(page.calls, slug).toEqual([])
                scope.stop()
            }
        })

        it('un job qui finit bien ou qu’on annule ne défile pas, même si un bandeau est rendu', async () => {
            for (const [slug, res] of [['fini', { ok: true }], ['coupe', { ok: false, error: 'cancelled' }]]) {
                const page = fakePage({ y: 0 })
                const { scope } = mount(page, { staleBanner: true, projectSlug: ref(`p-${slug}`) })
                start(slug, `p-${slug}`, 5)
                await flush()
                await finish(slug, res)
                expect(page.calls, slug).toEqual([])
                scope.stop()
            }
        })

        it('retour sur un job déjà échoué : aucun défilement', async () => {
            const first = fakePage({ y: 0 })
            const a = mount(first)
            start('a')
            await fail('a')
            expect(names(first)).toEqual(['banner'])
            a.scope.stop()
            const back = fakePage({ y: 0 })
            mount(back)
            await flush()
            expect(back.calls).toEqual([])
        })

        it('le job échoue sur un autre projet, retour dessus : aucun défilement (page réutilisée)', async () => {
            const page = fakePage({ y: 0 })
            const projectSlug = ref('pa')
            mount(page, { projectSlug })
            start('a', 'pa')
            await flush()
            projectSlug.value = 'pb'
            await flush()
            await fail('a')
            expect(page.calls).toEqual([])
            projectSlug.value = 'pa'
            await flush()
            expect(page.calls).toEqual([])
        })

        it('deux projets : l’échec déjà connu de B ne défile pas quand on quitte A en cours', async () => {
            const page = fakePage({ y: 0 })
            const projectSlug = ref('pb')
            mount(page, { projectSlug })
            start('b', 'pb', 5)
            await fail('b')
            expect(names(page)).toEqual(['banner'])
            page.calls.length = 0
            projectSlug.value = 'pa'
            start('a', 'pa', 5)
            await flush()
            projectSlug.value = 'pb'
            await flush()
            expect(page.calls).toEqual([])
        })

        it('retour sur un job en cours (page remontée), échec ensuite : le bandeau est amené', async () => {
            const seen = new Set()
            const first = fakePage()
            const a = mount(first, { seen })
            start('a')
            await frame('a')
            a.scope.stop()
            const back = fakePage({ y: 0 })
            mount(back, { seen })
            await flush()
            await fail('a')
            expect(names(back)).toEqual(['banner'])
        })

        it('l’utilisateur est parti lire ailleurs : la page ne l’y arrache pas', async () => {
            const page = fakePage()
            mount(page)
            start('a')
            await frame('a')
            page.wheel(1800)
            await fail('a')
            expect(names(page)).toEqual(['section'])
            expect(page.y).toBe(2000)
        })

        // Un cran de molette ne dit pas que l'utilisateur lit ailleurs : ce qui compte
        // est l'endroit où la page va s'arrêter et si l'atelier y est encore.
        it('un cran de molette avant la première frame : le bandeau est quand même amené', async () => {
            const page = fakePage()
            mount(page)
            start('a')
            await flush()
            page.wheel(-200)
            await frame('a')
            expect(page.y).toBe(200)
            await fail('a')
            expect(names(page)).toEqual(['section', 'banner'])
            expect(page.bannerWhole()).toBe(true)
        })

        it('très loin avant la première frame : la vue live l’a ramené, le bandeau est amené', async () => {
            const page = fakePage()
            mount(page)
            start('a')
            await flush()
            page.wheel(1800)
            await frame('a')
            await fail('a')
            expect(names(page)).toEqual(['section', 'banner'])
        })

        it('un cran de molette après la vue live, atelier encore à l’écran : le bandeau est amené', async () => {
            const page = fakePage()
            mount(page)
            start('a')
            await frame('a')
            page.wheel(100)
            await fail('a')
            expect(names(page)).toEqual(['section', 'banner'])
            expect(page.bannerWhole()).toBe(true)
        })

        it('vue live arrivée avec le bandeau à l’écran, puis un cran qui l’en sort : il est ramené', async () => {
            const page = fakePage({ vh: 1200, y: 200 })
            mount(page)
            start('a')
            await frame('a')
            expect(page.bannerWhole()).toBe(true)
            page.wheel(-200)
            expect(page.bannerWhole()).toBe(false)
            await fail('a')
            expect(names(page)).toEqual(['section', 'banner'])
        })

        it('un cran de molette, bandeau déjà entier à l’écran : rien à faire', async () => {
            const page = fakePage({ y: 700 })
            mount(page)
            start('a')
            await flush()
            page.wheel(100)
            await fail('a')
            expect(page.bannerWhole()).toBe(true)
            expect(page.calls).toEqual([])
        })

        it('molette sans frame, atelier sorti de l’écran : la page reste où elle est', async () => {
            const page = fakePage()
            mount(page)
            start('a')
            await flush()
            page.wheel(1800)
            await fail('a')
            expect(page.calls).toEqual([])
        })

        it('juste au bord : un atelier qui ne touche plus l’écran compte comme sorti', async () => {
            for (const [y, attendu] of [[1209, ['banner']], [1210, []]]) {
                const page = fakePage({ y: 0 })
                const { scope } = mount(page, { projectSlug: ref(`bord-${y}`) })
                start(`bord-${y}`, `bord-${y}`, 5)
                await flush()
                page.y = y
                page.wheel(0)
                // Bandeau volontairement hors écran : seul l'atelier décide.
                page.banner.getBoundingClientRect = () => ({ top: 5000, bottom: 5082 })
                await fail(`bord-${y}`)
                expect(names(page), `y=${y}`).toEqual(attendu)
                scope.stop()
            }
        })

        // Le défilement live est animé : pendant le trajet, la position de l'instant
        // ne dit rien de celle où la page s'arrêtera (atelier en haut d'écran).
        it('échec pendant que la vue live remonte, bandeau visible à cet instant : il est amené', async () => {
            const page = fakePage({ y: 1063, liveInFlight: true })
            mount(page)
            start('a')
            await frame('a')
            expect(names(page)).toEqual(['section'])
            expect(page.bannerWhole()).toBe(true)
            await fail('a')
            expect(names(page)).toEqual(['section', 'banner'])
        })

        it('loin de l’atelier, molette avant la première frame, échec pendant la remontée : il est amené', async () => {
            const page = fakePage({ y: 3000, liveInFlight: true })
            mount(page)
            start('a')
            await flush()
            page.wheel(100)
            await frame('a')
            await fail('a')
            expect(names(page)).toEqual(['section', 'banner'])
        })

        it('échec pendant que la vue live remonte, bandeau visible à l’arrivée (grand écran) : rien de plus', async () => {
            const page = fakePage({ vh: 1500, y: 700, liveInFlight: true })
            mount(page)
            start('a')
            await frame('a')
            await fail('a')
            expect(names(page)).toEqual(['section'])
        })

        it('échec pendant le trajet, l’utilisateur a repris la main loin de l’atelier : rien de plus', async () => {
            const page = fakePage({ y: 3000, liveInFlight: true })
            mount(page)
            start('a')
            await frame('a')
            page.wheel(100)
            await fail('a')
            expect(names(page)).toEqual(['section'])
        })

        it('même job relancé après son échec : le défilement live du premier passage ne compte plus', async () => {
            const page = fakePage()
            mount(page)
            start('a')
            await frame('a')
            await fail('a')
            expect(names(page)).toEqual(['section', 'banner'])
            expect(page.bannerWhole()).toBe(true)
            start('a')
            await flush()
            await fail('a')
            expect(names(page)).toEqual(['section', 'banner'])
        })

        it('un geste du job précédent ne compte plus pour le suivant', async () => {
            const page = fakePage()
            mount(page)
            start('a')
            await frame('a')
            page.wheel(1800)
            await fail('a')
            expect(names(page)).toEqual(['section'])
            start('b')
            await flush()
            await fail('b')
            expect(names(page)).toEqual(['section', 'banner'])
        })

        it('mouvement réduit : les deux défilements sont immédiats', async () => {
            const page = fakePage()
            page.calm = true
            mount(page)
            start('a')
            await frame('a')
            await fail('a')
            expect(page.calls.map((c) => c.behavior)).toEqual(['auto', 'auto'])
        })
    })

    describe('fin de vie de la page', () => {
        it('démontée : plus d’écouteur sur la fenêtre, plus aucun défilement', async () => {
            const page = fakePage({ y: 0 })
            const added = vi.spyOn(page.target, 'addEventListener')
            const removed = vi.spyOn(page.target, 'removeEventListener')
            const { scope } = mount(page)
            start('a')
            await flush()
            expect(added.mock.calls.map((c) => c[0]).sort()).toEqual(['keydown', 'touchmove', 'wheel'])
            scope.stop()
            expect(removed.mock.calls.map((c) => c[0]).sort()).toEqual(['keydown', 'touchmove', 'wheel'])
            await fail('a')
            expect(page.calls).toEqual([])
        })

        it('rendu serveur (pas de fenêtre) : ne lit rien et n’écoute rien', () => {
            const progress = vi.fn()
            const scope = effectScope()
            scope.run(() => useJobScroll({ progress, serverSlug: progress, liveEl: ref(null), failureEl: ref(null), target: null }))
            scope.stop()
            expect(progress).not.toHaveBeenCalled()
        })
    })
})
