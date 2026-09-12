<template>
    <div
        class="upload"
        @dragover.prevent="updateDragStatus()"
        @dragenter.prevent="updateDragStatus()"
        @dragleave.prevent="updateDragStatus(false)"
        @drop.prevent="onDrop"
    >
        <label
            class="upload__label"
            :class="labelClasses"
        >
            <input
                type="file"
                name="dxf"
                :accept="extensions.join(',')"
                multiple
                @change="onDXFChange"
                class="upload__input"
            />
            <MainButton
                :label="t('upload.choose')"
                tag="div"
                :theme="themeType.primary"
                trackingTag="choose_files"
                class="upload__btn"
            />
            <span class="upload__text">
                {{ t('upload.drop') }}
            </span>
            <span class="upload__text upload__text--gray">
                {{ limitLabel }}
            </span>
        </label>

        <!-- Lot E1 : « Import avancé », replié et ÉTEINT par défaut. Hors
             projet « cet appareil », le panneau n'existe pas (la chaîne
             d'éclatement est celle de l'import navigateur). -->
        <div
            v-if="advanced"
            class="advanced"
            data-testid="advanced-import"
        >
            <button
                type="button"
                class="advanced__toggle"
                :aria-expanded="adv.state.open ? 'true' : 'false'"
                data-testid="advanced-import-toggle"
                @click="adv.toggleOpen()"
            >
                <span class="advanced__caret" :class="{ 'advanced__caret--open': adv.state.open }">›</span>
                {{ t('advancedImport.title') }}
                <span v-if="activeLabel" class="advanced__badge">{{ activeLabel }}</span>
            </button>

            <div v-if="adv.state.open" class="advanced__panel">
                <label class="advanced__check">
                    <input
                        type="checkbox"
                        :checked="adv.state.explode"
                        data-testid="advanced-import-explode"
                        @change="adv.setExplode($event.target.checked)"
                    />
                    <span>
                        <span class="advanced__label">{{ t('advancedImport.explode') }}</span>
                        <span class="advanced__hint">{{ t('advancedImport.explodeHint') }}</span>
                    </span>
                </label>

                <div class="advanced__scale">
                    <span class="advanced__label">{{ t('advancedImport.scale') }}</span>
                    <div class="advanced__modes" role="radiogroup" :aria-label="t('advancedImport.scale')">
                        <button
                            v-for="m in SCALE_MODES"
                            :key="m"
                            type="button"
                            role="radio"
                            :aria-checked="adv.state.mode === m ? 'true' : 'false'"
                            class="advanced__mode"
                            :class="{ 'advanced__mode--on': adv.state.mode === m }"
                            :data-testid="`advanced-import-mode-${m}`"
                            @click="adv.setMode(m)"
                        >
                            {{ t(`advancedImport.mode.${m}`) }}
                        </button>
                    </div>
                    <label class="advanced__field">
                        <input
                            type="number"
                            min="0"
                            step="0.001"
                            class="advanced__value"
                            data-testid="advanced-import-value"
                            :value="displayValue"
                            @change="onValue($event.target.value)"
                        />
                        <span class="advanced__suffix">{{ valueSuffix }}</span>
                    </label>
                    <p class="advanced__hint">{{ t('advancedImport.scaleHint') }}</p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants';
import { MAX_UPLOAD_FILE_BYTES } from '~~/shared/constants/upload.constants'
import { SCALE_MODES, useAdvancedImport } from '~/composables/advancedImport'

const { t } = useLocale()
const { unitLabel, mmToDisplay, displayToMm } = useUnit()
const adv = useAdvancedImport()

const props = defineProps({
    extensions: {
        type: Array,
        default: () => [".dxf", ".svg", ".dwg"],
    },
    compact: {
        type: Boolean,
        default: false,
    },
    // Lot E1 : le panneau « Import avancé » n'existe que là où la chaîne
    // existe — les projets « cet appareil ».
    advanced: {
        type: Boolean,
        default: false,
    },
});
const emit = defineEmits(["files", "rejected", "oversize"]);

const { extensions } = toRefs(props);
const isDragOver = ref(false);

const fileExt = (name) => {
    const n = String(name || '').toLowerCase()
    const i = n.lastIndexOf('.')
    return i >= 0 ? n.slice(i) : ''
}

const limitLabel = computed(() =>
    unref(extensions).includes('.dwg') ? t('upload.limit') : t('upload.limitDevice')
)

const updateDragStatus = (newValue = true) => {
    isDragOver.value = newValue;
};
const setFiles = (newFiles) => {
    const allowed = unref(extensions)
    const typed = newFiles.filter((file) => allowed.includes(fileExt(file.name)))
    const sized = typed.filter((file) => file.size <= MAX_UPLOAD_FILE_BYTES)
    if (typed.length && !sized.length) {
        emit("oversize", typed)
        return
    }
    if (sized.length) emit("files", sized)
    else if (newFiles.length) emit("rejected", newFiles)
};
const onDrop = (event) => {
    updateDragStatus(false);
    const droppedFiles = Array.from(event.dataTransfer.files);
    setFiles(droppedFiles);
};
const onDXFChange = (event) => {
    const addedFiles = Array.from(event.target.files);
    setFiles(addedFiles);
};

