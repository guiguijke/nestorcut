<template>
    <!-- U1 passe 2 : unités sur UiSegmented (plus de pilule ovale ad hoc). -->
    <UiSegmented
        v-if="enabled"
        class="unit-switch"
        :model-value="unit"
        :options="options"
        :label="t('units.label')"
        @update:model-value="choose"
    />
</template>

<script setup>
const { t } = useLocale()
const { unit, setUnit, enabled } = useUnit()

const options = computed(() => [
    { value: 'mm', label: 'mm', hint: t('units.mm') },
    { value: 'inch', label: 'in', hint: t('units.inch') },
])

function choose(code) {
    setUnit(code)
}

// Bring the in-progress form values to the current unit — on manual switch,
// on cookie init, and on account preference synced from the DB. immediate
// covers the load path (the unit is set BEFORE this watcher registers, so
// without it no change event ever fires); the stores' paramsUnit tracking
// keeps the sync idempotent across remounts.
watch(
    unit,
    (to) => {
        if (!enabled.value || !to) return
        filesStore.actions.syncParamsToUnit(to)
    },
    { immediate: true }
)
</script>

<style lang="scss" scoped>
/* Compact header sizing: the segmented control keeps the 30 px line of the
   other ghost buttons without touching the primitive. */
.unit-switch {
    :deep(.ui-seg__opt) {
        min-width: 34px;
        padding: var(--sp-1) var(--sp-3);
    }
}
</style>
