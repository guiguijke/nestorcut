<template>
    <div class="preview" data-testid="import-preview">
        <div v-if="adv.preview.loading" class="preview__wait">
            {{ t('importPreview.reading') }}
        </div>

        <template v-else-if="drawing">
            <div class="preview__head">
                <span class="preview__title">
                    {{ t('importPreview.title') }}
                    <template v-if="adv.preview.pending.length > 1">
                        · {{ t('importPreview.batch', { n: adv.preview.pending.length }) }}
                    </template>
                </span>
                <span
                    v-if="!fits"
                    class="preview__warn"
                    data-testid="import-preview-outside"
                >
                    {{ t('importPreview.outside') }}
                </span>
            </div>

            <!-- Tôle + dessin. y moteur (haut) -> y SVG (bas) : flip
                 obligatoire (piège AGENTS #20b). -->
            <svg
                class="preview__svg"
                :viewBox="`0 0 ${boxW} ${boxH}`"
                data-testid="import-preview-svg"
                @pointermove="onMove"
                @pointerup="stopDrag"
                @pointerleave="stopDrag"
            >
                <rect
                    class="preview__sheet"
                    :x="pad"
                    :y="pad"
                    :width="sheetPx.w"
                    :height="sheetPx.h"
                />
                <g :transform="`translate(${pad} ${pad + sheetPx.h}) scale(1 -1)`">
                    <path
                        v-for="(d, i) in paths"
                        :key="i"
                        :d="d"
                        class="preview__part"
                        fill-rule="evenodd"
                    />
                </g>
                <!-- Poignée d'angle : rapport conservé, elle tire la LARGEUR
                     cible du dessin (le mode « largeur cible » du panneau). -->
                <!-- Le dessin est posé sur le BAS de la tôle (origine en bas
                     à gauche, y flippé) : la poignée est donc au coin HAUT
                     droit du dessin, à `hauteur de tôle − hauteur du
                     dessin`. La poser à `pad + hauteur du dessin` la faisait
                     flotter au-dessus du tracé. -->
                <rect
                    class="preview__handle"
                    :x="pad + drawPx.w - HANDLE / 2"
                    :y="pad + sheetPx.h - drawPx.h - HANDLE / 2"
                    :width="HANDLE"
                    :height="HANDLE"
                    data-testid="import-preview-handle"
                    @pointerdown="startDrag"
                />
            </svg>

            <div class="preview__row">
                <span class="preview__dims" data-testid="import-preview-dims">
                    {{ fmtLengthValue(scaledExtent.width, digits) }} ×
                    {{ fmtLengthValue(scaledExtent.height, digits) }} {{ unitLabel }}
                </span>
                <span class="preview__factor" data-testid="import-preview-factor">
                    {{ t('importPreview.factor', { v: factorLabel }) }}
                </span>
            </div>

            <div class="preview__row">
                <span class="preview__label">{{ t('importPreview.sheet') }}</span>
                <button
                    v-for="(p, i) in presets"
                    :key="i"
                    type="button"
                    class="preview__preset"
                    :class="{ 'preview__preset--on': isCurrent(p) }"
                    :data-testid="`import-preview-preset-${i}`"
                    @click="pickPreset(p)"
                >
                    {{ p.width }} × {{ p.height }}
                </button>
                <label class="preview__custom">
                    <input
                        type="number"
                        min="1"
                        class="preview__num"
                        data-testid="import-preview-sheet-w"
                        :value="sheetDisplay.width"
                        @change="onSheet('width', $event.target.value)"
                    />
                    ×
                    <input
                        type="number"
                        min="1"
                        class="preview__num"
                        data-testid="import-preview-sheet-h"
                        :value="sheetDisplay.height"
                        @change="onSheet('height', $event.target.value)"
                    />
                    <span class="preview__label">{{ unitLabel }}</span>
                </label>
            </div>

            <label class="preview__check">
                <input
                    type="checkbox"
                    :checked="adv.preview.useSheet"
                    data-testid="import-preview-use-sheet"
                    @change="adv.setUseSheet($event.target.checked)"
                />
                <span>{{ t('importPreview.useSheet') }}</span>
            </label>

            <p v-if="adv.preview.error" class="preview__error">{{ t(adv.preview.error) }}</p>

            <div class="preview__actions">
                <MainButton
                    :label="t('importPreview.confirm')"
                    :theme="themeType.primary"
                    trackingTag="advanced_import_confirm"
                    data-testid="import-preview-confirm"
                    @click="confirm"
                />
                <MainButton
                    :label="t('importPreview.cancel')"
                    :theme="themeType.secondary"
                    trackingTag="advanced_import_cancel"
                    data-testid="import-preview-cancel"
                    @click="adv.cancel()"
                />
            </div>
        </template>
    </div>
</template>

<script setup>
/**
 * Lot E1-bis — aperçu du dessin posé sur une tôle, avant import.
 *
 * Ce que l'aperçu est : une RÉFÉRENCE d'échelle. Il montre les contours lus
 * (une seule lecture, celle de l'import ordinaire) sur un rectangle de tôle,
 * avec une poignée d'angle à rapport conservé qui règle la LARGEUR CIBLE du
 * dessin — donc le mode « largeur cible » du panneau, pas une seconde façon
 * de calculer une échelle. Rien n'est importé avant « Importer » : aucune
 * fiche, aucun octet dans IndexedDB.
 */
import { themeType } from '~~/constants/theme.constants'
import { SHEET_PRESETS } from '~/utils/units'
import { fitsSheet, resolveScale, useAdvancedImport } from '~/composables/advancedImport'
import { filesStore } from '~/composables/files'

const { t } = useLocale()
const { unit, unitLabel, mmToDisplay, displayToMm, fmtLengthValue } = useUnit()
const adv = useAdvancedImport()

const HANDLE = 12
const pad = 8
const boxW = 520
const boxH = 240

/** Le dessin de référence de la dépose : le premier fichier lu. */
const drawing = computed(() => adv.preview.pending[0] || null)

const sheet = computed(() => adv.preview.sheet || { width: 1000, height: 2000 })
const presets = computed(() => SHEET_PRESETS[unref(unit)] || SHEET_PRESETS.mm)
const digits = computed(() => (unref(unitLabel) === '"' ? 3 : 1))

/** Facteur effectif : celui du panneau (champs ou poignée). */
const factor = computed(() => {
    const d = unref(drawing)
    if (!d) return 1
    return resolveScale(
        adv.state.mode === 'factor'
            ? { scale: adv.state.value }
            : { scaleTarget: { mode: adv.state.mode, mm: adv.state.value } },
        d.extent,
    )
})
const factorLabel = computed(() => {
    const f = unref(factor)
    return f >= 0.01 ? (Math.round(f * 1000) / 1000).toString() : f.toExponential(2)
})
const scaledExtent = computed(() => {
    const d = unref(drawing)
    const f = unref(factor)
    return {
        width: (d?.extent.width || 0) * f,
        height: (d?.extent.height || 0) * f,
    }
})
const fits = computed(() => fitsSheet(unref(drawing)?.extent, unref(factor), unref(sheet)))

// Échelle d'affichage : la tôle remplit la boîte, le dessin suit.
const view = computed(() => {
    const s = unref(sheet)
    const k = Math.min((boxW - 2 * pad) / s.width, (boxH - 2 * pad) / s.height)
    return k > 0 && Number.isFinite(k) ? k : 0.1
})
const sheetPx = computed(() => ({
    w: unref(sheet).width * unref(view),
    h: unref(sheet).height * unref(view),
}))
const drawPx = computed(() => ({
    w: unref(scaledExtent).width * unref(view),
    h: unref(scaledExtent).height * unref(view),
}))

/** Contours du dessin, ramenés à l'origine puis mis à l'échelle d'affichage. */
const paths = computed(() => {
    const d = unref(drawing)
    if (!d) return []
    const k = unref(view) * unref(factor)
    let minX = Infinity
    let minY = Infinity
    for (const p of d.parts) {
        for (const [x, y] of p.coordinates) {
            if (x < minX) minX = x
            if (y < minY) minY = y
        }
    }
    if (!Number.isFinite(minX)) return []
    const ring = (r) => r
        .map((c, i) => `${i === 0 ? 'M' : 'L'}${((c[0] - minX) * k).toFixed(2)} ${((c[1] - minY) * k).toFixed(2)}`)
        .join('') + 'Z'
    return d.parts.map((p) => [p.coordinates, ...(p.holes || [])].map(ring).join(' '))
})

// ------------------------------------------------------------- poignée
let dragging = false
const startDrag = (e) => {
    dragging = true
    e.target.setPointerCapture?.(e.pointerId)
}
const stopDrag = () => { dragging = false }
const onMove = (e) => {
    if (!dragging) return
    const svg = e.currentTarget
    const box = svg.getBoundingClientRect()
    // Position du pointeur en unités du viewBox, puis en millimètres.
    const px = ((e.clientX - box.left) / box.width) * boxW - pad
    const widthMm = px / unref(view)
    const d = unref(drawing)
    if (!d || widthMm <= 1) return
    adv.dragToWidth(widthMm)
}

// -------------------------------------------------------------- tôle
const sheetDisplay = computed(() => ({
    width: Math.round(mmToDisplay(unref(sheet).width) * 100) / 100,
    height: Math.round(mmToDisplay(unref(sheet).height) * 100) / 100,
}))
const isCurrent = (p) => {
    const s = unref(sheet)
    return Math.abs(displayToMm(p.width) - s.width) < 0.01
        && Math.abs(displayToMm(p.height) - s.height) < 0.01
}
const pickPreset = (p) => {
    // Changer de tôle ne touche PAS le facteur : la tôle est une référence.
    adv.setSheet(displayToMm(p.width), displayToMm(p.height))
}
const onSheet = (which, raw) => {
    const v = Number(raw)
    if (!Number.isFinite(v) || v <= 0) return
    const s = unref(sheet)
    const mm = displayToMm(v)
    adv.setSheet(which === 'width' ? mm : s.width, which === 'height' ? mm : s.height)
}

// ------------------------------------------------------------ validation
const confirm = async () => {
    const pending = [...adv.preview.pending]
    const useSheet = adv.preview.useSheet === true
    const s = unref(sheet)
    adv.cancel()
    if (useSheet) {
        // Pré-remplit la largeur/hauteur du PREMIER format, rien d'autre.
        filesStore.actions.updateSheet(0, {
            width: String(Math.round(mmToDisplay(s.width) * 100) / 100),
            height: String(Math.round(mmToDisplay(s.height) * 100) / 100),
        })
    }
    await filesStore.actions.importStagedFiles(
        pending.map((p) => p.file),
        pending[0]?.projectSlug || null,
    )
}
</script>

<style lang="scss" scoped>
.preview {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
    padding: 12px;
    border: 1px solid var(--fill-tertiary);
    border-radius: 4px;
    text-align: left;

    &__wait {
        color: var(--label-secondary);
        font-size: 13px;
    }
    &__head {
        display: flex;
        align-items: baseline;
        gap: 8px;
    }
    &__title {
        color: var(--label-primary);
        font-size: 14px;
    }
    &__warn {
        color: var(--red-primary, #DC2626);
        font-size: 12px;
    }
    &__svg {
        width: 100%;
        max-width: 520px;
        height: auto;
        touch-action: none;
    }
    &__sheet {
        fill: none;
        stroke: var(--accent-primary);
        stroke-width: 1;
        stroke-dasharray: 4 3;
    }
    &__part {
        fill: var(--accent-primary);
        fill-opacity: 0.18;
        stroke: var(--accent-primary);
        stroke-width: 0.8;
    }
    &__handle {
        fill: var(--accent-primary);
        cursor: nwse-resize;
    }
    &__row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }
    &__dims {
        color: var(--label-primary);
        font-size: 14px;
    }
    &__factor,
    &__label {
        color: var(--label-secondary);
        font-size: 13px;
    }
    &__preset,
    &__num {
        padding: 3px 8px;
        border: 1px solid var(--fill-tertiary);
        border-radius: 4px;
        background: none;
        color: var(--label-secondary);
        font-size: 13px;
    }
    &__preset {
        cursor: pointer;

        &--on {
            border-color: var(--accent-primary);
            color: var(--accent-primary);
        }
    }
    &__num {
        width: 84px;
        color: var(--label-primary);
    }
    &__custom {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--label-secondary);
    }
    &__check {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--label-primary);
        font-size: 14px;
        cursor: pointer;
    }
    &__error {
        margin: 0;
        color: var(--red-primary, #DC2626);
        font-size: 13px;
    }
    &__actions {
        display: flex;
        gap: 8px;
        margin-top: 4px;
    }
}
</style>
