<template>
    <!-- U1 passe 2 (a11y) : miniature DÉCORATIVE — les données de la carte
         (densité, tôles, état) portent l'information ; le SVG est masqué
         aux lecteurs d'écran au lieu d'un rôle img sans nom. -->
    <svg
        v-if="w && h"
        :viewBox="viewBox"
        class="sheet-preview"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
    >
        <g :transform="transform">
            <image
                :href="imageSrc"
                :x="-m"
                :y="-m"
                :width="w + 2 * m"
                :height="h + 2 * m"
                preserveAspectRatio="none"
            />
        </g>
        <SheetAxes :width="w" :height="h" :origin="origin" />
    </svg>
    <img
        v-else
        :src="src"
        class="sheet-preview sheet-preview--raw"
        alt=""
    />
</template>

<script setup>
import { sheetDisplaySize, sheetLandscapeTransform } from '~/utils/sheetView'
import { overhangMarginMm, viewBoxWithMargin, widenSvgDataUri } from '~/utils/overhangView'

const props = defineProps({
    src: { type: String, required: true },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    // Zéro des fichiers livrés, pour le repère X/Y : 'corner' (défaut) | 'center'.
    origin: { type: String, default: 'corner' },
    // Marge d'affichage (mm) autour de la tôle pour une pièce qui dépasse du bord
    // (distance au bord négative). null = la lire sur le résultat ouvert ; 0 = aucune.
    margin: { type: Number, default: null },
})

const w = computed(() => Number(props.width) || 0)
const h = computed(() => Number(props.height) || 0)
// Résultat « Cet appareil » : le record garde la distance au bord demandée.
const m = computed(() => {
    if (props.margin !== null) return Math.max(0, Number(props.margin) || 0)
    return overhangMarginMm(globalStore.getters.resultModalData?.localRecord?.requestedEdgeMm)
})
const imageSrc = computed(() => widenSvgDataUri(props.src, m.value))
const viewBox = computed(() => {
    const { viewW, viewH } = sheetDisplaySize(w.value, h.value)
    return viewBoxWithMargin(viewW, viewH, m.value)
})
const transform = computed(() => sheetLandscapeTransform(w.value, h.value))
</script>

<style scoped>
.sheet-preview {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--surface);
}
.sheet-preview--raw {
    object-fit: contain;
}
</style>
