<template>
    <!-- U1 passe 2 : langue sur UiSegmented (plus de menu déroulant ad hoc
         avec drapeaux SVG hex) — même poids que les unités. -->
    <UiSegmented
        class="locale"
        :model-value="locale"
        :options="options"
        :label="t('nav.language')"
        @update:model-value="choose"
    />
</template>

<script setup>
import { LOCALES, translate } from '~/utils/i18n'

const { locale, setLocale } = useLocale()

const options = LOCALES.map((code) => ({
    value: code,
    label: code.toUpperCase(),
}))

const t = (key) => translate(key, locale.value)

function choose(code) {
    setLocale(code)
}
</script>

<style lang="scss" scoped>
/* Compact header sizing: same 30 px line as the unit switcher. */
.locale {
    :deep(.ui-seg__opt) {
        min-width: 30px;
        padding: var(--sp-1) var(--sp-3);
    }
}
</style>
