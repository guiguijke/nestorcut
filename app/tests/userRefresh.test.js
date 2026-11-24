import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
    AUTO_REFRESH_MIN_GAP_MS,
    CLICK_REFRESH_MIN_AGE_MS,
    CLICK_WAIT_MS,
    PLAN_KEYS,
    createLockedClickGuard,
    createUserRefresher,
    guardedLockedClick,
    mergePlan,
    pickPlan,
    resolveLockedClick,
    runLockedDownload,
    shouldAutoRefresh,
} from '../utils/userRefresh'
import { hasPaidAccess } from '../utils/entitlementUi'
import { sheetDownloadState } from '../utils/sheetDownloadState'

// Palier périmé dans un onglet resté ouvert : relecture partagée, fusion des
// seuls champs de palier, décision du plugin de retour d'onglet, et logique
// des clics sur un cadenas. Tout est pur (horloge et réseau injectés).

const FREE = {
    id: 'u1', preferredUnit: 'mm', encryption: { enabled: true, locked: false, keyId: 'k1' },
    granted: false, compute: { level: null },
}
const PAID_ANSWER = { id: 'u1', granted: true, compute: { level: 'standard' } }

// Un onglet : le cache `user`, le store et le rafraîchisseur, branchés comme useUserRefresh.
function tab({ fetchUser, start = 0, startedAt = null, cache = FREE, storeId = cache?.id } = {}) {
    let t = start
    const w = { cache, storeUser: cache, storeSet: storeId !== undefined }
    const apply = vi.fn((fresh) => {
        const merged = mergePlan(w.cache, fresh)
        if (!merged) return false
        if (!w.storeSet || (w.storeUser?.id && w.storeUser.id !== merged.id)) return false
        w.storeUser = merged
        w.cache = merged
        return true
    })
    const fetch = fetchUser ?? vi.fn(async () => PAID_ANSWER)
    const r = createUserRefresher({ fetchUser: fetch, apply, now: () => t, startedAt })
    return { r, w, apply, fetch, tick: (ms) => { t += ms } }
}

describe('pickPlan / mergePlan', () => {
    it('pickPlan ne garde que la liste blanche, laisse de côté les clés absentes', () => {
        const out = pickPlan({ id: 'u1', granted: true, preferredUnit: 'inch', encryption: { locked: true }, name: 'x', evil: 1 })
        expect(out).toEqual({ granted: true })
        expect(Object.keys(pickPlan(Object.fromEntries(PLAN_KEYS.map((k) => [k, 1]))))).toEqual(PLAN_KEYS)
    })
    it('fusionne sur l utilisateur courant : clés absentes conservées', () => {
        const merged = mergePlan({ ...FREE, freeRemaining: 4 }, { id: 'u1', granted: true })
        expect(merged.granted).toBe(true)
        expect(merged.freeRemaining).toBe(4)
        expect(merged.preferredUnit).toBe('mm')
    })
    it('refuse sans utilisateur courant, sans id, ou avec un autre id', () => {
        expect(mergePlan(null, PAID_ANSWER)).toBeNull()
        expect(mergePlan({}, PAID_ANSWER)).toBeNull()
        expect(mergePlan({ ...FREE, id: 'u2' }, PAID_ANSWER)).toBeNull()
    })
})

