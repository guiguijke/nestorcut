<!--
    U3 passe 1 (PLAN-UI-PRO §U3) - EXTRACTION PURE de ResultModal.vue.
    Aucun changement de rendu : les blocs de template sont deplaces tels
    quels et les styles qui les visent suivent. Toute la logique reste dans
    l'orchestrateur (ResultModal.vue) : ce composant recoit un objet unique
    et le re-expose sous les memes noms, pour que le template n'ait pas eu
    a etre reecrit. La refonte deux volets est la passe 2.
-->
<template>
    <div class="viewer">
            <div class="viewer__toolbar" data-testid="viewer-toolbar">
                <!-- Le pager de tole vit desormais DANS la barre d'outils de
                     la visionneuse, plus au-dessus du dialogue. -->
                <div
                    v-if="resultModalData.isMultiSheet && !isHaveError"
                    class="viewer__sheets list-sheets"
                >
                    <MainButton
                        :theme="themeType.secondary"
                        :icon="iconType.arrowPrev"
                        :isLabelShow=false
                        :size="sizeType.s"
                        trackingTag="result_part_prev"
                        data-testid="sheet-prev"
                        :isDisable="activePart === 0"
                        label="prev"
                        class="controls__prev"
                        @click="$emit('part', activePart - 1)"
                    />
                    <span class="viewer__sheet-label" data-testid="sheet-label">
                        {{ t('result.sheet', { n: activePart + 1, total: currentDxfs.length }) }}
                    </span>
                    <MainButton
                        :theme="themeType.secondary"
                        :icon="iconType.arrowNext"
                        :size="sizeType.s"
                        :isLabelShow=false
                        :isDisable="activePart === currentDxfs.length - 1"
                        trackingTag="result_part_next"
                        data-testid="sheet-next"
                        label="next"
                        class="controls__next"
                        @click="$emit('part', activePart + 1)"
                    />
                </div>
                <div class="viewer__spacer" />
                <UiSegmented
                    v-if="hasColorPreview"
                    class="viewer__mode view-toggle"
                    :model-value="viewMode"
                    :options="viewOptions"
                    :label="t('result.colorView') + ' / ' + t('result.dxfView')"
                    testid="view-mode"
                    @update:modelValue="selectViewMode"
                />
                <MainButton
                    v-if="!isHaveError"
                    label="fullscreen"
                    :size="sizeType.s"
                    :theme="themeType.secondary"
                    :isLabelShow="false"
                    :icon="iconType.fullscreen"
                    trackingTag="result_fullscreen"
                    data-testid="viewer-fullscreen"
                    class="viewer__fullscreen"
                    @click="updateFullScreen"
                />
            </div>
            <div class="modal__wrapper viewer__stage" data-testid="viewer-stage">
                <LiveNestingView
                    v-if="isInProgress && resultModalData.liveLayout"
                    :result="resultModalData"
                    class="modal__live"
                />
                <div
                    v-else-if="isHaveError"
                    :class="placeholderClasses"
                    class="modal__placeholder"
                >
                    {{ t('result.failed') }}
                </div>
                <template v-else-if="resultModalData.isMultiSheet">
                    <SheetSvgPreview
                        v-if="showColorPreview"
                        :key="`svg-${activeAlt}-${activePart}`"
                        :src="currentSvgs[activePart]"
                        :width="previewSheet.w"
                        :height="previewSheet.h"
                        :class="displayClasses"
                        class="modal__display modal__svg-preview"
                    />
                    <DxfViewerComponent
                        v-else
                        :key="`dxf-${activeAlt}-${activePart}-${isFullScreen}`"
                        :dxfUrl="currentDxfs[activePart]"
                        :isFullScreen="isFullScreen"
                        :class="displayClasses"
                        class="modal__display"
                    />
                    <MainButton
                        class="modal__part-download"
                        v-if="resultModalData.isMultiSheet && !isLocal"
                        :href="currentDxfs[activePart]"
                        :label="t('result.downloadSheet', { n: activePart + 1 })"
                        tag="a"
                        :isDisable="isHaveError || isUnfit"
                        :size="sizeType.s"
                        :theme="themeType.primary"
                        trackingTag="result_part_download"
                    />
                    <MainButton
                        class="modal__part-download"
                        v-if="resultModalData.isMultiSheet && isLocal"
                        :label="t('result.downloadSheet', { n: activePart + 1 })"
                        :isDisable="isHaveError || isUnfit"
                        :size="sizeType.s"
                        :theme="themeType.primary"
                        trackingTag="result_part_download"
                        @click="downloadLocalSheet"
                    />
                </template>
                <SheetSvgPreview
                    v-else-if="showColorPreview"
                    :key="`svg-${activeAlt}-0`"
                    :src="currentSvgs[0]"
                    :width="previewSheet.w"
                    :height="previewSheet.h"
                    :class="displayClasses"
                    class="modal__display modal__svg-preview"
                />
                <DxfViewerComponent
                    v-else
                    :key="`dxf-${activeAlt}-0-${isFullScreen}`"
                    :dxfUrl="currentDxfs[0]"
                    :isFullScreen="isFullScreen"
                    :class="displayClasses"
                    class="modal__display"
                />
            </div>
    </div>
