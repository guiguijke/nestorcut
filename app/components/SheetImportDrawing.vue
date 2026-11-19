<template>
    <div class="draw" data-testid="sheet-import-drawing">
        <div ref="box" class="draw__stage">
        <svg
            class="draw__svg"
            :viewBox="fit.viewBox"
            role="group"
            :aria-label="t('sheetImport.drawing.label')"
            preserveAspectRatio="xMidYMid meet"
        >
            <!-- Mm, y vers le haut : la matrice du <g> flippe y (piège AGENTS 20b).
                 Traits à largeur constante à l'écran (vector-effect). -->
            <g :transform="fit.transform">
                <path :d="outlineD" class="draw__sheet" fill-rule="evenodd" />
                <path
                    v-for="z in shapes"
                    :key="z.index"
                    :d="z.d"
                    :class="[
                        'draw__zone',
                        `draw__zone--${z.state}`,
                        { 'draw__zone--hover': hovered === z.index, 'draw__zone--tiny': z.tiny },
                    ]"
                    :tabindex="z.interactive ? 0 : undefined"
                    :role="z.interactive ? 'button' : undefined"
                    :aria-pressed="z.interactive ? String(z.state === 'forbidden') : undefined"
                    :aria-label="z.interactive ? z.aria : undefined"
                    :data-testid="`sheet-import-zone-${z.number}`"
                    :data-state="z.state"
                    @click="z.interactive && emit('toggle', z.index)"
                    @keydown.enter.prevent="z.interactive && emit('toggle', z.index)"
                    @keydown.space.prevent="z.interactive && emit('toggle', z.index)"
                    @pointerenter="emit('hover', z.index)"
                    @pointerleave="emit('hover', null)"
                    @focus="emit('hover', z.index)"
                    @blur="emit('hover', null)"
                >
                    <title>{{ z.aria }}</title>
                </path>
            </g>
        </svg>
        </div>
        <ul class="draw__legend" aria-hidden="true">
            <li><i class="draw__key draw__key--sheet" />{{ t('sheetImport.legend.sheet') }}</li>
            <li><i class="draw__key draw__key--allowed" />{{ t('sheetImport.legend.allowed') }}</li>
            <li><i class="draw__key draw__key--forbidden" />{{ t('sheetImport.legend.forbidden') }}</li>
        </ul>
    </div>
</template>

<script setup>
/**
 * Dessin de la tôle importée : contour en ton clair, chaque forme intérieure
 * est un bouton (clic / Entrée / Espace = interdite ou non). Une forme
 * couverte par une zone interdite qui la contient n'est pas cliquable (la
 * zone parente la couvre déjà), une forme trop petite à l'écran (< 6 px)
 * non plus : elle reste pilotable depuis la liste du panneau.
 *
 * Palette EXPLICITE (piège AGENTS 21 : les variables de thème sont sombres
 * ici). Aucun id SVG : rien à rendre unique par instance (piège 22).
 */
import {
    contourScreenPx, fitTransform, isListOnly, ringPath, MIN_ZONE_PX,
} from '~/utils/sheetImportModel'

const props = defineProps({
    contours: { type: Array, required: true },
    view: { type: Object, required: true },
    // [{ index, number, state }] dans l'ordre de view.zones
    states: { type: Array, required: true },
    hovered: { type: Number, default: null },
    // libellé d'accessibilité de chaque zone : { [index]: string }
    labels: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['toggle', 'hover', 'scale'])

const { t } = useLocale()

// Taille réelle du cadre en px : le viewBox la suit, donc 1 unité = 1 px et le
// seuil des 6 px se mesure sur l'écran, pas sur un viewBox arbitraire.
const box = ref(null)
const size = ref({ w: 760, h: 520 })
let observer = null
onMounted(() => {
    const el = box.value
    if (!el) return
    const read = () => {
        const w = Math.round(el.clientWidth)
        const h = Math.round(el.clientHeight)
        if (w > 0 && h > 0 && (w !== size.value.w || h !== size.value.h)) size.value = { w, h }
    }
    read()
    if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(read)
        observer.observe(el)
    }
})
onBeforeUnmount(() => observer?.disconnect())

