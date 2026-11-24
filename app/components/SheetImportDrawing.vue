<template>
    <div class="draw" data-testid="sheet-import-drawing">
        <div ref="box" class="draw__stage">
        <svg
            ref="svg"
            class="draw__svg"
            :class="{ 'draw__svg--tool': drawing }"
            :viewBox="fit.viewBox"
            role="group"
            :aria-label="t('sheetImport.drawing.label')"
            preserveAspectRatio="xMidYMid meet"
            @pointerdown="onDown"
            @pointermove="onMove"
            @pointerup="onUp"
            @pointercancel="onCancel"
            @pointerleave="onLeave"
            @dblclick="onDouble"
        >
            <!-- Mm, y vers le haut : la matrice du <g> flippe y (piège AGENTS 20b).
                 Traits à largeur constante à l'écran (vector-effect). -->
            <g :transform="fit.transform">
                <path :d="outlineD" :class="['draw__sheet', { 'draw__sheet--ghost': cutShown }]" fill-rule="evenodd" />
                <g v-if="cutShown" :class="['draw__cut', { 'draw__cut--stale': cutStale }]">
                    <path :d="cutD" class="draw__kept" fill-rule="evenodd" data-testid="defect-cut-outline" />
                    <path
                        v-for="(p, i) in lostD"
                        :key="`lost-${i}`"
                        :d="p"
                        class="draw__lost"
                        fill-rule="evenodd"
                        :data-testid="`defect-lost-${i + 1}`"
                    >
                        <title>{{ t('sheetImport.defect.lost') }}</title>
                    </path>
                </g>
                <path
                    v-for="z in shapes"
                    :key="z.index"
                    :d="z.d"
                    :class="[
                        'draw__zone',
                        `draw__zone--${z.state}`,
                        { 'draw__zone--hover': hovered === z.index, 'draw__zone--tiny': z.tiny, 'draw__zone--inert': drawing },
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
                <!-- Défauts : rouge translucide, règle NON NULLE (la géométrie remplit ainsi un contour qui se croise). -->
                <path
                    v-for="(d, i) in defects"
                    :key="d.id"
                    :d="d.d"
                    :class="['draw__defect', { 'draw__defect--hover': hoveredDefect === i, 'draw__defect--inert': drawing }]"
                    fill-rule="nonzero"
                    :data-testid="`defect-shape-${i + 1}`"
                    @pointerenter="emit('hoverDefect', i)"
                    @pointerleave="emit('hoverDefect', null)"
                />
                <path v-if="draftD" :d="draftD" class="draw__draft" fill-rule="nonzero" />
            </g>
            <!-- Points posés, anneau de fermeture et taille vivante : en pixels écran, hors de la matrice. -->
            <g v-if="draftDots.length" class="draw__dots" aria-hidden="true">
                <circle v-for="(p, i) in draftDots" :key="i" :cx="p[0]" :cy="p[1]" r="3" class="draw__dot" />
                <circle v-if="canClose" :cx="draftDots[0][0]" :cy="draftDots[0][1]" r="9" class="draw__first" />
            </g>
            <text v-if="liveText" :x="liveAt[0]" :y="liveAt[1]" class="draw__live" aria-hidden="true" data-testid="defect-live">{{ liveText }}</text>
        </svg>
        </div>
        <ul class="draw__legend" aria-hidden="true">
            <li><i class="draw__key draw__key--sheet" />{{ t('sheetImport.legend.sheet') }}</li>
            <template v-if="view.zones.length">
                <li><i class="draw__key draw__key--allowed" />{{ t('sheetImport.legend.allowed') }}</li>
                <li><i class="draw__key draw__key--forbidden" />{{ t('sheetImport.legend.forbidden') }}</li>
            </template>
            <template v-if="drawn.length">
                <li><i class="draw__key draw__key--defect" />{{ t('sheetImport.defect.legend.defect') }}</li>
                <li v-if="cutShown && lostD.length"><i class="draw__key draw__key--lost" />{{ t('sheetImport.defect.legend.lost') }}</li>
            </template>
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
 * Défauts à la main (outils `free`, `circle`, `rect`) : les événements du
 * pointeur sont traduits en millimètres par `getScreenCTM` puis `fit` (juste
 * à toute taille de fenêtre, cadre en lettres-boîte compris) ; la logique
 * pure est dans utils/defectDrawing.js. Le dessin ne garde que le tracé en
 * cours ; un défaut terminé part vers la fenêtre (`add`), qui tient la liste,
 * l'historique et la coupe.
 *
 * Palette EXPLICITE (piège AGENTS 21 : les variables de thème sont sombres
 * ici). Aucun id SVG : rien à rendre unique par instance (piège 22).
 */
