<template>
    <div class="picker" role="radiogroup" :aria-label="t('privacy.choice')">
        <!-- U1 passe 2 (a11y) : l'action « Activer le coffre » vit HORS de
             la carte radio — un bouton imbriqué dans un role=radio est un
             contrôle interactif imbriqué (axe: nested-interactive). -->
        <div class="picker__cell">
            <div
                class="picker__card"
                :class="{ 'picker__card--on': model === 'device' }"
                role="radio"
                :aria-checked="model === 'device'"
                tabindex="0"
                @click="select('device')"
                @keydown.enter.prevent="select('device')"
                @keydown.space.prevent="select('device')"
            >
                <span class="picker__title">{{ t('privacy.device.title') }}</span>
                <span class="picker__body">{{ t('privacy.device.body') }}</span>
            </div>
        </div>
        <div class="picker__cell">
            <div
                class="picker__card"
                :class="{ 'picker__card--on': model === 'cloud' }"
                role="radio"
                :aria-checked="model === 'cloud'"
                tabindex="0"
                @click="select('cloud')"
                @keydown.enter.prevent="select('cloud')"
                @keydown.space.prevent="select('cloud')"
            >
                <span class="picker__title">{{ t('privacy.cloud.title') }}</span>
                <span class="picker__body">{{ t('privacy.cloud.body') }}</span>
            </div>
            <span
                v-if="vaultEnabled"
                class="picker__vault picker__vault--on"
            >{{ t('privacy.cloud.vaultOn') }}</span>
            <UiButton
                v-else
                class="picker__vault"
                variant="ghost"
                size="s"
                @click.stop="openVault"
            >{{ t('privacy.cloud.vaultOff') }}</UiButton>
        </div>
    </div>
</template>

<script setup>
const model = defineModel({ type: String, default: 'device' })
const { t } = useLocale()

const vaultEnabled = computed(() =>
    Boolean(unref(authStore.getters.user)?.encryption?.enabled)
)

function select(mode) {
    model.value = mode
}

function openVault() {
    model.value = 'cloud'
    useVaultMenuOpen().value = true
}
</script>

<style lang="scss" scoped>
.picker {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    text-align: left;

    @media (min-width: 567px) {
        grid-template-columns: 1fr 1fr;
    }

    &__cell {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
    }

    &__card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        padding: 14px 16px;
        border-radius: var(--radius-l);
        border: 1px solid var(--separator-secondary);
        background: var(--background-primary);
        color: inherit;
        cursor: pointer;
        text-align: left;
        transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;

        &--on {
            border-color: var(--accent-primary);
            border-width: 2px;
            padding: 13px 15px;
            background: color-mix(in srgb, var(--accent-primary) 6%, var(--background-primary));
        }

        @media (hover: hover) {
            &:hover {
                border-color: var(--accent-primary);
            }
        }
    }

    &__title {
        font-size: var(--fs-14);
        font-weight: 700;
        color: var(--label-primary);
    }

    &__body {
        font-size: var(--fs-13);
        line-height: 1.4;
        color: var(--label-secondary);
    }

    &__vault {
        font-size: var(--fs-12);
        font-weight: 600;
        line-height: 1.3;
        justify-self: start;

        &--on {
            color: var(--accent-primary);
        }
    }
}
</style>
