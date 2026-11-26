import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, watch } from 'vue'

// Navigateur : l'unité vient du useState (repris du payload du serveur) ;
// getUnitState() la lit pour les modules hors setup (files.js).

async function setup({ flag = 'true', cookie, preferred = null } = {}) {
    vi.resetModules()
    const states = {}
    const jar = { unit: cookie }
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { unitSwitchEnabled: flag } }))
    vi.stubGlobal('useCookie', (name) => ({
        get value() { return jar[name] },
        set value(v) { jar[name] = v },
    }))
    vi.stubGlobal('useNuxtData', () => ({ data: ref(preferred ? { preferredUnit: preferred } : null) }))
    vi.stubGlobal('useState', (key, init) => (states[key] ??= ref(init())))
    vi.stubGlobal('authStore', { getters: { user: ref(null) } })
    return { ...(await import('~/composables/useUnit')), jar, states }
}

afterEach(() => vi.unstubAllGlobals())

describe('unité dans le navigateur', () => {
    it('démarre sur la valeur du cookie ; le commutateur et getUnitState voient la même', async () => {
        const { useUnit, getUnitState } = await setup({ cookie: 'inch' })
        const { unit, setUnit } = useUnit()
        expect(unit.value).toBe('inch')
        expect(getUnitState()).toBe('inch')
        setUnit('mm')
        expect(unit.value).toBe('mm')
        expect(getUnitState()).toBe('mm')
    })

    it('le compte l\'emporte sur le cookie', async () => {
        const { useUnit, getUnitState } = await setup({ cookie: 'mm', preferred: 'inch' })
        expect(useUnit().unit.value).toBe('inch')
        expect(getUnitState()).toBe('inch')
    })

    it('interrupteur éteint : millimètre', async () => {
        const { useUnit, getUnitState } = await setup({ flag: 'false', cookie: 'inch' })
        expect(useUnit().unit.value).toBe('mm')
        expect(getUnitState()).toBe('mm')
    })
})
