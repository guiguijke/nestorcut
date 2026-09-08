<template>
    <!-- U0 : primitive champ — libellé au-dessus, suffixe d'unité, aide,
         erreur, inputmode numérique, step ±. InputField reste le
         composant historique ; UiField est la cible de la migration. -->
    <label :class="['ui-field', { 'ui-field--error': Boolean(error) }]">
        <span v-if="label" class="ui-field__label">{{ label }}</span>
        <span class="ui-field__box">
            <input
                :type="type"
                :value="modelValue"
                :placeholder="placeholder"
                :inputmode="inputmode"
                :step="step"
                :disabled="disabled"
                :aria-invalid="Boolean(error) || undefined"
                class="ui-field__input"
                :class="{ 'ui-field__input--num': numeric }"
                v-bind="$attrs"
                @input="$emit('update:modelValue', $event.target.value)"
                @blur="$emit('blur', $event)"
            />
            <button
                v-if="step && numeric"
                type="button"
                class="ui-field__step"
                aria-hidden="true"
                tabindex="-1"
                @click="bump(1)"
            >+</button>
            <span v-if="suffix" class="ui-field__suffix">{{ suffix }}</span>
        </span>
        <span v-if="error" class="ui-field__error">{{ error }}</span>
        <span v-else-if="hint" class="ui-field__hint">{{ hint }}</span>
    </label>
</template>

<script setup>
const props = defineProps({
    modelValue: { type: [String, Number], default: '' },
    label: { type: String, default: '' },
    type: { type: String, default: 'text' },
    placeholder: { type: String, default: '' },
    suffix: { type: String, default: '' },
    hint: { type: String, default: '' },
    error: { type: String, default: '' },
    inputmode: { type: String, default: '' },
    numeric: { type: Boolean, default: false },
    step: { type: [String, Number], default: '' },
    disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'blur'])
// Saisie continentale : la virgule est le séparateur décimal accepté.
const bump = (dir) => {
    const raw = String(props.modelValue ?? '').replace(',', '.')
    const v = Number(raw) || 0
    const s = Number(props.step) || 1
    const out = Math.round((v + dir * s) * 10000) / 10000
    emit('update:modelValue', String(out).replace('.', ','))
}
</script>

<style lang="scss" scoped>
.ui-field {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    text-align: left;

    &__label {
        font-size: var(--fs-12);
        font-weight: 600;
        color: var(--text-2);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    &__box {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        padding: 0 var(--sp-3);
        background: var(--surface);
        border: 1.5px solid var(--border-strong);
        border-radius: var(--radius);
        transition: border-color 0.2s, box-shadow 0.2s;
        min-height: 40px;
    }
    &:focus-within &__box {
        border-color: var(--accent);
        box-shadow: var(--focus-ring);
    }
    &--error &__box {
        border-color: var(--danger);
        background: var(--danger-bg);
    }
    &__input {
        flex: 1;
        min-width: 26px;
        border: none;
        outline: none;
        background: transparent;
        color: var(--text);
        font-size: var(--fs-14);
        font-weight: 500;
        padding: var(--sp-2) 0;
        &::placeholder { color: var(--text-3); font-weight: 400; }
    }
    &__input--num {
        font-variant-numeric: tabular-nums;
    }
    &__step {
        border: none;
        background: var(--surface-2);
        color: var(--text-2);
        border-radius: var(--radius-s);
        width: 20px;
        height: 20px;
        line-height: 1;
        font-size: var(--fs-13);
        font-weight: 700;
        cursor: pointer;
    }
    &__suffix {
        color: var(--text-3);
        font-size: var(--fs-12);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        flex-shrink: 0;
    }
    &__error { color: var(--danger); font-size: var(--fs-12); }
    &__hint { color: var(--text-3); font-size: var(--fs-12); }
}
</style>
