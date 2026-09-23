import { ref, computed, watch, onBeforeUnmount } from 'vue'

// Lot M1 : le titre et le « Nest ready » suivent la LANGUE DE L'APP
// (meta.title / meta.nestReady du dictionnaire) — plus de chaînes en
// dur anglaises. Le plugin lit les clés réactivement : un changement
// de langue sans rechargement met à jour le clignotement.
export default defineNuxtPlugin((nuxtApp) => {
    let interval = null
    const isTabActive = ref(true)
    const nestTitle = ref('')

    const { t } = useLocale()
    const defaultTitle = computed(() => t('meta.title'))
    const readyText = computed(() => t('meta.nestReady'))

    // Blink the document title between default and "Nest ready" so a user on
    // another tab notices a finished nesting. Only runs while a notification
    // is pending and the tab is hidden — and is stopped as soon as the user
    // comes back, instead of running forever.
    const stopTitleCycle = () => {
        if (interval) {
            clearInterval(interval)
            interval = null
        }
        nestTitle.value = readyText.value
    }
    const startTitleCycle = () => {
        stopTitleCycle()
        interval = setInterval(() => {
            nestTitle.value = nestTitle.value !== readyText.value ? readyText.value : defaultTitle.value
        }, 500)
    }

    const onVisibilityChange = () => {
        isTabActive.value = document.visibilityState === 'visible'
        if (isTabActive.value) {
            // Returning to the tab clears the notification and stops blinking.
            if (globalStore.getters.needNotification) {
                globalStore.actions.updateNotification(false)
            }
            stopTitleCycle()
        }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    // Drive the blinker from the notification state so it only runs while
    // needed (tab hidden + a pending notification).
    watch(
        () => Boolean(globalStore.getters.needNotification) && !isTabActive.value,
        (shouldBlink) => {
            if (shouldBlink) startTitleCycle()
            else stopTitleCycle()
        }
    )

    const title = computed(() => globalStore.getters.needNotification && !isTabActive.value ? nestTitle.value : defaultTitle.value)

    useHead({
        title: title
    })

    // Plugin is app-scoped but clean up the listener anyway for correctness.
    nuxtApp.hook('app:suspense:resolve', () => {})
    onBeforeUnmount(() => {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        stopTitleCycle()
    })

    nuxtApp.provide('isTabActive', isTabActive)
})
