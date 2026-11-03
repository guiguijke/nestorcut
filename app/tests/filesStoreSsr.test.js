import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, unref } from 'vue'
import { API_ROUTES } from '../composables/apiRoutes'
import { processingType } from '../../constants/files.constants'

// filesStore côté SERVEUR (vitest environment 'node' : import.meta.client est
// indéfini, donc le chemin serveur). Un process Nitro rend toutes les
// requêtes ; /project/[slug] lance getProject() dans un watch immédiat que le
// rendu n'attend pas. Avec l'état de MODULE d'avant, le HTML servi montrait
// le projet chargé par la requête précédente — titre, noms de fichiers,
// « Nest N parts » d'un AUTRE utilisateur — et le 404 d'un slug étranger
// redirigeait une requête concurrente vers /home (scripts/qa-ssr-files-leak.mjs).
//
// `current` simule le contexte Nuxt de la requête active ; runWithContext le
// pose le temps d'un appel synchrone, comme callWithNuxt.

let current

function fakeRequest(label) {
    const app = {
        label,
        runWithContext(fn) {
            const previous = current
            current = app
            try {
                return fn()
            } finally {
                current = previous
            }
        },
    }
    return app
}

function projectPayload(slug, fileCount, status = processingType.done) {
    return {
        name: `Projet ${slug}`,
        slug,
        files: Array.from({ length: fileCount }, (_, i) => ({
            slug: `${slug}-f${i}`,
            name: `${slug}-${i}.dxf`,
            processingStatus: status,
        })),
    }
}

// GET /api/project/:slug répond par la porte du test : il décide de l'ordre
// dans lequel les fetchs des requêtes se résolvent.
let gates
function gate(slug) {
    if (!gates.has(slug)) {
        let open
        const promise = new Promise((resolve, reject) => {
            open = { resolve, reject }
        })
        gates.set(slug, { promise, ...open })
    }
    return gates.get(slug)
}

