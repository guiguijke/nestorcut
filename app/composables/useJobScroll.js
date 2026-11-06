/**
 * Défilements automatiques de la page projet pendant un job.
 *
 * Vue live (décision J-038) : quand un job se met à diffuser, sa section est
 * amenée à l'écran UNE fois par job (la garde mémorise les slugs), donc ni à
 * chaque frame ni au retour sur un projet. Deux sources comptent : le flux
 * serveur et le calcul navigateur.
 *
 * Échec d'un job, local ou serveur : le bandeau qui dit la cause est SOUS
 * l'atelier, donc hors écran quand la page est restée défilée. On l'amène à
 * l'écran UNE fois, sur la transition « en cours » -> « erreur » du même job vue
 * par cette instance de page : jamais au retour sur un job déjà échoué, jamais
 * pour le job d'un autre projet (piège 47, `progress` et `serverJob` ne rendent
 * que ceux de la page). Les deux défilements suivent la même règle : un geste
 * antérieur au départ de la vue live ne compte plus, puisque c'est nous qui avons
 * déplacé la page ensuite.
 *
 * Un job serveur peut échouer entre deux ticks du flux (1 Hz) et apparaître
 * directement en erreur : `expectJob()`, appelé quand la demande part, désigne le
 * premier nouveau slug du projet comme ce job-là.
 *
 * La page ne fournit que ses refs : tout le reste est ici pour que les tests
 * exécutent le vrai code (app/tests/useJobScroll.test.js).
 */
import { nextTick, onScopeDispose, watch } from 'vue'
import { isActiveLocalPhase } from '../utils/liveJob'
import {
    createLiveScrollGate,
    failureScrollNeeded,
    liveScrollSlug,
    scrolledJobSlugs,
    watchUserScroll,
} from '../utils/liveScroll'

/**
 * @param projectSlug () => projet affiché (la page est réutilisée d'un projet à l'autre)
 * @param progress   () => job du registre local pour le projet affiché, ou null
 * @param serverSlug () => slug du job qui diffuse par le flux serveur, ou null
 * @param serverJob  () => { slug, phase } du dernier job vu par le flux serveur
 *                   (`serverJobState`), ou null
 * @param liveEl     ref de la section live
 * @param failureEl  ref du bandeau d'échec (null tant qu'il n'est pas rendu)
 * @param target     window côté navigateur, null au rendu serveur (ne fait rien)
 * @param onFailed   (slug) => appelé à la même transition, défilement ou non
 * @param seen       slugs déjà amenés à l'écran (survit au démontage de la page)
 * @returns {{ expectJob: () => void }}
 */
export function useJobScroll({ projectSlug = () => null, progress, serverSlug, serverJob = () => null, liveEl, failureEl, target, onFailed, seen = scrolledJobSlugs }) {
    if (!target) return { expectJob() {} }
    const gesture = watchUserScroll(target)
    onScopeDispose(() => gesture.stop())
    const gate = createLiveScrollGate(seen)
    const behavior = () => (target.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')
    let liveDepartedSlug = null

    watch(
        () => liveScrollSlug({ serverSlug: serverSlug(), job: progress() }),
        async (slug) => {
            if (!gate.claim(slug)) return
            await nextTick()
            gesture.reset()
            liveDepartedSlug = slug
            liveEl.value?.scrollIntoView({ behavior: behavior(), block: 'start' })
        },
    )

    const bringFailureIntoView = async (slug) => {
        await nextTick()
        const el = failureEl.value
        if (!el) return
        const userMoved = gesture.moved()
        const needed = failureScrollNeeded({
            banner: el.getBoundingClientRect(),
            section: liveEl.value?.getBoundingClientRect(),
            viewportHeight: target.innerHeight,
            heading: liveDepartedSlug === slug && !userMoved,
            userMoved,
        })
        if (needed) el.scrollIntoView({ behavior: behavior(), block: 'center' })
    }

    let expected = null
    const isExpectedServerJob = (slug) => {
        if (!expected) return false
        if (expected.project !== projectSlug()) {
            expected = null
            return false
        }
        if (!slug || slug === expected.before) return false
        expected = null
        return true
    }

    const followFailure = (job, isExpected = () => false) => {
        let runningSlug = null
        watch(
            [() => job()?.slug, () => job()?.phase],
            ([slug, phase]) => {
                const expectedNow = isExpected(slug)
                if (isActiveLocalPhase(phase)) {
                    if (runningSlug !== slug) {
                        runningSlug = slug
                        liveDepartedSlug = null
                        gesture.reset()
                    }
                    return
                }
                const justFailed = phase === 'error' && (runningSlug === slug || expectedNow)
                runningSlug = null
                if (!justFailed) return
                onFailed?.(slug)
                bringFailureIntoView(slug)
            },
            { immediate: true },
        )
    }
    followFailure(progress)
    followFailure(serverJob, isExpectedServerJob)

    return {
        expectJob() {
            expected = { before: serverJob()?.slug ?? null, project: projectSlug() }
            liveDepartedSlug = null
            gesture.reset()
        },
    }
}
