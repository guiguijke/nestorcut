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
            @oversize="onOversize"
        />
        <p v-if="rejectError" class="files__error">{{ t(rejectError, rejectParams) }}</p>
        <div class="files__grid">
            <!-- Lot J11-a (A2) : les fiches d'un même dessin issues du MÊME
                 `.job` se rendent sous UNE carte groupée dépliable — le
                 modèle reste une fiche par section (ses points de départ),
                 c'est la présentation qui regroupe. Une fiche seule reste
                 une carte ordinaire ; la recette ×4 (deux dessins) donne
                 toujours deux cartes. -->
            <template
                v-for="(entry, fileIndex) in groupedFiles"
                :key="entry.file.slug"
            >
                <FileGroup
                    v-if="entry.group"
                    :items="entry.group"
                    :drawing-name="entry.group[0].file.sheetcamDrawingName || entry.group[0].file.name"
                    :job-name="entry.group[0].file.sheetcamJobName"
                    class="files__item file"
                    data-testid="file-grouped-card"
                />
                <template v-else>
                    <FileDone
                        :file="entry.file"
                        :fileIndex="entry.index"
                        :canEdit="!readonly && !entry.file.expired"
                        @openModal="openModal(entry.file)"
                        @scale="onScale(entry.file)"
                        @resetScale="onResetScale(entry.file)"
                        @explode="explodeTarget = entry.file"
                        v-if="fileIsDone(entry.file.processingStatus)"
                        class="files__item file"
                    />
                    <FileInProgress
                        :file="entry.file"
                        v-if="fileIsProcessing(entry.file.processingStatus)"
                        class="files__item file"
                    />
                    <FileError
                        :file="entry.file"
                        v-if="fileIsError(entry.file.processingStatus)"
                        class="files__item file"
                    />
                </template>
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
const rejectParams = ref({})

// Lot E4-b/E4-c : les actions de fiche passent par le store — lui seul sait
// si la fiche est locale (IndexedDB) ou serveur (routes + worker).
const { actions: filesActions } = filesStore

// Lot J11-a (A2) : le regroupement PRÉSENTATIONNEL. Fiches partageant le
// même `.job` ET le même nom de dessin → une carte groupée. Le groupement
// ne s'applique qu'aux fiches ISSUES DU BINAIRE (sheetcamJobName) : un
// DXF déposé à côté reste sa propre carte, même nom ou non.
const groupedFiles = computed(() => {
    const out = []
    const groups = new Map()
    ;(props.projectFiles || []).forEach((file, index) => {
        const sc = file.sheetcamJobName ? file : null
        const key = sc
            ? `${file.sheetcamJobName}::${file.sheetcamDrawingName || file.name}`
            : null
        if (key && groups.has(key)) {
            groups.get(key).push({ file, index })
            return
        }
        if (key) {
            groups.set(key, [{ file, index }])
            // Placeholder : remplacé par le groupe une fois la liste finie.
            out.push({ file, index, groupKey: key, group: null })
            return
        }
        out.push({ file, index, group: null })
    })
    for (const entry of out) {
        if (entry.groupKey) {
            const members = groups.get(entry.groupKey) || []
            entry.group = members.length > 1 ? members : null
        }
    }
    return out
})

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

// Lot J8-bis (§9.75) : tout fichier écarté est NOMMÉ — le motif rappelle
// ce que CE mode accepte (le silence dès qu'un autre passait était la même
// famille de défaut que le mutisme d'uploadToServer, corrigé en J8-e).
const onRejected = (files) => {
    const list = files || []
    const names = list.map((f) => String(f.name || '?')).join(', ')
    if (props.local && list.some((f) => /\.dwg$/i.test(String(f.name || '')))) {
        rejectParams.value = { names }
        rejectError.value = 'upload.dwgNamed'
        return
    }
    rejectParams.value = { names }
    rejectError.value = props.local ? 'upload.rejectedDevice' : 'upload.rejectedServer'
}

const onOversize = (files) => {
    rejectParams.value = { names: (files || []).map((f) => String(f.name || '?')).join(', ') }
    rejectError.value = 'upload.oversizeNamed'
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
