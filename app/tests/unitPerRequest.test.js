import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'
import { API_ROUTES } from '../composables/apiRoutes'
import { processingType } from '../../constants/files.constants'

// L'unité côté SERVEUR : un processus Nitro rend les requêtes de tous les
// utilisateurs. Chaque requête a son cookie et son useState ; rien ne doit passer
// de l'une à l'autre, et le HTML du serveur doit être déjà dans l'unité du compte
// (pas 1000 × 2000 avant 48 × 96).

let current

function fakeRequest(cookieUnit, preferredUnit = null) {
    const app = {
        cookies: { unit: cookieUnit },
        states: {},
        user: preferredUnit ? { preferredUnit } : null,
        // Comme le vrai (callWithNuxt -> callAsync sur le serveur) : le contexte
        // tient pendant la partie synchrone, la réponse est TOUJOURS une Promise.
        runWithContext(fn) {
            const previous = current
            current = app
            try { return Promise.resolve(fn()) } finally { current = previous }
        },
    }
    return app
}

const file = (slug) => ({ slug, name: `${slug}.dxf`, processingStatus: processingType.done, parts: [{ width: 50, height: 50 }] })

async function setup({ flag = 'true' } = {}) {
    vi.resetModules()
    current = null
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('API_ROUTES', API_ROUTES)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { unitSwitchEnabled: flag } }))
    vi.stubGlobal('useCookie', (name) => ({ value: current.cookies[name] }))
    vi.stubGlobal('useNuxtData', () => ({ data: ref(current.user) }))
    vi.stubGlobal('useState', (key, init) => {
        const states = current.states
        if (!(key in states)) states[key] = ref(init())
        return states[key]
    })
    vi.stubGlobal('authStore', { getters: { user: ref(null) }, actions: { setUser: vi.fn(async () => {}) } })
    vi.stubGlobal('globalStore', { actions: { getProjects: vi.fn(async () => {}), setModalNestData: vi.fn() } })
    vi.stubGlobal('tryUseNuxtApp', () => current)
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('$fetch', vi.fn(async (url) => {
        const slug = String(url).split('/').pop()
        return { name: slug, slug, files: [file(`${slug}-f`)] }
    }))
    const { getUnitState, useUnit } = await import('~/composables/useUnit')
    const store = (await import('~/composables/files')).filesStore
    return { getUnitState, useUnit, store }
}

afterEach(() => vi.unstubAllGlobals())

// Lecture dans le contexte de la requête, comme filesState à la création de son état.
const inRequest = (app, fn) => app.runWithContext(fn)

describe('unité par requête côté serveur', () => {
    it('deux requêtes entrelacées : chacune lit son cookie, rien ne se mélange', async () => {
        const { getUnitState, useUnit } = await setup()
        const a = fakeRequest('inch')
        const b = fakeRequest('mm')
        expect(await inRequest(a, () => getUnitState(a))).toBe('inch')
        expect(await inRequest(b, () => getUnitState(b))).toBe('mm')
        expect(await inRequest(a, () => useUnit().unit.value)).toBe('inch')
        expect(await inRequest(b, () => useUnit().unit.value)).toBe('mm')
        expect(await inRequest(a, () => getUnitState(a))).toBe('inch')
        // le choix de A ne déteint pas sur une requête C sans cookie
        const c = fakeRequest(undefined)
        expect(await inRequest(c, () => getUnitState(c))).toBe('mm')
    })

    it("hors du contexte de la requête nommée (après un await, ou contexte d'une autre) : millimètre", async () => {
        const { getUnitState } = await setup()
        const a = fakeRequest('inch')
        const b = fakeRequest('inch')
        await inRequest(a, () => {
            expect(getUnitState()).toBe('mm')
            expect(getUnitState(b)).toBe('mm')
        })
        // aucun contexte du tout
        expect(getUnitState(a)).toBe('mm')
    })

    it("le compte l'emporte sur le cookie", async () => {
        const { getUnitState } = await setup()
        const x = fakeRequest('mm', 'inch')
        const y = fakeRequest('inch', 'mm')
        expect(await inRequest(x, () => getUnitState(x))).toBe('inch')
        expect(await inRequest(y, () => getUnitState(y))).toBe('mm')
    })

    it('interrupteur éteint : millimètre pour tous', async () => {
        const { getUnitState, useUnit } = await setup({ flag: 'false' })
        const a = fakeRequest('inch', 'inch')
        expect(await inRequest(a, () => getUnitState(a))).toBe('mm')
        expect(await inRequest(a, () => useUnit().unit.value)).toBe('mm')
    })

    it("réglages rendus dans l'unité de la requête : 48 × 96 pour les pouces, 1000 × 2000 pour les mm", async () => {
        const { store } = await setup()
        const inch = fakeRequest('inch')
        const mm = fakeRequest('mm')
        // état créé dans le contexte de chaque requête (setup), projet chargé ensuite.
        // Rien d'autre ne convertit ici (pas de sélecteur d'unité) : 48 × 96 prouve que
        // l'état a lu 'inch' à sa création (avec runWithContext il lisait une Promise).
        const sheetsOf = (app) => inRequest(app, () => store.getters.params.sheets.map((s) => [s.width, s.height]))
        expect(await sheetsOf(inch)).toEqual([['48', '96']])
        expect(await sheetsOf(mm)).toEqual([['1000', '2000']])
        // le projet se charge hors contexte (après await) : l'unité vient de l'état
        await inRequest(inch, () => store.actions.getProject(API_ROUTES.PROJECT('p')))
        await inRequest(mm, () => store.actions.getProject(API_ROUTES.PROJECT('q')))
        expect(await sheetsOf(inch)).toEqual([['48', '96']])
        expect(await sheetsOf(mm)).toEqual([['1000', '2000']])
        expect(await inRequest(inch, () => store.getters.params.space)).not.toBe(await inRequest(mm, () => store.getters.params.space))
    })

    it("l'unité est lue sans runWithContext (qui rend une Promise sur le vrai serveur)", async () => {
        const { getUnitState } = await setup()
        const a = fakeRequest('inch')
        const spy = vi.spyOn(a, 'runWithContext')
        current = a
        try {
            expect(getUnitState(a)).toBe('inch')
        } finally {
            current = null
        }
        expect(spy).not.toHaveBeenCalled()
    })
})
