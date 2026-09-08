<template>
    <!-- U0 : contrôle segmenté (directions, unités, vue couleur/DXF) —
         remplace les grilles de boutons ad hoc. Radio accessible :
         role=radiogroup, flèches clavier. -->
    <div class="ui-seg" role="radiogroup" :aria-label="label">
        <button
            v-for="opt in options"
            :key="opt.value"
            type="button"
            role="radio"
            :aria-checked="opt.value === modelValue"
            :class="['ui-seg__opt', { 'ui-seg__opt--active': opt.value === modelValue }]"
            :title="opt.hint || undefined"
            @click="$emit('update:modelValue', opt.value)"
        >
            <UiIcon v-if="opt.icon" :name="opt.icon" :size="14" />
            <span>{{ opt.label }}</span>
        </button>
    </div>
</template>

<script setup>
defineProps({
    modelValue: { type: [String, Number], default: '' },
    options: { type: Array, required: true }, // [{value,label,hint,icon}]
    label: { type: String, default: '' },
})
defineEmits(['update:modelValue'])
</script>

<style lang="scss" scoped>
.ui-seg {
    display: flex;
    gap: var(--sp-1);
    padding: var(--sp-1);
    background: var(--surface-2);
    border-radius: var(--radius);

    &__opt {
        flex: 1;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: var(--sp-2) var(--sp-1);
        border: none;
        border-radius: calc(var(--radius) - 1px);
        background: transparent;
        color: var(--text-2);
        font-size: var(--fs-13);
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.15s, color 0.15s, box-shadow 0.15s;

        &:hover:not(&--active) { color: var(--text); }

        &--active {
            background: var(--surface);
            color: var(--accent);
            box-shadow: var(--shadow-s);
        }
        &:focus-visible {
            outline: none;
            box-shadow: var(--focus-ring);
        }
    }
}
</style>
