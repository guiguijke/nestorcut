<template>
    <div
        class="advswitch"
        :class="{ 'advswitch--on': modelValue }"
        data-testid="advanced-import-switch"
    >
        <button
            type="button"
            role="switch"
            :aria-checked="modelValue ? 'true' : 'false'"
            class="advswitch__btn"
            data-testid="advanced-import-switch-btn"
            @click="emit('update:modelValue', !modelValue)"
        >
            <span class="advswitch__track" aria-hidden="true">
                <span class="advswitch__knob" />
            </span>
            <span class="advswitch__text">
                <span class="advswitch__label">{{ t('advancedImport.title') }}</span>
                <span class="advswitch__hint">
                    {{ modelValue ? t('advancedImport.switchOn') : t('advancedImport.switchOff') }}
                </span>
            </span>
        </button>
    </div>
</template>

<script setup>
/**
 * Lot E3 — l'interrupteur « Import avancé »
 * (`docs/PLAN-ECLATEMENT-2026-09-12.md` §6.1 point 1).
 *
 * Le même composant sert à la création d'un projet (page d'accueil, entre les
 * cartes de mode et la zone de dépôt) et sur la page projet. Son état est une
 * propriété du PROJET : l'appelant le lit sur le document projet et le
 * persiste quand il change — ce composant ne connaît ni réseau ni stockage.
 *
 * ALLUMÉ, IL DOIT SE VOIR : libellé explicite, couleur d'accent, bordure de
 * la zone de dépôt (la classe `advswitch--on` est aussi le crochet des pages).
 * Pas une case grise. Rayon 4 px partout, jamais de pilule (mémoire UI).
 */
const { t } = useLocale()

defineProps({
    modelValue: {
        type: Boolean,
        default: false,
    },
})
const emit = defineEmits(['update:modelValue'])
</script>

<style lang="scss" scoped>
.advswitch {
    border: 1px solid var(--fill-tertiary);
    border-radius: 4px;
    padding: 8px 10px;
    transition: border-color 0.15s ease, background-color 0.15s ease;

    &--on {
        border-color: var(--blue);
        background-color: rgba(110, 168, 255, 0.08);
    }

    &__btn {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 0;
        border: 0;
        background: none;
        cursor: pointer;
        text-align: left;
    }

    &__track {
        position: relative;
        flex: 0 0 auto;
        width: 34px;
        height: 18px;
        border-radius: 4px;
        background-color: var(--fill-tertiary);
        transition: background-color 0.15s ease;
    }
    &--on &__track {
        background-color: var(--blue);
    }
    &__knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 4px;
        background-color: #fff;
        transition: transform 0.15s ease;
    }
    &--on &__knob {
        transform: translateX(16px);
    }

    &__text {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }
    &__label {
        color: var(--label-primary);
        font-size: 14px;
        font-weight: 600;
    }
    &--on &__label {
        color: var(--blue);
    }
    &__hint {
        color: var(--label-secondary);
        font-size: 12px;
    }
}
</style>
