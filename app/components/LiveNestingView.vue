<template>
    <div class="live" :class="{ 'live--compact': compact }">
        <!-- Header: stage + badge on the left, stats on the right — all
             high-contrast text on the panel background. -->
        <div class="live__header">
            <span class="live__stage">{{ stageLabel }}</span>
            <span v-if="badgeKind" class="live__badge" :class="{ 'live__badge--ok': badgeKind !== 'searching' }">
                {{ badgeText }}
            </span>
            <span v-if="partialLine" class="live__partial" data-testid="live-partial">{{ partialLine }}</span>
            <span class="live__spacer" />
            <!-- U3 passe 3 (plan U2 reporté deux fois) : les statistiques de
                 l'en-tête live sont des `UiStat` — valeur en chiffres
                 tabulaires SOUS un libellé visible (AGENTS #24 : jamais un
                 nombre nu).
                 C12 (audit UX 2026-09-05) : le compteur « n combinaisons »
                 reste retiré — itérations de recuit BPP et évaluations
                 separator SPP ne sont pas comparables. -->
            <div class="live__stats" data-testid="live-stats">
                <UiStat
                    v-if="elapsedSec != null"
                    :value="formatElapsed(elapsedSec, locale)"
                    :label="t('live.elapsed')"
                    :title="t('live.elapsedTitle')"
                    data-testid="live-stat-elapsed"
                />
                <UiStat
                    v-if="scoreLabel"
                    class="live__stat--accent"
                    :value="scoreLabel"
                    :label="t('live.score')"
                    :title="t('live.scoreTitle')"
                    data-testid="live-stat-density"
                />
                <UiStat
                    v-if="usedLengthLabel"
                    :value="usedLengthLabel"
                    :label="t('live.width')"
                    :title="t('live.widthTitle')"
                    data-testid="live-stat-length"
                />
                <UiStat
                    v-if="sheetCount"
                    :value="sheetCount"
                    :label="t('live.sheets')"
                    data-testid="live-stat-sheets"
                />
                <UiStat
                    v-if="cores"
                    :label="t('live.cores')"
                    :title="t('nest.coresTitle', { n: cores })"
                    data-testid="live-stat-cores"
                >
                    <CoresSpinner :cores="cores" :size="16" show-count />
                </UiStat>
            </div>
        </div>

        <div class="live__body">
            <!-- Main view: champion of the selected strategy (default: left).
                 BPP : une tôle par panneau côte à côte (jusqu'à
                 MAX_LIVE_SHEETS) — l'ancien rendu ignorait l'index de
                 tôle des items et superposait tout sur un seul contour. -->
            <svg
                v-if="sheet"
                :viewBox="viewBox"
                class="live__sheet"
                preserveAspectRatio="xMidYMid meet"
            >
                <g
                    v-for="pane in mainPanes.panes"
                    :key="pane.bin"
                    :transform="`translate(${pane.dx} 0)`"
                >
                    <g :transform="pane.landscape">
                        <!-- Un rectangle de découpe PAR panneau, à la taille de SA
                             tôle : un seul rectangle à la taille de la première
                             tôle rognait les pièces de toute tôle plus grande
                             (formats mélangés). -->
                        <defs>
                            <clipPath :id="paneClipId('m', pane.bin)">
                                <rect x="0" y="0" :width="pane.w" :height="pane.h" />
                            </clipPath>
                        </defs>
                        <!-- Tôle importée : vrai contour (le reste de la boîte n'est
                             pas de la tôle) + zones interdites rouges, SOUS les
                             pièces. Format du rang inconnu : rectangle. -->
                        <template v-if="mainPaneShapes.get(pane.bin)">
                            <path :d="mainPaneShapes.get(pane.bin).outline" class="live__sheet-bg" fill-rule="evenodd" />
                            <g v-if="mainPaneShapes.get(pane.bin).zones" data-testid="live-zones">
                                <defs>
                                    <pattern
                                        :id="hatchId('m', pane.bin)"
                                        patternUnits="userSpaceOnUse"
                                        :width="liveHatchPitch(pane)"
                                        :height="liveHatchPitch(pane)"
                                        patternTransform="rotate(45)"
                                    >
                                        <line x1="0" y1="0" x2="0" :y2="liveHatchPitch(pane)" :stroke="ZONE_RED" :stroke-width="liveHatchPitch(pane) * 0.12" />
                                    </pattern>
                                </defs>
                                <path :d="mainPaneShapes.get(pane.bin).zones" :fill="ZONE_RED" fill-opacity="0.18" fill-rule="evenodd" />
                                <path :d="mainPaneShapes.get(pane.bin).zones" :fill="`url(#${hatchId('m', pane.bin)})`" :stroke="ZONE_RED" stroke-width="1.2" fill-rule="evenodd" />
                            </g>
                        </template>
                        <rect v-else x="0" y="0" :width="pane.w" :height="pane.h" class="live__sheet-bg" />
                        <g :clip-path="`url(#${paneClipId('m', pane.bin)})`">
                            <!-- Lot J8-b : la pièce ET ses amorces vivent dans
                                 le MÊME groupe transformé — translate(x, H−y)
                                 scale(1,-1) rotate(θ), jamais une autre
                                 formule, sinon les amorces dériveraient à
                                 chaque rotation (piège #20b). -->
                            <g
                                v-for="(item, i) in mainItemsByBin.get(pane.bin) || []"
                                :key="i"
                                :transform="partTransform(item, pane.h)"
                            >
                                <path
                                    :d="item.d"
                                    class="live__part"
                                    :fill="item.color"
                                    :fill-opacity="partFillOpacity"
                                    :stroke="item.color"
                                    fill-rule="evenodd"
                                />
                                <path
                                    v-for="(lead, j) in item.leads || []"
                                    :key="'lead' + j"
                                    :d="lead.d"
                                    :class="`live__lead--${lead.kind}`"
                                />
                            </g>
                        </g>
                        <text
                            v-if="!mainItems.length && pane.bin === mainPanes.panes[0].bin"
                            :x="pane.w / 2"
                            :y="pane.h / 2"
                            text-anchor="middle"
                            class="live__placeholder"
                            :style="{ fontSize: `${placeholderSize(pane)}px` }"
                        >
                            {{ t('live.waiting') }}
                        </text>
                    </g>
                    <SheetAxes :width="pane.w" :height="pane.h" />
                </g>
                <text
                    v-if="mainPanes.truncated"
                    :x="mainPanes.totalW - mainPanes.gap / 2"
                    :y="mainPanes.totalH / 2"
                    text-anchor="middle"
                    class="live__placeholder"
                >
                    +{{ mainPanes.truncated }}
                </text>
            </svg>

            <!-- One card per strategy: its own champion-locked track. Click
                 to make it the main view. -->
            <div v-if="classCards.length > 1" class="live__cards">
                <button
                    v-for="card in classCards"
                    :key="card.cls"
                    class="live__card"
                    :class="{ 'live__card--active': card.cls === selected }"
                    :title="t(`settings.directions.${card.cls}Hint`)"
                    @click="selected = card.cls"
                >
                    <span class="live__card-label">{{ t(`settings.directions.${card.cls}`) }}</span>
                    <svg
                        v-if="card.champ && sheet"
                        :viewBox="`0 0 ${card.panes.totalW} ${card.panes.totalH}`"
                        class="live__card-sheet"
                        preserveAspectRatio="xMidYMid meet"
                    >
                        <g
                            v-for="pane in card.panes.panes"
                            :key="pane.bin"
                            :transform="`translate(${pane.dx} 0)`"
                        >
                            <g :transform="pane.landscape">
                                <template v-if="card.paneShapes.get(pane.bin)">
                                    <path :d="card.paneShapes.get(pane.bin).outline" class="live__sheet-bg" fill-rule="evenodd" />
                                    <path
                                        v-if="card.paneShapes.get(pane.bin).zones"
                                        :d="card.paneShapes.get(pane.bin).zones"
                                        :fill="ZONE_RED"
                                        fill-opacity="0.3"
                                        :stroke="ZONE_RED"
                                        stroke-width="1.2"
                                        fill-rule="evenodd"
                                    />
                                </template>
                                <rect v-else x="0" y="0" :width="pane.w" :height="pane.h" class="live__sheet-bg" />
                                <defs>
                                    <clipPath :id="paneClipId(card.cls, pane.bin)">
                                        <rect x="0" y="0" :width="pane.w" :height="pane.h" />
                                    </clipPath>
                                </defs>
                                <g :clip-path="`url(#${paneClipId(card.cls, pane.bin)})`">
                                    <g
                                        v-for="(item, i) in card.paneItems.get(pane.bin) || []"
                                        :key="i"
                                        :transform="partTransform(item, pane.h)"
                                    >
                                        <path
                                            :d="item.d"
                                            class="live__part"
                                            :fill="item.color"
                                            :fill-opacity="partFillOpacity"
                                            :stroke="item.color"
                                            fill-rule="evenodd"
                                        />
                                        <path
                                            v-for="(lead, j) in item.leads || []"
                                            :key="'lead' + j"
                                            :d="lead.d"
                                            :class="`live__lead--${lead.kind}`"
                                        />
                                    </g>
                                </g>
                            </g>
                        </g>
                    </svg>
                    <span v-if="card.champ" class="live__card-metric">
                        <template v-if="frameDensity(card.champ) != null">{{ formatScore(frameDensity(card.champ)) }}</template>
                        <template v-else-if="card.champ.strip_width != null">{{ fmtLength(card.champ.strip_width) }}</template>
                        <template v-else-if="card.champ.bins != null">{{ t('live.sheets') }} {{ card.champ.bins }}</template>
                    </span>
                    <span v-else class="live__card-metric live__card-metric--pending">…</span>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
/**
 * Real-time nesting visualizer. One champion-locked track per directional
 * strategy (left / bottom / balanced — champions only ever get REPLACED by
 * strictly better layouts that fit the sheet, so the animation is monotone
 * and calm). The main view shows the selected strategy's champion; the
 * right cards let you compare all three strategies live.
 *
 * Working states (sparrow separations: over-width, pieces outside the
 * strip) are never displayed: a champion locks only on fitsSheet snapshots
 * and everything is clipped to the sheet rect.
 */
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import {
    engineToDisplay,
    livePaneLayout,
    sheetAxesDisplay,
} from '~/utils/sheetView';
// Lot J8-b : la géométrie des amorces (mêmes trajets que la réserve).
import { drawingLeadShapes } from '~~/shared/sheetcamReserve.js';
// Champion live partagé avec le registre de solves (R-6 audit 2026-08-31) :
// une seule définition de « meilleure frame » — la couche registre filtrait
// en égalité stricte et la vue ne voyait plus que des frames déjà meilleures.
import { frameFitsSheet as fitsSheet, frameIsBetter as isBetter, resolveLiveStage, liveBadgeKind, liveUsedLength, liveDensity, isPartialBppFrame, partialPlacedCount, PARTIAL_DELAY_SEC } from '~/utils/liveJob';
import { formatElapsed } from '~/utils/elapsedFormat';
import { ZONE_RED, livePaneShape, liveHatchId, liveHatchPitch } from '~/utils/sheetDraw';

const props = defineProps({
    result: { type: Object, required: true },
    compact: { type: Boolean, default: false },
    // Le job ENTIER est fini (posé par la page d'après l'état réel du calcul).
    // Seul ce signal autorise « Terminé » ; une frame `final` ne suffit pas.
    jobDone: { type: Boolean, default: false },
    // Calcul dans CE navigateur : seul cas où la meilleure disposition
    // partielle peut remplacer le message d'attente (jamais un résultat serveur).
    localCompute: { type: Boolean, default: false },
    // Pièces demandées au total, donné par la page ; null = inconnu, pas de ligne.
    partialTotal: { type: Number, default: null },
});

const { t, fmtPercent, locale } = useLocale();
// strip_width arrives in canonical mm — fmtLength converts at display.
const { fmtLength } = useUnit();
// NOTE: bare $fetch (Nuxt auto-import) — nuxtApp.$fetch is not reliable
// everywhere; a failed fetch here silently empties the whole render.


// ---- part geometry cache ---------------------------------------------------
const geometryCache = ref({}); // fileSlug -> [{d, color}]
const pendingSlugs = new Set();

// Parts are filled with their own display color at low opacity (CAD-style:
// the stroke carries the full color, holes stay readable through the fill).
const partFillOpacity = 0.35;
const FALLBACK_PART_COLOR = 'rgb(37, 99, 235)';

async function ensureGeometry(slug) {
    if (!slug || geometryCache.value[slug] || pendingSlugs.has(slug)) return;
    pendingSlugs.add(slug);
    try {
        // J-090 : un fichier « 100 % privé » n'a AUCUNE géométrie côté
        // serveur — sa source de vérité est IndexedDB (même forme de parts).
        const { getLocalFile } = await import('~/composables/localFilesStore');
        const local = await getLocalFile(slug).catch(() => null);
        const rawParts = local?.parts
            || (await $fetch(`/api/files/project/geometry/${slug}`)).parts;
        const parts = (rawParts || []).map((p) => ({
            d: ringsToPath([p.coordinates, ...(p.holes || [])]),
            // Assigned at import; the geometry route always resolves one
            // (deterministic fallback for legacy files).
            color: p.color || FALLBACK_PART_COLOR,
        }));
        // Lot J8-b — les AMORCES d'une fiche `.job`, en coordonnées du
        // dessin (y-up : le flip vient du transform du groupe, piège #20b).
        // Une fiche ordinaire n'en a PAS : rien n'est ajouté (§9.73 point 11
        // — jamais d'amorce inventée). Un point non posable est omis.
        const leadsByPart = leadPathsForRecord(local);
        if (leadsByPart) {
            parts.forEach((p, k) => { p.leads = leadsByPart[k] || []; });
        }
        geometryCache.value = { ...geometryCache.value, [slug]: parts };
    } catch (e) {
        // 404 = fichier vraiment absent (projet local inconnu de CE
        // navigateur, ou purge 24 h) : négatif-cacher pour ne pas tempêter
        // l'endpoint à chaque frame live. Erreurs réseau transitoires : on
        // retentera au prochain frame (comportement historique).
        if (e?.response?.status === 404) {
            geometryCache.value = { ...geometryCache.value, [slug]: [] };
        }
        console.warn('geometry fetch failed', slug, e);
    } finally {
        pendingSlugs.delete(slug);
    }
}

function ringsToPath(rings) {
    return rings
        .filter((r) => r && r.length > 2)
        .map((ring) => 'M' + ring.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('L') + 'Z')
        .join(' ');
}

// Lot J8-b — amorces d'un record local `.job` en chemins SVG, par pièce.
// Rend null pour une fiche sans `.job` (aucun `leads` posé sur le cache),
// et des entrées `{ d, kind }` sinon : kind 'stroke' (trajet CERTAIN,
// trait fin sans remplissage), 'zone' (éventail tangent TRANSLUCIDE — la
// règle exacte n'est pas mesurée, une droite serait un mensonge),
// 'pierce' (disque de perçage en pointillé).
function leadPathsForRecord(record) {
    const sc = record?.sheetcam;
    if (!sc || !Array.isArray(sc.starts) || !sc.starts.length) return null;
    const rings = [];
    const isHole = [];
    const ringPart = [];
    (record.parts || []).forEach((p, k) => {
        rings.push(p.coordinates); isHole.push(false); ringPart.push(k);
        for (const h of p.holes || []) {
            rings.push(h); isHole.push(true); ringPart.push(k);
        }
    });
    let shapes;
    try {
        shapes = drawingLeadShapes({
            rings, isHole,
            starts: sc.starts,
            origin: sc.origin || null,
            kerf: Number(sc.kerfWidth) || 0,
            leadIn: Number(sc.leadIn) || 0,
            leadInType: Number(sc.leadInType) || 0,
            leadOut: Number(sc.leadOut) || 0,
            leadOutType: Number(sc.leadOutType) || 0,
        });
    } catch {
        return null;
    }
    const byPart = {};
    for (const s of shapes) {
        const k = ringPart[s.ringIndex];
        if (k == null) continue;
        (byPart[k] = byPart[k] || []).push(...leadToPaths(s));
    }
    return byPart;
}

function leadToPaths(shape) {
    const out = [];
    const toD = (pts) => 'M' + pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('L');
    for (const side of [shape.inPath, shape.outPath]) {
        if (side?.points?.length > 1) out.push({ d: toD(side.points), kind: 'stroke' });
        if (side?.zone?.length > 2) out.push({ d: toD(side.zone) + 'Z', kind: 'zone' });
    }
    if (shape.pierce && Number.isFinite(shape.pierce.r) && shape.pierce.r > 0) {
        const [cx, cy] = shape.pierce.c;
        const r = shape.pierce.r;
        out.push({
            d: `M${(cx - r).toFixed(2)} ${cy.toFixed(2)}A${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(cx + r).toFixed(2)} ${cy.toFixed(2)}A${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(cx - r).toFixed(2)} ${cy.toFixed(2)}Z`,
            kind: 'pierce',
        });
    }
    return out;
}

// SVG is y-down, the engine frame is y-up: translate(x, H - y) scale(1, -1)
// rotate(deg) lands the part exactly where the production DXF (and the dxf
// viewer) puts it. Without the flip the live view renders vertically
// mirrored against the final result.
function partTransform(item, sheetHeight) {
    return `translate(${item.x} ${sheetHeight - item.y}) scale(1 -1) rotate(${item.rot})`;
}

function buildItems(snap, itemMap, cache) {
    if (!snap?.items?.length || !itemMap) return [];
    const byId = Object.fromEntries(itemMap.map((m) => [m.id, m]));
    const out = [];
    for (const raw of snap.items) {
        let id, bin, rot, x, y;
        if (raw.length === 5) [id, bin, rot, x, y] = raw; // BPP
        else [id, rot, x, y] = raw; // SPP
        const m = byId[id];
        // E4-a : un item BLOC couvre toutes les pièces de sa fiche —
        // chacune est dessinée sous la MÊME pose (dessin rigide, `parts`
        // porté par l'entrée itemMap). Un bloc sans géométrie en cache
        // ne dessine RIEN plutôt qu'une seule lettre trompeuse.
        const n = m?.parts || 1;
        if (n > 1) {
            const all = cache[m.slug] || [];
            for (let k = 0; k < n; k++) {
                const part = all[k];
                if (!part) continue;
                out.push({ d: part.d, color: part.color || FALLBACK_PART_COLOR, leads: part.leads, rot, x, y, bin: bin ?? 0 });
            }
            continue;
        }
        const part = m && cache[m.slug]?.[m.part];
        if (!part) continue;
        // bin conservé (0 pour le SPP) : le rendu BPP répartit les pièces
        // par tôle au lieu de les superposer sur le contour unique.
        out.push({ d: part.d, color: part.color || FALLBACK_PART_COLOR, leads: part.leads, rot, x, y, bin: bin ?? 0 });
    }
    return out;
}

// ---- snapshots & champion locks (per strategy) ------------------------------
const snapshots = ref({}); // worker -> liveLayout
// One champion per strategy class ('left'|'bottom'|'balanced'|'best').
const champions = ref({});
let pendingChamps = {};
let champTimer = null;
// Meilleure frame BPP partielle vue (moins de pièces non posées). Jamais un
// champion : elle ne sert que tant qu'aucune frame ne tient.
const partialChamp = ref(null);

const DIRECTION_CLASSES = ['left', 'bottom', 'balanced'];

const clipId = `sheet-clip-${Math.random().toString(36).slice(2, 9)}`;

// fitsSheet (présentabilité : bande qui tient dans la tôle) et isBetter
// (ordre de qualité strict du champion) viennent de utils/liveJob.js —
// partagés avec le filtre de frames du registre de solves.

function offerChampion(live) {
    if (typeof window !== 'undefined') {
        window.__champOffers = (window.__champOffers || 0) + 1;
    }
    // Never lock onto a working state: only layouts that FIT the sheet may
    // become champion — mid-search separation states (over-width, pieces
    // spilling out) are working states, not presentable layouts.
    if (!fitsSheet(live)) return;
    // V6 (vérif 2026-09-04) : une frame FINALE/reveal (résultat
    // post-passé) remplace TOUTES les classes, sans passer par isBetter —
    // sans bias elle atterrissait dans 'best', jamais affichée en −X
    // (selected = 'left') : le panneau vivait « Optimizing sheets » sur
    // une frame moteur dentelée pendant que le modal montrait le final.
    const isFinal = live.stage === 'final' || live.stage === 'reveal';
    if (isFinal) {
        for (const cls of [...DIRECTION_CLASSES, 'best']) {
            pendingChamps[cls] = live;
        }
        if (champTimer) return;
        champTimer = setTimeout(() => {
            champTimer = null;
            const next = { ...champions.value };
            for (const [k, v] of Object.entries(pendingChamps)) {
                if (isBetter(v, next[k]) || v.stage === 'final' || v.stage === 'reveal') next[k] = v;
            }
            champions.value = next;
            pendingChamps = {};
        }, 150);
        return;
    }
    const cls = DIRECTION_CLASSES.includes(live.bias) ? live.bias : 'best';
    if (!isBetter(live, pendingChamps[cls] || champions.value[cls])) return;
    pendingChamps[cls] = live;
    if (champTimer) return;
    champTimer = setTimeout(() => {
        champTimer = null;
        if (typeof window !== 'undefined') {
            window.__champSwaps = (window.__champSwaps || 0) + 1;
        }
        const next = { ...champions.value };
        for (const [k, v] of Object.entries(pendingChamps)) {
            if (isBetter(v, next[k])) next[k] = v;
        }
        champions.value = next;
        pendingChamps = {};
    }, 150);
}

// The displayed strategy: 'left' by default when directions exist (option 1
// = the historical layout), 'best' on legacy jobs. Clickable via the cards.
const selected = ref('best');

// New job: wipe everything so no stale layout from the previous run leaks.
watch(
    () => props.result?.slug,
    () => {
        snapshots.value = {};
        champions.value = {};
        pendingChamps = {};
        partialChamp.value = null;
        selected.value = 'best';
        if (champTimer) {
            clearTimeout(champTimer);
            champTimer = null;
        }
    }
);

onBeforeUnmount(() => {
    if (champTimer) clearTimeout(champTimer);
});

watch(
    () => props.result?.liveLayout,
    (live) => {
        if (!live) return;
        if (live.worker != null) {
            snapshots.value = { ...snapshots.value, [live.worker]: live };
        }
        offerChampion(live);
        if (isPartialBppFrame(live) && isBetter(live, partialChamp.value)) {
            partialChamp.value = live;
        }
        // Default the main view to the left strategy as soon as it exists.
        if (selected.value === 'best' && champions.value.left) {
            selected.value = 'left';
        }
        const map = props.result?.itemMap || [];
        for (const m of map) ensureGeometry(m.slug);
    },
    { immediate: true, deep: true }
);

// ---- views ------------------------------------------------------------------
// Meilleure disposition qui TIENT (champion, sinon snapshot qui tient), ou null.
const fittingBest = computed(() => {
    const champ = champions.value[selected.value];
    if (champ) return champ;
    // The selected strategy has no champion yet: show the best available
    // champion of ANY class (a strategy that is still exploring over-width
    // must never leave the main view empty while others have layouts).
    const anyChamp = Object.values(champions.value);
    if (anyChamp.length) {
        return anyChamp.sort((a, b) => (isBetter(a, b) ? -1 : 1))[0];
    }
    // Last resort: the best FITTING snapshot of the selected class (never a
    // mid-search working state).
    const fitting = Object.values(snapshots.value).filter((s) => {
        const cls = DIRECTION_CLASSES.includes(s.bias) ? s.bias : 'best';
        return cls === selected.value && fitsSheet(s);
    });
    if (!fitting.length) return null;
    return fitting.sort((a, b) => (isBetter(a, b) ? -1 : 1))[0];
});

// Meilleure disposition PARTIELLE à dessiner : seulement pour un calcul dans
// ce navigateur, quand aucune frame ne tient depuis PARTIAL_DELAY_SEC. Dès
// qu'une frame tient, fittingBest existe et la vue est celle d'avant.
const partialBest = computed(() => {
    if (!props.localCompute || fittingBest.value || !partialChamp.value) return null;
    const sec = elapsedSec.value;
    return sec != null && sec >= PARTIAL_DELAY_SEC ? partialChamp.value : null;
});
const isPartialView = computed(() => !fittingBest.value && !!partialBest.value);
const best = computed(() => fittingBest.value || partialBest.value || null);

const partialLine = computed(() => {
    if (!isPartialView.value) return null;
    const total = Number(props.partialTotal);
    if (!Number.isFinite(total) || total <= 0) return null;
    const placed = partialPlacedCount(best.value, props.result?.itemMap, geometryCache.value);
    // 0 = géométrie pas encore chargée : rien n'est dessiné, pas de « 0 sur m ».
    return placed > 0 ? t('live.partial', { placed, total }) : null;
});

const liveStage = computed(() => resolveLiveStage(props.result, best.value?.stage));
const badgeKind = computed(() => (best.value ? liveBadgeKind(best.value, props.jobDone) : null));
const badgeText = computed(() => ({
    done: t('live.feasible'),
    fits: t('live.fitsSheet'),
    searching: t('live.searching'),
})[badgeKind.value]);

const sheet = computed(() => {
    const b = best.value;
    if (b?.sheets?.length) return b.sheets[0];
    const anySnap = Object.values(snapshots.value)[0];
    return anySnap?.sheets?.[0] || null;
});

const mainItems = computed(() =>
    buildItems(best.value, props.result?.itemMap, geometryCache.value)
);

function pathCoords(d) {
    const nums = []
    const re = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi
    let m
    while ((m = re.exec(d || ''))) nums.push(Number(m[0]))
    return nums
}

function itemLocalCorners(item) {
    const nums = pathCoords(item.d)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = nums[i]
        const y = nums[i + 1]
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
    }
    if (!Number.isFinite(minX)) return []
    return [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
    ]
}