describe('createUserRefresher', () => {
    it('relit et écrit les deux sources avec le palier frais', async () => {
        const { r, w, apply } = tab()
        expect(await r.refresh()).toBe(true)
        expect(apply).toHaveBeenCalledTimes(1)
        expect(w.cache.granted).toBe(true)
        expect(w.storeUser).toBe(w.cache)
    })

    it('ne change jamais preferredUnit ni encryption, même si la réponse les porte', async () => {
        const answer = { ...PAID_ANSWER, preferredUnit: 'inch', encryption: { enabled: true, locked: true, keyId: 'k2' }, name: 'autre' }
        const { r, w } = tab({ fetchUser: vi.fn(async () => answer) })
        await r.refresh()
        expect(w.cache.granted).toBe(true)
        expect(w.cache.preferredUnit).toBe('mm')
        expect(w.cache.encryption).toEqual(FREE.encryption)
        expect(w.storeUser.preferredUnit).toBe('mm')
        expect(w.storeUser.encryption).toEqual(FREE.encryption)
    })

    it('réponse tardive après déconnexion : rien n est écrit', async () => {
        let release
        const fetchUser = vi.fn(() => new Promise((res) => { release = () => res(PAID_ANSWER) }))
        const { r, w } = tab({ fetchUser })
        const p = r.refresh()
        w.cache = null // déconnexion pendant la lecture
        w.storeUser = {}
        w.storeSet = false
        release()
        expect(await p).toBe(false)
        expect(w.cache).toBeNull()
        expect(w.storeSet).toBe(false)
        expect(w.storeUser).toEqual({})
    })

    it('réponse d un autre compte : rien n est écrit', async () => {
        const { r, w } = tab({ fetchUser: vi.fn(async () => ({ ...PAID_ANSWER, id: 'u2' })) })
        expect(await r.refresh()).toBe(false)
        expect(w.cache).toBe(FREE)
        expect(w.storeUser).toBe(FREE)
    })

    it('store déconnecté : le store refuse, le cache reste intact', async () => {
        const { r, w } = tab()
        w.storeSet = false
        expect(await r.refresh()).toBe(false)
        expect(w.cache).toBe(FREE)
    })

    it('dédoublonne les appels simultanés : un seul fetch', async () => {
        let release
        const fetchUser = vi.fn(() => new Promise((res) => { release = () => res(PAID_ANSWER) }))
        const { r } = tab({ fetchUser })
        const a = r.refresh()
        const b = r.refresh()
        const c = r.refreshIfOlderThan(CLICK_REFRESH_MIN_AGE_MS)
        release()
        await Promise.all([a, b, c])
        expect(fetchUser).toHaveBeenCalledTimes(1)
    })

    it('un relevé réussi de moins de 5 s saute la relecture du clic, sans appeler le réseau', async () => {
        const { r, tick, fetch } = tab({ start: 1000 })
        expect(r.lastRefreshAt()).toBeNull()
        await r.refresh()
        expect(r.lastRefreshAt()).toBe(1000)
        expect(r.lastOkAt()).toBe(1000)
        tick(4000)
        expect(await r.refreshIfOlderThan(CLICK_REFRESH_MIN_AGE_MS)).toBe(false)
        expect(fetch).toHaveBeenCalledTimes(1)
        tick(1500)
        expect(await r.refreshIfOlderThan(CLICK_REFRESH_MIN_AGE_MS)).toBe(true)
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(r.lastRefreshAt()).toBe(6500)
    })

    it('le chargement de la page compte comme un relevé (startedAt)', async () => {
        const { r, apply } = tab({ start: 100, startedAt: 100 })
        expect(await r.refreshIfOlderThan(CLICK_REFRESH_MIN_AGE_MS)).toBe(false)
        expect(apply).not.toHaveBeenCalled()
    })

    it('un échec ne compte pas pour la règle des 5 s : le clic suivant relit', async () => {
        const fetchUser = vi.fn()
            .mockRejectedValueOnce(new Error('down'))
            .mockResolvedValueOnce(PAID_ANSWER)
        const { r, tick, w } = tab({ fetchUser, start: 1000 })
        expect(await r.refresh()).toBe(false)
        // ... mais il compte pour la règle automatique des 60 s
        expect(r.lastRefreshAt()).toBe(1000)
        expect(r.lastOkAt()).toBeNull()
        tick(100)
        expect(await r.refreshIfOlderThan(CLICK_REFRESH_MIN_AGE_MS)).toBe(true)
        expect(fetchUser).toHaveBeenCalledTimes(2)
        expect(w.cache.granted).toBe(true)
    })

    it('ne rejette jamais et n écrit rien sur erreur réseau', async () => {
        const { r, w, apply } = tab({ fetchUser: vi.fn(async () => { throw new Error('401') }) })
        await expect(r.refresh()).resolves.toBe(false)
        expect(apply).not.toHaveBeenCalled()
        expect(w.cache).toBe(FREE)
    })

    it('n écrit rien quand la réponse n a pas d id (déconnecté : {} ou null)', async () => {
        for (const body of [{}, null, undefined]) {
            const { r, apply, w } = tab({ fetchUser: vi.fn(async () => body) })
            expect(await r.refresh()).toBe(false)
            expect(apply).not.toHaveBeenCalled()
            expect(w.cache).toBe(FREE)
        }
    })

    it('un apply qui échoue ne rejette pas non plus', async () => {
        const r = createUserRefresher({
            fetchUser: async () => PAID_ANSWER,
            apply: () => { throw new Error('boom') },
            now: () => 0,
        })
        await expect(r.refresh()).resolves.toBe(false)
    })
})

