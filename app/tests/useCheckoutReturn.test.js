import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCheckoutReturn } from '~/composables/useCheckoutReturn'
import {
    useBuyCreditsContext,
    useBuyCreditsDialog,
    useBuyCreditsOpener,
    useCheckoutReopenTarget,
    useCheckoutReturnState,
} from '~/composables/useModalState'
import { CHECKOUT_INTENT_KEY, writeCheckoutIntent } from '~/utils/checkoutReturn'
import { trackEvent } from '~/utils/track'

// Le suivi part en réseau : on n'en garde que l'appel.
vi.mock('~/utils/track', () => ({ trackEvent: vi.fn() }))

// Retour de Stripe Checkout (O3, d10, D15, D17). Le composable vit dans le
// contexte Nuxt : ses globales auto-importées (useRoute, useRouter, useToast,
// useLocale, refreshNuxtData, $fetch, authStore, onMounted, useState) sont
// remplacées ici par des doubles ; les ouvreurs et états de useModalState sont
// les vrais, posés sur un useState en mémoire.

const ID = '0123456789abcdef01234567'
const PROJECT_PATH = '/project/brave-otter-0123456789ab'
const INTENT = {
    source: 'locked_sheets',
    resultSlug: 'nested-plate_2-abc123',
    projectSlug: 'brave-otter-0123456789ab',
}

// Faux sessionStorage : une Map suffit.
function fakeStorage() {
    const map = new Map()
    return {
        map,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => void map.set(k, String(v)),
        removeItem: (k) => void map.delete(k),
    }
}

// useState en mémoire : un état par clé, et la liste de ses écritures (le
// composable doit poser la cible UNE fois, et remettre 'checking' à 'idle').
function makeUseState() {
    const store = new Map()
    const useState = (key, init) => {
        if (!store.has(key)) {
            let current = typeof init === 'function' ? init() : undefined
            const writes = []
            store.set(key, {
                writes,
                get value() {
                    return current
                },
                set value(next) {
                    writes.push(next)
                    current = next
                },
            })
        }
        return store.get(key)
    }
    return { useState, writesOf: (key) => store.get(key)?.writes ?? [] }
}

