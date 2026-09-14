<template>
    <div class="files">
        <!-- Lot E4-d : l'interrupteur « Import avancé » et la fenêtre de
             choix au dépôt ont DISPARU — le dépôt est l'import ordinaire,
             l'échelle et l'éclatement sont des actions sur la fiche. -->
        <DxfUpload
            v-if="!readonly"
            compact
            :extensions="uploadExtensions"
            class="files__upload"
            @files="addFiles"
            @rejected="onRejected"
            @oversize="rejectError = 'upload.tooLarge'"
        />
        <p v-if="rejectError" class="files__error">{{ t(rejectError) }}</p>
        <div class="files__grid">
            <template
                v-for="(file, fileIndex) in projectFiles"
                :key="file.slug"
            >
                <FileDone
                    :file="file"
                    :fileIndex="fileIndex"
                    :canEdit="!readonly && !file.expired"
                    @openModal="openModal(file)"
                    @scale="onScale(file)"
                    @resetScale="onResetScale(file)"
                    @explode="explodeTarget = file"
                    v-if="fileIsDone(file.processingStatus)"
                    class="files__item file"
                />
                <FileInProgress
                    :file="file"
                    v-if="fileIsProcessing(file.processingStatus)"
                    class="files__item file"
                />
                <FileError
                    :file="file"
                    v-if="fileIsError(file.processingStatus)"
                    class="files__item file"
                />
            </template>
        </div>
        <FileModal v-model:isModalOpen="fileDialog" />

        <!-- Lot E4-b : l'aperçu sur tôle, ouvert sur la fiche choisie. -->
        <AdvancedImportPreview @apply="onApplyScale" />

        <!-- Lot E4-c : « Éclater » est irréversible — une confirmation en
             une ligne, rien de plus. -->
        <DialogWrapper
            :isModalOpen="Boolean(explodeTarget)"
            trackingTag="file_explode_confirm"
            @update:isModalOpen="explodeTarget = null"
        >
            <div v-if="explodeTarget" class="explode" data-testid="explode-confirm">
                <p class="explode__text">
                    {{ t('files.explodeConfirmText', { n: explodeTarget.parts?.length || 0 }) }}
                </p>
                <div class="explode__actions">
                    <MainButton
                        :label="t('files.explodeConfirmOk')"
                        :theme="themeType.primary"
                        trackingTag="file_explode_confirm_ok"
                        data-testid="explode-confirm-ok"
                        @click="onExplode"
                    />
                    <MainButton
                        :label="t('importPreview.cancel')"
                        :theme="themeType.secondary"
                        trackingTag="file_explode_confirm_cancel"
                        data-testid="explode-confirm-cancel"
                        @click="explodeTarget = null"
                    />
                </div>
            </div>
        </DialogWrapper>
    </div>
</template>
<script setup>
import { processingType } from "~~/constants/files.constants";
import { themeType } from '~~/constants/theme.constants'
import FileError from "./FileError.vue";

const props = defineProps({
    projectFiles: {
        type: Array,
        required: true
    },
    // Read-only mode (shared demo project): no upload dropzone.
    readonly: {
        type: Boolean,
        default: false
    },
    // Projet « cet appareil » : DXF/SVG/.job seulement (DWG = serveurs).
    local: {
        type: Boolean,
        default: false
    }
})

// Cette liste ne sert qu'au FILTRE du sélecteur de fichiers du système (et à
// la même passoire dans DxfUpload). La vérité du format reste la SIGNATURE de
// contenu, lue à l'import (piège #31 : les slugs d'upload finissaient tous en
// `.dxf` quel que soit le format réel). Lot J4 : `.job` SheetCam sur le chemin
// navigateur seulement — le miroir serveur est le lot J5.
const uploadExtensions = computed(() =>
    props.local ? ['.dxf', '.svg', '.job'] : ['.dxf', '.svg', '.dwg']
)

const emit = defineEmits(["addFiles"])
const { t } = useLocale()
const rejectError = ref('')

// Lot E4-b/E4-c : les actions de fiche passent par le store — lui seul sait
// si la fiche est locale (IndexedDB) ou serveur (routes + worker).
const { actions: filesActions } = filesStore

const addFiles = (files) => {
    rejectError.value = ''
    emit("addFiles", files)
}

const onScale = (file) => filesActions.openFicheScale(file)
const onApplyScale = (options) => filesActions.applyFicheScale(options)
const onResetScale = (file) => filesActions.resetFicheScale(file)

const explodeTarget = ref(null)
const onExplode = () => {
    const file = explodeTarget.value
    explodeTarget.value = null
    if (file) filesActions.explodeFiche(file)
}

const onRejected = (files) => {
    const names = (files || []).map((f) => String(f.name || '').toLowerCase())
    if (props.local && names.some((n) => n.endsWith('.dwg'))) {
        rejectError.value = 'localImport.dwgRejected'
        return
    }
    rejectError.value = props.local ? 'localImport.unsupportedType' : 'upload.unsupported'
}

const fileIsDone = (status) => status === processingType.done
const fileIsProcessing = (status) => status === processingType.inProgress
const fileIsError = (status) => status === processingType.error

const { actions } = globalStore;
const { setModalFileData } = actions;

const fileDialog = useFileDialog();
const openModal = (file) => {
    setModalFileData(file)
    fileDialog.value = true
}
</script>

<style lang="scss" scoped>
.files {
    display: flex;
    flex-direction: column;
    gap: 12px;

    &__upload {
        width: 100%;
    }

    &__error {
        margin: 0;
        padding: 10px 12px;
        font-size: var(--fs-13);
        line-height: 1.4;
        color: var(--label-secondary);
        background-color: var(--error-background);
        border: 1px solid var(--error-border);
        border-radius: var(--radius-l);
    }

    &__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;

        @media (min-width: 880px) {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }
}
.file {
    position: relative;
    $self: &;
    padding: 15px;
    border-radius: var(--radius-l);
    border: 1px solid var(--separator-secondary);
    transition: border-color 0.3s;

    &__display {
        width: 56px;
        height: 56px;
    }
    &__name {
        margin-top: 16px;
        margin-bottom: 16px;
        color: var(--label-secondary);
        transition: color 0.3s;
    }
    &__btn {
        opacity: 0;
        position: absolute;
        top: 8px;
        right: 8px;
        transition: opacity 0.3s;
    }

    @media (hover:hover) {
        &:hover {
            border-color: var(--separator-primary);

            #{$self}__name {
                color: var(--label-primary);
            }
            #{$self}__btn {
                opacity: 1;
            }
        }
    }
}
.counter {
    display: flex;
    align-items: center;

    &__value {
        color: var(--label-secondary);
        margin-left: 8px;
        margin-right: 8px;
        min-width: 24px;
        text-align: center;
    }
}
.explode {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 440px;
    padding: 4px 8px 8px;
    text-align: left;

    &__text {
        margin: 0;
        color: var(--label-primary);
        font-size: 14px;
    }

    &__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
}
</style>