const outline = computed(() => props.contours[props.view.outlineIndex])
const fit = computed(() => fitTransform(outline.value.bbox, size.value.w, size.value.h, 28))
watch(() => fit.value.scale, (v) => emit('scale', v), { immediate: true })
const outlineD = computed(() => ringPath(outline.value.ring))

const shapes = computed(() => props.states.map((s) => {
    const contour = props.contours[s.index]
    const tiny = isListOnly(contour, fit.value.scale, MIN_ZONE_PX)
    return {
        index: s.index,
        number: s.number,
        state: s.state,
        d: ringPath(contour.ring),
        tiny,
        interactive: !tiny && s.state !== 'implied',
        aria: props.labels[s.index] || '',
        px: contourScreenPx(contour, fit.value.scale),
    }
}))
</script>

<style lang="scss" scoped>
// Palette du dessin : explicite, identique en thème clair et sombre.
$canvas: #1b2338;
$sheet: #e8edf4;
$sheet-line: #8f9bb0;
$inner: #cdd6e4;
$inner-line: #5d6c87;
// Survol : une teinte légère et un trait fin, plus discrets que le rouge des zones interdites.
$hover-fill: #dbe6f6;
$hover-line: #3b82d6;
$focus-line: #0069d9;
$red: #ef4444;
$red-fill: rgba(220, 38, 38, 0.42);

.draw {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background-color: $canvas;
    // Quadrillage discret : repère de calme, sans prétendre à une échelle.
    background-image:
        radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.07) 1px, transparent 0);
    background-size: 20px 20px;
    border-radius: var(--radius-l);
    overflow: hidden;

    // Le cadre du dessin garde sa hauteur propre : la légende, dessous, n'est
    // jamais écrasée ni rognée (elle passe à la ligne si la place manque).
    &__stage {
        position: relative;
        flex: 1 1 auto;
        min-height: 260px;
    }

    &__svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
        touch-action: manipulation;
    }

    &__sheet {
        fill: $sheet;
        stroke: $sheet-line;
        stroke-width: 1.5;
        vector-effect: non-scaling-stroke;
        pointer-events: none;
    }

    &__zone {
        fill: $inner;
        stroke: $inner-line;
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
        cursor: pointer;
        outline: none;
        transition: fill 0.15s, stroke 0.15s;

        &--tiny,
        &--implied {
            cursor: default;
        }
        &--tiny {
            pointer-events: none;
        }
        &--forbidden {
            fill: $red-fill;
            stroke: $red;
            stroke-width: 2;
        }
        // Couverte : la zone parente est déjà rouge ; trait pointillé seulement.
        &--implied {
            fill: none;
            stroke: $red;
            stroke-width: 1;
            stroke-dasharray: 4 3;
        }
        &.draw__zone--hover:not(.draw__zone--implied):not(.draw__zone--forbidden) {
            fill: $hover-fill;
            stroke: $hover-line;
            stroke-width: 1.5;
        }
        &.draw__zone--hover.draw__zone--forbidden {
            fill: rgba(220, 38, 38, 0.55);
            stroke-width: 2.5;
        }
        &.draw__zone--hover.draw__zone--implied {
            stroke-width: 2;
        }
        &:focus-visible {
            stroke: $focus-line;
            stroke-width: 3;
            filter: drop-shadow(0 0 3px $focus-line);
        }
    }

    &__legend {
        flex: 0 0 auto;
        display: flex;
        flex-wrap: wrap;
        gap: 4px 14px;
        margin: 0;
        padding: 8px 14px 10px;
        list-style: none;
        color: #c9d2e3;
        font-size: var(--fs-12);
        line-height: 1.3;
        pointer-events: none;

        li {
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
    }
    &__key {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: var(--radius-s);
        border: 1px solid transparent;

        &--sheet {
            background-color: $sheet;
            border-color: $sheet-line;
        }
        &--allowed {
            background-color: $inner;
            border-color: $inner-line;
        }
        &--forbidden {
            background-color: $red-fill;
            border-color: $red;
        }
    }
}
</style>