describe('shouldAutoRefresh (plugin de retour d onglet)', () => {
    const base = { signedIn: true, paidAccess: false, event: 'visibilitychange', visibilityState: 'visible', lastAt: 0, now: AUTO_REFRESH_MIN_GAP_MS }

    it('relit au retour d onglet quand connecté, sans accès payant, dernier relevé > 60 s', () => {
        expect(shouldAutoRefresh(base)).toBe(true)
        expect(shouldAutoRefresh({ ...base, event: 'focus' })).toBe(true)
    })
    it('jamais pour un visiteur', () => {
        expect(shouldAutoRefresh({ ...base, signedIn: false })).toBe(false)
    })
    it('jamais pour un compte qui paie déjà (abonné, accordé, Pro)', () => {
        expect(shouldAutoRefresh({ ...base, paidAccess: true })).toBe(false)
        for (const user of [{ granted: true }, { subscriptionStatus: 'active' }, { compute: { level: 'privacy' } }]) {
            expect(shouldAutoRefresh({ ...base, paidAccess: hasPaidAccess(user) })).toBe(false)
        }
        expect(shouldAutoRefresh({ ...base, paidAccess: hasPaidAccess(FREE) })).toBe(true)
    })
    it('pas quand l onglet passe en arrière-plan', () => {
        expect(shouldAutoRefresh({ ...base, visibilityState: 'hidden' })).toBe(false)
        expect(shouldAutoRefresh({ ...base, event: 'focus', visibilityState: 'hidden' })).toBe(false)
    })
    it('au plus une fois par 60 s', () => {
        expect(shouldAutoRefresh({ ...base, now: AUTO_REFRESH_MIN_GAP_MS - 1 })).toBe(false)
        expect(shouldAutoRefresh({ ...base, lastAt: null, now: 5 })).toBe(true)
    })
    it('pageshow : seulement depuis le cache de navigation (persisted)', () => {
        const p = { ...base, event: 'pageshow', visibilityState: 'hidden' }
        expect(shouldAutoRefresh({ ...p, persisted: false })).toBe(false)
        expect(shouldAutoRefresh({ ...p, persisted: true })).toBe(true)
    })
    it('dix signaux en 10 s ne donnent qu une relecture', () => {
        let last = null
        let reads = 0
        for (let i = 0; i < 10; i++) {
            const now = i * 1000
            if (shouldAutoRefresh({ ...base, lastAt: last, now })) { reads += 1; last = now }
        }
        expect(reads).toBe(1)
    })
})

