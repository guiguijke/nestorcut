<template>
    <!-- U2 : extraction du bandeau refus capacité. Classes
         `.capacity-panel__levers li` CONSERVÉES (capacityPanel.test.js
         et le harnais). -->
    <div
        v-if="panel"
        class="capacity-panel"
        data-testid="capacity-panel"
    >
        <div class="capacity-panel__title">{{ t('nest.capacity.title') }}</div>
        <p class="capacity-panel__refunded">{{ t('nest.capacity.refunded') }}</p>
        <ul class="capacity-panel__levers">
            <li v-if="panel.levers.sheetsNeeded">
                {{ t('report.unfit.sheetsNeeded', { n: panel.levers.sheetsNeeded }) }}
            </li>
            <li v-if="panel.levers.maxParts != null">
                {{ t('report.unfit.maxParts', { n: panel.levers.maxParts }) }}
            </li>
            <li v-if="panel.levers.maxSpacingMm != null">
                {{ t('report.unfit.maxSpacing', { v: panel.levers.maxSpacingMm }) }}
            </li>
        </ul>
        <p v-if="panel.noSpacingGain" class="capacity-panel__floor">
            {{ t('nest.capacity.noSpacingGain') }}
        </p>
        <div class="capacity-panel__actions">
            <MainButton
                v-if="panel.nextSheets"
                :label="t('report.unfit.addSheet')"
                :size="sizeType.s"
                :theme="themeType.primary"
                data-testid="capacity-add-sheet"
                @click="$emit('add-sheet')"
            />
            <MainButton
                v-if="panel.reduceSpacingToMm != null"
                :label="t('report.unfit.reduceSpacing', { v: panel.reduceSpacingToMm })"
                :size="sizeType.s"
                :theme="themeType.secondary"
                data-testid="capacity-reduce-spacing"
                @click="$emit('reduce-spacing')"
            />
            <MainButton
                :label="t('nest.capacity.retry')"
                :size="sizeType.s"
                :theme="themeType.secondary"
                data-testid="capacity-retry"
                @click="$emit('retry')"
            />
        </div>
    </div>
</template>

<script setup>
import { sizeType } from '~~/constants/size.constants'
import { themeType } from '~~/constants/theme.constants'

defineProps({
    panel: { type: Object, default: null },
})
defineEmits(['add-sheet', 'reduce-spacing', 'retry'])
const { t } = useLocale()
</script>

<style lang="scss" scoped>
.capacity-panel {
    margin-top: 12px;
    padding: 14px 16px;
    background-color: var(--error-background);
    border: solid 1px var(--error-border);
    border-radius: var(--radius-l);
    max-width: 42rem;

    &__title {
        font-size: var(--fs-14);
        font-weight: 600;
        color: var(--label-primary);
    }

    &__levers {
        margin: 10px 0 0;
        padding-left: 18px;
        font-size: var(--fs-13);
        line-height: 1.6;
        color: var(--label-secondary);
    }

    &__refunded {
        margin: 4px 0 0;
        font-size: var(--fs-12);
        color: var(--label-tertiary);
    }

    &__floor {
        margin: 10px 0 0;
        font-size: var(--fs-13);
        line-height: 1.5;
        color: var(--label-secondary);
        font-style: italic;
    }

    &__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
    }
}
</style>
