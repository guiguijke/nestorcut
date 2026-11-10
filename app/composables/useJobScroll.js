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
 * Refus d'une demande de Nest par le serveur (409 concurrent_limit, 5xx) : le
 * message est sous l'atelier, donc hors écran, et aucun job n'existe pour
 * défiler. `refusal()` compte les refus posés (le texte peut être identique d'un
 * refus au suivant) ; `expectJob()` arme le défilement, donc seul un refus qui
 * suit un clic de CETTE page défile (jamais au retour sur la page ni au
 * rechargement). Un refus = au plus un défilement, seulement si le message n'est
 * pas déjà entier à l'écran.
 *
 * Fichier refusé à l'import (un `.job` dont un dessin ne se décode pas) : le
 * message est en tête de page, au-dessus du dépôt et des fiches, donc hors écran
 * quand la page est défilée sur une longue liste. Même règle que le refus de Nest :
 * `expectImport()`, appelé au dépôt de CETTE page, arme le défilement ; le refus
 * suivant amène le message à l'écran s'il n'y est pas déjà entier, sauf si
 * l'utilisateur a défilé lui-même entre le dépôt et le refus. Jamais au retour sur
 * la page, ni pour un refus que cette page n'a pas demandé.
 *
 * La page ne fournit que ses refs : tout le reste est ici pour que les tests
 * exécutent le vrai code (app/tests/useJobScroll.test.js).
 */
import { nextTick, onScopeDispose, watch } from 'vue'
import { isActiveLocalPhase } from '../utils/liveJob'
import {
    createLiveScrollGate,
    failureScrollNeeded,
    isWhollyInView,
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
 * @param refusal    () => nombre de refus de soumission posés par le store
 * @param refusalEl  ref du message de refus (null tant qu'il n'est pas rendu)
 * @param importPosted () => refus d'import posé par le store (texte et paramètres,
 *                   objet neuf à chaque refus), ou une valeur vide quand il n'y en a pas
 * @param importEl   ref du message de refus d'import (null tant qu'il n'est pas rendu)
 * @param target     window côté navigateur, null au rendu serveur (ne fait rien)
 * @param onFailed   (slug) => job en échec vu par cette page, transition ou retour
 *                   dessus, défilement ou non
 * @param seen       slugs déjà amenés à l'écran (survit au démontage de la page)
 * @returns {{ expectJob: () => void, expectImport: () => void }}
 */
export function useJobScroll({ projectSlug = () => null, progress, serverSlug, serverJob = () => null, liveEl, failureEl, refusal = () => 0, refusalEl = null, importPosted = () => null, importEl = null, target, onFailed, seen = scrolledJobSlugs }) {
    if (!target) return { expectJob() {}, expectImport() {} }
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

    // Projet du dernier clic sur Nest vu par cette page, consommé par son refus.
    let refusalExpectedFor = null
    watch(refusal, async () => {
        const armed = refusalExpectedFor
        refusalExpectedFor = null
        if (armed === null || armed !== projectSlug()) return
        await nextTick()
        const el = refusalEl?.value
        if (!el || isWhollyInView(el.getBoundingClientRect(), target.innerHeight)) return
        el.scrollIntoView({ behavior: behavior(), block: 'center' })
    })

    // Projet du dernier dépôt vu par cette page, consommé par son refus d'import.
    let importExpectedFor = null
    watch(importPosted, async (posted) => {
        const armed = importExpectedFor
        if (!posted) return
        importExpectedFor = null
        if (armed === null || armed !== projectSlug() || gesture.moved()) return
        await nextTick()
        if (gesture.moved()) return
        const el = importEl?.value
        if (!el || isWhollyInView(el.getBoundingClientRect(), target.innerHeight)) return
        el.scrollIntoView({ behavior: behavior(), block: 'center' })
    })

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
                if (phase === 'error') onFailed?.(slug)
                if (justFailed) bringFailureIntoView(slug)
            },
            { immediate: true },
        )
    }
    followFailure(progress)
    followFailure(serverJob, isExpectedServerJob)

    return {
        expectImport() {
            importExpectedFor = projectSlug() ?? ''
            gesture.reset()
        },
        expectJob() {
            expected = { before: serverJob()?.slug ?? null, project: projectSlug() }
            refusalExpectedFor = projectSlug() ?? ''
            liveDepartedSlug = null
            gesture.reset()
        },
    }
}