describe('resolveLockedClick (clic sur un cadenas)', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    function world({ granted, fail = false }) {
        const t = tab({ fetchUser: vi.fn(async () => { if (fail) throw new Error('down'); return granted ? PAID_ANSWER : { id: 'u1' } }), start: 100 })
        const readState = () => sheetDownloadState(t.w.cache, {})
        return { ...t, readState }
    }

    it('verrouillé → relit → ouvert : on livre, pas de fenêtre', async () => {
        const { r, readState } = world({ granted: true })
        expect(readState()).toBe('locked')
        expect(await resolveLockedClick({ refreshIfOlderThan: r.refreshIfOlderThan, readState })).toBe('proceed')
    })
    it('verrouillé → relit → toujours verrouillé : la fenêtre s ouvre', async () => {
        const { r, readState } = world({ granted: false })
        expect(await resolveLockedClick({ refreshIfOlderThan: r.refreshIfOlderThan, readState })).toBe('paywall')
    })
    it('relecture en échec : la fenêtre s ouvre, comme avant', async () => {
        const { r, readState } = world({ granted: true, fail: true })
        expect(await resolveLockedClick({ refreshIfOlderThan: r.refreshIfOlderThan, readState })).toBe('paywall')
    })
    it('relecture qui lève : la fenêtre s ouvre aussi', async () => {
        const out = await resolveLockedClick({
            refreshIfOlderThan: async () => { throw new Error('x') },
            readState: () => 'locked',
        })
        expect(out).toBe('paywall')
    })
    it('relevé réussi de moins de 5 s : pas de requête, décision sur l état courant', async () => {
        const refreshIfOlderThan = vi.fn(async () => false)
        const out = await resolveLockedClick({ refreshIfOlderThan, readState: () => 'locked' })
        expect(refreshIfOlderThan).toHaveBeenCalledWith(CLICK_REFRESH_MIN_AGE_MS)
        expect(out).toBe('paywall')
    })

    it('réseau lent : décide au bout de 2 s sur l état courant, la réponse tardive s applique seule', async () => {
        let release
        const w = { state: 'locked' }
        const refreshIfOlderThan = vi.fn(() => new Promise((res) => { release = () => { w.state = 'enabled'; res(true) } }))
        let settled = null
        const p = resolveLockedClick({ refreshIfOlderThan, readState: () => w.state }).then((v) => { settled = v })
        await vi.advanceTimersByTimeAsync(CLICK_WAIT_MS - 1)
        expect(settled).toBeNull()
        await vi.advanceTimersByTimeAsync(1)
        await p
        expect(settled).toBe('paywall')
        // la réponse arrive ensuite et s'applique d'elle-même
        release()
        expect(w.state).toBe('enabled')
    })

    it('réponse avant 2 s : décide dessus sans attendre le délai', async () => {
        const w = { state: 'locked' }
        const refreshIfOlderThan = vi.fn(async () => { w.state = 'enabled'; return true })
        expect(await resolveLockedClick({ refreshIfOlderThan, readState: () => w.state })).toBe('proceed')
    })
})

describe('guardedLockedClick (garde et contexte)', () => {
    const mk = (outcome = 'paywall') => {
        let release
        const resolve = vi.fn(() => new Promise((res) => { release = () => res(outcome) }))
        return { resolve, release: () => release(), onPaywall: vi.fn(), onProceed: vi.fn() }
    }

    it('double clic : un seul résolveur, une seule fenêtre', async () => {
        const g = createLockedClickGuard()
        const d = mk()
        const a = guardedLockedClick({ guard: g, ...d })
        const b = guardedLockedClick({ guard: g, ...d })
        expect(await b).toBe('ignored')
        d.release()
        expect(await a).toBe('paywall')
        expect(d.resolve).toHaveBeenCalledTimes(1)
        expect(d.onPaywall).toHaveBeenCalledTimes(1)
    })
    it('la garde se libère après la résolution : un nouveau clic passe', async () => {
        const g = createLockedClickGuard()
        const d1 = mk(); const a = guardedLockedClick({ guard: g, ...d1 }); d1.release(); await a
        const d2 = mk(); const b = guardedLockedClick({ guard: g, ...d2 }); d2.release()
        expect(await b).toBe('paywall')
        expect(g.busy).toBe(false)
    })
    it('la garde se libère aussi si la résolution lève', async () => {
        const g = createLockedClickGuard()
        await expect(guardedLockedClick({ guard: g, resolve: async () => { throw new Error('x') }, onPaywall: vi.fn() })).rejects.toThrow('x')
        expect(g.busy).toBe(false)
    })
    it('fenêtre fermée, autre résultat ou carte démontée : aucune action', async () => {
        const g = createLockedClickGuard()
        const d = mk('proceed')
        let current = true
        const p = guardedLockedClick({ guard: g, ...d, isCurrent: () => current })
        current = false
        d.release()
        expect(await p).toBe('stale')
        expect(d.onPaywall).not.toHaveBeenCalled()
        expect(d.onProceed).not.toHaveBeenCalled()
    })
    it('compte ouvert : onProceed, pas de fenêtre', async () => {
        const d = mk('proceed')
        const p = guardedLockedClick({ guard: createLockedClickGuard(), ...d })
        d.release()
        expect(await p).toBe('proceed')
        expect(d.onProceed).toHaveBeenCalledTimes(1)
        expect(d.onPaywall).not.toHaveBeenCalled()
    })
})

