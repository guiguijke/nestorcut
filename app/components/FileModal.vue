<template>
    <DialogWrapper trackingTag="file">
        <div class="modal">
            <div class="modal__wrapper">
                <FileParts :class="partsClasses" :parts="fileModalData.parts" class="modal__parts"/>
                <!-- Lot J11-a (A5) : la vue agrandie d'une fiche `.job` montre
                     l'aperçu ENRICHI (contour, points de départ, amorces,
                     disque de perçage) — c'est PRÉCISÉMENT là qu'on veut les
                     vérifier, la vignette de la carte les rend illisibles.
                     Même source que la vignette (J8-b), à taille lisible,
                     avec la légende des quatre tracés. Une fiche ordinaire
                     garde la vue DXF d'origine, inchangée. -->
                <div
                    v-if="fileModalData.enrichedSvg"
                    :class="displayClasses"
                    class="modal__display modal__enriched"
                >
                    <SvgDisplay  :src="fileModalData.enrichedSvg" preserve-colors class="modal__enriched-svg" />
                    <NewBadge feature="lead-enlarged-view" class="modal__enriched-badge" />
                    <ul class="modal__legend">
                        <li><span class="modal__swatch modal__swatch--cut" />{{ t('jobImport.legendCut') }}</li>
                        <li><span class="modal__swatch modal__swatch--lead" />{{ t('jobImport.legendLead') }}</li>
                        <li><span class="modal__swatch modal__swatch--zone" />{{ t('jobImport.legendZone') }}</li>
                        <li><span class="modal__swatch modal__swatch--pierce" />{{ t('jobImport.legendPierce') }}</li>
                    </ul>
                </div>
                <DxfViewerComponent
                    v-else
                    :key="`dxf-0-${isFullScreen}`"
                    :dxfUrl="fileModalData.dxfUrl"
                    :isFullScreen="isFullScreen"
                    :class="displayClasses"
                    class="modal__display"
                />
                <MainButton
                    label="fullscreen"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    :isLabelShow=false
                    :icon="iconType.fullscreen"
                    trackingTag="file_fullscreen"
                    @click="updateFullScreen"
                    class="modal__fullscreen"
                />
            </div>
            <div class="modal__name">
                {{ fileModalData.name }}
            </div>
            <!-- Lot 2c : la fiche montre TOUT, une ligne par constat avec son
                 niveau — jamais un résumé (le résumé est sur la carte). -->
            <ul v-if="findingList.length" class="modal__findings">
                <li
                    v-for="finding in findingList"
                    :key="finding.code"
                    :class="`modal__finding--${finding.level}`"
                    class="modal__finding"
                >
                    {{ finding.text }}
                </li>
            </ul>
        </div>
    </DialogWrapper>
</template>

<script setup>
import { iconType } from '~~/constants/icon.constants';
import { sizeType } from '~~/constants/size.constants';
import { themeType } from '~~/constants/theme.constants';
import { composeFindingList } from '~/composables/importFindings';

const { getters } = globalStore;
const fileModalData = computed(() => getters.fileModalData);

const { t, fmtNumber } = useLocale();
const findingList = computed(() =>
    composeFindingList(fileModalData.value?.findings, t, (v) => fmtNumber(v, 0)),
);

const isFullScreen = useFullScreen();
const updateFullScreen = () => {
    isFullScreen.value = !unref(isFullScreen);
    localStorage.setItem('isFullScreen', unref(isFullScreen));
}
onMounted(() => {
    isFullScreen.value = localStorage.getItem('isFullScreen') === 'true';
})
const displayClasses = computed(() => ({
    'modal__display--is-fullscreen': unref(isFullScreen)
}))
const partsClasses = computed(() => ({
    'modal__parts--is-fullscreen': unref(isFullScreen)
}))
</script>
    
<style lang="scss" scoped>
.modal {
    padding: 48px 24px 24px;

    max-width: 368px;
    @media (min-width: 567px) {
        max-width: initial;
        min-width: 368px;
    }

    &__wrapper {
        position: relative;
        display: flex;
    }
    &__fullscreen {
        display: none;

        @media (min-width: 567px) {
            position: absolute;
            top: 8px;
            right: 8px;
            display: block;
        }
    }
    &__display {
        cursor: pointer;
        max-width: 100%;
        max-height: 100%;

        width: 320px;
        height: 320px;

        &--is-fullscreen {
            @media (min-width: 567px) {
                width: calc(80vw - 48px);
                height: calc(80vh - 148px);
            }
        }
    }
    &__name {
        display: flex;
        justify-content: center;
        align-items: center;
        text-align: center;
        margin-top: 10px;
        margin-bottom: 10px;
        min-height: 42px;
        color: var(--label-primary);
        margin-left: auto;
        margin-right: auto;

        @media (min-width: 567px) {
            max-width: 320px;
        }
    }

    &__parts {
        flex-shrink: 0;
        width: 100px;
        height: 320px;
        margin-right: 16px;

        &--is-fullscreen {
            @media (min-width: 567px) {
                height: calc(80vh - 148px);
            }
        }
    }
}
</style><style lang="scss" scoped>
// Lot J11-a (A5) : la vue agrandie enrichie — même source que la vignette,
// à taille lisible, avec sa légende. Couleurs explicites (piège #21).
// Lot J11-ter : le bloc sort de la hauteur FIXE de `__display` (320 px) —
// dessin + badge + légende empilés la dépassaient de 71 px et la légende
// s'imprimait sur le nom et les constats (NO-GO J11-bis, R10).
.modal__enriched {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding: 8px;
    height: auto;

    // La variante plein écran de `__display` fixe une hauteur calc() —
    // le bloc enrichi la refuse aussi : sa colonne doit pouvoir GRANDIR.
    &.modal__display--is-fullscreen {
        height: auto;
    }
}

.modal__enriched-svg {
    width: 100%;
    max-height: 280px;
}

// Le badge reste un BADGE : aligné au début de la colonne, jamais étiré
// sur la largeur par le flex (la barre bleue pleine largeur du NO-GO).
.modal__enriched-badge {
    align-self: flex-start;
    margin-left: 0;
}

.modal__legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--fs-12, 12px);
    color: var(--label-secondary);

    li {
        display: flex;
        align-items: center;
        gap: 4px;
    }
}

.modal__swatch {
    width: 14px;
    height: 8px;
    border-radius: 2px;
    flex: none;

    &--cut {
        background: #2563eb;
    }

    &--lead {
        background: #D97706;
    }

    &--zone {
        background: rgba(217, 119, 6, 0.25);
        border: 1px solid rgba(217, 119, 6, 0.6);
    }

    &--pierce {
        background: rgba(217, 119, 6, 0.15);
        border: 1px dashed #D97706;
    }
}
</style>
