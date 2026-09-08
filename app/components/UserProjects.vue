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
        <div
            v-if="filteredList.length"
            class="projects"
        >
            <UserProjectItem
                @click="$emit('closeAside')"
                v-for="project in filteredList"
                :key="project.slug"
                :project="project"
                class="projects__item"
            />
        </div>
        <p v-else-if="search" class="projects__text">
            {{ t('project.searchEmpty') }}
        </p>
        <p v-else class="projects__text">
            {{ t('project.empty') }}
        </p>
    </MainAside>
</template>

<script setup>
const route = useRoute();
const router = useRouter();
const { t } = useLocale()

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
}
</style>