describe('runLockedDownload (sheet_locked, un seul nouvel essai)', () => {
    const locked = () => { throw new Error('sheet_locked') }
    const mk = (resolveTo) => ({ resolve: vi.fn(async () => resolveTo), paywall: vi.fn(), warn: vi.fn() })

    it('pas de refus : livré, rien d autre', async () => {
        const run = vi.fn(); const d = mk('proceed')
        expect(await runLockedDownload({ run, ...d })).toBe('done')
        expect(run).toHaveBeenCalledTimes(1)
        expect(d.resolve).not.toHaveBeenCalled()
    })
    it('le chemin normal est synchrone : run a déjà été appelé au retour de l appel', () => {
        const run = vi.fn()
        runLockedDownload({ run, ...mk('proceed') })
        expect(run).toHaveBeenCalledTimes(1)
    })
    it('refus puis compte ouvert : second essai livré, pas de fenêtre', async () => {
        const run = vi.fn().mockImplementationOnce(locked); const d = mk('proceed')
        expect(await runLockedDownload({ run, ...d })).toBe('done')
        expect(run).toHaveBeenCalledTimes(2)
        expect(d.paywall).not.toHaveBeenCalled()
    })
    it('second refus alors que l état dit ouvert : fenêtre, run appelé 2 fois au plus', async () => {
        const run = vi.fn(locked); const d = mk('proceed')
        expect(await runLockedDownload({ run, ...d })).toBe('paywall')
        expect(run).toHaveBeenCalledTimes(2)
        expect(d.paywall).toHaveBeenCalledTimes(1)
    })
    it('refus et compte toujours verrouillé : fenêtre, un seul appel de run', async () => {
        const run = vi.fn(locked); const d = mk('paywall')
        expect(await runLockedDownload({ run, ...d })).toBe('paywall')
        expect(run).toHaveBeenCalledTimes(1)
        expect(d.paywall).toHaveBeenCalledTimes(1)
    })
    it('autre erreur : signalée, ni relecture ni fenêtre', async () => {
        const run = vi.fn(() => { throw new Error('disk') }); const d = mk('proceed')
        expect(await runLockedDownload({ run, ...d })).toBe('failed')
        expect(d.warn).toHaveBeenCalledTimes(1)
        expect(d.resolve).not.toHaveBeenCalled()
        expect(d.paywall).not.toHaveBeenCalled()
    })
    it('double clic sur un téléchargement refusé : une seule résolution, une seule fenêtre', async () => {
        const run = vi.fn(locked)
        const guard = createLockedClickGuard()
        let release
        const resolve = vi.fn(() => new Promise((res) => { release = () => res('paywall') }))
        const paywall = vi.fn()
        const a = runLockedDownload({ run, resolve, paywall, warn: vi.fn(), guard })
        const b = runLockedDownload({ run, resolve, paywall, warn: vi.fn(), guard })
        expect(await b).toBe('ignored')
        release()
        expect(await a).toBe('paywall')
        expect(resolve).toHaveBeenCalledTimes(1)
        expect(paywall).toHaveBeenCalledTimes(1)
    })
    it('fenêtre fermée pendant l attente : ni fenêtre d abonnement ni second essai', async () => {
        const run = vi.fn(locked)
        let open = true
        let release
        const resolve = vi.fn(() => new Promise((res) => { release = () => res('proceed') }))
        const d = { paywall: vi.fn(), warn: vi.fn() }
        const p = runLockedDownload({ run, resolve, ...d, isCurrent: () => open })
        open = false
        release()
        expect(await p).toBe('stale')
        expect(run).toHaveBeenCalledTimes(1)
        expect(d.paywall).not.toHaveBeenCalled()
    })
})