</template>

<script setup>
import { iconType } from '~~/constants/icon.constants'
import { sizeType } from '~~/constants/size.constants'
import { themeType } from '~~/constants/theme.constants'

const props = defineProps({ d: { type: Object, required: true } })
const emit = defineEmits(['view-mode', 'toggle-fullscreen', 'download-sheet', 'part'])

const t = (...a) => props.d.t(...a)
const resultModalData = computed(() => props.d.resultModalData)
const isInProgress = computed(() => props.d.isInProgress)
const isHaveError = computed(() => props.d.isHaveError)
const isUnfit = computed(() => props.d.isUnfit)
const isLocal = computed(() => props.d.isLocal)
const isFullScreen = computed(() => props.d.isFullScreen)
const hasColorPreview = computed(() => props.d.hasColorPreview)
const showColorPreview = computed(() => props.d.showColorPreview)
const viewMode = computed(() => props.d.viewMode)
const currentSvgs = computed(() => props.d.currentSvgs)
const currentDxfs = computed(() => props.d.currentDxfs)
const activeAlt = computed(() => props.d.activeAlt)
const activePart = computed(() => props.d.activePart)
const previewSheet = computed(() => props.d.previewSheet)
const displayClasses = computed(() => props.d.displayClasses)
const placeholderClasses = computed(() => props.d.placeholderClasses)

const viewOptions = computed(() => ([
    { value: 'color', label: t('result.colorView') },
    { value: 'dxf', label: t('result.dxfView') },
]))
const selectViewMode = (mode) => emit('view-mode', mode)
const updateFullScreen = () => emit('toggle-fullscreen')
const downloadLocalSheet = () => emit('download-sheet')
</script>

<style lang="scss" scoped>
/* U3 passe 2 : la visionneuse occupe son volet — barre d'outils en haut,
   scene qui prend le reste. Le bouton plein ecran est dans la barre, il ne
   flotte plus au-dessus du dessin. */
.viewer {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    min-height: 0;

    &__toolbar {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        flex-wrap: wrap;
        flex: 0 0 auto;
    }

    &__spacer {
        flex: 1 1 auto;
    }

    &__sheets {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
    }

    &__sheet-label {
        font-size: var(--fs-13);
        font-weight: 600;
        color: var(--label-primary);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }

    &__mode {
        flex: 0 0 auto;
    }

    &__stage {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--sp-2);
        border: 1px solid var(--separator-secondary);
        border-radius: var(--radius-l);
        background-color: var(--fill-tertiary);
        padding: var(--sp-3);
        overflow: hidden;
    }
}
.view-toggle {
    display: flex;
    justify-content: center;
    gap: 6px;
    margin: 0 auto 10px;

    &__btn {
        padding: 5px 14px;
        border-radius: var(--radius);
        border: 1px solid var(--separator-secondary);
        background-color: var(--fill-tertiary);
        color: var(--label-secondary);
        font-size: var(--fs-12);
        font-weight: 600;
        cursor: pointer;
        transition: border-color 0.3s, background-color 0.3s;

        @media (hover:hover) {
            &:hover {
                border-color: var(--accent-primary);
            }
        }

        &--active {
            color: var(--background-primary);
            background-color: var(--accent-primary);
            border-color: var(--accent-primary);
        }
    }
}

.modal {
    &__wrapper {
        position: relative;
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
    }

    // Colored sheet preview (server SVG, per-part colors): keeps its own
    // white CAD background, never upscaled beyond its box.
    &__svg-preview {
        object-fit: contain;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-l);
    }

    /* U3 passe 2 : l'affichage suit la scene (le volet 2/3) au lieu de
       tailles fixes calculees sur le viewport. */
    &__display,
    &__placeholder {
        width: 100%;
        height: 100%;
        max-width: 100%;
        max-height: 100%;
        min-height: 240px;
    }

    &__placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        border-radius: var(--radius-l);
        background-color: var(--error-background);
        border: solid 1px var(--error-border);
        color: var(--label-primary);
    }

    &__part-download {
        margin-left: auto;
        margin-right: auto;
        margin-top: 8px;
    }
}

</style>
