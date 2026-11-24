import { shouldAutoRefresh } from '~/utils/userRefresh'
import { hasPaidAccess } from '~/utils/entitlementUi'

// Retour d'onglet : un palier accordé (ou payé ailleurs) pendant que l'onglet
// restait ouvert apparaît sans recharger. Piège 30 : les écouteurs vivent dans
// un PLUGIN (scope app, immortel) et la source de vérité est
// useNuxtData('user'), pas le store d'authentification. Au plus une relecture
// par minute ; jamais pour un visiteur ni pour un compte qui paie déjà ; sans effet visible (le cache garde
// l'ancien utilisateur jusqu'à la réponse et n'est jamais vidé sur erreur —
// voir utils/userRefresh.js).
export default defineNuxtPlugin((nuxtApp) => {
    const { data: userData } = useNuxtData('user')
    const userRefresh = useUserRefresh()

    const onSignal = (event, persisted = false) => {
        const go = shouldAutoRefresh({
            signedIn: Boolean(userData.value?.id),
            paidAccess: hasPaidAccess(userData.value),
            event,
            visibilityState: document.visibilityState,
            persisted,
            lastAt: userRefresh.lastRefreshAt(),
            now: Date.now(),
        })
        if (go) nuxtApp.runWithContext(() => userRefresh.refresh())
    }

    document.addEventListener('visibilitychange', () => onSignal('visibilitychange'))
    window.addEventListener('focus', () => onSignal('focus'))
    window.addEventListener('pageshow', (e) => onSignal('pageshow', e.persisted === true))
})
