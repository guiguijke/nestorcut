import { customRef, reactive, readonly, unref } from 'vue'

const emptyState = () => ({ userIsSet: false, user: {} })

// Client: one tab = one user, a module-level singleton is fine — and it
// must stay empty until the client middleware runs setUser(), which
// registers useAsyncData('user') on the client (refreshNuxtData('user')
// is a no-op otherwise — Subscription.vue relies on it). Hence no
// useState: hydrating this state would make that first setUser() skip.
const clientState = import.meta.client ? reactive(emptyState()) : null

// Server: ONE Nitro process renders every request. A module-level state
// leaked the previous render's user into the next anonymous one (avatar +
// logged-in CTAs on /plans, /changelog, /benchmarks — lot 3.1.6) and let
// two concurrent renders overwrite each other between setUser() and
// render. The state now lives on the request's own nuxtApp.
const serverStates = new WeakMap()

function authState() {
    if (import.meta.client) return clientState
    const nuxtApp = tryUseNuxtApp()
    // No Nuxt context (module scope, after an await in a plain function):
    // there is no way to tell which request this is — read as anonymous,
    // never as someone else.
    if (!nuxtApp) return reactive(emptyState())
    let state = serverStates.get(nuxtApp)
    if (!state) {
        state = reactive(emptyState())
        serverStates.set(nuxtApp, state)
    }
    return state
}

// Same shape as the former computed() getters (a ref the readonly store
// unwraps), but resolved on every read: a module-level computed would cache
// the first request's state on the server.
const stateGetter = (key) => customRef(() => ({
    get: () => authState()[key],
    set: () => {}
}))

async function setUser() {
    // Resolve the request's state BEFORE the first await: on the server the
    // Nuxt context is only guaranteed synchronously here.
    const state = authState()
    try {
        // Stable key: Nuxt deduplicates concurrent calls to the same key and
        // shares the cached payload across the middleware + pages that call
        // setUser() (9 call sites), avoiding one network round-trip per
        // navigation.
        //
        // useRequestFetch() (via useApiFetch) forwards the incoming request
        // headers — including the sessionId cookie — to internal API calls
        // during SSR. The previous plain useFetch dropped the cookie on the
        // server, so /api/user answered {} on any server-rendered navigation
        // (going back to the landing, reload…) and the user appeared logged
        // out. Wrapping the cookie-aware fetch in useAsyncData('user') keeps
        // the dedup/cache behaviour of the old useFetch({ key }).
        const $apiFetch = useApiFetch()
        const { data } = await useAsyncData('user', () => $apiFetch(API_ROUTES.USER))
        const userData = unref(data)
        if (userData && Boolean(userData.id)) {
            state.user = userData
            state.userIsSet = true
        } else {
            state.user = {}
            state.userIsSet = false
        }
    } catch (error) {
        console.error('Failed to set user:', error)
        state.user = {}
        state.userIsSet = false
    }
}

async function logout() {
    const state = authState()
    try {
        await $fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        })
        state.user = {}
        state.userIsSet = false
        // Invalidate the cached user payload so the next setUser() actually
        // refetches instead of returning the pre-logout data (which would
        // keep the user "logged in" on the client).
        clearNuxtData('user')
    } catch (err) {
        console.error('Logout failed:', err)
    }
}

export const authStore = readonly({
    getters: {
        user: stateGetter('user'),
        userIsSet: stateGetter('userIsSet')
    },
    actions: {
        setUser,
        logout
    }
})
