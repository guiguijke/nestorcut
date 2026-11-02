import {
    CHECKOUT_ACTIVE_STATUSES,
    checkoutReturnMarker,
    pollCheckoutStatus,
    queryWithoutCheckoutMarkers,
    returnPageKind,
    takeCheckoutIntent,
} from '~/utils/checkoutReturn'
import { trackEvent } from '~/utils/track'

/**
 * Attente d'au plus `ms` millisecondes, écourtée dès que l'onglet repasse au
 * premier plan (visibilitychange → visible) : un onglet resté en arrière-plan
 * pendant le paiement ne fait pas attendre la vérification pour rien. Retire
 * son écouteur à chaque réveil.
 */
function sleepOrVisible(ms) {
    return new Promise((resolve) => {
        let timer = null
        const onVisible = () => {
            if (document.visibilityState === 'visible') done()
        }
        const done = () => {
            clearTimeout(timer)
            document.removeEventListener('visibilitychange', onVisible)
            resolve()
        }
        timer = setTimeout(done, ms)
        document.addEventListener('visibilitychange', onVisible)
    })
}

/**
 * O3, d10, D15, D17 : retour de Stripe Checkout, sur n'importe quelle page du
 * layout `auth` (appelé UNE fois depuis layouts/auth.vue). Le retour est un
 * chargement complet : le layout se monte, la query porte
 * `?subscriptionInternalId=<24 hex>` (succès) ou `?checkout=cancelled`.
 *
 *   1. consomme l'intention `sessionStorage` (une seule fois) ;
 *   2. nettoie l'URL tout de suite (un rechargement ne rejoue pas le retour) ;
 *   3. pose la cible de réouverture de la fenêtre du résultat ;
 *   4. succès : interroge /check jusqu'à un statut terminal (phase rapide puis
 *      lente, pollCheckoutStatus) pendant que useCheckoutReturnState vaut
 *      'checking' — les boutons « Débloquer » sont alors désactivés ;
 *   5. rafraîchit le palier du client SANS recharger, avertit par un toast ;
 *   6. trace `checkout_return` avec le statut final.
 *
 * La boucle n'est pas liée au démontage du layout : ses seuls effets sont
 * globaux (données `user`, toast, état partagé) et elle est bornée à 2 min.
 */
export function useCheckoutReturn() {
    // Tout ce qui exige le contexte Nuxt est capturé ICI, dans le setup.
    const route = useRoute()
    const router = useRouter()
    const toast = useToast()
    const { t } = useLocale()
    const reopenTarget = useCheckoutReopenTarget()
    const checkoutState = useCheckoutReturnState()
    const openBuyCredits = useBuyCreditsOpener()

    const refreshClientTier = async () => {
        // Les deux sources du palier côté client : le cache `user` (cadenas des
        // cartes et de la fenêtre) et le store d'authentification (bannière).
        try {
            await refreshNuxtData('user')
        } catch (err) {
            console.warn('Checkout return: user refresh failed', err)
        }
        try {
            await authStore.actions.setUser()
        } catch (err) {
            console.warn('Checkout return: setUser failed', err)
        }
    }

    const handleReturn = async () => {
        const marker = checkoutReturnMarker(route.query)
        if (!marker) return

        // Capturés avant le nettoyage de l'URL.
        const path = route.path
        const page = returnPageKind(path)
        const query = queryWithoutCheckoutMarkers(route.query)
        const hash = route.hash

        let intent = null
        try {
            intent = takeCheckoutIntent(window.sessionStorage)
        } catch {
            // Stockage indisponible : le retour fonctionne, sans réouverture.
        }

        try {
            await router.replace({ path, query, hash })
        } catch (err) {
            console.warn('Checkout return: URL cleanup failed', err)
        }

        // Succès ET annulation : l'utilisateur reprend là où il en était.
        if (intent?.resultSlug) {
            reopenTarget.value = { resultSlug: intent.resultSlug, projectSlug: intent.projectSlug }
        }

        let status = marker.kind === 'cancel' ? 'cancelled' : 'invalid'
        let timedOut = false

        if (marker.kind === 'success') {
            checkoutState.value = 'checking'
            // Le serveur relit la session Stripe : « pending » tant que le
            // paiement n'est pas confirmé (pollCheckoutStatus réessaie).
            const checkStatus = async () => {
                const response = await $fetch('/api/payment/subscription/check?subscriptionInternalId=' + marker.id, {
                    method: 'POST',
                })
                return response?.status || 'error'
            }
            try {
                const result = await pollCheckoutStatus({
                    check: checkStatus,
                    sleep: (ms) => sleepOrVisible(ms),
                    onSlow: () => toast.show(t('sub.return.pending'), 'clock'),
                })
                status = result.status
                timedOut = result.timedOut

                if (CHECKOUT_ACTIVE_STATUSES.includes(status)) {
                    await refreshClientTier()
                    toast.show(t('sub.return.activated'))
                } else if (timedOut) {
                    toast.show(t('sub.return.slow'), 'clock')
                } else {
                    // Terminal non actif (incomplete, past_due, canceled…) : la
                    // fenêtre d'abonnement, sans contexte, montre l'état réel.
                    toast.show(t('sub.return.failed'), 'alert')
                    openBuyCredits(null)
                }
            } finally {
                checkoutState.value = 'idle'
            }
        }

        trackEvent('checkout_return', {
            status: String(timedOut ? 'timeout' : status),
            page,
            source: intent?.source || 'unknown',
        })
    }

    onMounted(() => {
        handleReturn().catch((err) => {
            console.warn('Checkout return failed:', err)
        })
    })
}