describe('useCheckoutReturn (retour de Checkout)', () => {
    let storage
    let route
    let router
    let toast
    let order // journal des appels, dans l'ordre
    let mounted
    let refreshNuxtData
    let setUser
    let fetchMock
    let states

    // Dernier statut /check rendu, ou file de statuts (le dernier se répète).
    function checkReturns(...statuses) {
        const queue = [...statuses]
        fetchMock.mockImplementation(async () => {
            order.push('check')
            const next = queue.length > 1 ? queue.shift() : queue[0]
            if (next instanceof Error) throw next
            return { status: next }
        })
    }

    beforeEach(() => {
        storage = fakeStorage()
        order = []
        mounted = []
        route = { path: PROJECT_PATH, query: {}, hash: '' }
        router = {
            replace: vi.fn(async () => {
                order.push('replace')
            }),
        }
        toast = {
            show: vi.fn((text) => {
                order.push(`toast:${text}`)
            }),
        }
        refreshNuxtData = vi.fn(async (key) => {
            order.push(`refreshNuxtData:${key}`)
        })
        setUser = vi.fn(async () => {
            order.push('setUser')
        })
        fetchMock = vi.fn()
        states = makeUseState()

        vi.stubGlobal('window', { sessionStorage: storage })
        // sleepOrVisible (délais de la boucle) écoute visibilitychange.
        vi.stubGlobal('document', {
            visibilityState: 'visible',
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })
        vi.stubGlobal('useState', states.useState)
        vi.stubGlobal('useRoute', () => route)
        vi.stubGlobal('useRouter', () => router)
        vi.stubGlobal('useToast', () => toast)
        vi.stubGlobal('useLocale', () => ({ t: (key) => key }))
        vi.stubGlobal('useCheckoutReopenTarget', useCheckoutReopenTarget)
        vi.stubGlobal('useCheckoutReturnState', useCheckoutReturnState)
        vi.stubGlobal('useBuyCreditsOpener', useBuyCreditsOpener)
        vi.stubGlobal('refreshNuxtData', refreshNuxtData)
        vi.stubGlobal('authStore', { actions: { setUser } })
        vi.stubGlobal('$fetch', fetchMock)
        vi.stubGlobal('onMounted', (callback) => {
            mounted.push(callback)
        })
        trackEvent.mockClear()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        checkReturns('active')
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    // Appelle le composable (setup), puis déclenche son onMounted.
    function mount() {
        useCheckoutReturn()
        for (const callback of mounted.splice(0)) callback()
    }
    // Tout est résolu par des micro-tâches : une macro-tâche suffit à les vider.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

    const reopenTargetWrites = () => states.writesOf('checkoutReopenTarget')
    const checkingWrites = () => states.writesOf('checkoutReturnState')
    const dialogOpen = () => useBuyCreditsDialog().value
    const trackedReturn = () => trackEvent.mock.calls.filter(([action]) => action === 'checkout_return')

    describe('succès (?subscriptionInternalId=<24 hex>)', () => {
        it('URL nettoyée, palier rafraîchi (cache ET store), cible posée une fois, état remis à zéro', async () => {
            route.query = { subscriptionInternalId: ID, keep: '1' }
            route.hash = '#ancre'
            writeCheckoutIntent(storage, INTENT)

            mount()
            await settle()

            // L'URL est nettoyée AVANT la vérification, chemin et ancre conservés.
            expect(router.replace).toHaveBeenCalledTimes(1)
            expect(router.replace).toHaveBeenCalledWith({ path: PROJECT_PATH, query: { keep: '1' }, hash: '#ancre' })
            expect(fetchMock).toHaveBeenCalledWith('/api/payment/subscription/check?subscriptionInternalId=' + ID, {
                method: 'POST',
            })
            // Palier client : le cache `user` (cadenas) puis le store (bannière).
            expect(order).toEqual(['replace', 'check', 'refreshNuxtData:user', 'setUser', 'toast:sub.return.activated'])
            // Cible de réouverture posée UNE fois, intention consommée.
            expect(reopenTargetWrites()).toEqual([{ resultSlug: INTENT.resultSlug, projectSlug: INTENT.projectSlug }])
            expect(storage.map.has(CHECKOUT_INTENT_KEY)).toBe(false)
            // 'checking' pendant la vérification, puis remis à zéro.
            expect(checkingWrites()).toEqual(['checking', 'idle'])
            expect(useCheckoutReturnState().value).toBe('idle')
            expect(dialogOpen()).toBe(false)
            expect(trackedReturn()).toEqual([
                ['checkout_return', { status: 'active', page: 'project', source: 'locked_sheets' }],
            ])
        })

        it('essai (trialing) sans intention : palier rafraîchi, pas de cible, source « unknown »', async () => {
            route.query = { subscriptionInternalId: ID }
            checkReturns('trialing')

            mount()
            await settle()

            expect(order).toContain('refreshNuxtData:user')
            expect(order).toContain('setUser')
            expect(toast.show).toHaveBeenCalledWith('sub.return.activated')
            expect(reopenTargetWrites()).toEqual([])
            expect(trackedReturn()).toEqual([
                ['checkout_return', { status: 'trialing', page: 'project', source: 'unknown' }],
            ])
        })

        it("un refreshNuxtData qui échoue n'empêche ni setUser ni le toast ; un setUser qui échoue non plus", async () => {
            route.query = { subscriptionInternalId: ID }
            refreshNuxtData.mockRejectedValueOnce(new Error('réseau'))
            mount()
            await settle()
            expect(setUser).toHaveBeenCalledTimes(1)
            expect(toast.show).toHaveBeenCalledWith('sub.return.activated')
            expect(checkingWrites()).toEqual(['checking', 'idle'])

            order.length = 0
            toast.show.mockClear()
            setUser.mockRejectedValueOnce(new Error('réseau'))
            mount()
            await settle()
            expect(toast.show).toHaveBeenCalledWith('sub.return.activated')
            expect(checkingWrites()).toEqual(['checking', 'idle', 'checking', 'idle'])
        })

        it('Stripe confirme après deux « pending » : un seul toast d’activation, aucun toast « en attente »', async () => {
            route.query = { subscriptionInternalId: ID }
            checkReturns('pending', 'pending', 'active')
            vi.useFakeTimers()

            mount()
            await vi.advanceTimersByTimeAsync(10_000)

            expect(fetchMock).toHaveBeenCalledTimes(3)
            expect(toast.show.mock.calls.map(([text]) => text)).toEqual(['sub.return.activated'])
            expect(trackedReturn()[0][1].status).toBe('active')
        })
    })

    describe('annulation (?checkout=cancelled)', () => {
        it('réouverture du résultat sans toast, sans vérification, sans fenêtre d’abonnement', async () => {
            route.query = { checkout: 'cancelled', keep: '1' }
            writeCheckoutIntent(storage, INTENT)

            mount()
            await settle()

            expect(router.replace).toHaveBeenCalledWith({ path: PROJECT_PATH, query: { keep: '1' }, hash: '' })
            expect(reopenTargetWrites()).toEqual([{ resultSlug: INTENT.resultSlug, projectSlug: INTENT.projectSlug }])
            expect(toast.show).not.toHaveBeenCalled()
            expect(fetchMock).not.toHaveBeenCalled()
            expect(refreshNuxtData).not.toHaveBeenCalled()
            expect(setUser).not.toHaveBeenCalled()
            expect(checkingWrites()).toEqual([])
            expect(dialogOpen()).toBe(false)
            expect(storage.map.has(CHECKOUT_INTENT_KEY)).toBe(false)
            expect(trackedReturn()).toEqual([
                ['checkout_return', { status: 'cancelled', page: 'project', source: 'locked_sheets' }],
            ])
        })
    })

    describe('statut terminal non actif', () => {
        it('toast d’échec, fenêtre d’abonnement ouverte sans contexte, palier intact', async () => {
            route.query = { subscriptionInternalId: ID }
            writeCheckoutIntent(storage, INTENT)
            checkReturns('incomplete')

            mount()
            await settle()

            // Terminal : un seul appel à /check, jamais de nouvel essai.
            expect(fetchMock).toHaveBeenCalledTimes(1)
            expect(toast.show).toHaveBeenCalledTimes(1)
            expect(toast.show).toHaveBeenCalledWith('sub.return.failed', 'alert')
            expect(dialogOpen()).toBe(true)
            expect(useBuyCreditsContext().value).toBeNull()
            expect(refreshNuxtData).not.toHaveBeenCalled()
            expect(setUser).not.toHaveBeenCalled()
            expect(checkingWrites()).toEqual(['checking', 'idle'])
            expect(trackedReturn()).toEqual([
                ['checkout_return', { status: 'incomplete', page: 'project', source: 'locked_sheets' }],
            ])
        })
    })

    describe('délai épuisé', () => {
        it('toast « en attente » une fois, puis toast « trop long » ; état remis à zéro ; suivi « timeout »', async () => {
            route.query = { subscriptionInternalId: ID }
            checkReturns('pending')
            vi.useFakeTimers()

            mount()
            // Phase rapide (4 s) puis phase lente bornée à 2 min.
            await vi.advanceTimersByTimeAsync(130_000)

            expect(toast.show.mock.calls).toEqual([
                ['sub.return.pending', 'clock'],
                ['sub.return.slow', 'clock'],
            ])
            expect(fetchMock.mock.calls.length).toBeGreaterThan(3)
            expect(refreshNuxtData).not.toHaveBeenCalled()
            expect(setUser).not.toHaveBeenCalled()
            expect(checkingWrites()).toEqual(['checking', 'idle'])
            expect(useCheckoutReturnState().value).toBe('idle')
            expect(trackedReturn()).toEqual([
                ['checkout_return', { status: 'timeout', page: 'project', source: 'unknown' }],
            ])
        })
    })

    describe('intention consommée une seule fois', () => {
        it('une deuxième visite avec le même marqueur ne repose pas la cible de réouverture', async () => {
            route.query = { subscriptionInternalId: ID }
            writeCheckoutIntent(storage, INTENT)

            mount()
            await settle()
            expect(reopenTargetWrites()).toEqual([{ resultSlug: INTENT.resultSlug, projectSlug: INTENT.projectSlug }])
            expect(storage.map.has(CHECKOUT_INTENT_KEY)).toBe(false)

            // UserResults a rouvert la fenêtre puis vidé la cible.
            useCheckoutReopenTarget().value = null

            // Retour arrière sur l'URL de Stripe : même marqueur, plus d'intention.
            route.query = { subscriptionInternalId: ID }
            mount()
            await settle()

            expect(reopenTargetWrites()).toEqual([
                { resultSlug: INTENT.resultSlug, projectSlug: INTENT.projectSlug },
                null,
            ])
            expect(useCheckoutReopenTarget().value).toBeNull()
            expect(trackedReturn().map(([, data]) => data.source)).toEqual(['locked_sheets', 'unknown'])
        })
    })

    describe('identifiant invalide', () => {
        it('URL nettoyée, intention consommée, aucune vérification ni toast', async () => {
            route.query = { subscriptionInternalId: 'pas-un-identifiant', keep: '1' }
            writeCheckoutIntent(storage, INTENT)

            mount()
            await settle()

            expect(router.replace).toHaveBeenCalledTimes(1)
            expect(router.replace).toHaveBeenCalledWith({ path: PROJECT_PATH, query: { keep: '1' }, hash: '' })
            expect(storage.map.has(CHECKOUT_INTENT_KEY)).toBe(false)
            expect(fetchMock).not.toHaveBeenCalled()
            expect(toast.show).not.toHaveBeenCalled()
            expect(refreshNuxtData).not.toHaveBeenCalled()
            expect(checkingWrites()).toEqual([])
            expect(dialogOpen()).toBe(false)
            expect(trackedReturn()).toEqual([
                ['checkout_return', { status: 'invalid', page: 'project', source: 'locked_sheets' }],
            ])
        })
    })

    describe('cas limites', () => {
        it('aucun marqueur : rien ne bouge, l’intention reste en place, pas de suivi', async () => {
            route.query = { keep: '1' }
            writeCheckoutIntent(storage, INTENT)

            useCheckoutReturn()
            // Avant le montage, rien ne s'exécute.
            await settle()
            expect(router.replace).not.toHaveBeenCalled()
            for (const callback of mounted.splice(0)) callback()
            await settle()

            expect(router.replace).not.toHaveBeenCalled()
            expect(fetchMock).not.toHaveBeenCalled()
            expect(storage.map.has(CHECKOUT_INTENT_KEY)).toBe(true)
            expect(reopenTargetWrites()).toEqual([])
            expect(trackEvent).not.toHaveBeenCalled()
        })

        it('un router.replace qui échoue ne bloque pas la vérification', async () => {
            route.query = { subscriptionInternalId: ID }
            router.replace.mockRejectedValueOnce(new Error('navigation annulée'))

            mount()
            await settle()

            expect(fetchMock).toHaveBeenCalledTimes(1)
            expect(toast.show).toHaveBeenCalledWith('sub.return.activated')
            expect(trackedReturn()[0][1].status).toBe('active')
        })

        it('sessionStorage inaccessible : le retour fonctionne, sans réouverture', async () => {
            route.query = { subscriptionInternalId: ID }
            vi.stubGlobal('window', {
                get sessionStorage() {
                    throw new Error('SecurityError')
                },
            })

            mount()
            await settle()

            expect(reopenTargetWrites()).toEqual([])
            expect(toast.show).toHaveBeenCalledWith('sub.return.activated')
            expect(trackedReturn()).toEqual([
                ['checkout_return', { status: 'active', page: 'project', source: 'unknown' }],
            ])
        })

        it('la page du retour est tracée : /home → home, /profile → profile', async () => {
            route.path = '/home'
            route.query = { checkout: 'cancelled' }
            mount()
            await settle()
            route.path = '/profile'
            route.query = { checkout: 'cancelled' }
            mount()
            await settle()

            expect(trackedReturn().map(([, data]) => data.page)).toEqual(['home', 'profile'])
        })
    })
})