describe('applyUser du store (garde côté auth.js)', () => {
    const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

    async function loadStore() {
        vi.resetModules()
        globalThis.tryUseNuxtApp = () => APP
        const APP = {}
        globalThis.useApiFetch = () => async () => ({})
        globalThis.API_ROUTES = { USER: '/api/user' }
        globalThis.clearNuxtData = () => {}
        const set = (u) => { globalThis.useAsyncData = async () => ({ data: ref(u) }) }
        const { authStore } = await import('../composables/auth.js')
        return { authStore, set }
    }

    it('refuse quand le store est déconnecté, un autre id, ou une réponse sans id', async () => {
        const { authStore, set } = await loadStore()
        // déconnecté (jamais chargé) : une réponse tardive ne reconnecte pas
        expect(authStore.actions.applyUser({ id: 'u1', granted: true })).toBe(false)
        expect(authStore.getters.userIsSet).toBe(false)
        set({ id: 'u1', name: 'U' })
        await authStore.actions.setUser()
        expect(authStore.getters.userIsSet).toBe(true)
        expect(authStore.actions.applyUser({ id: 'u2', granted: true })).toBe(false)
        expect(authStore.actions.applyUser({ granted: true })).toBe(false)
        expect(authStore.getters.user.id).toBe('u1')
        expect(authStore.getters.user.granted).toBeUndefined()
        expect(authStore.actions.applyUser({ id: 'u1', name: 'U', granted: true })).toBe(true)
        expect(authStore.getters.user.granted).toBe(true)
    })

    it('le câblage statique : /api/user/plan, timeout 5 s, sans réessai', () => {
        const src = read('../composables/useUserRefresh.js')
        expect(src).toContain('API_ROUTES.USER_PLAN')
        expect(src).toContain('timeout: 5000')
        expect(src).toContain('retry: 0')
        expect(src).not.toContain('API_ROUTES.USER,')
        expect(read('../composables/apiRoutes.js')).toContain("USER_PLAN: '/api/user/plan'")
    })
})

describe('câblage statique', () => {
    const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

    it('le plugin écoute les trois signaux, garde le contexte Nuxt, ignore les payants', () => {
        const src = read('../plugins/userRefresh.client.js')
        expect(src).toContain("addEventListener('visibilitychange'")
        expect(src).toContain("addEventListener('focus'")
        expect(src).toContain("addEventListener('pageshow'")
        expect(src).toContain('runWithContext')
        expect(src).toContain("useNuxtData('user')")
        expect(src).toContain('hasPaidAccess(')
    })
    it('les gestionnaires de cadenas passent par la garde et resolveLockedClick', () => {
        const modal = read('../components/ResultModal.vue')
        const card = read('../components/UserResultItem.vue')
        expect(modal.match(/resolveLockedClick\(/g).length).toBeGreaterThanOrEqual(2)
        expect(modal.match(/guardedLockedClick\(/g).length).toBeGreaterThanOrEqual(2)
        expect(modal).toContain('runLockedDownload(')
        expect(modal).not.toContain('onLocalDownloadError')
        expect(card).toContain('resolveLockedClick(')
        expect(card).toContain('guardedLockedClick(')
        expect(card).toContain('runLockedDownload(')
        for (const src of [modal, card]) expect(src).toContain('onBeforeUnmount(')
    })
    it('le composable n utilise pas refreshNuxtData (qui vide le cache sur erreur)', () => {
        expect(read('../composables/useUserRefresh.js')).not.toContain('refreshNuxtData')
    })
})
