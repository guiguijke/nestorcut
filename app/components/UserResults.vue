<template>
    <MainAside @closeAside="$emit('closeAside')" :label="isHomePage ? t('results.all') : t('results.title')">
        <div
            v-if="getters.resultsList.length"
            class="results"
        >
            <UserResultItem
                v-for="result in getters.resultsList"
                :key="result.id"
                :result="result"
                :privacy-mode="privacyMode"
                @openModal="openModal(result)"
                class="results__item"
            />
        </div>
        <p v-else class="results__text">
            {{ t('results.empty') }}
        </p>
        <ResultModal
            v-model:isModalOpen="resultDialog"
            @unfit-add-sheet="onUnfitAddSheet"
            @unfit-reduce-spacing="onUnfitReduceSpacing"
            @unfit-open-project="onUnfitOpenProject"
        />
    </MainAside>
</template>

<script setup>
import { projectPrivacyMode } from '~/utils/privacyMode'
import { hasPaidAccess } from '~/utils/entitlementUi'
import { findReopenItem, isOnJobProject } from '~/utils/resultNav'
import { trackEvent } from '~/utils/track'

const route = useRoute();
const resultDialog = useResultDialog();
const { t } = useLocale()
const { getters, actions } = globalStore;
const { setResults, setModalResultData, updateNotification } = actions;
const eventSource = ref(null)
// J-082 : hydratation asynchrone (IndexedDB) — chaîner pour préserver
// l'ordre des frames SSE même si une hydratation est encore en cours.
let hydrateChain = Promise.resolve()

const slug = computed(() => route.params.slug);
const privacyMode = computed(() => {
    if (!unref(slug) || filesStore.getters.projectDemo) return null
    return projectPrivacyMode(
        { local: unref(filesStore.getters.projectLocal), isDemo: false },
        Boolean(unref(authStore.getters.user)?.encryption?.enabled),
    )
})

onMounted(() => {
    updateResults()
})
const updateResults = () => {
    setResults([])

    if (unref(eventSource)) {
        unref(eventSource).close()
    }

    eventSource.value = new EventSource(API_ROUTES.RESULTS(unref(slug)))

    unref(eventSource).onmessage = (event) => {
        try {
            const parsed = JSON.parse(event.data)
            if (parsed.type === 'initial' || parsed.type === 'update') {
                const items = parsed.data.items
                // J-082 : les jobs locaux (localOnly) n'ont AUCUN artefact
                // côté serveur — alternatives/SVG/DXF/rapport viennent
                // d'IndexedDB (hydratation, zéro géométrie servie).
                hydrateChain = hydrateChain
                    .then(() => hydrateLocalItems(items))
                    .then((hydrated) => setResults(hydrated))
                    .catch(() => setResults(items))

                if (parsed.data.needNotification) {
                    updateNotification(parsed.data.needNotification)
                }
            }
        } catch (e) {
            console.error('Error parsing SSE message:', e)
        }
    }
    unref(eventSource).onerror = (err) => {
        console.error('SSE connection error:', err)
    }
}


const openModal = (result) => {
    setModalResultData(result)
    resultDialog.value = true
}

// Z1/Z3 (vérif 2026-09-05) puis D11/D12 (02/11) : les boutons « Ajouter
// environ k tôles et relancer » / « Réduire l'espacement » du modal
// n'écrivent AUCUN réglage ici. Sur la page du projet du job, ils posent une
// demande que `[slug].vue` applique avec SES fonctions (ajout + relance ;
// réduction de la SÉCURITÉ par updateKerfSafety, jamais `space` brut).
// Ailleurs (/home, autre projet), un seul bouton « Ouvrir le projet ».
// « Sur le projet du job » = route ET store, qui porte le CHEMIN d'API —
// jamais `filesStore.getters.projectSlug === ps` (toujours faux, C2-1).
const onJob = (ps) => isOnJobProject(route.params.slug, filesStore.getters.projectSlug, ps)
const capacityActionRequest = useCapacityActionRequest()
const { data: userData } = useNuxtData('user')

const onUnfitOpenProject = (payload) => {
    const ps = payload?.projectSlug
    trackEvent('capacity_open_project_click', { surface: 'modal' })
    resultDialog.value = false
    if (ps) navigateTo('/project/' + ps)
}
const onUnfitAddSheet = (payload) => {
    if (!onJob(payload?.projectSlug)) return onUnfitOpenProject(payload)
    if (!payload?.nextSheets) return
    trackEvent('capacity_add_sheets_click', {
        surface: 'modal',
        k: String(payload.addSheets ?? 1),
        plan: hasPaidAccess(unref(userData)) ? 'paid' : 'free',
    })
    resultDialog.value = false
    capacityActionRequest.value = {
        projectSlug: payload.projectSlug,
        action: 'add_sheets',
        nextSheets: payload.nextSheets,
        at: Date.now(),
    }
}
const onUnfitReduceSpacing = (payload) => {
    const mm = Number(payload?.mm)
    if (payload?.mm == null || !Number.isFinite(mm)) return
    // Hors du projet du job, le bouton n'est pas affiché (D12) : rien.
    if (!onJob(payload?.projectSlug)) return
    resultDialog.value = false
    capacityActionRequest.value = {
        projectSlug: payload.projectSlug,
        action: 'reduce_spacing',
        mm,
        at: Date.now(),
    }
}

// d10 (02/11) : retour de Checkout — la fenêtre du résultat se rouvre dès
// que son slug est dans la liste SSE, une seule fois (cible vidée ensuite,
// et au changement de page).
const reopenTarget = useCheckoutReopenTarget()
watch(
    [() => getters.resultsList, reopenTarget],
    ([list, target]) => {
        const item = findReopenItem(list, target)
        if (!item) return
        reopenTarget.value = null
        openModal(item)
    },
)

const isHomePage = computed(() => {
    return route.path === '/home'
})

onBeforeUnmount(() => {
    if (unref(eventSource)) {
        unref(eventSource).close()
    }
})

watch(
    () => route.path,
    () => {
        reopenTarget.value = null
        updateResults()
    },
);

</script>
<style lang="scss" scoped>
.results {
    &__text {
        color: var(--label-secondary);
    }
    &__item {
        &:not(:last-child) {
            margin-bottom: 8px;
        }
    }
}
</style>