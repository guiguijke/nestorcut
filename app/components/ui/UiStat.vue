<template>
    <!-- U0 : statistique — valeur en chiffres tabulaires + libellé. -->
    <div class="ui-stat">
        <!-- U3 passe 3 : la valeur accepte un contenu riche (le compteur
             de coeurs anime de la vue live) ; sans slot, c'est `value`. -->
        <span class="ui-stat__value num"><slot>{{ value }}</slot></span>
        <span class="ui-stat__label">{{ label }}</span>
    </div>
</template>

<script setup>
defineProps({
    value: { type: [String, Number], default: '' },
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