import {
    contourScreenPx, fitTransform, isListOnly, ringPath, MIN_ZONE_PX,
} from '~/utils/sheetImportModel'
import { circleRing, rectRing } from '~/utils/sheetDefects'
import {
    circleDrag, isDrawTool, liveSize, mmToScreen, nearFirst, popPoint, pushPoint, rectDrag, screenToMm,
} from '~/utils/defectDrawing'

const props = defineProps({
    contours: { type: Array, required: true },
    view: { type: Object, required: true },
    // [{ index, number, state }] dans l'ordre de view.zones
    states: { type: Array, required: true },
    hovered: { type: Number, default: null },
    // libellé d'accessibilité de chaque zone : { [index]: string }
    labels: { type: Object, default: () => ({}) },
    // outil actif : 'pointer' (choisir les formes) | 'free' | 'circle' | 'rect'
    tool: { type: String, default: 'pointer' },
    // défauts dessinés ({ id, kind, ring }) et coupe liée à eux (null tant que rien n'est calculé)
    drawn: { type: Array, default: () => [] },
    cut: { type: Object, default: null },
    // la coupe tenue n'est plus celle de l'état courant : atténuée
    cutStale: { type: Boolean, default: false },
    hoveredDefect: { type: Number, default: null },
})
const emit = defineEmits(['toggle', 'hover', 'scale', 'add', 'draft', 'hoverDefect'])

const { t } = useLocale()
const { fmtLength } = useUnit()

// Taille réelle du cadre en px : le viewBox la suit, donc 1 unité = 1 px et le
// seuil des 6 px se mesure sur l'écran, pas sur un viewBox arbitraire.
const box = ref(null)
const svg = ref(null)
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
onBeforeUnmount(() => {
    observer?.disconnect()
    stopKeys()
})

const outline = computed(() => props.contours[props.view.outlineIndex])
const fit = computed(() => fitTransform(outline.value.bbox, size.value.w, size.value.h, 28))
watch(() => fit.value.scale, (v) => emit('scale', v), { immediate: true })
const outlineD = computed(() => ringPath(outline.value.ring))

const drawing = computed(() => isDrawTool(props.tool))

const shapes = computed(() => props.states.map((s) => {
    const contour = props.contours[s.index]
    const tiny = isListOnly(contour, fit.value.scale, MIN_ZONE_PX)
    return {
        index: s.index,
        number: s.number,
        state: s.state,
        d: ringPath(contour.ring),
        tiny,
        // Un outil de dessin actif : les formes ne sont plus des boutons.
        interactive: !drawing.value && !tiny && s.state !== 'implied',
        aria: props.labels[s.index] || '',
        px: contourScreenPx(contour, fit.value.scale),
    }
}))

// ------------------------------------------------------------ défauts et coupe
const defects = computed(() => props.drawn.map((d) => ({ id: d.id, d: ringPath(d.ring) })))
const cutShown = computed(() => props.drawn.length > 0 && Boolean(props.cut))
const cutD = computed(() => (props.cut ? ringPath(props.cut.outer) : ''))
// Morceau perdu : contour + trous, rempli à la règle paire-impaire.
const lostD = computed(() => (props.cut
    ? props.cut.lostPieces.map((p) => ringPath(p.outer) + (p.holes || []).map(ringPath).join(''))
    : []))

// ------------------------------------------------------------- tracé en cours
const points = ref([]) // contour libre : points posés (mm)
const start = ref(null) // cercle / rectangle : point de départ (mm)
const cursor = ref(null) // { mm, sx, sy } : pointeur courant
let activeId = null // pointeur qui trace (les autres doigts sont ignorés)
let lastCloseAt = -Infinity

const drafting = computed(() => points.value.length > 0 || start.value !== null)
const canClose = computed(() => props.tool === 'free' && points.value.length >= 3)
watch(() => points.value.length, (n) => emit('draft', n), { immediate: true })

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

