<template>
    <MainAside
        :label="t('project.projects')"
        @closeAside="$emit('closeAside')"
        :btnLabel="btnLabelValue"
        @btnClick="createNewProject"
    >
        <!-- U1 passe 2 : champ de recherche au-dessus de la liste dès 8
             projets (une seule liste, filtrée). -->
        <UiField
            v-if="projectsList.length >= 8"
            v-model="search"
            type="search"
            :placeholder="t('project.search')"
            class="projects__search"
        />
        <!-- Sélection multiple (demande du propriétaire, 03/11) : dès qu'un
             projet est supprimable (la démo ne l'est jamais). -->
        <div
            v-if="deletable.length"
            class="projects__toolbar"
        >
            <button
                v-if="!selecting"
                type="button"
                class="projects__tool"
                data-testid="projects-select"
                @click="startSelecting"
            >
                {{ t('project.select') }}
            </button>
            <template v-else>
                <button
                    type="button"
                    class="projects__tool"
                    data-testid="projects-select-all"
                    @click="toggleAll"
                >
                    {{ allSelected ? t('project.selectNone') : t('project.selectAll') }}
                </button>
                <button
                    type="button"
                    class="projects__tool"
                    data-testid="projects-select-cancel"
                    @click="stopSelecting"
                >
                    {{ t('project.deleteCancel') }}
                </button>
                <MainButton
                    :theme="themeType.primary"
                    :size="sizeType.s"
                    :label="t('project.deleteSelected', { n: selectedSlugs.length })"
                    :isDisable="!selectedSlugs.length"
                    trackingTag="project_delete_many_open"
                    data-testid="projects-delete-selected"
                    class="projects__delete"
                    @click="openConfirm"
                />
            </template>
        </div>
        <div
            v-if="filteredList.length"
            class="projects"
        >
            <UserProjectItem
                @click="selecting || $emit('closeAside')"
                v-for="project in filteredList"
                :key="project.slug"
                :project="project"
                :selecting="selecting"
                :selected="selectedSlugs.includes(project.slug)"
                class="projects__item"
                @toggle="toggle"
            />
        </div>
        <p v-else-if="search" class="projects__text">
            {{ t('project.searchEmpty') }}
        </p>
        <p v-else class="projects__text">
            {{ t('project.empty') }}
        </p>
        <DialogWrapper
            v-model:isModalOpen="confirmOpen"
            trackingTag="project_delete_many"
        >
            <div class="delete-many">
                <MainTitle
                    :label="tp('project.deleteManyTitle', deleting ? progress.total : selectedProjects.length)"
                    class="delete-many__title"
                />
                <p class="delete-many__text">
                    {{ t(selectedProjects.some((p) => p.local) ? 'project.deleteManyLocal' : 'project.deleteManyCloud') }}
                </p>
                <p
                    v-if="deleting"
                    class="delete-many__progress"
                    role="status"
                >
                    {{ t('project.deleteManyProgress', progress) }}
                </p>
                <p
                    v-if="failedCount"
                    class="delete-many__error"
                    role="alert"
                >
                    {{ tp('project.deleteManyFailed', failedCount) }}
                </p>
                <div class="delete-many__actions">
                    <MainButton
                        :theme="themeType.secondary"
                        :label="t('project.deleteCancel')"
                        :isDisable="deleting"
                        trackingTag="project_delete_many_cancel"
                        class="delete-many__action"
                        @click="confirmOpen = false"
                    />
                    <MainButton
                        :theme="themeType.primary"
                        :label="t('project.deleteConfirm')"
                        :isDisable="deleting || !selectedProjects.length"
                        trackingTag="project_delete_many_confirm"
                        data-testid="projects-delete-many-confirm"
                        class="delete-many__action"
                        @click="confirmDeleteMany"
                    />
                </div>
            </div>
        </DialogWrapper>
    </MainAside>
</template>

<script setup>
import { sizeType } from '~~/constants/size.constants'
import { themeType } from '~~/constants/theme.constants'
import { canDeleteProject, deleteProjects } from '~/composables/projects'

const route = useRoute();
const router = useRouter();
const { t, tp } = useLocale()

const { getters, actions} = globalStore;
const { setProjects } = actions;

const $apiFetch = useApiFetch();
const data = getters.projectsList || await $apiFetch(API_ROUTES.PROJECTS);

const projectsList = computed(() => {
    return getters.projectsList || data.projects
});

const search = ref('')

const filteredList = computed(() => {
    const list = projectsList.value
    const q = search.value.trim().toLowerCase()
    if (!q) return list
    // Sans accents : « charpente » trouve « Charpente été ».
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const nq = norm(q)
    return list.filter((p) => norm(p.isDemo ? t('demo.projectName') : String(p.name || '')).includes(nq))
})

// Sélection multiple. La sélection porte sur des slugs : un projet supprimé
// quitte la liste ET la sélection au fil de l'eau.
const deletable = computed(() => projectsList.value.filter(canDeleteProject))
const selecting = ref(false)
const selected = ref(new Set())
const selectedSlugs = computed(() =>
    deletable.value.map((p) => p.slug).filter((slug) => selected.value.has(slug))
)
const selectedProjects = computed(() =>
    deletable.value.filter((p) => selected.value.has(p.slug))
)
// « Tout » = ce que la recherche affiche, pas les projets masqués.
const visibleDeletable = computed(() => filteredList.value.filter(canDeleteProject))
const allSelected = computed(() =>
    visibleDeletable.value.length > 0 && visibleDeletable.value.every((p) => selected.value.has(p.slug))
)
const confirmOpen = ref(false)
const deleting = ref(false)
const progress = ref({ done: 0, total: 0 })
const failedCount = ref(0)

function startSelecting() {
    selected.value = new Set()
    selecting.value = true
}
function stopSelecting() {
    selecting.value = false
    selected.value = new Set()
}
function toggle(slug) {
    const next = new Set(selected.value)
    if (next.has(slug)) next.delete(slug)
    else next.add(slug)
    selected.value = next
}
function toggleAll() {
    const next = new Set(selected.value)
    const select = !allSelected.value
    for (const p of visibleDeletable.value) {
        if (select) next.add(p.slug)
        else next.delete(p.slug)
    }
    selected.value = next
}
function openConfirm() {
    failedCount.value = 0
    confirmOpen.value = true
}
async function confirmDeleteMany() {
    if (deleting.value) return
    deleting.value = true
    failedCount.value = 0
    progress.value = { done: 0, total: selectedProjects.value.length }
    const { failed } = await deleteProjects(selectedProjects.value, {
        currentSlug: route.params.slug,
        onProgress: (p) => { progress.value = p },
    })
    deleting.value = false
    // Les échecs restent cochés, la fenêtre reste ouverte pour les dire.
    selected.value = new Set(failed.map((f) => f.project.slug))
    failedCount.value = failed.length
    if (!failed.length) {
        confirmOpen.value = false
        stopSelecting()
    }
}

onMounted(async () => {
    if(!getters.projectsList) {
        const { overlayLocalProjectTitles } = await import('~/composables/projects')
        setProjects(await overlayLocalProjectTitles(data.projects))
    }
})

const btnLabelValue = computed(() => {
    return route.name === 'home' ? '' : t('project.new')
})

const emit = defineEmits(["closeAside"]);

const createNewProject = () => {
    emit('closeAside');
    router.push({ name: 'home' })
}
</script>
    
<style lang="scss" scoped>
.projects {
    &__search {
        margin-bottom: 12px;
    }
    &__text {
        color: var(--label-secondary);
    }
    &__item {
        &:not(:last-child) {
            margin-bottom: 8px;
        }
    }
    &__toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 4px 12px;
        margin-bottom: 8px;
    }
    &__tool {
        padding: 4px 0;
        background: none;
        border: none;
        color: var(--accent-primary);
        cursor: pointer;
        font-size: var(--fs-13);
        text-decoration: underline;

        @media (hover: hover) {
            &:hover {
                opacity: 0.8;
            }
        }
    }
}

.delete-many {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px;
    max-width: 420px;
    text-align: center;

    &__text,
    &__progress {
        color: var(--label-secondary);
        font-size: var(--fs-14);
        line-height: 1.5;
    }
    &__error {
        color: var(--error-text, var(--danger));
        font-size: var(--fs-14);
    }
    &__actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
    }
    &__action {
        flex: 1;
    }
}
</style>