// Le nombre saisi est un FACTEUR (sans unité) ou une longueur cible (dans
// l'unité courante) : la conversion mm ↔ affichage se fait ici, à la
// frontière UI (AGENTS #25) — l'état, lui, est toujours en mm.
const valueSuffix = computed(() =>
    adv.state.mode === 'factor' ? '×' : unitLabel.value
)
const displayValue = computed(() => {
    const v = Number(adv.state.value)
    if (!Number.isFinite(v)) return ''
    if (adv.state.mode === 'factor') return v
    return Math.round(mmToDisplay(v) * 1000) / 1000
})
const onValue = (raw) => {
    const v = Number(raw)
    if (!Number.isFinite(v)) return adv.setValue(0)
    adv.setValue(adv.state.mode === 'factor' ? v : displayToMm(v))
}
// Résumé sur le bouton replié : ce que la dépose va faire, sans l'ouvrir.
const activeLabel = computed(() => {
    if (!adv.state.open) {
        const bits = []
        if (adv.state.explode) bits.push(t('advancedImport.badgeExplode'))
        const v = Number(adv.state.value)
        if (adv.state.mode === 'factor' ? v !== 1 && v > 0 : v > 0) {
            bits.push(adv.state.mode === 'factor'
                ? `×${v}`
                : `${Math.round(mmToDisplay(v) * 1000) / 1000} ${unitLabel.value}`)
        }
        return bits.join(' · ')
    }
    return ''
})

const labelClasses = computed(() => ({
    'upload__label--hover': unref(isDragOver),
    'upload__label--compact': unref(props.compact),
}));
</script>

<style lang="scss" scoped>
.upload {
    $self: &;
    position: relative;
    text-align: center;

    &__label {
        padding: 10px;
        cursor: pointer;
        display: flex;
        justify-content: center;
        flex-direction: column;
        align-items: center;
        min-height: 164px;
        background-color: var(--fill-tertiary);
        border: dashed 1px var(--accent-primary);
        border-radius: var(--radius-l);
        transition: background-color 0.3s;

        &--hover {
            background-color: var(--fill-secondary);
        }

        &--compact {
            min-height: 88px;
            flex-direction: row;
            flex-wrap: wrap;
            gap: 8px 16px;
            padding: 16px 20px;

            .upload__btn {
                margin-bottom: 0;
            }

            .upload__text--gray {
                margin-top: 0;
                flex-basis: 100%;
            }
        }
    }
    &__btn {
        position: relative;
        z-index: 1;
        margin-bottom: 16px;
    }
    &__text {
        color: var(--label-primary);

        &--gray {
            margin-top: 8px;
            color: var(--label-secondary);
        }
    }
    &__input {
        opacity: 0;
        width: 0;
        height: 0;
        overflow: hidden;
        position: absolute;
        z-index: -1;
        top: 0;
        left: 0;
    }

    @media (hover:hover) {
        &:hover {
            #{$self}__label {
                background-color: var(--fill-secondary);
            }
        }
    }
}

/* Lot E1 : panneau « Import avancé ». Rayon 4 px comme partout ailleurs,
   aucune pilule. */
.advanced {
    margin-top: 8px;
    text-align: left;

    &__toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 6px;
        border: none;
        background: none;
        border-radius: 4px;
        color: var(--label-secondary);
        font-size: 13px;
        cursor: pointer;

        &:hover {
            color: var(--label-primary);
            background-color: var(--fill-tertiary);
        }
    }
    &__caret {
        display: inline-block;
        transition: transform 0.15s;

        &--open {
            transform: rotate(90deg);
        }
    }
    &__badge {
        color: var(--accent-primary);
    }
    &__panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 8px;
        padding: 12px;
        border: 1px solid var(--fill-tertiary);
        border-radius: 4px;
    }
    &__check {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        cursor: pointer;
    }
    &__label {
        display: block;
        color: var(--label-primary);
        font-size: 14px;
    }
    &__hint {
        display: block;
        margin: 2px 0 0;
        color: var(--label-secondary);
        font-size: 12px;
    }
    &__scale {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    &__modes {
        display: flex;
        gap: 4px;
    }
    &__mode {
        padding: 4px 10px;
        border: 1px solid var(--fill-tertiary);
        border-radius: 4px;
        background: none;
        color: var(--label-secondary);
        font-size: 13px;
        cursor: pointer;

        &--on {
            border-color: var(--accent-primary);
            color: var(--accent-primary);
        }
    }
    &__field {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 180px;
    }
    &__value {
        width: 100%;
        padding: 4px 8px;
        border: 1px solid var(--fill-tertiary);
        border-radius: 4px;
        background: none;
        color: var(--label-primary);
    }
    &__suffix {
        color: var(--label-secondary);
        font-size: 13px;
    }
}
</style>
