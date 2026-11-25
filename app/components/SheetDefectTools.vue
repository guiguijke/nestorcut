<template>
    <div class="dtools" role="toolbar" :aria-label="t('sheetImport.defect.tools')" data-testid="defect-tools">
        <button
            v-for="item in items"
            :key="item.id"
            type="button"
            class="dtools__btn"
            :class="{ 'dtools__btn--on': tool === item.id }"
            :aria-pressed="String(tool === item.id)"
            :data-testid="`defect-tool-${item.id}`"
            @click="emit('update:tool', item.id)"
        >
            <svg class="dtools__icon" viewBox="0 0 20 20" aria-hidden="true">
                <path v-for="(d, i) in item.paths" :key="i" :d="d" />
            </svg>
            <span>{{ t(`sheetImport.defect.tool.${item.id}`) }}</span>
        </button>
        <button
            type="button"
            class="dtools__btn"
            :disabled="!canUndo"
            data-testid="defect-undo"
            @click="emit('undo')"
        >
            <svg class="dtools__icon" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M7 4 3 8l4 4M3 8h8a5 5 0 0 1 0 10H8" />
            </svg>
            <span>{{ t('sheetImport.defect.undo') }}</span>
        </button>
    </div>
</template>

<script setup>
/**
 * Barre d'outils du dessin des défauts : choisir les formes (par défaut),
 * contour libre, cercle, rectangle, annuler. Boutons de type radio
 * (aria-pressed), icône SVG en ligne + texte. « Fermer le contour » est sur le
 * dessin (SheetImportDrawing) : il apparaît sans déplacer quoi que ce soit.
 */
defineProps({
    tool: { type: String, required: true },
    canUndo: { type: Boolean, default: false },
})
const emit = defineEmits(['update:tool', 'undo'])

const { t } = useLocale()

const items = [
    { id: 'pointer', paths: ['M5 3v12l3-3 2.5 5 2-1-2.5-5H15z'] },
    { id: 'free', paths: ['M3 15c2-8 4-9 6-5s4 3 8-6'] },
    { id: 'circle', paths: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z'] },
    { id: 'rect', paths: ['M3.5 5.5h13v9h-13z'] },
]
</script>

<style lang="scss" scoped>
.dtools {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);

    &__btn {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-1);
        min-height: 32px;
        padding: var(--sp-1) var(--sp-3);
        border: 1px solid var(--border-strong);
        border-radius: var(--radius);
        background: transparent;
        color: var(--text-2);
        font-family: inherit;
        font-size: var(--fs-13);
        font-weight: 600;
        cursor: pointer;
        transition: border-color 0.2s, color 0.2s, background-color 0.2s;

        @media (hover: hover) {
            &:hover:not(:disabled) { color: var(--text); background-color: var(--surface-2); }
        }
        &:focus-visible { outline: none; box-shadow: var(--focus-ring); }
        &:disabled { opacity: 0.45; cursor: default; }

        &--on {
            border-color: var(--accent);
            color: var(--accent);
            background-color: color-mix(in srgb, var(--accent) 10%, transparent);
        }
    }
    &__icon {
        width: 16px;
        height: 16px;
        flex: 0 0 auto;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.6;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
}

// Au doigt : des cibles d'au moins 40 px de haut, qui passent à la ligne.
@media (max-width: 900px) {
    .dtools__btn { min-height: 40px; }
}
</style>
