<template>
    <!-- U0 : état vide — icône, titre, phrase, action optionnelle. -->
    <div class="ui-empty">
        <UiIcon :name="icon || 'file'" :size="32" class="ui-empty__icon" />
        <div class="ui-empty__title">{{ title }}</div>
        <p v-if="text" class="ui-empty__text">{{ text }}</p>
        <div v-if="$slots.action" class="ui-empty__action">
            <slot name="action" />
        </div>
    </div>
</template>

<script setup>
defineProps({
    icon: { type: String, default: '' },
    title: { type: String, required: true },
    text: { type: String, default: '' },
})
</script>

<style lang="scss" scoped>
.ui-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-7) var(--sp-4);
    text-align: center;
    color: var(--text-3);

    &__icon { opacity: 0.5; }
    &__title { font-size: var(--fs-14); font-weight: 700; color: var(--text-2); }
    &__text { font-size: var(--fs-13); max-width: 36rem; line-height: var(--lh-text); }
    &__action { margin-top: var(--sp-2); }
}
</style>