// Écran (unités du viewBox) -> mm : la CTM du svg couvre la lettre-boîte et tout
// redimensionnement ; `fit` fait le reste.
const readPoint = (e) => {
    const el = svg.value
    const ctm = el?.getScreenCTM?.()
    if (!el || !ctm) return null
    const pt = el.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const q = pt.matrixTransform(ctm.inverse())
    return { mm: screenToMm(q.x, q.y, fit.value), sx: q.x, sy: q.y }
}

const draftDots = computed(() => points.value.map((p) => mmToScreen(p, fit.value)))
const draftD = computed(() => {
    const cur = cursor.value?.mm
    if (props.tool === 'free' && points.value.length) {
        const pts = cur ? [...points.value, cur] : points.value
        return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')
    }
    if (start.value && cur) {
        if (props.tool === 'circle') {
            const ring = circleRing(start.value[0], start.value[1], Math.hypot(cur[0] - start.value[0], cur[1] - start.value[1]))
            return ring ? ringPath(ring) : ''
        }
        if (props.tool === 'rect') {
            const ring = rectRing(start.value, cur)
            return ring ? ringPath(ring) : ''
        }
    }
    return ''
})

// Taille vivante, près du pointeur (unité d'affichage).
const live = computed(() => liveSize(props.tool, start.value, cursor.value?.mm))
const liveText = computed(() => {
    const v = live.value
    if (!v) return ''
    return v.kind === 'circle' ? `Ø ${fmtLength(v.diameter)}` : `${fmtLength(v.width)} × ${fmtLength(v.height)}`
})
const liveAt = computed(() => {
    const c = cursor.value
    if (!c) return [0, 0]
    // Le texte reste dans le cadre : à gauche / en dessous du pointeur près des bords.
    const x = c.sx + 130 > size.value.w ? c.sx - 120 : c.sx + 14
    const y = c.sy - 18 < 14 ? c.sy + 24 : c.sy - 12
    return [x, y]
})

const cancelDraft = () => {
    points.value = []
    start.value = null
    cursor.value = null
    activeId = null
}
const popDraftPoint = () => { points.value = popPoint(points.value) }
const closeContour = () => {
    if (points.value.length < 3) return
    const pts = points.value
    points.value = []
    cursor.value = null
    lastCloseAt = nowMs()
    emit('add', { kind: 'free', data: { points: pts } })
}
defineExpose({ cancelDraft, popPoint: popDraftPoint, closeContour })

watch(() => props.tool, () => cancelDraft())

// Échap et Entrée pendant un tracé : la phase de capture sur window passe AVANT
// l'écoute du DialogWrapper (document, phase de bulle) ; Échap annule le tracé
// SANS fermer la fenêtre. Hors tracé, l'écoute n'existe pas.
// Le bouton de l'outil garde souvent le focus (on vient de cliquer dessus) :
// Entrée y ferme le contour ; tout autre bouton garde son Entrée.
const isFieldTarget = (el) => Boolean(el)
    && !el.closest?.('[data-testid^="defect-tool-"]')
    && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.isContentEditable)
const onKey = (e) => {
    if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelDraft()
    } else if (e.key === 'Enter' && canClose.value && !isFieldTarget(e.target)) {
        e.preventDefault()
        e.stopPropagation()
        closeContour()
    }
}
let keysOn = false
function startKeys() {
    if (keysOn || typeof window === 'undefined') return
    window.addEventListener('keydown', onKey, true)
    keysOn = true
}
function stopKeys() {
    if (!keysOn) return
    window.removeEventListener('keydown', onKey, true)
    keysOn = false
}
// Un tracé est « en cours » dès un point posé ou un glissé commencé.
watch(drafting, (on) => { if (on) startKeys(); else stopKeys() })

