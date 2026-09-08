<template>
    <!-- U0 : primitive bouton — variant primary/secondary/ghost/danger,
         tailles s/m, loading, icône (aria-label obligatoire si icône
         seule). MainButton reste le composant historique (compat) ;
         UiButton est la cible de la migration U0→U5. -->
    <button
        :type="type"
        :class="['ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, { 'ui-btn--loading': loading }]"
        :disabled="disabled || loading"
        @click="onClick"
    >
        <span v-if="loading" class="ui-btn__spinner" aria-hidden="true" />
        <UiIcon v-else-if="icon" :name="icon" :size="size === 's' ? 14 : 16" />
        <span v-if="hasLabel" class="ui-btn__label"><slot>{{ label }}</slot></span>
    </button>
</template>

<script setup>
import { trackEvent } from '~/utils/track'

const props = defineProps({
    label: { type: String, default: '' },
    variant: { type: String, default: 'secondary' }, // primary|secondary|ghost|danger
    size: { type: String, default: 'm' },            // s|m
    type: { type: String, default: 'button' },
    icon: { type: String, default: '' },
    iconOnly: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    trackingTag: { type: String, default: '' },
})
const slots = useSlots()
const hasLabel = computed(() => Boolean(props.label || slots.default))
const onClick = () => {
    if (props.trackingTag) trackEvent(`click_${props.trackingTag}`)
}
</script>

<style lang="scss" scoped>
.ui-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-2);
    font-family: var(--font-body);
    font-weight: 600;
    border-radius: var(--radius);
    border: 1px solid transparent;
    cursor: pointer;
    transition: background-color 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
    white-space: nowrap;

    &--m {
        padding: var(--sp-3) var(--sp-4);
        font-size: var(--fs-14);
        min-height: 40px;
    }
    &--s {
        padding: var(--sp-1) var(--sp-3);
        font-size: var(--fs-13);
        min-height: 30px;
    }

    &--primary {
        background: var(--accent);
        color: var(--on-accent);
        &:hover:not(:disabled) { background: var(--accent-hover); }
    }
    &--secondary {
        background: var(--surface);
        color: var(--text);
        border-color: var(--border-strong);
        &:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    }
    &--ghost {
        background: transparent;
        color: var(--text-2);
        &:hover:not(:disabled) { color: var(--accent); background: var(--fill-tertiary); }
    }
    &--danger {
        background: var(--danger);
        color: var(--on-accent);
        &:hover:not(:disabled) { filter: brightness(0.9); }
    }

    &:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
    }
    &:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }

    &__spinner {
        width: 14px;
        height: 14px;
        border: 2px solid currentColor;
        border-top-color: transparent;
        border-radius: var(--radius-s);
        animation: ui-btn-spin 0.7s linear infinite;
    }
}
@keyframes ui-btn-spin {
    to { transform: rotate(360deg); }
}
</style>
