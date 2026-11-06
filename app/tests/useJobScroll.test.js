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
    // Refus de Nest sous l'atelier : page défilée à y=222 (Nest visible), il est à top=1006 pour un écran de 900.
    page.refusal = element('refusal', 1228, 60, (top, height) => top + height / 2 - vh / 2)
    page.refusalWhole = () => {
        const r = page.refusal.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= vh
    }
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
    function mount(page, { projectSlug = ref('p1'), serverSlug = ref(null), serverJob = ref(null), onFailed, seen = new Set(), panel = false, staleBanner = false, refusals = ref(0), refusalText = ref('') } = {}) {
        const scope = effectScope()
        const failureEl = ref(null)
        const refusalEl = ref(null)
        let scroll
        scope.run(() => {
            scroll = useJobScroll({
                projectSlug: () => projectSlug.value,
                progress: () => registry.progressFor(projectSlug.value),
                serverSlug: () => serverSlug.value,
                serverJob: () => serverJob.value,
                liveEl: ref(page.section),
                failureEl,
                refusal: () => refusals.value,
                refusalEl,
                onFailed,
                target: page.target,
                seen,
            })
            watch(
                () => {
                    const p = registry.progressFor(projectSlug.value)
                    if (serverJob.value?.phase === 'error' && !panel) return true
                    return staleBanner || (p?.phase === 'error' && p?.error !== 'cancelled' && !panel)
                },
                (show) => { failureEl.value = show ? page.banner : null },
                { flush: 'post', immediate: true },
            )
            // Le bandeau de refus n'existe que tant que le texte est posé (v-if).
            watch(refusalText, (text) => { refusalEl.value = text ? page.refusal : null }, { flush: 'post', immediate: true })
        })
        return { scope, projectSlug, serverSlug, serverJob, seen, scroll, refusals, refusalText }
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

    // Le job serveur arrive par le flux SSE, sans registre : sa position dans le
    // cycle est décrite par `serverJobState`. Géométrie de l'essai réel : Nest
    // cliqué à y=300, le bandeau naît sous le pli.
    describe('échec d’un job serveur', () => {
        const srv = (phase, slug = 'srv') => ({ slug, phase })
        const play = async (serverJob, ...phases) => {
            for (const phase of phases) {
                serverJob.value = srv(phase)
                await flush()
            }
        }

        it('en cours puis erreur : le bandeau est amené, une seule fois', async () => {
            const page = fakePage({ y: 300 })
            const { serverJob } = mount(page)
            await play(serverJob, 'running', 'error')
            expect(page.calls).toEqual([{ name: 'banner', behavior: 'smooth', block: 'center' }])
            expect(page.bannerWhole()).toBe(true)
            await play(serverJob, 'error')
            expect(names(page)).toEqual(['banner'])
        })

        it('après la vue live : la position d’arrivée compte, le bandeau finit à l’écran', async () => {
            const page = fakePage({ liveInFlight: true })
            const { serverJob, serverSlug } = mount(page)
            await play(serverJob, 'running')
            serverSlug.value = 'srv'
            await flush()
            await play(serverJob, 'error')
            expect(names(page)).toEqual(['section', 'banner'])
        })

        it('bandeau déjà entier à l’écran : aucun défilement', async () => {
            const page = fakePage({ y: 800 })
            const { serverJob } = mount(page)
            await play(serverJob, 'running', 'error')
            expect(page.calls).toEqual([])
        })

        it('job déjà échoué à l’arrivée sur la page : aucun défilement', async () => {
            const page = fakePage({ y: 300 })
            const { serverJob } = mount(page)
            await play(serverJob, 'error')
            expect(page.calls).toEqual([])
            const reload = fakePage({ y: 300 })
            mount(reload, { serverJob: ref(srv('error')) })
            await flush()
            expect(reload.calls).toEqual([])
        })

        it('fin normale ou annulation : aucun défilement', async () => {
            const page = fakePage({ y: 300 })
            const { serverJob } = mount(page, { staleBanner: true })
            await play(serverJob, 'running', 'done')
            expect(page.calls).toEqual([])
        })

        it('l’utilisateur est parti lire ailleurs : la page ne l’y arrache pas', async () => {
            const page = fakePage({ y: 300 })
            const { serverJob } = mount(page)
            await play(serverJob, 'running')
            page.wheel(1700)
            await play(serverJob, 'error')
            expect(page.calls).toEqual([])
            expect(page.y).toBe(2000)
        })

        it('job calculé dans le navigateur : le flux serveur ne double pas le registre', async () => {
            const page = fakePage({ y: 300 })
            const onFailed = vi.fn()
            const { serverJob } = mount(page, { onFailed })
            await play(serverJob, 'running', 'local', 'error')
            expect(page.calls).toEqual([])
            expect(onFailed.mock.calls).toEqual([['srv']])
        })

        // Mesuré dans le navigateur sur le vrai worker : la pièce à la cote exacte
        // échoue entre deux ticks du flux, le job apparaît directement en erreur.
        describe('job qui échoue avant d’être vu en cours', () => {
            it('Nest cliqué, nouveau job déjà en erreur : le bandeau est amené une fois', async () => {
                const page = fakePage({ y: 300 })
                const onFailed = vi.fn()
                const { serverJob, scroll } = mount(page, { onFailed })
                scroll.expectJob()
                await play(serverJob, 'error')
                expect(names(page)).toEqual(['banner'])
                expect(onFailed.mock.calls).toEqual([['srv']])
                await play(serverJob, 'error')
                expect(names(page)).toEqual(['banner'])
            })

            it('le job suivant remplace un échec plus ancien : même règle', async () => {
                const page = fakePage({ y: 300 })
                const { serverJob, scroll } = mount(page)
                await play(serverJob, 'error')
                expect(page.calls).toEqual([])
                scroll.expectJob()
                await flush()
                serverJob.value = srv('error', 'suivant')
                await flush()
                expect(names(page)).toEqual(['banner'])
            })

            it('Nest cliqué mais toujours l’ancien job (requête refusée) : aucun défilement', async () => {
                const page = fakePage({ y: 300 })
                const { serverJob, scroll } = mount(page)
                await play(serverJob, 'error')
                scroll.expectJob()
                await play(serverJob, 'error')
                expect(page.calls).toEqual([])
            })

            it('l’ancien job échoue après le clic : ce n’est pas lui qu’on attend, le nouveau reste suivi', async () => {
                const page = fakePage({ y: 300 })
                const onFailed = vi.fn()
                const { serverJob, scroll } = mount(page, { onFailed })
                await play(serverJob, 'local')
                scroll.expectJob()
                await play(serverJob, 'error')
                expect(page.calls).toEqual([])
                serverJob.value = srv('error', 'suivant')
                await flush()
                expect(names(page)).toEqual(['banner'])
                expect(onFailed.mock.calls).toEqual([['srv'], ['suivant']])
            })

            it('Nest cliqué puis autre projet : son échec connu ne défile pas', async () => {
                const page = fakePage({ y: 300 })
                const { serverJob, scroll, projectSlug } = mount(page)
                scroll.expectJob()
                await flush()
                projectSlug.value = 'p2'
                serverJob.value = srv('error', 'job-de-p2')
                await flush()
                expect(page.calls).toEqual([])
            })

            it('un geste avant le clic sur Nest ne compte pas', async () => {
                const page = fakePage({ y: 100 })
                const { serverJob, scroll } = mount(page)
                page.wheel(1700)
                scroll.expectJob()
                await play(serverJob, 'error')
                expect(names(page)).toEqual(['banner'])
            })

            it('nouveau job vu en cours : la règle normale reprend, un seul défilement', async () => {
                const page = fakePage({ y: 300 })
                const { serverJob, scroll } = mount(page)
                scroll.expectJob()
                await play(serverJob, 'running', 'error')
                expect(names(page)).toEqual(['banner'])
            })
        })

        it('le job d’un autre slug n’hérite pas de la transition du précédent', async () => {
            const page = fakePage({ y: 300 })
            const { serverJob } = mount(page)
            await play(serverJob, 'running')
            serverJob.value = srv('error', 'autre')
            await flush()
            expect(page.calls).toEqual([])
        })
    })

    // Le message propose de réessayer : Nest doit le permettre sans toucher aux
    // réglages. La page n'y raccorde que `resetLastParams`.
    describe('rappel onFailed', () => {
        it('job serveur : une fois, à la transition vers l’erreur', async () => {
            const onFailed = vi.fn()
            const { serverJob } = mount(fakePage({ y: 300 }), { onFailed })
            serverJob.value = { slug: 'srv', phase: 'running' }
            await flush()
            expect(onFailed).not.toHaveBeenCalled()
            serverJob.value = { slug: 'srv', phase: 'error' }
            await flush()
            serverJob.value = { slug: 'srv', phase: 'error' }
            await flush()
            expect(onFailed.mock.calls).toEqual([['srv']])
        })

        it('job local : une fois à l’échec, même si le bandeau est déjà à l’écran', async () => {
            const onFailed = vi.fn()
            mount(fakePage({ y: 800 }), { onFailed })
            start('a')
            await fail('a')
            expect(onFailed.mock.calls).toEqual([['a']])
        })

        it('fin normale, annulation : aucun appel', async () => {
            const onFailed = vi.fn()
            const projectSlug = ref('p-fini')
            mount(fakePage(), { onFailed, projectSlug })
            start('fini', 'p-fini', 5)
            await flush()
            await finish('fini', { ok: true })
            projectSlug.value = 'p-coupe'
            start('coupe', 'p-coupe', 5)
            await flush()
            await finish('coupe', { ok: false, error: 'cancelled' })
            await flush()
            expect(onFailed).not.toHaveBeenCalled()
        })

        // Page remontée sur le même projet : `lastParams` a survécu, Nest resterait
        // grisé sous un bandeau qui propose de réessayer.
        it('retour sur un job serveur déjà échoué : appelé, sans défilement', async () => {
            const onFailed = vi.fn()
            const page = fakePage({ y: 300 })
            mount(page, { onFailed, serverJob: ref({ slug: 'srv', phase: 'error' }) })
            await flush()
            expect(onFailed.mock.calls).toEqual([['srv']])
            expect(page.calls).toEqual([])
        })

        it('retour sur un job local déjà échoué : appelé, sans défilement', async () => {
            const onFailed = vi.fn()
            const projectSlug = ref('p-connu')
            const page = fakePage({ y: 300 })
            mount(page, { onFailed, projectSlug })
            start('connu', 'p-connu', 5)
            await flush()
            projectSlug.value = 'p-ailleurs'
            await flush()
            await fail('connu')
            expect(onFailed).not.toHaveBeenCalled()
            projectSlug.value = 'p-connu'
            await flush()
            expect(onFailed.mock.calls).toEqual([['connu']])
            expect(page.calls).toEqual([])
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

    describe('refus de Nest par le serveur', () => {
        // Comme le store : le clic arme (nestBusy), le message disparaît, puis le
        // refus pose le texte et compte un refus de plus.
        const click = (m) => {
            m.refusalText.value = ''
            m.scroll.expectJob()
        }
        const refuse = async (m, text = 'Another job is running') => {
            m.refusalText.value = text
            m.refusals.value += 1
            await flush()
        }

        it('clic puis refus hors écran : le message est amené, une seule fois', async () => {
            const page = fakePage({ y: 222 })
            const m = mount(page)
            click(m)
            expect(page.refusalWhole()).toBe(false)
            await refuse(m)
            expect(names(page)).toEqual(['refusal'])
            expect(page.calls[0]).toMatchObject({ block: 'center', behavior: 'smooth' })
            expect(page.refusalWhole()).toBe(true)
        })

        it('message déjà entier à l’écran : aucun défilement', async () => {
            const page = fakePage({ y: 800 })
            const m = mount(page)
            click(m)
            expect(page.refusalWhole()).toBe(true)
            await refuse(m)
            expect(page.calls).toEqual([])
        })

        it('deuxième refus au texte identique après un défilement de l’utilisateur : ramené aussi', async () => {
            const page = fakePage({ y: 222 })
            const m = mount(page)
            click(m)
            await refuse(m)
            page.wheel(-800)
            expect(page.refusalWhole()).toBe(false)
            click(m)
            await refuse(m)
            expect(names(page)).toEqual(['refusal', 'refusal'])
            expect(page.refusalWhole()).toBe(true)
        })

        it('mouvement réduit : défilement immédiat', async () => {
            const page = fakePage({ y: 222 })
            page.calm = true
            const m = mount(page)
            click(m)
            await refuse(m)
            expect(page.calls.map((c) => c.behavior)).toEqual(['auto'])
        })

        it('refus qui ne suit pas un clic de cette page : aucun défilement', async () => {
            const page = fakePage({ y: 222 })
            const m = mount(page)
            await refuse(m)
            expect(page.calls).toEqual([])
        })

        it('page remontée sur un refus déjà affiché : aucun défilement', async () => {
            const page = fakePage({ y: 222 })
            const m = mount(page, { refusals: ref(3), refusalText: ref('Another job is running') })
            await flush()
            expect(page.calls).toEqual([])
            expect(m.refusals.value).toBe(3)
        })

        it('le clic est consommé par son refus : un refus suivant sans clic ne défile pas', async () => {
            const page = fakePage({ y: 222 })
            const m = mount(page)
            click(m)
            await refuse(m)
            page.wheel(-800)
            page.calls.length = 0
            await refuse(m)
            expect(page.calls).toEqual([])
        })

        it('l’utilisateur a quitté le projet entre le clic et le refus : aucun défilement', async () => {
            const page = fakePage({ y: 222 })
            const m = mount(page)
            click(m)
            m.projectSlug.value = 'p2'
            await refuse(m)
            expect(page.calls).toEqual([])
        })

        it('le refus n’empêche pas le défilement d’un échec de job qui suit', async () => {
            const page = fakePage({ y: 641 })
            const m = mount(page)
            click(m)
            await refuse(m)
            page.y = 641
            page.calls.length = 0
            m.refusalText.value = ''
            start('a')
            await frame('a')
            await fail('a')
            expect(names(page)).toEqual(['section', 'banner'])
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