// ------------------------------------------------------------------ pointeur
const release = (e) => {
    try { svg.value?.releasePointerCapture?.(e.pointerId) } catch { /* déjà relâché */ }
}
const onDown = (e) => {
    if (!drawing.value || activeId !== null) return
    // Premier contact seulement : ni bouton secondaire, ni deuxième doigt.
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
    const q = readPoint(e)
    if (!q) return
    activeId = e.pointerId
    cursor.value = q
    if (props.tool !== 'free') start.value = q.mm
    try { svg.value?.setPointerCapture?.(e.pointerId) } catch { /* pointeur synthétique */ }
    e.preventDefault()
}
const onMove = (e) => {
    if (!drawing.value) return
    if (activeId !== null && e.pointerId !== activeId) return
    const q = readPoint(e)
    if (q) cursor.value = q
}
const onLeave = (e) => {
    // Sortie de la souris : plus d'étiquette ; le fil élastique d'un contour libre reste.
    if (activeId !== null && e.pointerId === activeId) return
    if (!(props.tool === 'free' && points.value.length)) cursor.value = null
}
const onUp = (e) => {
    if (!drawing.value || e.pointerId !== activeId) return
    activeId = null
    release(e)
    const q = readPoint(e)
    if (!q) {
        start.value = null
        return
    }
    const scale = fit.value.scale
    if (props.tool === 'free') {
        // Deuxième clic d'un double clic qui vient de fermer le contour : rien.
        if (nowMs() - lastCloseAt < 400) return
        if (nearFirst(points.value, q.mm, scale)) closeContour()
        else points.value = pushPoint(points.value, q.mm, scale)
        return
    }
    const from = start.value
    start.value = null
    cursor.value = null
    if (!from) return
    const data = props.tool === 'circle' ? circleDrag(from, q.mm, scale) : rectDrag(from, q.mm, scale)
    if (data) emit('add', { kind: props.tool, data })
}
const onCancel = (e) => {
    if (e.pointerId !== activeId) return
    release(e)
    activeId = null
    if (props.tool === 'free') return // les points déjà posés restent
    start.value = null
    cursor.value = null
}
const onDouble = () => {
    if (drawing.value && props.tool === 'free' && points.value.length >= 3) closeContour()
}
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
$kept-line: #2f81f7;
$lost-fill: rgba(143, 155, 176, 0.38);
$lost-line: #c9d2e3;

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

        // Un outil de dessin actif : le doigt trace, il ne fait plus défiler la page.
        &--tool {
            touch-action: none;
            cursor: crosshair;
            user-select: none;
        }
    }

    &__sheet {
        fill: $sheet;
        stroke: $sheet-line;
        stroke-width: 1.5;
        vector-effect: non-scaling-stroke;
        pointer-events: none;

        // Coupe calculée : le contour d'origine ne reste qu'en pointillé pâle.
        &--ghost {
            fill: none;
            stroke: rgba(201, 210, 227, 0.55);
            stroke-width: 1;
            stroke-dasharray: 4 3;
        }
    }

    // Ce qui reste de la tôle : trait plein, bien visible.
    &__cut {
        pointer-events: none;

        &--stale { opacity: 0.45; }
    }
    &__kept {
        fill: $sheet;
        stroke: $kept-line;
        stroke-width: 2.5;
        vector-effect: non-scaling-stroke;
    }
    // Morceau perdu : grisé, pointillé.
    &__lost {
        fill: $lost-fill;
        stroke: $lost-line;
        stroke-width: 1.5;
        stroke-dasharray: 5 3;
        vector-effect: non-scaling-stroke;
        pointer-events: all;
    }

    &__defect {
        fill: $red-fill;
        stroke: $red;
        stroke-width: 2;
        vector-effect: non-scaling-stroke;
        transition: fill 0.15s;

        &--hover {
            fill: rgba(220, 38, 38, 0.62);
            stroke-width: 3;
        }
        &--inert { pointer-events: none; }
    }
    // Tracé en cours.
    &__draft {
        fill: rgba(220, 38, 38, 0.18);
        stroke: $red;
        stroke-width: 1.5;
        stroke-dasharray: 4 3;
        vector-effect: non-scaling-stroke;
        pointer-events: none;
    }
    &__dot {
        fill: #fff;
        stroke: $red;
        stroke-width: 1.5;
        pointer-events: none;
    }
    // Anneau du premier point : un clic dedans ferme le contour.
    &__first {
        fill: none;
        stroke: #fff;
        stroke-width: 2;
        pointer-events: none;
    }
    &__live {
        fill: #fff;
        font-size: 13px;
        font-weight: 600;
        paint-order: stroke;
        stroke: $canvas;
        stroke-width: 4px;
        stroke-linejoin: round;
        pointer-events: none;
        user-select: none;
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
        &--tiny,
        &--inert {
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
        &--forbidden,
        &--defect {
            background-color: $red-fill;
            border-color: $red;
        }
        &--lost {
            background-color: $lost-fill;
            border: 1px dashed $lost-line;
        }
    }
}
</style>
