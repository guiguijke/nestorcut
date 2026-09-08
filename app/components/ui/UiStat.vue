<template>
    <!-- U0 : statistique — valeur en chiffres tabulaires + libellé. -->
    <div class="ui-stat">
        <span class="ui-stat__value num">{{ value }}</span>
        <span class="ui-stat__label">{{ label }}</span>
    </div>
</template>

<script setup>
defineProps({
    value: { type: [String, Number], required: true },
    label: { type: String, default: '' },
})
</script>

<style lang="scss" scoped>
.ui-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;

    &__value {
        font-variant-numeric: tabular-nums;
        font-size: var(--fs-18);
        font-weight: 700;
        color: var(--text);
        line-height: var(--lh-title);
    }
    &__label {
        font-size: var(--fs-12);
        color: var(--text-3);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
}
</style>
