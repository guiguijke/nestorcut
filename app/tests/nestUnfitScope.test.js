import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { API_ROUTES } from '../composables/apiRoutes'
import { processingType } from '../../constants/files.constants'

// ---------------------------------------------------------------------------
// Constat 5 (revue adverse du lot V1, 02/11) : le refus de capacité d'un
// projet cloud (`nestUnfit`, 422 capacity_exceeded) vit dans le store
// MODULE de `files.js` — il survivait au changement de projet. Le panneau à
// leviers de A s'affichait alors sur B, et son bouton « Ajouter environ k
// tôles et relancer » modifiait les réglages de B puis relançait B avec les
// chiffres de A (un crédit consommé).
//
// Ce test charge le VRAI store, avec les globales Nuxt stubbées (l'alias
// vitest `~` pointe sur `app/`) : `$fetch`, `globalStore`, `authStore`,
// `API_ROUTES`, `ref` (auto-imports Nuxt). Deux verrous :
//   1. remise à zéro de nestUnfit / nestError à l'ARRIVÉE sur un autre projet
//      (`setProjectFiles`, branche `!sameProject`) ;
//   2. garde contre la course : le 422 de A qui arrive APRÈS le chargement de
//      B n'est pas rangé (`nest()` compare `state.projectSlug`, qui porte le
//      CHEMIN d'API, à celui du projet soumis).
//
// Reliquats de la passe adverse suivante (02/11) : la MÊME garde couvre les
// autres écritures tardives de `nest()` — `nestError` (409 concurrent_limit,
// 400 too_many_sheets, 5xx) et la branche succès (`lastParams` prenait le corps
// de B et grisait son bouton Nest ; la fenêtre de résultat de A s'ouvrait sur B).
// ---------------------------------------------------------------------------

const UNFIT = {
    reason: 'capacity',
    ratio: 4.2,
    sheetsNeeded: 5,
    maxPartsAtSpacing: 12,
    maxSpacingForFitMm: 0.4,
}

function capacityRefusal() {
    return { data: { statusMessage: 'capacity_exceeded', data: { unfit: UNFIT } } }
}

function projectPayload(name) {
    return {
        name,
        files: [{ slug: `${name}-f1`, name: `${name}.dxf`, processingStatus: processingType.done }],
    }
}

/**
 * Charge un store `files.js` neuf. `onNest(slug)` répond à POST /nest : il
 * retourne (ou lève) ce que le serveur renverrait ; les GET projet renvoient
 * toujours un projet « terminé » (aucun polling de rafraîchissement).
 */
let setModalNestData
async function loadStore(onNest) {
    vi.resetModules()
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('API_ROUTES', API_ROUTES)
    // `files.js` déstructure l'action à l'import : le mock est gardé ici pour
    // vérifier si la fenêtre de résultat est (ou non) ouverte.
    setModalNestData = vi.fn()
    vi.stubGlobal('globalStore', {
        actions: { getProjects: vi.fn(async () => {}), setModalNestData },
    })
    vi.stubGlobal('authStore', { actions: { setUser: vi.fn(async () => {}) } })
    // vitest = chemin serveur de `files.js` (import.meta.client indéfini) :
    // l'état vit sur le nuxtApp de la requête. Un seul nuxtApp ici = un seul
    // utilisateur, comme l'onglet du client (filesStoreSsr.test.js couvre
    // le cloisonnement entre requêtes).
    const nuxtApp = { runWithContext: (fn) => fn() }
    vi.stubGlobal('tryUseNuxtApp', () => nuxtApp)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal(
        '$fetch',
        vi.fn(async (url) => {
            const nested = /^\/api\/project\/([^/]+)\/nest$/.exec(url)
            if (nested) return onNest(nested[1])
            const project = /^\/api\/project\/([^/]+)$/.exec(url)
            if (project) return projectPayload(project[1])
            throw new Error(`route inattendue : ${url}`)
        }),
    )
    const { filesStore } = await import('~/composables/files')
    return filesStore
}

