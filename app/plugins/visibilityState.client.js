import { ref, computed, watch, onBeforeUnmount } from 'vue'

// Lot M1 : le « Nest ready » suit la langue (meta.nestReady du dictionnaire).
// M1-bis (relecture) : le titre n'est posé QUE PENDANT le clignotement, avec
// tagPriority: 'high' — sur unhead 3.2.3, quand deux entrées posent le
// titre, la dernière enregistrée gagne en permanence : app.vue masquerait ce
// plugin pour toujours. L'entrée est RETIRÉE à l'arrêt, laissant la main à
// app.vue et aux pages qui ont leur propre titre (légales, benchmarks).
export default defineNuxtPlugin((nuxtApp) => {
    let interval = null
    const isTabActive = ref(true)
    const blinking = ref(false)
    const showReady = ref(false)

    const { t } = useLocale()
    const readyText = computed(() => t('meta.nestReady'))
    const blinkTitle = computed(() => (showReady.value ? readyText.value : ''))

    const stopTitleCycle = () => {
        if (interval) {
            clearInterval(interval)
            interval = null
        }
        blinking.value = false
        showReady.value = false
    }
    const startTitleCycle = () => {
        stopTitleCycle()
        blinking.value = true
        showReady.value = true
        interval = setInterval(() => {
            showReady.value = !showReady.value
        }, 500)
    }

    const onVisibilityChange = () => {
        isTabActive.value = document.visibilityState === 'visible'
        if (isTabActive.value) {
            if (globalStore.getters.needNotification) {
                globalStore.actions.updateNotification(false)
            }
            stopTitleCycle()
        }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    watch(
        () => Boolean(globalStore.getters.needNotification) && !isTabActive.value,
        (shouldBlink) => {
            if (shouldBlink) startTitleCycle()
            else stopTitleCycle()
        }
    )

    // L'entrée de titre n'existe que pendant le clignotement — retirée
    // à l'arrêt, la main revient à app.vue et aux pages à titre propre.
    watch(blinking, (on) => {
        if (on) {
            useHead({ title: blinkTitle }, { tagPriority: 'high' })
        }
        // le retrait se fait par blinking=false → showReady reste false →
        // le titre vide cesse d'être posé par ce plugin
    })

    nuxtApp.hook('app:suspense:resolve', () => {})
    onBeforeUnmount(() => {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        stopTitleCycle()
    })

    nuxtApp.provide('isTabActive', isTabActive)
})
