// Lot M1-ter : le VERROU du clignotement — exécute le VRAI plugin.
// Pose en globales ce que Nuxt auto-importe (defineNuxtPlugin, useHead,
// useLocale, globalStore), un document minimal, importe le plugin et
// exécute-le avec un faux nuxtApp. Onglet caché + notification ⇒
// useHead en priorité haute et le titre alterne (horloge simulée).
// Onglet visible ⇒ dispose() appelé. Ce verrou DOIT mordre sur le code
// fautif (titre vide sans dispose) — la preuve qu'il travaille.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref, computed, nextTick } from 'vue'

// ── les espions ──
const headCalls = []
const disposed = []

// ── globales que Nuxt auto-importe ──
globalThis.defineNuxtPlugin = (fn) => fn
globalThis.useHead = vi.fn((entry, opts) => {
    const handle = {
        entry, opts,
        dispose: () => disposed.push(handle),
    }
    headCalls.push(handle)
    return handle
})
globalThis.useLocale = () => ({
    t: (key) => ({
        'meta.title': 'NestorCut — Kostenlose Online-Nesting-Software für…',
        'meta.nestReady': 'Nesting fertig',
    })[key] || key,
})

// le store global (composable index.js) — state contrôlable
const _state = ref(false)
globalThis.globalStore = {
    getters: { needNotification: computed(() => _state.value) },
    actions: { updateNotification: (v) => { _state.value = v } },
}

// document minimal (addEventListener + visibilityState)
const _listeners = {}
let _visState = 'visible'
globalThis.document = {
    addEventListener: (evt, fn) => { (_listeners[evt] = _listeners[evt] || []).push(fn) },
    removeEventListener: (evt, fn) => {
        if (_listeners[evt]) _listeners[evt] = _listeners[evt].filter((f) => f !== fn)
    },
}
Object.defineProperty(globalThis.document, 'visibilityState', {
    get: () => _visState,
    configurable: true,
})

// ── import du plugin APRÈS les globales ──
// (le module lit defineNuxtPlugin, useHead, useLocale, globalStore à l'exécution)
const pluginModule = await import('../plugins/visibilityState.client.js')
const plugin = pluginModule.default

// faux nuxtApp
const _hooks = {}
const fakeNuxtApp = {
    hook: (name, fn) => { _hooks[name] = fn },
    provide: vi.fn(),
}

// helpers : simuler les événements
const setVisibility = (state) => {
    _visState = state
    for (const fn of _listeners.visibilitychange || []) fn()
}
const setNotification = (v) => { _state.value = v }
const tick = (ms) => vi.advanceTimersByTime(ms)

describe('M1-ter — le clignotement du titre (plugin exécuté)', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        headCalls.length = 0
        disposed.length = 0
        _state.value = false
        _visState = 'visible'
    })

    it('à vide (notification=false, onglet visible), le plugin ne pose AUCUN titre', async () => {
        plugin(fakeNuxtApp)
        await nextTick()
        expect(headCalls.filter((h) => h.opts?.tagPriority === 'high')).toEqual([])
    })

    it('onglet caché + notification ⇒ useHead en priorité haute, le titre ALTERNE', async () => {
        plugin(fakeNuxtApp)
        await nextTick()

        // cacher l'onglet, lever la notification
        setVisibility('hidden')
        setNotification(true)
        await nextTick()

        // le watch doit avoir déclenché startTitleCycle → useHead high
        expect(headCalls.length).toBeGreaterThanOrEqual(1)
        const entry = headCalls[headCalls.length - 1]
        expect(entry.opts?.tagPriority).toBe('high')

        // avancer l'horloge : le titre alterne entre fertig et le titre de repos
        const titles = []
        for (let i = 0; i < 4; i++) {
            tick(500)
            await nextTick()
            titles.push(entry.entry.title.value)
        }
        // alternance : au moins un « Nesting fertig » ET au moins un titre de repos
        const sawReady = titles.some((t) => t === 'Nesting fertig')
        const sawRest = titles.some((t) => t.includes('Kostenlose'))
        expect(sawReady, `doit alterner vers « Nesting fertig » (titres: ${titles.join(' | ')})`).toBe(true)
        expect(sawRest, `doit alterner vers le titre de repos (titres: ${titles.join(' | ')})`).toBe(true)
    })

    it('onglet redevient visible ⇒ dispose() appelé, l\'entrée est retirée', async () => {
        plugin(fakeNuxtApp)
        await nextTick()

        setVisibility('hidden')
        setNotification(true)
        await nextTick()
        expect(headCalls.length).toBeGreaterThanOrEqual(1)

        // revenir visible
        setVisibility('visible')
        await nextTick()

        // dispose() a été appelé
        expect(disposed.length).toBeGreaterThanOrEqual(1)
        // et le store a été nettoyé
        expect(_state.value).toBe(false)
    })

    it('la phase « éteinte » alterne avec meta.title, jamais une chaîne vide', async () => {
        plugin(fakeNuxtApp)
        await nextTick()

        setVisibility('hidden')
        setNotification(true)
        await nextTick()

        const entry = headCalls[headCalls.length - 1]
        tick(500) // phase éteinte
        await nextTick()
        const offTitle = entry.entry.title.value
        expect(offTitle, `la phase éteinte doit être meta.title, pas vide (reçu: «${offTitle}»)`).not.toBe('')
        expect(offTitle).toContain('Kostenlose')
    })
})