describe("files.js — le refus de capacité ne suit pas l'utilisateur sur un autre projet", () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('A → 422 capacité → B : le panneau de A ne survit pas', async () => {
        const store = await loadStore(() => {
            throw capacityRefusal()
        })
        await store.actions.getProject(API_ROUTES.PROJECT('a'))
        await store.actions.nest('a')
        // Témoin : sur A, le refus est bien rangé (sinon le test ne prouverait rien).
        expect(store.getters.nestUnfit).toEqual(UNFIT)

        await store.actions.getProject(API_ROUTES.PROJECT('b'))

        expect(store.getters.projectSlug).toBe(API_ROUTES.PROJECT('b'))
        expect(store.getters.nestUnfit).toBeNull()
    })

    it("A → erreur de soumission → B : le message d'erreur de A ne survit pas", async () => {
        const store = await loadStore(() => {
            throw { data: { statusMessage: 'concurrent_limit' }, response: { status: 409 } }
        })
        await store.actions.getProject(API_ROUTES.PROJECT('a'))
        await store.actions.nest('a')
        expect(store.getters.nestError).toBe('nest.error.concurrent')

        await store.actions.getProject(API_ROUTES.PROJECT('b'))

        expect(store.getters.nestError).toBe('')
    })

    it('rechargement du MÊME projet (upload, polling) : le refus reste affiché', async () => {
        const store = await loadStore(() => {
            throw capacityRefusal()
        })
        await store.actions.getProject(API_ROUTES.PROJECT('a'))
        await store.actions.nest('a')

        // addFiles / scheduleFilesRefresh rappellent getProject sur le même chemin.
        await store.actions.getProject(API_ROUTES.PROJECT('a'))

        expect(store.getters.nestUnfit).toEqual(UNFIT)
    })

    it("course : le 422 de A qui arrive après le chargement de B n'est pas rangé", async () => {
        let refuseNest
        const store = await loadStore(
            () =>
                new Promise((_resolve, reject) => {
                    refuseNest = reject
                }),
        )
        await store.actions.getProject(API_ROUTES.PROJECT('a'))
        const submission = store.actions.nest('a')
        expect(store.getters.nestBusy).toBe(true)

        // L'utilisateur quitte A pendant le POST : B est chargé…
        await store.actions.getProject(API_ROUTES.PROJECT('b'))
        // …puis le serveur répond 422 pour A.
        refuseNest(capacityRefusal())
        await submission

        expect(store.getters.projectSlug).toBe(API_ROUTES.PROJECT('b'))
        expect(store.getters.nestUnfit).toBeNull()
        // La sortie anticipée ne laisse pas le verrou de double soumission posé.
        expect(store.getters.nestBusy).toBe(false)
    })

    it("course, témoin : le 422 de A qui arrive alors qu'on est resté sur A est rangé", async () => {
        let refuseNest
        const store = await loadStore(
            () =>
                new Promise((_resolve, reject) => {
                    refuseNest = reject
                }),
        )
        await store.actions.getProject(API_ROUTES.PROJECT('a'))
        const submission = store.actions.nest('a')

        refuseNest(capacityRefusal())
        await submission

        expect(store.getters.nestUnfit).toEqual(UNFIT)
        expect(store.getters.nestBusy).toBe(false)
    })

    it.each([
        [
            '409 concurrent_limit',
            { data: { statusMessage: 'concurrent_limit' }, response: { status: 409 } },
            'nest.error.concurrent',
        ],
        [
            '400 too_many_sheets',
            { data: { statusMessage: 'too_many_sheets' }, response: { status: 400 } },
            'nest.error.maxSheets',
        ],
        ['5xx', { data: { statusMessage: 'boom' }, response: { status: 500 } }, 'nest.error.generic'],
    ])(
        "course : l'erreur %s de A qui arrive après le chargement de B n'est pas rangée",
        async (_label, failure, expectedKey) => {
            let failNest
            const store = await loadStore(
                () =>
                    new Promise((_resolve, reject) => {
                        failNest = reject
                    }),
            )
            await store.actions.getProject(API_ROUTES.PROJECT('a'))
            const submission = store.actions.nest('a')

            await store.actions.getProject(API_ROUTES.PROJECT('b'))
            failNest(failure)
            await submission

            expect(store.getters.projectSlug).toBe(API_ROUTES.PROJECT('b'))
            expect(store.getters.nestError).toBe('')
            expect(store.getters.nestBusy).toBe(false)

            // Témoin : restée sur A, la même erreur est bien rangée (sinon le
            // test ne prouverait rien).
            await store.actions.getProject(API_ROUTES.PROJECT('a'))
            const retry = store.actions.nest('a')
            failNest(failure)
            await retry
            expect(store.getters.nestError).toBe(expectedKey)
        },
    )

    it('course : le succès de A qui arrive après le chargement de B ne grise pas Nest sur B', async () => {
        let finishNest
        const store = await loadStore(
            () =>
                new Promise((resolve) => {
                    finishNest = resolve
                }),
        )
        await store.actions.getProject(API_ROUTES.PROJECT('a'))
        const submission = store.actions.nest('a')

        await store.actions.getProject(API_ROUTES.PROJECT('b'))
        finishNest({ jobId: 'job-a' })
        await submission

        expect(store.getters.projectSlug).toBe(API_ROUTES.PROJECT('b'))
        // B n'a rien soumis : son bouton Nest reste actif…
        expect(store.getters.isNewParams).toBe(true)
        // …et la fenêtre de résultat de A ne s'ouvre pas sur B.
        expect(setModalNestData).not.toHaveBeenCalled()
        expect(store.getters.nestBusy).toBe(false)
    })

    it('course : le job échoue pendant que nest() attend ses réponses, Nest reste actif', async () => {
        let finishNest
        const store = await loadStore(
            () =>
                new Promise((resolve) => {
                    finishNest = resolve
                }),
        )
        await store.actions.getProject(API_ROUTES.PROJECT('a'))
        const submission = store.actions.nest('a')

        // Le flux a vu le job échouer : la page appelle resetLastParams.
        store.actions.resetLastParams()
        finishNest({ jobId: 'job-a' })
        await submission

        expect(store.getters.isNewParams).toBe(true)
        expect(store.getters.nestBusy).toBe(false)
    })

    it('course, témoin : le succès de A, resté sur A, grise Nest et ouvre la fenêtre de résultat', async () => {
        let finishNest
        const store = await loadStore(
            () =>
                new Promise((resolve) => {
                    finishNest = resolve
                }),
        )
        await store.actions.getProject(API_ROUTES.PROJECT('a'))
        expect(store.getters.isNewParams).toBe(true)
        const submission = store.actions.nest('a')

        finishNest({ jobId: 'job-a' })
        await submission

        expect(store.getters.isNewParams).toBe(false)
        expect(setModalNestData).toHaveBeenCalledWith({ jobId: 'job-a' })
    })
})
