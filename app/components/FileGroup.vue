<template>
    <!-- Lot J11-a (A2, §2 du plan) : la PRÉSENTATION groupée des fiches d'un
         même dessin issues du même `.job`. Le MODÈLE reste une fiche par
         section originale (chacune porte SES points de départ — c'est ce
         qui les fait marcher) : la carte ne regroupe que l'AFFICHAGE. Un
         dessin présent quatre fois dans le `.job` est déjà éclaté aux yeux
         de SheetCam (une pose par section) — il n'y a rien à « éclater »,
         et le bouton n'existe pas. -->
    <div class="fgroup" data-testid="file-group">
        <button
            type="button"
            class="fgroup__head"
            :aria-expanded="String(open)"
            @click="open = !open"
        >
            <SvgDisplay :size="sizeType.s" :src="cover" class="fgroup__cover" preserve-colors />
            <span class="fgroup__meta">
                <span class="fgroup__name" :title="drawingName">{{ drawingName }}</span>
                <span class="fgroup__line">
                    <span class="fgroup__count">×{{ total }}</span>
                    <span class="fgroup__origin" v-if="jobName" :title="jobName">{{ jobName }}</span>
                </span>
            </span>
            <span class="fgroup__chevron" :class="{ 'fgroup__chevron--open': open }">▾</span>
        </button>
        <!-- La quantité vit sur le GROUPE : répartie 1 par exemplaire,
             l'excédent en copies du dernier (règle 4 du format). -->
        <div class="fgroup__counter counter">
            <MainButton :size="sizeType.s" :icon="iconType.minus" :isDisable="total < 1" :isLabelShow="false"
                trackingTag="file_decrement" @click="setTotal(total - 1)" label="decrement" class="counter__btn" />
            <input
                type="number"
                v-model="total"
                min="0"
                max="999"
                class="counter__value"
                :aria-label="t('file.quantity', { name: drawingName })"
                @blur="onBlur"
            />
            <MainButton :size="sizeType.s" :icon="iconType.plus" :isLabelShow="false" :isDisable="total >= 999"
                trackingTag="file_increment" @click="setTotal(total + 1)" label="increment" class="counter__btn" />
        </div>
        <div v-if="open" class="fgroup__members">
            <div v-for="(item, k) in items" :key="item.file.slug" class="fgroup__member">
                <span class="fgroup__index">{{ k + 1 }}/{{ items.length }}</span>
                <SvgDisplay :size="sizeType.s" :src="item.file.svgUrl" class="fgroup__thumb" preserve-colors />
                <span class="fgroup__member-line">
                    <span
                        v-if="item.file.sheetcamUserPoints"
                        class="fgroup__moved"
                        :title="t('jobImport.userPoint')"
                    >{{ t('jobImport.userPointShort') }}</span>
                </span>
            </div>
        </div>
    </div>
</template>

<script setup>
import { sizeType } from '~~/constants/size.constants'
import { iconType } from '~~/constants/icon.constants'

const { t } = useLocale()

const props = defineProps({
    // Les fiches du groupe, DANS L'ORDRE des exemplaires (1..N) — l'appelant
    // les fournit avec leur index dans la liste du projet (pour les actions).
    items: { type: Array, required: true },
    drawingName: { type: String, required: true },
    jobName: { type: String, default: null },
})

const open = ref(false)
const total = ref(props.items.reduce((n, it) => n + (Number(it.file.count) || 1), 0))

const cover = computed(() => props.items[0]?.file?.svgUrl || null)

const { actions } = filesStore
const { updateCount } = actions

// Répartition (§3 point 2) : 1 par exemplaire, l'excédent en copies du
// DERNIER. Moins d'exemplaires que demandé : les suivants à 0 (désactivés,
// jamais supprimés — même sémantique que le `.job` rendu).
const setTotal = (n) => {
    const v = Math.max(0, Math.min(999, Number(n) || 0))
    total.value = v
    props.items.forEach((it, k) => {
        const own = k < v ? 1 : 0
        const last = k === props.items.length - 1 ? Math.max(0, v - props.items.length + 1) : 0
        updateCount(String(own + last), it.index)
    })
}
const onBlur = () => setTotal(total.value)
watch(() => props.items.map((it) => it.file.count).join(','), () => {
    const sum = props.items.reduce((n, it) => n + (Number(it.file.count) || 0), 0)
    if (sum !== total.value) total.value = sum
})
</script>

<style lang="scss" scoped>
.fgroup {
    display: flex;
    flex-wrap: wrap;
    position: relative;
    padding: 12px;
    border-radius: var(--radius-l);
    border: 1px solid var(--separator-secondary);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--label-primary) 4%, transparent);
    // Couleurs explicites pour les éléments qui doivent rester lisibles sur
    // les deux thèmes (piège #21) — le reste suit les vars de thème.
    --fgroup-accent: #6ea8ff;

    &__head {
        display: flex;
        align-items: center;
        gap: 12px;
        width: calc(100% - 130px);
        background: none;
        border: none;
        cursor: pointer;
        text-align: left;
        padding: 0;
        color: inherit;
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

    &__chevron {
        margin-left: auto;
        color: var(--label-tertiary);
        transition: transform 0.2s;
        flex: none;

        &--open {
            transform: rotate(180deg);
        }
    }

    &__counter {
        position: absolute;
        top: 8px;
        right: 8px;
        z-index: 1;
    }

    &__members {
        flex-basis: 100%;
        margin-top: 8px;
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding-top: 4px;
    }

    &__member {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        flex: none;
        width: 72px;
    }

    &__index {
        font-size: var(--fs-12, 12px);
        color: var(--label-tertiary);
    }

    &__thumb {
        width: 56px;
        height: 56px;
    }

    &__moved {
        font-size: var(--fs-12, 12px);
        color: var(--fgroup-accent);
        white-space: nowrap;
    }
}
</style>
