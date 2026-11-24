import { createUserRefresher, mergePlan } from '~/utils/userRefresh'

// Un seul rafraîchisseur par onglet : son état (relevé en cours, heure du
// dernier) est partagé entre le plugin de retour d'onglet, les fenêtres de
// résultat et les cartes. Créé au premier appel DANS un contexte Nuxt (le
// plugin client l'appelle au démarrage) : $fetch et le cache y sont capturés.
let refresher = null

/**
 * Relit /api/user/plan et met à jour les DEUX sources du palier côté client :
 * le cache `useNuxtData('user')` (cadenas) et le store d'authentification
 * (bannière Free, bouton Turbo). Champs de palier seulement, et seulement si
 * l'onglet tient encore le MÊME utilisateur. Ne rejette jamais, dédoublonne
 * les appels simultanés, ne touche à rien sur erreur / 401 / autre compte.
 * Côté serveur : sans effet.
 */
export function useUserRefresh() {
    if (!import.meta.client) {
        const none = () => Promise.resolve(false)
        return { refresh: none, refreshIfOlderThan: none, lastRefreshAt: () => null, lastOkAt: () => null }
    }
    if (!refresher) {
        const $apiFetch = useApiFetch()
        const { data: userData } = useNuxtData('user')
        refresher = createUserRefresher({
            startedAt: Date.now(),
            fetchUser: () => $apiFetch(API_ROUTES.USER_PLAN, { timeout: 5000, retry: 0 }),
            // Le cache COURANT est relu à l'écriture : une réponse tardive après
            // déconnexion ou changement de compte n'écrit rien.
            apply: (fresh) => {
                const merged = mergePlan(userData.value, fresh)
                if (!merged) return false
                if (authStore.actions.applyUser(merged) === false) return false
                userData.value = merged
                return true
            },
        })
    }
    return refresher
}
