<template>
    <div class="stats">
        <MainTitle :label="t('stats.title')" class="stats__title" />
        <div class="stats__grid grid">
            <div class="grid__item">
                <UiStat :value="stats.projects" :label="t('stats.projects')" />
            </div>
            <div class="grid__item">
                <UiStat :value="stats.nestings" :label="t('stats.nestings')" />
            </div>
            <div class="grid__item">
                <UiStat :value="stats.partsNested" :label="t('stats.partsNested')" />
            </div>
            <!-- U1 passe 2 (retouche 2) : les CINQ statistiques sur la même
                 primitive — plus d'anciennes tuiles à chiffres bleus. -->
            <div class="grid__item">
                <UiStat :value="stats.nestingsThisMonth" :label="t('stats.thisMonth')" />
            </div>
            <div class="grid__item">
                <UiStat :value="`${successRate}%`" :label="t('stats.successRate')" />
            </div>
        </div>
    </div>
</template>

<script setup>
const { t } = useLocale()

const stats = ref({
    projects: 0,
    nestings: 0,
    nestingsCompleted: 0,
    nestingsFailed: 0,
    partsNested: 0,
    nestingsThisMonth: 0,
    dxfFiles: 0,
    dxfProcessed: 0,
})

const $apiFetch = useApiFetch()

onMounted(async () => {
    try {
        const data = await $apiFetch('/api/user/stats')
        stats.value = data
    } catch (err) {
        console.error('Failed to load user stats:', err)
    }
})

const successRate = computed(() => {
    const { nestingsCompleted, nestings } = stats.value
    if (!nestings) return 0
    return Math.round((nestingsCompleted / nestings) * 100)
})
</script>

<style lang="scss" scoped>
.stats {
    width: 100%;
    max-width: 520px;

    &__title {
        text-align: center;
        margin-bottom: 16px;
    }
}

.grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;

    @media (min-width: 567px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}
</style>
