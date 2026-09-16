<template>
    <!-- Lot D5 : le « ? » qui mène à la page de documentation, à l'ancre
         exacte, dans la langue de l'utilisateur (repli anglais — le
         helper gère les six codes, seules les langues publiées servent).
         Un VRAI lien (nouvel onglet), pas une infobulle : la réponse est
         dans la doc, à un clic du geste.
         D5-bis : le texte de l'ANCIENNE infobule peut voyager en title
         (prop hint) — un seul « ? » par bloc, le lien absorbe la bulle ;
         et la forme est le CARRÉ 4 px de la charte (le rond est pour les
         avatars). -->
    <a
        v-if="href"
        :href="href"
        target="_blank"
        rel="noopener"
        class="helpdot"
        :aria-label="hint || t('help.openDoc')"
        :title="hint || t('help.openDoc')"
        data-testid="help-dot"
    >?</a>
</template>

<script setup>
import { computed } from 'vue'
import { docsHelpUrl } from '~/utils/docsLinks'
import { translate } from '~/utils/i18n'

const props = defineProps({
    topic: { type: String, required: true },
    // Texte de l'ancienne infobule, quand le lien remplace un « ? » à
    // bulle : il devient le title du lien.
    hint: { type: String, default: null },
})

const { locale } = useLocale()
const href = computed(() => docsHelpUrl(locale.value, props.topic))
const t = (key) => translate(key, locale.value)
</script>

<style lang="scss" scoped>
.helpdot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    margin-left: 6px;
    // D5-bis : 4 px, la règle de la charte — pas le rond (réservé aux
    // avatars).
    border-radius: var(--radius);
    border: 1px solid var(--separator-secondary);
    background: none;
    color: var(--label-tertiary);
    font-size: 11px;
    line-height: 1;
    text-decoration: none;
    vertical-align: middle;
    flex: none;

    &:hover {
        color: var(--accent-primary);
        border-color: var(--accent-primary);
    }

    &:focus-visible {
        outline: 2px solid var(--accent-primary);
        outline-offset: 1px;
    }
}
</style>
