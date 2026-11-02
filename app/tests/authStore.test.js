import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, toRefs, unref } from 'vue'

// authStore côté SERVEUR (vitest environment 'node' : import.meta.client est
// indéfini, donc le chemin serveur). Un process Nitro rend toutes les
// requêtes : l'état doit appartenir au nuxtApp de CHAQUE requête. Avant le
// correctif (état de module), un rendu anonyme héritait de l'utilisateur du
// rendu précédent (/plans, /changelog, /benchmarks) et deux rendus
// concurrents s'écrasaient entre setUser() et le rendu.
//
// Les globales Nuxt auto-importées (tryUseNuxtApp, useApiFetch,
// useAsyncData, API_ROUTES) sont mockées sur globalThis — même pattern que
// vaultMenu.test.js. `current` simule le contexte Nuxt de la requête active.

let current

function fakeRequest(payload) {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    return { payload, gate, release }
}

beforeEach(() => {
    current = null
    globalThis.tryUseNuxtApp = () => current
    globalThis.API_ROUTES = { USER: '/api/user' }
    globalThis.useApiFetch = () => vi.fn()
    // useAsyncData résout la session de la requête qui l'a APPELÉ (contexte
    // synchrone), quand le test relâche sa porte.
    globalThis.useAsyncData = vi.fn(() => {
        const req = current
        return req.gate.then(() => ({ data: ref(req.payload) }))
    })
})

const { authStore } = await import('../composables/auth')

function readAs(req) {
    current = req
    const { user, userIsSet } = toRefs(authStore.getters)
    return { user: unref(user), userIsSet: unref(userIsSet) }
}

describe('authStore — état par requête côté serveur', () => {
    it('un rendu anonyme n’hérite pas de l’utilisateur du rendu précédent', async () => {
        const alice = fakeRequest({ id: 'local:alice@probe.test', name: 'Alice' })
        alice.release()
        current = alice
        await authStore.actions.setUser()
        expect(readAs(alice)).toEqual({ user: alice.payload, userIsSet: true })

        // Nouvelle requête, aucun setUser() (ex. ancien raccourci de
        // auth-optional) : anonyme, jamais Alice.
        const anon = fakeRequest({})
        expect(readAs(anon)).toEqual({ user: {}, userIsSet: false })
    })

    it('deux setUser() concurrents gardent chacun leur utilisateur', async () => {
        const alice = fakeRequest({ id: 'local:alice@probe.test', name: 'Alice' })
        const bob = fakeRequest({ id: 'local:bob@probe.test', name: 'Bob' })

        current = alice
        const pA = authStore.actions.setUser()
        current = bob
        const pB = authStore.actions.setUser()
        // Contexte perdu après l'await (fonction async non transformée) :
        // setUser() doit avoir résolu SON état avant.
        current = null
        bob.release()
        await pB
        alice.release()
        await pA

        expect(readAs(alice).user.name).toBe('Alice')
        expect(readAs(bob).user.name).toBe('Bob')
    })

    it('session anonyme après une session connectée sur la même requête', async () => {
        const req = fakeRequest({ id: 'local:alice@probe.test', name: 'Alice' })
        req.release()
        current = req
        await authStore.actions.setUser()
        req.payload = {}
        await authStore.actions.setUser()
        expect(readAs(req)).toEqual({ user: {}, userIsSet: false })
    })

    it('hors contexte Nuxt : lu comme anonyme', async () => {
        const alice = fakeRequest({ id: 'local:alice@probe.test', name: 'Alice' })
        alice.release()
        current = alice
        await authStore.actions.setUser()
        expect(readAs(null)).toEqual({ user: {}, userIsSet: false })
    })
})