function mapPlacedEngine(px, py, item) {
    const rad = ((item.rot || 0) * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    const rx = px * c - py * s
    const ry = px * s + py * c
    return [item.x + rx, item.y + ry]
}

// ---- BPP : panneaux (une tôle visible par panneau) ---------------------------
// Plafond d'affichage — au-delà, les tôles restantes ne sont pas dessinées
// et un « +N » l'indique (limite de visualisation demandée 2026-09-01).
const MAX_LIVE_SHEETS = 6;

function paneLayoutFor(snap, items) {
    const sheets = snap?.sheets?.length ? snap.sheets : (sheet.value ? [sheet.value] : [[1, 1]]);
    return livePaneLayout(sheets, items.map((it) => it.bin ?? 0), MAX_LIVE_SHEETS);
}

function itemsByPane(panes, items) {
    const map = new Map(panes.panes.map((p) => [p.bin, []]));
    for (const it of items) {
        const arr = map.get(it.bin ?? 0);
        if (arr) arr.push(it);
    }
    return map;
}

const mainPanes = computed(() => paneLayoutFor(best.value, mainItems.value));
const mainItemsByBin = computed(() => itemsByPane(mainPanes.value, mainItems.value));

// Tôle importée : forme à dessiner par panneau (rang de tôle -> { outline,
// zones }). Un rang dont le format n'est pas connu n'y figure pas : il garde
// son rectangle plutôt qu'une forme fausse.
function shapesByPane(frame, panes) {
    const map = new Map();
    for (const pane of panes.panes) {
        const shape = livePaneShape(frame, pane);
        if (shape) map.set(pane.bin, shape);
    }
    return map;
}
// Rien de présentable encore : la forme vient de la première frame reçue (mêmes
// règles, un seul format connu), pas un rectangle qui deviendrait un disque.
const mainPaneShapes = computed(() => shapesByPane(best.value || Object.values(snapshots.value)[0], mainPanes.value));
// Texte d'attente : en unités de la tôle, il doit tenir dans un petit panneau.
const placeholderSize = (pane) => Math.min(32, pane.w / 18);
const paneClipId = (cardKey, bin) => `${clipId}-${String(cardKey).replace(/[^a-zA-Z0-9_-]/g, '')}-${bin}`;
const hatchViewId = `live-${clipId}`;
const hatchId = (cardKey, bin) => liveHatchId(hatchViewId, cardKey, bin);

// Zoom onto the used region in DISPLAY space. Axes stay in frame (origin
// is always included). Export geometry is unchanged.
const viewBox = computed(() => {
    const s = sheet.value
    if (!s) return '0 0 1 1'
    const pl = mainPanes.value
    const totalW = pl.totalW
    const totalH = Math.max(pl.totalH, 1)
    const full = `0 0 ${totalW} ${totalH}`
    const items = mainItems.value
    if (!items.length) return full
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const include = (x, y) => {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
    }
    for (const pane of pl.panes) {
        const ax = sheetAxesDisplay(pane.w, pane.h)
        include(pane.dx + ax.origin.x, ax.origin.y)
        include(pane.dx + ax.xTo.x, ax.xTo.y)
        include(pane.dx + ax.yTo.x, ax.yTo.y)
    }
    const paneByBin = new Map(pl.panes.map((p) => [p.bin, p]))
    for (const item of items) {
        const pane = paneByBin.get(item.bin ?? 0)
        // Tôle au-delà du plafond d'affichage : non dessinée, hors zoom.
        if (!pane) continue
        for (const [px, py] of itemLocalCorners(item)) {
            const [ex, ey] = mapPlacedEngine(px, py, item)
            const [dx, dy] = engineToDisplay(ex, ey, pane.w, pane.h)
            include(pane.dx + dx, dy)
        }
    }
    if (!Number.isFinite(minX)) return full
    const bw = Math.max(1, maxX - minX)
    const bh = Math.max(1, maxY - minY)
    if ((bw * bh) / (totalW * totalH) >= 0.4) return full
    const pad = Math.max(bw, bh) * 0.14 + Math.max(totalW, totalH) * 0.02
    const vx = Math.max(0, minX - pad)
    const vy = Math.max(0, minY - pad)
    const vw = Math.min(totalW - vx, bw + pad * 2)
    const vh = Math.min(totalH - vy, bh + pad * 2)
    return `${vx} ${vy} ${vw} ${vh}`
});

// One card per observed/declared strategy, each with its own champion.
const classCards = computed(() => {
    const declared = props.result?.compute?.directions;
    const observed = new Set(
        Object.values(snapshots.value)
            .map((s) => s.bias)
            .filter((b) => DIRECTION_CLASSES.includes(b))
    );
    const classes = DIRECTION_CLASSES.filter(
        (c) => observed.has(c) || (Array.isArray(declared) && declared.includes(c))
    );
    return classes.map((cls) => {
        const champ = champions.value[cls] || null;
        const items = buildItems(champ, props.result?.itemMap, geometryCache.value);
        const panes = paneLayoutFor(champ, items);
        return {
            cls,
            champ,
            items,
            panes,
            paneItems: itemsByPane(panes, items),
            paneShapes: shapesByPane(champ, panes),
        };
    });
});

// ---- header stats -------------------------------------------------------------
const cores = computed(() => {
    const n = props.result?.compute?.vcores;
    return n ? Math.min(8, Math.max(1, Number(n) || 1)) : null;
});

// Job clock from the worker's progress heartbeat — NOT the champion's
// event timestamp (an early near-optimal champion would freeze it at 0s).
const elapsedSec = computed(() => {
    const n = props.result?.progress?.elapsed_sec;
    return n != null ? Number(n) : null;
});

// Densité d'une frame, ou null quand elle ne peut pas être celle du résultat
// (frame d'un ancien worker serveur : densité brute du moteur).
function frameDensity(frame) {
    return liveDensity(frame, props.result);
}

function formatScore(density) {
    const n = Number(density);
    if (!Number.isFinite(n)) return null;
    return fmtPercent(n * 100);
}

// U3 passe 3 : nombre de tôles du meilleur agencement courant (BPP) —
// « layouts » de l'en-tête du plan.
// Rien de dessiné ou une disposition partielle : pas de nombre de tôles.
const sheetCount = computed(() => {
    if (isPartialView.value) return null;
    const n = Number(best.value?.bins);
    return Number.isFinite(n) && n > 0 ? n : null;
})

// SPP en recherche : la longueur de tôle utilisée diminue quand le moteur
// progresse (la densité d'en-tête, elle, reste constante).
const usedLengthLabel = computed(() => {
    const mm = liveUsedLength(best.value, liveStage.value);
    return mm != null ? fmtLength(mm) : null;
})

const scoreLabel = computed(() => {
    if (isPartialView.value) return null;
    const d = frameDensity(best.value);
    return d != null ? formatScore(d) : null;
})

// C12 (audit UX 2026-09-05) : les compteurs « combinaisons » (itérations
// de recuit BPP / évaluations separator SPP — unités différentes, nombre
// non crédible comme indicateur) sont retirés de l'en-tête.

const stageLabel = computed(() => {
    const stage = resolveLiveStage(props.result, best.value?.stage);
    if (!stage) return t('results.nesting');
    // Plan « dernière tôle » §8.3.3 : la fusion refait la tôle partielle
    // dans la direction demandée — ça dure, il faut le dire.
    if (stage === 'bpp-finish') return t('live.finishing');
    const key = `progress.stage.${stage}`;
    const translated = t(key);
    return translated === key ? stage : translated;
});

</script>

<style lang="scss" scoped>
// Explicit, readable palette: the panel inherits the app theme (dark in some
// setups), so the CANVAS is forced light — a clean CAD-style render where
// parts and text are always legible.
.live {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;

    &__header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        min-width: 0;
        font-size: var(--fs-13);
        color: var(--label-primary);
    }

    &__stage {
        font-weight: 700;
        color: var(--label-primary);
    }

    &__partial {
        font-size: var(--fs-12);
        color: var(--label-secondary);
    }

    &__badge {
        padding: 2px 9px;
        font-size: var(--fs-12);
        font-weight: 700;
        border-radius: var(--radius-l);
        background: var(--warn);
        color: var(--surface);

        &--ok {
            background: var(--ok);
        }
    }

    &__spacer {
        flex: 1;
    }

    /* U3 passe 3 : rangée de UiStat alignée à droite de l'en-tête. */
    &__stats {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--sp-2) var(--sp-4);
        min-width: 0;
        max-width: 100%;

        // Téléphone : les statistiques passent sous le titre et à la ligne,
        // libellés entiers (compteur de cœurs compris), au lieu d'une rangée
        // unique coupée par le bord de l'écran.
        @media (max-width: 640px) {
            flex: 1 1 100%;
            gap: var(--sp-2) var(--sp-3);
        }
    }

    &__stat--accent :deep(.ui-stat__value) {
        color: var(--accent-primary);
    }

    &__body {
        display: flex;
        gap: 10px;
        align-items: stretch;
    }

    // The CAD canvas: light, always (AGENTS #21 — never theme vars here).
    &__sheet {
        flex: 1;
        min-height: 280px;
        max-height: min(52vh, 560px);
        border: 1px solid var(--border);
        border-radius: var(--radius-l);
        background: var(--surface-2);
    }

    &__sheet-bg {
        fill: var(--surface);
        stroke: var(--accent);
        stroke-width: 1;
    }

    &__part {
        // fill/stroke come from the per-part color bound inline — a CSS rule
        // here would override the SVG presentation attributes.
        stroke-width: 1.2;
        transition: transform 0.18s ease, fill 0.2s ease, stroke 0.2s ease;
    }

    // Lot J8-b — une amorce n'est PAS de la matière (§9.73 point 9) :
    // trait fin ambré sans remplissage pour les trajets certains, zone
    // TRANSLUCIDE pour l'éventail tangent, disque de perçage en pointillé.
    // Couleurs EXPLICITES (piège #21 : jamais les vars de thème) — l'ambre
    // est distinct de la palette des pièces et lisible sur les deux thèmes.
    &__lead--stroke {
        fill: none;
        stroke: #D97706;
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
    }

    &__lead--zone {
        fill: rgba(217, 119, 6, 0.18);
        stroke: rgba(217, 119, 6, 0.55);
        stroke-width: 0.6;
        vector-effect: non-scaling-stroke;
    }

    &__lead--pierce {
        fill: rgba(217, 119, 6, 0.08);
        stroke: #D97706;
        stroke-width: 1;
        stroke-dasharray: 3 2;
        vector-effect: non-scaling-stroke;
    }

    &__cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 132px;
        flex-shrink: 0;
    }

    &__card {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 4px;
        padding: 8px;
        border: 1.5px solid var(--separator-secondary);
        border-radius: var(--radius-l);
        background: var(--background-primary, var(--surface));
        cursor: pointer;
        transition: border-color 0.2s, box-shadow 0.2s;

        &--active {
            border-color: var(--accent-primary, var(--accent));
            box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary, var(--accent)) 18%, transparent);
        }

        @media (hover: hover) {
            &:hover {
                border-color: var(--accent-primary, var(--accent));
            }
        }
    }

    &__card-label {
        font-size: var(--fs-12);
        font-weight: 700;
        color: var(--label-primary);
        text-align: left;
    }

    &__placeholder {
        fill: var(--text-3);
        font-size: var(--fs-32);
        font-weight: 600;
    }

    &__card-sheet {
        width: 100%;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface-2);
    }

    &__card-metric {
        font-size: var(--fs-12);
        color: var(--label-secondary);
        font-variant-numeric: tabular-nums;
        text-align: left;

        &--pending {
            color: var(--label-tertiary);
        }
    }
}
</style>
