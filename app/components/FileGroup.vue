<template>
    <!-- Lot J11-bis (R1) : la carte groupée OCCUPE TOUTE LA RANGÉE de la
         grille — le titre entier, la quantité alignée comme une carte
         simple, les N vignettes visibles sans coupe. Le fond (une fiche par
         section originale, J9) ne change pas : c'est la mise en page qui
         suit son contenu. -->
    <div class="fgroup" data-testid="file-grouped-card">
        <div class="fgroup__row">
            <SvgDisplay :size="sizeType.s" :src="cover" class="fgroup__cover" preserve-colors />
            <div class="fgroup__meta">
                <span class="fgroup__name" :title="drawingName">{{ drawingName }}</span>
                <span class="fgroup__line">
                    <span class="fgroup__count">×{{ total }}</span>
                    <span v-if="jobName" class="fgroup__origin" :title="jobName">{{ jobName }}</span>
                </span>
            </div>
            <NewBadge feature="job-grouped-card" />
            <MainButton :size="sizeType.s" :label="open ? t('files.groupCollapse') : t('files.groupExpand')"
                :theme="themeType.secondary" trackingTag="file_group_toggle" class="fgroup__toggle"
                :aria-expanded="String(open)" @click="open = !open" />
        </div>
        <div v-if="open" class="fgroup__members">
            <!-- Lot J11-bis (R10) : une vignette de membre SE CLIQUE et ouvre
                 la fiche détaillée (constats, vue DXF, échelle) — la carte
                 groupée remplace les cartes simples, sans elle le détail
                 devenait inatteignable. -->
            <button
                v-for="(item, k) in items"
                :key="item.file.slug"
                type="button"
                class="fgroup__member"
                :title="item.file.name"
                @click="$emit('openModal', item.file)"
            >
                <span class="fgroup__index">{{ k + 1 }}/{{ items.length }}</span>
                <SvgDisplay :size="sizeType.s" :src="item.file.svgUrl" class="fgroup__thumb" preserve-colors />
                <span
                    v-if="item.file.sheetcamUserPoints"
                    class="fgroup__moved"
                    :title="t('jobImport.userPoint')"
                >{{ t('jobImport.userPointShort') }}</span>
                <span v-else class="fgroup__moved fgroup__moved--auto">&nbsp;</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { sizeType } from '~~/constants/size.constants'
import { themeType } from '~~/constants/theme.constants'

const { t } = useLocale()

const props = defineProps({
    items: { type: Array, required: true },
    drawingName: { type: String, required: true },
    jobName: { type: String, default: null },
})

const open = ref(true)
const total = computed(() => props.items.reduce((n, it) => n + (Number(it.file.count) || 1), 0))
const cover = computed(() => props.items[0]?.file?.svgUrl || null)
</script>

<style lang="scss" scoped>
// Lot J11-bis (R1) : TOUTE LA RANGÉE — la grille `files__grid` donne à
// chaque enfant une colonne ; la carte groupée sort du flux en
// `grid-column: 1 / -1` pour occuper la largeur complète, et son contenu
// se met en page en lignes (métadonnées + toggle, puis vignettes).
.fgroup {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: var(--radius-l);
    border: 1px solid var(--separator-secondary);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--label-primary) 4%, transparent);
    --fgroup-accent: #6ea8ff;

    &__row {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    &__cover {
        width: 48px;
        height: 48px;
        flex: none;
    }

    &__meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
    }

    &__name {
        color: var(--label-primary);
        font-size: var(--fs-14, 14px);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    &__line {
        display: flex;
        gap: 8px;
        align-items: baseline;
        min-width: 0;
    }

    &__count {
        color: var(--fgroup-accent);
        font-weight: 600;
        flex: none;
    }

    &__origin {
        color: var(--label-tertiary);
        font-size: var(--fs-12, 12px);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    &__toggle {
        flex: none;
    }

    &__members {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        padding-top: 4px;
        border-top: 1px solid var(--separator-secondary);
    }

    &__member {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        width: 72px;
        flex: none;
        padding: 0;
        border: none;
        background: none;
        font: inherit;
        color: inherit;
        cursor: pointer;
        border-radius: var(--radius-s, 6px);

        &:hover .fgroup__thumb {
            outline: 1px solid var(--fgroup-accent);
        }

        &:focus-visible {
            outline: 2px solid var(--fgroup-accent);
            outline-offset: 2px;
        }
    }

    &__index {
        font-size: var(--fs-12, 12px);
        color: var(--label-tertiary);
    }

    &__thumb {
        width: 64px;
        height: 64px;
    }

    &__moved {
        font-size: var(--fs-12, 12px);
        color: var(--fgroup-accent);
        white-space: nowrap;

        &--auto {
            visibility: hidden;
        }
    }
}
</style>
