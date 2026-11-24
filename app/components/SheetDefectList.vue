<template>
    <div class="dlist" data-testid="defect-block">
        <h3 class="dlist__title">{{ t('sheetImport.defect.list.title') }}</h3>
        <p v-if="!drawn.length" class="dlist__empty" data-testid="defect-empty">{{ t('sheetImport.defect.list.empty') }}</p>
        <ul v-else class="dlist__rows" data-testid="defect-list">
            <li
                v-for="(d, i) in drawn"
                :key="d.id"
                class="dlist__row"
                :class="{ 'dlist__row--hover': hovered === i }"
                :data-testid="`defect-row-${i + 1}`"
                @pointerenter="emit('hover', i)"
                @pointerleave="emit('hover', null)"
            >
                <span class="dlist__num">{{ i + 1 }}</span>
                <span class="dlist__main">
                    <span class="dlist__name">{{ t('sheetImport.defect.item', { n: i + 1 }) }}</span>
                    <span class="dlist__size">{{ kindText(d) }} · {{ sizeText(d) }}</span>
                </span>
                <button
                    type="button"
                    class="dlist__del"
                    :aria-label="t('sheetImport.defect.delete', { n: i + 1 })"
                    :title="t('sheetImport.defect.delete', { n: i + 1 })"
                    :data-testid="`defect-delete-${i + 1}`"
                    @click="emit('delete', i)"
                    @focus="emit('hover', i)"
                    @blur="emit('hover', null)"
                >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10M9 9v4M11 9v4" />
                    </svg>
                </button>
            </li>
        </ul>
        <p class="dlist__rule">{{ t('sheetImport.defect.list.rule') }}</p>
    </div>
</template>

<script setup>
/**
 * Panneau « Défauts dessinés » : un défaut par ligne (numéro, genre, taille),
 * bouton de suppression, rappel de la règle. Le survol d'une ligne éclaire le
 * défaut dans le dessin, et inversement (indice `hovered`).
 */
import { defectBbox } from '~/utils/sheetDefects'

defineProps({
    drawn: { type: Array, required: true },
    hovered: { type: Number, default: null },
})
const emit = defineEmits(['delete', 'hover'])

const { t } = useLocale()
const { fmtLength } = useUnit()

const kindText = (d) => t(`sheetImport.defect.tool.${d.kind}`)
const sizeText = (d) => {
    if (d.kind === 'circle') return `Ø ${fmtLength(2 * d.r)}`
    const b = defectBbox(d)
    return b ? `${fmtLength(b[2] - b[0])} × ${fmtLength(b[3] - b[1])}` : ''
}
</script>

<style lang="scss" scoped>
.dlist {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);

    &__title {
        margin: 0;
        color: var(--text-2);
        font-size: var(--fs-12);
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
    }
    &__empty,
    &__rule {
        margin: 0;
        color: var(--text-2);
        font-size: var(--fs-12);
        line-height: var(--lh-text);
    }
    &__rows {
        margin: 0;
        padding: 0;
        list-style: none;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background-color: var(--surface);
        max-height: 220px;
        overflow-y: auto;
    }
    &__row {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--sp-3);
        min-height: 48px;
        box-sizing: border-box;
        padding: var(--sp-1) var(--sp-2) var(--sp-1) var(--sp-3);
        border-left: 3px solid var(--danger);
        font-size: var(--fs-13);
        transition: background-color 0.15s;

        & + & { border-top: 1px solid var(--border); }
        &--hover { background-color: var(--danger-bg); }
    }
    &__num {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: var(--radius);
        background-color: var(--surface-2);
        border: 1px solid var(--border);
        font-size: var(--fs-12);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }
    &__main {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    &__name { font-weight: 600; }
    &__size {
        color: var(--text-2);
        font-size: var(--fs-12);
        font-variant-numeric: tabular-nums;
    }
    &__del {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border: none;
        border-radius: var(--radius);
        background: transparent;
        color: var(--text-2);
        cursor: pointer;

        svg {
            width: 18px;
            height: 18px;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.5;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        @media (hover: hover) {
            &:hover { color: var(--danger); background-color: var(--danger-bg); }
        }
        &:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    }
}
@media (max-width: 900px) {
    .dlist__rows { max-height: none; }
    .dlist__del { width: 40px; height: 40px; }
}
</style>
