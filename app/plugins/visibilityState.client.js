import { ref, computed, watch, onBeforeUnmount } from 'vue'

// Lot M1 : le « Nest ready » suit la langue (meta.nestReady du dictionnaire).
// M1-bis : le titre n'est posé QUE PENDANT le clignotement, avec
// tagPriority: 'high' — sur unhead 3.2.3, la dernière entrée enregistrée
// gagne en permanence : app.vue masquerait ce plugin pour toujours.
// M1-ter (relecture M1-bis) : l'entrée est DISPOSÉE à l'arrêt
// (entry.dispose()) — un titre vide en priorité haute SUPPRIME la balise
// titre au lieu de rendre la main (le navigateur fige alors le titre du
// chargement, les pages légales perdent le leur). Pendant le clignotement,
// la phase « éteinte » alterne avec t('meta.title'), jamais une chaîne vide.
export default defineNuxtPlugin((nuxtApp) => {
    let interval = null
    let headEntry = null
    const isTabActive = ref(true)
    const showReady = ref(false)

    const { t } = useLocale()
    const readyText = computed(() => t('meta.nestReady'))
    const restTitle = computed(() => t('meta.title'))
    const blinkTitle = computed(() => (showReady.value ? readyText.value : restTitle.value))

    const disposeHeadEntry = () => {
        if (headEntry) {
            headEntry.dispose()
            headEntry = null
        }
    }

    const stopTitleCycle = () => {
        if (interval) {
            clearInterval(interval)
            interval = null
        }
        showReady.value = false
        disposeHeadEntry()
    }

    const startTitleCycle = () => {
        stopTitleCycle()
        showReady.value = true
        headEntry = useHead({ title: blinkTitle }, { tagPriority: 'high' })
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

    nuxtApp.hook('app:suspense:resolve', () => {})
    onBeforeUnmount(() => {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        stopTitleCycle()
    })

    nuxtApp.provide('isTabActive', isTabActive)
})
