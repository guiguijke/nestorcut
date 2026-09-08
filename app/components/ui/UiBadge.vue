<template>
    <!-- U0/U1 : statuts en badges CONTOUR + point coloré (§1 « Statuts ») —
         rayon 2 px, casse normale ; neutre/info = contour discret
         (--border-strong) et la couleur portée par le point ; succès /
         avertissement / danger réservés aux états de résultat. -->
    <span :class="['ui-badge', `ui-badge--${tone}`]">
        <span v-if="dot" class="ui-badge__dot" aria-hidden="true" />
        <slot />
    </span>
</template>

<script setup>
defineProps({
    tone: { type: String, default: 'neutral' }, // neutral|info|ok|warn|danger|accent
    dot: { type: Boolean, default: false },
})
</script>

<style lang="scss" scoped>
.ui-badge {
    --ui-badge-dot: var(--text-3);

    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 1px 7px;
    border-radius: var(--radius-s);
    font-size: var(--fs-12);
    font-weight: 600;
    line-height: 1.5;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text-2);
    white-space: nowrap;

    &__dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--ui-badge-dot);
        flex-shrink: 0;
    }

    /* Tons discrets : la couleur est dans le point, pas dans le contour. */
    &--info { --ui-badge-dot: var(--info); }
    &--accent { --ui-badge-dot: var(--accent); }

    /* États de résultat (§1) : contour + texte dans le ton. */
    &--ok {
        --ui-badge-dot: var(--ok);
        color: var(--ok);
        border-color: color-mix(in srgb, var(--ok) 45%, transparent);
        background: var(--ok-bg);
    }
    &--warn {
        --ui-badge-dot: var(--warn);
        color: var(--warn);
        border-color: color-mix(in srgb, var(--warn) 45%, transparent);
        background: var(--warn-bg);
    }
    &--danger {
        --ui-badge-dot: var(--danger);
        color: var(--danger);
        border-color: color-mix(in srgb, var(--danger) 45%, transparent);
        background: var(--danger-bg);
    }
}
</style>
