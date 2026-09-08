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
            <div
                v-if="hasColorPreview"
                class="view-toggle"
            >
                <button
                    class="view-toggle__btn"
                    :class="{ 'view-toggle__btn--active': viewMode === 'color' }"
                    tracking-tag="result_view_color"
                    @click="selectViewMode('color')"
                >
                    {{ t('result.colorView') }}
                </button>
                <button
                    class="view-toggle__btn"
                    :class="{ 'view-toggle__btn--active': viewMode === 'dxf' }"
                    tracking-tag="result_view_dxf"
                    @click="selectViewMode('dxf')"
                >
                    {{ t('result.dxfView') }}
                </button>
            </div>
            <div class="modal__wrapper">
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
                <MainButton
                    v-if="!isHaveError"
                    label="fullscreen"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    :isLabelShow="false"
                    :icon="iconType.fullscreen"
                    trackingTag="result_fullscreen"
                    @click="updateFullScreen"
                    class="modal__fullscreen"
                />
            </div>
    </div>
</template>

<script setup>
import { iconType } from '~~/constants/icon.constants'
import { sizeType } from '~~/constants/size.constants'
import { themeType } from '~~/constants/theme.constants'

const props = defineProps({ d: { type: Object, required: true } })
const emit = defineEmits(['view-mode', 'toggle-fullscreen', 'download-sheet'])

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

const selectViewMode = (mode) => emit('view-mode', mode)
const updateFullScreen = () => emit('toggle-fullscreen')
const downloadLocalSheet = () => emit('download-sheet')
</script>

<style lang="scss" scoped>
.viewer {
    display: contents;
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

    &__display,
    &__placeholder {
        max-width: 100%;
        max-height: 100%;

        width: 320px;
        height: 320px;

        @media (min-width: 567px) {
            width: min(620px, 78vw);
            height: min(280px, 42vh);
        }

        &--is-fullscreen {
            @media (min-width: 567px) {
                width: calc(80vw - 48px);
                height: calc(80vh - 148px);
            }
        }
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