// Requête active (label) à chaque appel de navigateTo.
let redirectedIn
let filesStore
beforeEach(async () => {
    current = null
    gates = new Map()
    redirectedIn = []
    vi.resetModules()
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('API_ROUTES', API_ROUTES)
    vi.stubGlobal('globalStore', { actions: { getProjects: vi.fn(), setModalNestData: vi.fn() } })
    vi.stubGlobal('authStore', { actions: { setUser: vi.fn() } })
    vi.stubGlobal('tryUseNuxtApp', () => current)
    vi.stubGlobal('navigateTo', vi.fn(() => {
        redirectedIn.push(current?.label ?? null)
    }))
    vi.stubGlobal(
        '$fetch',
        vi.fn((url) => {
            const slug = /^\/api\/project\/([^/]+)$/.exec(url)?.[1]
            if (!slug) throw new Error(`route inattendue : ${url}`)
            return gate(slug).promise
        }),
    )
    ;({ filesStore } = await import('~/composables/files'))
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

// Le watch immédiat de la page appelle getProject() pendant le setup : le
// contexte de la requête n'est garanti que pendant cet appel synchrone.
function startLoad(req, slug) {
    current = req
    const done = filesStore.actions.getProject(API_ROUTES.PROJECT(slug))
    current = null
    return done
}

function readAs(req) {
    current = req
    const g = filesStore.getters
    const view = {
        projectSlug: unref(g.projectSlug),
        projectName: unref(g.projectName),
        files: (unref(g.projectFiles) || []).map((f) => f.name),
        filesCount: unref(g.filesCount),
    }
    current = null
    return view
}

const EMPTY = { projectSlug: null, projectName: '', files: [], filesCount: 0 }

describe('filesStore — état par requête côté serveur', () => {
    it("un rendu n'hérite pas du projet chargé par la requête précédente", async () => {
        const alice = fakeRequest('alice')
        gate('a').resolve(projectPayload('a', 3))
        await startLoad(alice, 'a')
        expect(readAs(alice)).toEqual({
            projectSlug: API_ROUTES.PROJECT('a'),
            projectName: 'Projet a',
            files: ['a-0.dxf', 'a-1.dxf', 'a-2.dxf'],
            filesCount: 3,
        })

        // Bob rend la page avant que SON fetch ne réponde : rien d'Alice.
        const bob = fakeRequest('bob')
        const pending = startLoad(bob, 'b')
        expect(readAs(bob)).toEqual(EMPTY)
        gate('b').resolve(projectPayload('b', 1))
        await pending
        expect(readAs(bob).projectName).toBe('Projet b')
    })

    it('deux chargements concurrents gardent chacun leur projet', async () => {
        const alice = fakeRequest('alice')
        const bob = fakeRequest('bob')
        const loads = [startLoad(alice, 'a'), startLoad(bob, 'b')]
        // Réponses dans l'ordre inverse des demandes.
        gate('b').resolve(projectPayload('b', 1))
        gate('a').resolve(projectPayload('a', 3))
        await Promise.all(loads)

        expect(readAs(alice)).toMatchObject({ projectName: 'Projet a', filesCount: 3 })
        expect(readAs(bob)).toMatchObject({ projectName: 'Projet b', filesCount: 1, files: ['b-0.dxf'] })
    })

    it("le 404 d'un slug étranger redirige SA requête, pas celle du contexte courant", async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const alice = fakeRequest('alice')
        const bob = fakeRequest('bob')
        const load = startLoad(bob, 'a')
        // unctx garde le dernier nuxtApp restauré (asyncContext coupé) : ici
        // celui d'Alice quand le 404 de Bob arrive.
        current = alice
        gate('a').reject({ statusCode: 404, data: {} })
        await load

        expect(globalThis.navigateTo).toHaveBeenCalledWith('/home')
        expect(redirectedIn).toEqual(['bob'])
        expect(readAs(alice)).toEqual(EMPTY)
    })

    it('hors de tout contexte Nuxt : lecture vide, écriture perdue', () => {
        filesStore.actions.updateParams({ space: '9' })
        expect(readAs(null)).toEqual(EMPTY)
        const alice = fakeRequest('alice')
        current = alice
        expect(unref(filesStore.getters.params).space).not.toBe('9')
    })

    // Le rendu n'attend pas getProject : sans garde, le HTML servi d'un
    // projet PLEIN affichait « Select at least one file » en rouge.
    it("aucune erreur « needFiles » tant que le projet demandé n'a pas répondu", async () => {
        const nestError = (req) => {
            current = req
            const value = unref(filesStore.getters.nestRequestError)
            current = null
            return value
        }
        const alice = fakeRequest('alice')
        const full = startLoad(alice, 'a')
        expect(nestError(alice)).toBe('')
        gate('a').resolve(projectPayload('a', 2))
        await full
        expect(nestError(alice)).toBe('')

        // Projet réellement vide : l'erreur revient une fois la réponse là.
        const bob = fakeRequest('bob')
        const empty = startLoad(bob, 'b')
        expect(nestError(bob)).toBe('')
        gate('b').resolve(projectPayload('b', 0))
        await empty
        expect(nestError(bob)).toBe('project.needFiles')

        // Le garde ne vise que « aucun fichier » : des paramètres invalides
        // restent signalés pendant le chargement du projet suivant.
        current = alice
        filesStore.actions.updateParams({ space: 'abc' })
        current = null
        expect(nestError(alice)).toBe('project.invalidParams')
        const next = startLoad(alice, 'c')
        expect(nestError(alice)).toBe('project.invalidParams')
        gate('c').resolve(projectPayload('c', 1))
        await next
    })

    it('aucun polling serveur pour des fichiers encore en traitement', async () => {
        vi.useFakeTimers()
        const alice = fakeRequest('alice')
        gate('a').resolve(projectPayload('a', 1, processingType.inProgress))
        await startLoad(alice, 'a')
        await vi.advanceTimersByTimeAsync(20_000)
        expect(globalThis.$fetch).toHaveBeenCalledTimes(1)
    })
})
