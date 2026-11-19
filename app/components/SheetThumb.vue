<template>
    <svg
        v-if="model"
        class="thumb"
        :viewBox="model.viewBox"
        role="img"
        :aria-label="label"
        preserveAspectRatio="xMidYMid meet"
    >
        <title>{{ label }}</title>
        <!-- y moteur (haut) -> y SVG (bas) : le flip est dans la matrice (piège AGENTS 20b). -->
        <g :transform="model.transform">
            <path :d="model.outlineD" class="thumb__sheet" fill-rule="evenodd" />
            <path
                v-for="(d, i) in model.zonesD"
                :key="i"
                :d="d"
                class="thumb__zone"
            />
        </g>
    </svg>
</template>

<script setup>
/**
 * Vignette du contour d'une tôle (cartes « tôles récentes »). Palette
 * explicite : jamais les variables de thème pour un dessin (piège AGENTS 21).
 */
import { thumbModel } from '~/utils/sheetImportModel'

const props = defineProps({
    record: { type: Object, default: null },
    label: { type: String, default: '' },
    width: { type: Number, default: 96 },
    height: { type: Number, default: 64 },
})

const model = computed(() => thumbModel(props.record, props.width, props.height))
</script>

<style lang="scss" scoped>
.thumb {
    display: block;
    width: 100%;
    height: 100%;
    background-color: #1b2338;
    border-radius: var(--radius);

    &__sheet {
        fill: #e8edf4;
        stroke: #8f9bb0;
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
    }
    &__zone {
        fill: rgba(220, 38, 38, 0.55);
        stroke: #ef4444;
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
    }
}
</style>
