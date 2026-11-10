<template>
    <!-- U2 : extraction du bandeau refus capacité. Classes
         `.capacity-panel__levers li` CONSERVÉES (capacityPanel.test.js
         et le harnais). -->
    <div
        v-if="panel"
        class="capacity-panel"
        :class="`capacity-panel--${tone}`"
        data-testid="capacity-panel"
    >
        <div class="capacity-panel__title">{{ title || t('nest.capacity.title') }}</div>
        <p class="capacity-panel__refunded">{{ detail || t('nest.capacity.refunded') }}</p>
        <ul class="capacity-panel__levers">
            <li v-if="panel.levers.sheetsNeeded">
                {{ t('report.unfit.sheetsNeeded', { n: panel.levers.sheetsNeeded }) }}
            </li>
            <li v-if="panel.levers.maxParts != null">
                {{ t('report.unfit.maxParts', { n: panel.levers.maxParts }) }}
            </li>
            <li v-if="panel.levers.maxSpacingMm != null">
                {{ t('report.unfit.maxSpacing', { v: fmtNumber(panel.levers.maxSpacingMm, 2) }) }}
            </li>
        </ul>
        <p v-if="panel.noSpacingGain" class="capacity-panel__floor">
            {{ t('nest.capacity.noSpacingGain') }}
        </p>
        <!-- D26 : information, SANS bouton — un compte Free télécharge les
             premières tôles seulement ; le dire avant de relancer un calcul
             qui en produira beaucoup. Texte déjà traduit par l'appelant. -->
        <p v-if="freeNote" class="capacity-panel__note" data-testid="capacity-free-note">
            {{ freeNote }}
        </p>
        <div class="capacity-panel__actions">
            <!-- D12 : hors du projet du job, ajouter des tôles ou réduire
                 l'espacement agirait sur les réglages d'un AUTRE projet —
                 un seul bouton, qui mène au projet. -->
            <MainButton
                v-if="openProject"
                :label="t('report.unfit.openProject')"
                :size="sizeType.s"
                :theme="themeType.primary"
                data-testid="capacity-open-project"
                @click="$emit('open-project')"
            />
            <MainButton
                v-if="!openProject && panel.nextSheets"
                :label="tp('report.unfit.addSheets', panel.addSheets ?? 1)"
                :data-add-sheets="panel.addSheets ?? 1"
                :size="sizeType.s"
                :theme="themeType.primary"
                data-testid="capacity-add-sheet"
                @click="$emit('add-sheet')"
            />
            <MainButton
                v-if="!openProject && panel.reduceSpacingToMm != null"
                :label="t('report.unfit.reduceSpacing', { v: panel.reduceSpacingToMm })"
                :size="sizeType.s"
                :theme="themeType.secondary"
                data-testid="capacity-reduce-spacing"
                @click="$emit('reduce-spacing')"
            />
            <MainButton
                v-if="showRetry"
                :label="t('nest.capacity.retry')"
                :size="sizeType.s"
                :theme="themeType.secondary"
                data-testid="capacity-retry"
                @click="$emit('retry')"
            />
        </div>
    </div>
</template>

<script setup>
import { sizeType } from '~~/constants/size.constants'
import { themeType } from '~~/constants/theme.constants'

defineProps({
    panel: { type: Object, default: null },
    // U3 passe 3 : le meme panneau sert le refus de la page projet (rouge,
    // « non facture », bouton Relancer) ET le volet rapport de la modale —
    // ou un resultat PARTIEL est ambre (Z3 : le pose est decoupable, jamais
    // de rouge) et ou « Relancer » ferait doublon avec « Reessayer ».
    tone: { type: String, default: 'danger' }, // danger | warn
    title: { type: String, default: '' },
    detail: { type: String, default: '' },
    showRetry: { type: Boolean, default: true },
    // D12 : hors de la page du projet du job (fenêtre de résultat ouverte
    // depuis /home ou un autre projet), le panneau ne propose qu'« Ouvrir le
    // projet » — pas d'ajout de tôles ni de réduction d'espacement.
    openProject: { type: Boolean, default: false },
    // D26 : texte d'information déjà traduit (vide = rien d'affiché).
    freeNote: { type: String, default: '' },
})
defineEmits(['add-sheet', 'reduce-spacing', 'retry', 'open-project'])
const { t, tp, fmtNumber } = useLocale()
</script>

<style lang="scss" scoped>
.capacity-panel {
    margin-top: 12px;
    padding: 14px 16px;
    background-color: var(--error-background);
    border: solid 1px var(--error-border);
    border-radius: var(--radius-l);
    max-width: 42rem;

    /* Z3 : imbrication PARTIELLE = ambre. Le rouge est reserve au resultat
       non decoupable. */
    &--warn {
        background-color: var(--warn-bg);
        border-color: color-mix(in srgb, var(--warn) 45%, transparent);
    }

    &__title {
        font-size: var(--fs-14);
        font-weight: 600;
        color: var(--label-primary);
    }

    &__levers {
        margin: 10px 0 0;
        padding-left: 18px;
        font-size: var(--fs-13);
        line-height: 1.6;
        color: var(--label-secondary);
    }

    &__refunded {
        margin: 4px 0 0;
        font-size: var(--fs-12);
        color: var(--label-tertiary);
    }

    &__floor {
        margin: 10px 0 0;
        font-size: var(--fs-13);
        line-height: 1.5;
        color: var(--label-secondary);
        font-style: italic;
    }

    /* D26 : information Free (téléchargement des premières tôles) — sans
       bouton, lisible comme une note et non comme une erreur. */
    &__note {
        margin: 10px 0 0;
        font-size: var(--fs-13);
        line-height: 1.5;
        color: var(--label-secondary);
    }

    &__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
    }
}
</style>
