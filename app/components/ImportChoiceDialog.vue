<template>
    <DialogWrapper
        :isModalOpen="adv.choice.open"
        trackingTag="import_choice"
        @update:isModalOpen="onClose"
    >
        <div class="choice" data-testid="import-choice">
            <h2 class="choice__title">{{ t('importChoice.title') }}</h2>
            <p class="choice__lead">{{ t('importChoice.lead') }}</p>

            <p v-if="adv.preview.loading" class="choice__wait">
                {{ t('importPreview.reading') }}
            </p>

            <!-- Ce que l'import a LU, fichier par fichier : le nombre de
                 pièces et l'étendue du dessin. Pas une promesse — la lecture
                 a eu lieu, et c'est la même que celle de l'aperçu. -->
            <ul v-else class="choice__list" data-testid="import-choice-list">
                <li
                    v-for="(item, i) in adv.preview.pending"
                    :key="i"
                    class="choice__item"
                >
                    <span class="choice__name">{{ item.name }}</span>
                    <span class="choice__read">
                        {{ t('importChoice.read', {
                            n: item.parts.length,
                            w: fmt(item.extent.width),
                            h: fmt(item.extent.height),
                            unit: unitLabel,
                        }) }}
                    </span>
                </li>
            </ul>

            <p v-if="adv.preview.error" class="choice__error">
                {{ t(adv.preview.error) }}
            </p>

            <div class="choice__actions">
                <!-- « Import automatique » est le DÉFAUT et prend le focus
                     initial : c'est ce que fait l'application sans rien
                     demander, et l'utilisateur qui valide sans lire obtient
                     ce qu'il obtenait avant. -->
                <MainButton
                    ref="autoBtn"
                    :label="t('importChoice.auto')"
                    :theme="themeType.primary"
                    trackingTag="import_choice_auto"
                    data-testid="import-choice-auto"
                    @click="onAuto"
                />
                <MainButton
                    :label="t('importChoice.explode')"
                    :theme="themeType.secondary"
                    trackingTag="import_choice_explode"
                    data-testid="import-choice-explode"
                    @click="onExplode"
                />
                <MainButton
                    :label="t('importChoice.cancel')"
                    :theme="themeType.secondary"
                    trackingTag="import_choice_cancel"
                    data-testid="import-choice-cancel"
                    @click="onClose"
                />
            </div>
            <p class="choice__hint">{{ t('importChoice.hint') }}</p>
        </div>
    </DialogWrapper>
</template>

<script setup>
/**
 * Lot E3 — la fenêtre de choix au dépôt
 * (`docs/PLAN-ECLATEMENT-2026-09-12.md` §6.1 point 2).
 *
 * Elle n'existe que lorsque l'interrupteur « Import avancé » du PROJET est
 * allumé, et elle s'ouvre AVANT toute création de fiche. Deux issues :
 *
 *   - « Import automatique » (le défaut, focus initial) : une fiche par
 *     fichier, multi-pièces conservé tel quel — exactement l'import
 *     ordinaire, options neutres imposées ;
 *   - « Éclater en pièces et mettre à l'échelle » : l'aperçu sur tôle du lot
 *     E1-bis prend la main, sur les fichiers DÉJÀ lus (aucune relecture).
 *
 * « Annuler » ne crée rien. Le choix vaut pour LE LOT DÉPOSÉ.
 */
import { themeType } from '~~/constants/theme.constants'
import { useAdvancedImport } from '~/composables/advancedImport'
import { filesStore } from '~/composables/files'

const { t } = useLocale()
const { unitLabel, mmToDisplay } = useUnit()
const adv = useAdvancedImport()

const fmt = (mm) => Math.round(mmToDisplay(Number(mm) || 0) * 10) / 10

const onAuto = async () => {
    const { files, projectSlug } = adv.chooseAuto()
    if (!files.length) return
    // Options NEUTRES imposées : ce chemin doit être l'import ordinaire, pas
    // « l'import avancé avec des réglages à zéro ».
    await filesStore.actions.importStagedFiles(files, projectSlug, {
        scale: 1,
        explode: false,
    })
}

const onExplode = () => {
    adv.chooseExplode()
}

const onClose = () => {
    adv.cancelChoice()
}
</script>

<style lang="scss" scoped>
.choice {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 320px;
    max-width: 520px;
    text-align: left;

    &__title {
        margin: 0;
        color: var(--label-primary);
        font-size: 18px;
    }
    &__lead,
    &__hint {
        margin: 0;
        color: var(--label-secondary);
        font-size: 13px;
    }
    &__wait {
        color: var(--label-secondary);
        font-size: 13px;
    }
    &__list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 0;
        padding: 8px;
        border: 1px solid var(--fill-tertiary);
        border-radius: 4px;
        list-style: none;
        max-height: 220px;
        overflow-y: auto;
    }
    &__item {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 13px;
    }
    &__name {
        color: var(--label-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    &__read {
        color: var(--label-secondary);
        white-space: nowrap;
    }
    &__error {
        margin: 0;
        color: var(--red);
        font-size: 13px;
    }
    &__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
}
</style>
