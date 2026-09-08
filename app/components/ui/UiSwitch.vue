<template>
    <!-- U0 : interrupteur accessible (checked via v-model). -->
    <label class="ui-switch">
        <input type="checkbox" :checked="modelValue" @change="$emit('update:modelValue', $event.target.checked)" />
        <span class="ui-switch__track" aria-hidden="true" />
        <span class="ui-switch__label"><slot>{{ label }}</slot></span>
    </label>
</template>

<script setup>
defineProps({
    modelValue: { type: Boolean, default: false },
    label: { type: String, default: '' },
})
defineEmits(['update:modelValue'])
</script>

<style lang="scss" scoped>
.ui-switch {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    cursor: pointer;
    color: var(--text);
    font-size: var(--fs-13);
    font-weight: 500;

    input { position: absolute; opacity: 0; }

    &__track {
        width: 34px;
        height: 20px;
        border-radius: var(--radius-full);
        background: var(--border-strong);
        position: relative;
        transition: background-color 0.2s;
        flex-shrink: 0;

        &::after {
            content: '';
            position: absolute;
            top: 2px;
            left: 2px;
            width: 16px;
            height: 16px;
            border-radius: var(--radius-full);
            background: var(--surface);
            box-shadow: var(--shadow-s);
            transition: transform 0.2s;
        }
    }
    input:checked + &__track {
        background: var(--accent);
        &::after { transform: translateX(14px); }
    }
    input:focus-visible + &__track {
        box-shadow: var(--focus-ring);
    }
}
</style>
