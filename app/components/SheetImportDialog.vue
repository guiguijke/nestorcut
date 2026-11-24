<template>
    <DialogWrapper
        :isModalOpen="open"
        trackingTag="sheet_import"
        backdrop="dim"
        :lockScroll="true"
        @update:isModalOpen="onWrapper"
    >
        <div
            ref="rootEl"
            class="sid"
            :class="step === 'review' ? 'sid--review' : 'sid--choose'"
            tabindex="-1"
            data-testid="sheet-import"
        >
            <header class="sid__head">
                <h2 class="sid__title">{{ editing ? t('sheetImport.titleEdit') : t('sheetImport.title') }}</h2>
                <p v-if="step !== 'review'" class="sid__intro">{{ t('sheetImport.intro') }}</p>
                <div v-else class="sid__file">
                    <span class="sid__fileName" data-testid="sheet-import-filename">{{ source.fileName }}</span>
                    <button
                        v-if="!editing"
                        type="button"
                        class="sid__link"
                        data-testid="sheet-import-back"
                        @click="backToChoose"
                    >
                        {{ t('sheetImport.back') }}
                    </button>
                </div>
            </header>

            <!-- ───────────── Choisir un fichier ───────────── -->
            <div v-if="step !== 'review'" class="sid__body sid__body--choose">
                <div
                    class="drop"
                    :class="{ 'drop--over': dragOver, 'drop--busy': step === 'reading', 'drop--error': Boolean(errorText) }"
                    data-testid="sheet-import-drop"
                    @dragover.prevent="dragOver = true"
                    @dragleave.prevent="dragOver = false"
                    @drop.prevent="onDrop"
                >
                    <template v-if="step === 'reading'">
                        <span class="drop__spinner" aria-hidden="true" />
                        <p class="drop__title" role="status" data-testid="sheet-import-reading">
                            {{ t('sheetImport.reading', { file: readingName }) }}
                        </p>
                    </template>
                    <template v-else>
                        <svg class="drop__icon" viewBox="0 0 48 48" aria-hidden="true">
                            <rect x="9" y="6" width="30" height="36" rx="3" fill="none" stroke="currentColor" stroke-width="2.5" />
                            <path d="M24 33V17m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                        <p class="drop__title">{{ t('sheetImport.drop.title') }}</p>
                        <MainButton
                            :label="t('sheetImport.drop.choose')"
                            :theme="themeType.secondary"
                            :size="sizeType.m"
                            data-testid="sheet-import-choose"
                            @click="pickFile"
                        />
                        <p class="drop__hint">{{ t('sheetImport.drop.hint') }}</p>
                    </template>
                    <!-- hidden : hors de l'ordre de tabulation pour de vrai (display: none) ;
                         le clic programmatique de « Choisir un fichier » l'ouvre quand même. -->
                    <input
                        ref="fileInput"
                        type="file"
                        accept=".dxf"
                        hidden
                        data-testid="sheet-import-file"
                        @change="onPick"
                    />
                </div>
                <div v-if="errorText" class="sid__error" role="alert" data-testid="sheet-import-error">
                    <span>{{ errorText }}</span>
                    <small v-if="error && error.detail">{{ error.detail }}</small>
                </div>

                <section v-if="recents.length" class="recent" data-testid="sheet-import-recents">
                    <h3 class="sid__h">{{ t('sheetImport.recent.title') }}</h3>
                    <ul class="recent__list">
                        <li
                            v-for="(r, i) in recents"
                            :key="r.slug"
                            class="card"
                            :data-testid="`sheet-import-recent-${i}`"
                        >
                            <div class="card__thumb">
                                <SheetThumb :record="r" :label="r.name" />
                            </div>
                            <div class="card__info">
                                <strong class="card__name" :title="r.name">{{ r.name }}</strong>
                                <span class="card__meta">{{ recentSize(r) }}</span>
                                <span class="card__meta">{{ recentZones(r) }}</span>
                            </div>
                            <div class="card__actions">
                                <MainButton
                                    :label="t('sheetImport.recent.use')"
                                    :theme="themeType.secondary"
                                    :size="sizeType.s"
                                    :data-testid="`sheet-import-recent-use-${i}`"
                                    @click="useRecent(r)"
                                />
                                <button
                                    type="button"
                                    class="card__forget"
                                    :aria-label="t('sheetImport.recent.forgetLabel', { name: r.name })"
                                    :data-testid="`sheet-import-recent-forget-${i}`"
                                    @click="forgetRecent(r)"
                                >
                                    {{ t('sheetImport.recent.forget') }}
                                </button>
                            </div>
                        </li>
                    </ul>
                </section>
            </div>

            <!-- ───────────── Relire et choisir les zones ───────────── -->
            <div v-else-if="view" class="sid__body sid__body--review">
                <div class="stage">
                    <SheetDefectTools
                        v-model:tool="tool"
                        :canUndo="canUndo"
                        :points="draftPoints"
                        @undo="undo"
                        @close="drawingRef?.closeContour()"
                    />
                    <div class="stage__canvas">
                        <SheetImportDrawing
                            ref="drawingRef"
                            :contours="contours"
                            :view="view"
                            :states="states"
                            :hovered="hovered"
                            :labels="zoneLabels"
                            :tool="tool"
                            :drawn="drawn"
                            :cut="cut"
                            :cutStale="cutStale"
                            :hoveredDefect="hoveredDefect"
                            @toggle="onToggle"
                            @hover="hovered = $event"
                            @scale="stageScale = $event"
                            @add="addDefect"
                            @draft="draftPoints = $event"
                            @hoverDefect="hoveredDefect = $event"
                        />
                    </div>
                    <p class="stage__hint">{{ stageHint }}</p>
                    <p v-if="cutProblem" class="stage__note stage__note--bad" role="alert" data-testid="defect-message">{{ cutProblem }}</p>
                    <p v-else class="stage__note" role="status" data-testid="defect-message">{{ cutMessage }}</p>
                </div>

                <aside class="panel">
                    <div class="panel__block">
                        <label class="panel__label" for="sheet-import-name">{{ t('sheetImport.panel.name') }}</label>
                        <input
                            id="sheet-import-name"
                            v-model="name"
                            type="text"
                            class="field"
                            :class="{ 'field--invalid': nameInvalid }"
                            :maxlength="MAX_NAME_LENGTH"
                            required
                            aria-required="true"
                            :aria-invalid="nameInvalid ? 'true' : 'false'"
                            autocomplete="off"
                            data-testid="sheet-import-name"
                            @input="nameTouched = true"
                        />
                        <p v-if="nameInvalid" class="panel__note panel__note--bad">{{ t('sheetImport.err.nameRequired') }}</p>
                    </div>

                    <div class="panel__block">
                        <h3 class="panel__label">{{ t('sheetImport.panel.measures') }}</h3>
                        <dl class="facts" data-testid="sheet-import-facts">
                            <div class="facts__row">
                                <dt>{{ t('sheetImport.panel.width') }}</dt>
                                <dd data-testid="sheet-import-width">{{ fmtDim(widthMm) }}</dd>
                            </div>
                            <div class="facts__row">
                                <dt>{{ t('sheetImport.panel.height') }}</dt>
                                <dd data-testid="sheet-import-height">{{ fmtDim(heightMm) }}</dd>
                            </div>
                            <div class="facts__row">
                                <dt>{{ t('sheetImport.panel.usable') }}</dt>
                                <dd
                                    data-testid="sheet-import-usable"
                                    :class="{ 'facts__pending': usablePending }"
                                    :title="usablePending ? t('sheetImport.defect.computing') : undefined"
                                >{{ usableText }}</dd>
                            </div>
                            <div v-if="!fromRecord" class="facts__row">
                                <dt>{{ t('sheetImport.panel.units') }}</dt>
                                <dd data-testid="sheet-import-units">{{ unitsText }}</dd>
                            </div>
                        </dl>
                        <div v-if="showInchesHint" class="notice" data-testid="sheet-import-inches">
                            <p v-if="inchesOn" class="notice__text" data-testid="sheet-import-inches-on">{{ t('sheetImport.inches.on', { w: fmtDim(widthMm), h: fmtDim(heightMm) }) }}</p>
                            <p v-else class="notice__text">{{ t('sheetImport.inches.hint', { size: fmtLength(rawBigMm) }) }}</p>
                            <UiSwitch
                                v-model="inchesOn"
                                :label="t('sheetImport.inches.switch')"
                                data-testid="sheet-import-inches-switch"
                            />
                        </div>
                    </div>

                    <div v-if="ignored.length" class="panel__block">
                        <h3 class="panel__label">{{ t('sheetImport.ignored.title') }}</h3>
                        <ul class="ignored" data-testid="sheet-import-ignored">
                            <li v-for="line in ignored" :key="line.key">{{ tp(line.key, line.n) }}</li>
                        </ul>
                    </div>

                    <SheetDefectList
                        :drawn="drawn"
                        :hovered="hoveredDefect"
                        class="panel__block"
                        @delete="deleteDefect"
                        @hover="hoveredDefect = $event"
                    />

                    <div v-if="view.zones.length" class="panel__block panel__block--grow">
                        <div class="zhead">
                            <h3 class="panel__label">{{ t('sheetImport.zones.title') }}</h3>
                            <div class="zhead__tools">
                                <button type="button" class="chip" data-testid="sheet-import-none" @click="setForbidden(forbidNone())">{{ t('sheetImport.short.none') }}</button>
                                <button type="button" class="chip" data-testid="sheet-import-all" @click="setForbidden(forbidAll(contours, view))">{{ t('sheetImport.short.all') }}</button>
                                <button type="button" class="chip" data-testid="sheet-import-invert" @click="setForbidden(forbidInvert(contours, view, forbidden))">{{ t('sheetImport.short.invert') }}</button>
                            </div>
                        </div>
                        <ul class="zlist" data-testid="sheet-import-list">
                            <li v-for="(z, i) in view.zones" :key="z.index">
                                <button
                                    type="button"
                                    class="zrow"
                                    :class="[`zrow--${states[i].state}`, { 'zrow--hover': hovered === z.index }]"
                                    :disabled="states[i].state === 'implied'"
                                    :aria-pressed="states[i].state === 'implied' ? undefined : String(states[i].state === 'forbidden')"
                                    :data-testid="`sheet-import-row-${z.number}`"
                                    :data-state="states[i].state"
                                    @click="onToggle(z.index)"
                                    @pointerenter="hovered = z.index"
                                    @pointerleave="hovered = null"
                                    @focus="hovered = z.index"
                                    @blur="hovered = null"
                                >
                                    <span class="zrow__num">{{ z.number }}</span>
                                    <span class="zrow__main">
                                        <span class="zrow__name">{{ t('sheetImport.zones.item', { n: z.number }) }}</span>
                                        <span class="zrow__size">
                                            {{ fmtLength(z.widthMm) }} × {{ fmtLength(z.heightMm) }}
                                            <em v-if="tinyIndexes.has(z.index)">· {{ t('sheetImport.zones.small') }}</em>
                                        </span>
                                    </span>
                                    <span class="zrow__state">{{ stateText(states[i]) }}</span>
                                </button>
                            </li>
                        </ul>
                    </div>
                </aside>
            </div>

            <footer v-if="step === 'review'" class="sid__foot">
                <p v-if="importedExportNote" class="sid__trial" data-testid="sheet-import-trial-note">{{ importedExportNote }}</p>
                <p v-if="saveError" class="sid__error sid__error--foot" role="alert" data-testid="sheet-import-save-error">{{ saveError }}</p>
                <div class="sid__actions">
                    <MainButton
                        :label="t('sheetImport.cancel')"
                        :theme="themeType.secondary"
                        :size="sizeType.m"
                        data-testid="sheet-import-cancel"
                        @click="close"
                    />
                    <MainButton
                        :label="confirmText"
                        :theme="themeType.primary"
                        :size="sizeType.m"
                        class="sid__confirm"
                        :isDisable="!canConfirm"
                        data-testid="sheet-import-confirm"
                        @click="confirm"
                    />
                </div>
            </footer>
        </div>
    </DialogWrapper>
</template>

<script setup>
/**
 * Fenêtre d'import d'une tôle depuis un DXF (lot 3 de la tôle importée).
 *
 * Deux états : choisir un fichier (ou une tôle récente), puis relire le
 * dessin et choisir les zones interdites. Rien n'est interdit d'office : un
 * contour intérieur n'est jamais présumé être un trou, et le bouton de
 * confirmation dit le choix en toutes lettres.
 *
 * La géométrie reste dans le navigateur : lecture wasm locale, stockage
 * IndexedDB (localSheetsStore) ; seuls shapeId, nom et dimensions entrent
 * dans les réglages du projet (files.js). Aucun octet ne part au serveur,
 * hors l'événement de suivi (nombre de zones, en chaîne).
 *
 * Mode édition : `editSlug` ouvre directement le relevé de l'enregistrement
 * gardé ; la confirmation le réécrit sous le même slug et remplace la forme
 * de la ligne `replaceIndex`.
 */
import { themeType } from '~~/constants/theme.constants'
import { sizeType } from '~~/constants/size.constants'
import { MAX_UPLOAD_FILE_BYTES } from '~~/shared/constants/upload.constants'
import { filesStore } from '~/composables/files'
import { bindCut, cutKeyOf, recordZoneCount, ringBbox, scaleContours } from '~/utils/sheetShape'
import { cutInput, makeDefect, normalizeDrawn, scaleDrawn } from '~/utils/sheetDefects'
import {
    canAddDefect, historyPop, historyPush, historyScale, isDrawTool, nextDefectId,
} from '~/utils/defectDrawing'
import { trackEvent } from '~/utils/track'
import { importedSheetLockVisible, sheetDownloadState } from '~/utils/sheetDownloadState'
import {
    ERROR_KEYS, INCH_FACTOR, MAX_NAME_LENGTH, MIN_ZONE_PX,
    baseName, buildRecord, buildSheetView, cleanName, confirmLabel, defaultSheetName,
    forbidAll, forbidInvert, forbidNone, ignoredLines, importErrorOf, isDxfName,
    isListOnly, looksLikeDxf, looksLikeInches, newSheetSlug, pairDecimals, toggleZone, usableArea, zoneStates,
} from '~/utils/sheetImportModel'

const props = defineProps({
    open: { type: Boolean, default: false },
    projectSlug: { type: String, default: '' },
    // ligne de la liste des tôles à remplacer (mode édition)
    replaceIndex: { type: Number, default: null },
    // enregistrement gardé à rouvrir (mode édition)
    editSlug: { type: String, default: '' },
})
const emit = defineEmits(['update:open'])

const { t, tp, locale } = useLocale()
const { unit, fmtLength, fmtLengthValue, fmtArea } = useUnit()
const { actions } = filesStore

// ------------------------------------------------------------------ état
const step = ref('choose') // 'choose' | 'reading' | 'review'
const error = ref(null) // { key, detail }
const saveError = ref('')
const readingName = ref('')
const dragOver = ref(false)
const saving = ref(false)
const recents = ref([])
const fileInput = ref(null)
const rootEl = ref(null)

// Ce qui a été lu (ou rouvert) : contours bruts, avant l'éventuel réglage « pouces ».
// shallowRef : le résultat du lecteur (gros tableaux de points) n'a pas à être
// rendu réactif ; chaque lecture REMPLACE la valeur entière.
const source = shallowRef({ contours: [], sourceUnits: 0, fileName: '', openPaths: 0, skippedEntities: 0 })
const fromRecord = ref(false) // relevé d'un enregistrement gardé : pas de réglage d'unité
const inchesOn = ref(false)
const forbidden = ref([])
// Défauts dessinés à la main (voir utils/sheetDefects.js). Tableaux REMPLACÉS à chaque
// geste, jamais modifiés en place : shallowRef, et l'historique garde des instantanés.
const drawn = shallowRef([])
const history = shallowRef([])
const tool = ref('pointer') // 'pointer' | 'free' | 'circle' | 'rect'
const draftPoints = ref(0) // points déjà posés du contour libre en cours
const hoveredDefect = ref(null)
const drawingRef = ref(null)
// La coupe : résultat de geoCutSheet LIÉ à l'état exact qui l'a produit (`forKey`).
const cut = shallowRef(null)
const cutInfo = shallowRef(null) // { changed } du dernier calcul abouti
const cutBusy = ref(false)
const cutErrorKey = ref('') // le calcul a échoué : clé de message
const limitKey = ref('') // un ajout a été refusé (plafond de zones) : clé de message
let cutToken = 0
const name = ref('')
const nameTouched = ref(false)
const hovered = ref(null)
let editRecord = null
let readToken = 0

const editing = computed(() => Boolean(props.editSlug))
const errorText = computed(() => (error.value ? t(error.value.key) : ''))

// ------------------------------------------------------------ dérivés
const contours = computed(() => (inchesOn.value
    ? scaleContours(source.value.contours, INCH_FACTOR)
    : source.value.contours))
const view = computed(() => (step.value === 'review' ? buildSheetView(contours.value) : null))
const states = computed(() => zoneStates(contours.value, view.value, forbidden.value))
const forbiddenCount = computed(() => states.value.filter((s) => s.state === 'forbidden').length)

const outlineBbox = computed(() => {
    const v = view.value
    if (!v) return [0, 0, 0, 0]
    return contours.value[v.outlineIndex].bbox || ringBbox(contours.value[v.outlineIndex].ring)
})
const widthMm = computed(() => outlineBbox.value[2] - outlineBbox.value[0])
const heightMm = computed(() => outlineBbox.value[3] - outlineBbox.value[1])
const outlineArea = computed(() => (view.value ? contours.value[view.value.outlineIndex].areaMm2 : 0))
const usable = computed(() => usableArea(contours.value, view.value, forbidden.value))

// ------------------------------------------------------------ coupe (défauts)
// Clé de l'état courant ; la coupe tenue ne vaut que si sa clé est la même.
const currentKey = computed(() => {
    if (!view.value || !drawn.value.length) return ''
    try {
        return cutKeyOf(contours.value, view.value.outlineIndex, forbidden.value, drawn.value)
    } catch {
        return ''
    }
})
const cutMatches = computed(() => Boolean(cut.value) && cut.value.forKey === currentKey.value)
const cutStale = computed(() => Boolean(cut.value) && !cutMatches.value)
// Sans défaut, rien à calculer ; avec, il faut la coupe de CET état, sans calcul en cours ni erreur.
const cutReady = computed(() => !drawn.value.length || (cutMatches.value && !cutBusy.value && !cutErrorKey.value))
const cutProblem = computed(() => {
    const key = cutErrorKey.value || limitKey.value
    return key ? t(key) : ''
})
const usablePending = computed(() => drawn.value.length > 0 && !cutErrorKey.value && !(cutMatches.value && !cutBusy.value))
const usableText = computed(() => {
    if (drawn.value.length && cutErrorKey.value) return '—'
    // Pendant un calcul : la dernière valeur connue, atténuée (jamais un faux chiffre « final »).
    if (drawn.value.length && cut.value) return fmtArea(cut.value.usableArea, outlineArea.value)
    return fmtArea(usable.value, outlineArea.value)
})
const cutMessage = computed(() => {
    // Contour libre pas fermé : il ne compte pas encore, et l'écran le dit (la
    // confirmation attend : sinon le défaut serait perdu sans un mot).
    if (draftPoints.value > 0) return t('sheetImport.defect.unfinished')
    if (!drawn.value.length) return ''
    if (!cutMatches.value || cutBusy.value) return t('sheetImport.defect.computing')
    const c = cut.value
    if (c.pieces > 1) return t('sheetImport.defect.split', { n: c.pieces, area: fmtArea(c.lostArea, outlineArea.value) })
    if (cutInfo.value?.changed === false || c.removedArea === 0) return t('sheetImport.defect.noEffect')
    return ''
})
const stageHint = computed(() => {
    if (isDrawTool(tool.value)) return t(`sheetImport.defect.hint.${tool.value}`)
    return view.value.zones.length ? t('sheetImport.review.hint') : t('sheetImport.zones.none')
})

const failCut = (code) => {
    cut.value = null
    cutInfo.value = null
    // Un code inconnu (travailleur absent, délai…) : le message générique de la coupe.
    const key = importErrorOf(String(code || '')).key
    cutErrorKey.value = key === ERROR_KEYS.unreadable ? ERROR_KEYS.cut : key
}
const recomputeCut = async () => {
    const token = ++cutToken
    cutErrorKey.value = ''
    if (step.value !== 'review' || !view.value || !drawn.value.length) {
        cut.value = null
        cutInfo.value = null
        cutBusy.value = false
        return
    }
    // L'état EXACT de cet appel : la coupe lui est liée, quoi qu'il arrive entre-temps.
    const snap = { c: contours.value, o: view.value.outlineIndex, f: [...forbidden.value], d: drawn.value }
    cutBusy.value = true
    let result
    try {
        const input = cutInput(snap.c, snap.o, snap.f, snap.d)
        const { geoCutSheet } = await import('~/composables/geometryClient')
        result = await geoCutSheet(input.outer, input.holes, input.defects)
    } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : '' }
    }
    if (token !== cutToken) return // un état plus récent a pris la main
    cutBusy.value = false
    if (!result || result.ok === false) {
        failCut(result?.error)
        return
    }
    try {
        cut.value = bindCut(result, snap.c, snap.o, snap.f, snap.d)
        cutInfo.value = { changed: result.changed !== false }
    } catch (err) {
        failCut(err instanceof Error ? err.message : '')
    }
}
watch([drawn, forbidden, contours, step], () => { recomputeCut() })

// Réglage « pouces » : les défauts restent au même endroit de la tôle, historique compris.
// `sync` : tout change d'un bloc, aucun calcul ne voit contours et défauts à deux échelles.
watch(inchesOn, (on) => {
    const factor = on ? INCH_FACTOR : 1 / INCH_FACTOR
    if (drawn.value.length) drawn.value = scaleDrawn(drawn.value, factor)
    history.value = historyScale(history.value, factor, scaleDrawn)
}, { flush: 'sync' })
// Largeur et hauteur : le même arrondi (jamais « 507,8 » à côté de « 507,9 »).
const dimDecimals = computed(() => pairDecimals(unref(unit), widthMm.value, heightMm.value))
const fmtDim = (mm) => {
    const v = fmtLengthValue(mm, dimDecimals.value)
    return unref(unit) === 'inch' ? `${v}"` : `${v} mm`
}

// Réglage « pouces » : jugé sur la lecture BRUTE (une fois basculé, le dessin
// dépasse 30 mm mais l'interrupteur doit rester pour pouvoir revenir).
const rawBigMm = computed(() => {
    const raw = buildSheetView(source.value.contours)
    if (!raw) return 0
    const c = source.value.contours[raw.outlineIndex]
    const b = c.bbox || ringBbox(c.ring)
    return Math.max(b[2] - b[0], b[3] - b[1])
})
const showInchesHint = computed(() => !fromRecord.value
    && looksLikeInches(source.value.sourceUnits, rawBigMm.value, rawBigMm.value))

const UNIT_CODES = [0, 1, 2, 4, 5, 6]
const unitsText = computed(() => {
    const code = inchesOn.value ? 1 : source.value.sourceUnits
    return UNIT_CODES.includes(code) ? t(`sheetImport.units.${code}`) : t('sheetImport.units.other', { n: code })
})

const ignored = computed(() => ignoredLines({
    openPaths: source.value.openPaths,
    skippedEntities: source.value.skippedEntities,
    otherOutlines: view.value?.otherOutlines || 0,
}))

// Formes trop petites pour être cliquées dans le dessin (< 6 px à l'écran) : elles
// restent pilotables depuis la liste, qui le dit. L'échelle vient du dessin lui-même.
const stageScale = ref(1)
const tinyIndexes = computed(() => {
    const v = view.value
    const set = new Set()
    if (!v) return set
    for (const z of v.zones) if (isListOnly(contours.value[z.index], stageScale.value, MIN_ZONE_PX)) set.add(z.index)
    return set
})

const stateText = (s) => {
    if (s.state === 'forbidden') return t('sheetImport.zones.forbidden')
    if (s.state === 'implied') return t('sheetImport.zones.covered', { n: s.coveredBy })
    return t('sheetImport.zones.allowed')
}
const zoneLabels = computed(() => {
    const out = {}
    const v = view.value
    if (!v) return out
    v.zones.forEach((z, i) => {
        out[z.index] = t('sheetImport.zones.aria', {
            n: z.number,
            size: `${fmtLength(z.widthMm)} × ${fmtLength(z.heightMm)}`,
            state: stateText(states.value[i]),
        })
    })
    return out
})

const nameInvalid = computed(() => nameTouched.value && cleanName(name.value) === '')
// Essai Free (20/11) : une ligne avant de confirmer — importer, placer et
// voir est ouvert, l'export des fichiers de coupe demande Unlimited. Même
// palier que la page projet (useNuxtData('user') prime ; K et démo explicites).
const { data: userData } = useNuxtData('user')
const runtimeConfig = useRuntimeConfig()
const route = useRoute()
const importedExportNote = computed(() =>
    importedSheetLockVisible(
        sheetDownloadState(unref(userData), {
            paidPlansDisabled: runtimeConfig.public.paidPlansDisabled,
            projectSlug: route.params.slug ?? null,
        }),
        true,
    ) ? t('sheetImport.trialNote') : '')
const canConfirm = computed(() => step.value === 'review' && !saving.value && cleanName(name.value) !== ''
    && cutReady.value && draftPoints.value === 0)
const confirmText = computed(() => {
    if (saving.value) return t('sheetImport.saving')
    // Un défaut est de la matière interdite : il compte avec les zones interdites.
    const label = confirmLabel(forbiddenCount.value + drawn.value.length)
    return label.plural ? tp(label.plural, label.n) : t(label.key)
})

// Nom proposé tant que l'utilisateur ne l'a pas touché.
watch([view, unit, locale], () => {
    if (nameTouched.value || !view.value) return
    name.value = defaultSheetName(view.value.outline, unref(unit), unref(locale))
}, { immediate: true })

// ------------------------------------------------------------ cartes récentes
const recentSize = (r) => `${fmtLength(r.widthMm)} × ${fmtLength(r.heightMm)}`
const recentZones = (r) => {
    const n = recordZoneCount(r)
    return n === 0 ? t('sheetImport.recent.noZones') : tp('sheetImport.recent.zones', n)
}
const loadRecents = async () => {
    try {
        const { listRecentSheets } = await import('~/composables/localSheetsStore')
        recents.value = await listRecentSheets()
    } catch {
        recents.value = []
    }
}
const forgetRecent = async (record) => {
    try {
        const { forgetRecentSheet } = await import('~/composables/localSheetsStore')
        await forgetRecentSheet(record.slug)
    } catch { /* la carte reste, rien de plus à dire */ }
    await loadRecents()
}

// ------------------------------------------------------------------- focus
// Quand l'état change, l'élément qui avait le focus disparaît : sans cette
// reprise, le focus tombe sur la page derrière la fenêtre (clavier, lecteur
// d'écran). Relevé -> champ du nom ; choix -> « Choisir un fichier » ;
// lecture -> la fenêtre elle-même (rien de focalisable pendant la lecture).
const focusStep = async () => {
    await nextTick()
    const root = rootEl.value
    if (!root) return
    let target = null
    if (step.value === 'review') target = root.querySelector('#sheet-import-name')
    else if (step.value === 'choose') target = root.querySelector('[data-testid="sheet-import-choose"]')
    ;(target || root).focus?.()
}
watch(step, () => { focusStep() })

// ----------------------------------------------------------------- ouverture
const reset = () => {
    readToken++
    step.value = 'choose'
    error.value = null
    saveError.value = ''
    saving.value = false
    dragOver.value = false
    hovered.value = null
    // Les défauts d'abord : le réglage « pouces » qui suit ne doit rien avoir à remettre à l'échelle.
    drawn.value = []
    history.value = []
    tool.value = 'pointer'
    draftPoints.value = 0
    hoveredDefect.value = null
    limitKey.value = ''
    inchesOn.value = false
    forbidden.value = []
    name.value = ''
    nameTouched.value = false
    fromRecord.value = false
    editRecord = null
    source.value = { contours: [], sourceUnits: 0, fileName: '', openPaths: 0, skippedEntities: 0 }
}

const openOnRecord = (record, { edit }) => {
    const first = buildSheetView(record.contours)
    if (!first) {
        error.value = importErrorOf({ contours: [] })
        step.value = 'choose'
        return false
    }
    // Défauts de l'enregistrement : la coupe est recalculée à l'ouverture (jamais reprise sur parole).
    let restored
    try {
        restored = normalizeDrawn(record.drawn)
    } catch (err) {
        error.value = importErrorOf(err)
        step.value = 'choose'
        return false
    }
    source.value = {
        contours: record.contours,
        sourceUnits: record.sourceUnits ?? 0,
        fileName: record.sourceFileName || record.name,
        openPaths: 0,
        skippedEntities: 0,
    }
    fromRecord.value = true
    forbidden.value = Array.isArray(record.forbidden) ? [...record.forbidden] : []
    drawn.value = restored
    history.value = []
    name.value = record.name
    nameTouched.value = true
    if (edit) editRecord = record
    step.value = 'review'
    return true
}

watch(() => props.open, async (isOpen) => {
    if (!isOpen) return
    reset()
    // DialogWrapper pose son focus initial (la croix) après le rendu : le nôtre passe après.
    setTimeout(() => { if (props.open) focusStep() }, 0)
    if (props.editSlug) {
        try {
            const { getSheet } = await import('~/composables/localSheetsStore')
            const record = await getSheet(props.editSlug)
            if (record && openOnRecord(record, { edit: true })) return
            if (!record) error.value = { key: ERROR_KEYS.unreadable, detail: null }
        } catch (err) {
            error.value = importErrorOf(err)
        }
    }
    await loadRecents()
}, { immediate: true })

// ---------------------------------------------------------------- lecture
const pickFile = () => fileInput.value?.click()
const onPick = (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // le même fichier peut être rechoisi
    if (file) readFile(file)
}
const onDrop = (event) => {
    dragOver.value = false
    const file = event.dataTransfer?.files?.[0]
    if (file) readFile(file)
}

const readFile = async (file) => {
    const token = ++readToken
    error.value = null
    if (!isDxfName(file.name)) {
        error.value = { key: ERROR_KEYS.notDxf, detail: null }
        return
    }
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
        error.value = { key: ERROR_KEYS.tooHeavy, detail: null }
        return
    }
    readingName.value = file.name
    step.value = 'reading'
    let result
    try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        // Contrôle bon marché avant le lecteur : un texte renommé .dxf a son
        // propre message, distinct de « aucun contour fermé ».
        if (!looksLikeDxf(bytes.subarray(0, 4096))) {
            if (token !== readToken) return
            error.value = { key: ERROR_KEYS.notDxfContent, detail: null }
            step.value = 'choose'
            return
        }
        const { geoImportSheet } = await import('~/composables/geometryClient')
        result = await geoImportSheet(bytes)
    } catch {
        result = { ok: false }
    }
    if (token !== readToken) return // fermée ou relancée entre-temps
    const problem = importErrorOf(result)
    if (problem) {
        error.value = problem
        step.value = 'choose'
        return
    }
    source.value = {
        contours: result.contours,
        sourceUnits: Number.isInteger(result.sourceUnits) ? result.sourceUnits : 0,
        fileName: file.name,
        openPaths: result.openPaths || 0,
        skippedEntities: result.skippedEntities || 0,
    }
    fromRecord.value = false
    drawn.value = [] // un nouveau fichier : aucun défaut hérité
    history.value = []
    inchesOn.value = false
    forbidden.value = [] // jamais de zone interdite présumée
    nameTouched.value = false
    name.value = ''
    step.value = 'review'
}

const useRecent = (record) => {
    error.value = null
    openOnRecord(record, { edit: false })
}
const backToChoose = () => {
    readToken++
    step.value = 'choose'
    error.value = null
    saveError.value = ''
    drawn.value = []
    history.value = []
    tool.value = 'pointer'
    loadRecents()
}

// ------------------------------------------------------------------ zones
const setForbidden = (next) => { forbidden.value = next }
const onToggle = (index) => {
    forbidden.value = toggleZone(contours.value, view.value, forbidden.value, index)
}

// ----------------------------------------------------------------- défauts
const canUndo = computed(() => draftPoints.value > 0 || history.value.length > 0)

const pushHistory = () => { history.value = historyPush(history.value, drawn.value) }
const addDefect = ({ kind, data }) => {
    if (!canAddDefect(forbiddenCount.value, drawn.value.length)) {
        limitKey.value = ERROR_KEYS.tooManyZones
        return
    }
    const defect = makeDefect(nextDefectId(drawn.value), kind, data)
    if (!defect) return
    limitKey.value = ''
    pushHistory()
    drawn.value = [...drawn.value, defect]
}
const deleteDefect = (index) => {
    if (!drawn.value[index]) return
    limitKey.value = ''
    hoveredDefect.value = null
    pushHistory()
    drawn.value = drawn.value.filter((_, i) => i !== index)
}
// Annuler : au milieu d'un contour libre, retire le dernier point ; sinon revient à l'état d'avant.
const undo = () => {
    if (draftPoints.value > 0) {
        drawingRef.value?.popPoint()
        return
    }
    const { history: rest, snapshot } = historyPop(history.value)
    if (snapshot === null) return
    limitKey.value = ''
    hoveredDefect.value = null
    history.value = rest
    drawn.value = snapshot
}
// Ctrl+Z / Cmd+Z, quand le focus n'est pas dans un champ de texte.
const isTextTarget = (el) => Boolean(el) && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
const onUndoKey = (e) => {
    if (!props.open || step.value !== 'review') return
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== 'z') return
    if (isTextTarget(e.target) || !canUndo.value) return
    e.preventDefault()
    undo()
}
onMounted(() => window.addEventListener('keydown', onUndoKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onUndoKey))

// --------------------------------------------------------------- validation
const close = () => emit('update:open', false)
const onWrapper = (value) => { if (value === false) close() }

const confirm = async () => {
    if (!canConfirm.value || !view.value) return
    // Jamais une coupe d'un autre état : elle est refusée aussi par buildRecord, mais ici on n'essaie même pas.
    if (drawn.value.length && !cutMatches.value) return
    saveError.value = ''
    saving.value = true
    const now = new Date().toISOString()
    const slug = editRecord ? editRecord.slug : newSheetSlug(Date.now(), Math.random())
    const { record, error: buildError } = buildRecord({
        slug,
        projectSlug: props.projectSlug,
        name: name.value,
        sourceFileName: source.value.fileName,
        sourceUnits: inchesOn.value ? 1 : source.value.sourceUnits,
        contours: contours.value,
        outlineIndex: view.value.outlineIndex,
        forbidden: forbidden.value,
        now: editRecord?.addedAt ?? now,
        drawn: drawn.value,
        cut: drawn.value.length ? cut.value : undefined,
    })
    if (buildError) {
        saveError.value = t(buildError)
        saving.value = false
        return
    }
    try {
        const { saveSheet, rememberRecentSheet } = await import('~/composables/localSheetsStore')
        await saveSheet(record)
        try {
            await rememberRecentSheet(record, now)
        } catch { /* la bibliothèque est un confort, la tôle du projet est gardée */ }
    } catch (err) {
        // La vraie cause reste lisible en développement (un DataCloneError ne
        // doit plus se cacher derrière « le navigateur n'a pas pu garder »).
        if (import.meta.dev) console.error('[sheetImport] save failed', err)
        const key = importErrorOf(err).key
        saveError.value = t(key === ERROR_KEYS.unreadable ? ERROR_KEYS.storage : key)
        saving.value = false
        return
    }
    if (props.replaceIndex != null) actions.replaceSheetShape(props.replaceIndex, record)
    else actions.addSheetFromShape(record)
    // Des nombres seulement (en chaînes) : aucune géométrie ne part.
    trackEvent('sheet_import_confirm', { zones: String(record.forbidden.length), defects: String(record.drawn?.length ?? 0) })
    saving.value = false
    close()
}
</script>

<style lang="scss" scoped>
// Fenêtre d'import : mêmes jetons que le reste de l'app (espacement 4 px,
// rayons, Inter). Un seul accent (l'action principale) ; le rouge est
// réservé aux zones interdites.
.sid {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    width: min(1120px, 92vw);
    max-width: 100%;
    padding: var(--sp-5);
    text-align: left;
    color: var(--text);
    font-family: var(--font-body);

    // Le tabindex -1 de la racine ne reçoit le focus que par programme.
    &:focus { outline: none; }

    &--choose {
        // Peu de contenu : fenêtre étroite, le texte d'intro prend toute la largeur.
        width: min(640px, 92vw);
    }
    &--review {
        // Hauteur calée sur la fenêtre : le dessin remplit, le panneau défile.
        height: min(760px, calc(94vh - 8px));
    }

    &__head {
        display: flex;
        flex-direction: column;
        gap: var(--sp-1);
        padding-right: 40px; // croix de fermeture du DialogWrapper
    }
    &__title {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--fs-22);
        font-weight: 600;
        line-height: var(--lh-title);
    }
    &__intro {
        margin: 0;
        color: var(--text-2);
        font-size: var(--fs-14);
        line-height: var(--lh-text);
    }
    &__file {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--sp-3);
        color: var(--text-2);
        font-size: var(--fs-13);
    }
    &__fileName {
        padding: 2px var(--sp-2);
        border-radius: var(--radius);
        background-color: var(--surface-2);
        border: 1px solid var(--border);
        font-family: $sf_mono;
        font-size: var(--fs-12);
        color: var(--text);
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    &__link {
        border: none;
        background: none;
        padding: 2px var(--sp-1);
        color: var(--accent);
        font-size: var(--fs-13);
        font-weight: 600;
        cursor: pointer;
        border-radius: var(--radius);

        &:hover { text-decoration: underline; }
        &:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    }
    &__h {
        margin: 0 0 var(--sp-3);
        color: var(--text-2);
        font-size: var(--fs-13);
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
    }
    &__error {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--sp-3) var(--sp-4);
        border: 1px solid var(--error-border);
        border-radius: var(--radius);
        background-color: var(--danger-bg);
        color: var(--danger);
        font-size: var(--fs-14);
        line-height: var(--lh-text);

        small { color: var(--text-2); font-size: var(--fs-12); }

        &--foot { flex: 1 1 100%; }
    }

    // Essai Free : une ligne d'information, sur toute la largeur du pied.
    &__trial {
        flex: 1 1 100%;
        margin: 0;
        font-size: var(--fs-12);
        line-height: var(--lh-text);
        color: var(--text-2);
    }

    &__body {
        min-height: 0;

        &--choose {
            display: flex;
            flex-direction: column;
            gap: var(--sp-5);
        }
        &--review {
            flex: 1 1 auto;
            display: grid;
            grid-template-columns: minmax(0, 1fr) 340px;
            gap: var(--sp-5);
        }
    }

    &__foot {
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
        padding-top: var(--sp-4);
        border-top: 1px solid var(--border);
    }
    &__actions {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: var(--sp-3);
    }
    // Le libellé change avec le nombre de zones : largeur réservée, le bouton
    // ne saute pas et « Annuler » reste où il est.
    &__confirm {
        min-width: 21rem;
        max-width: 100%;
        justify-content: center;
    }
}

// ───────────────────────── zone de dépôt
.drop {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--sp-3);
    min-height: 220px;
    padding: var(--sp-6) var(--sp-5);
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-l);
    background-color: var(--surface);
    text-align: center;
    transition: border-color 0.2s, background-color 0.2s;

    // Survol / dépôt : un liseré et une teinte légère, le rouge reste la couleur
    // la plus forte de la fenêtre (il est réservé aux zones interdites).
    &--over {
        border-color: var(--accent);
        background-color: color-mix(in srgb, var(--accent) 5%, var(--surface));
    }
    &--error { border-color: var(--danger); }
    &--busy { border-style: solid; }

    &__icon {
        width: 44px;
        height: 44px;
        color: var(--text-3);
    }
    &__title {
        margin: 0;
        font-size: var(--fs-16);
        font-weight: 600;
    }
    &__hint {
        margin: 0;
        color: var(--text-3);
        font-size: var(--fs-13);
    }
    &__spinner {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 3px solid var(--border);
        border-top-color: var(--accent);
        animation: sid-spin 0.8s linear infinite;
    }
}
@keyframes sid-spin {
    to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
    .drop__spinner { animation-duration: 2.4s; }
}

// ───────────────────────── tôles récentes
.recent {
    &__list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: var(--sp-3);
        margin: 0;
        padding: 0;
        list-style: none;
    }
}
.card {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    grid-template-areas:
        'thumb info'
        'thumb actions';
    gap: var(--sp-2) var(--sp-3);
    padding: var(--sp-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-l);
    background-color: var(--surface);
    box-shadow: var(--shadow-s);
    transition: border-color 0.2s, box-shadow 0.2s;

    @media (hover: hover) {
        &:hover {
            border-color: var(--border-strong);
            box-shadow: var(--shadow-m);
        }
    }

    &__thumb {
        grid-area: thumb;
        width: 96px;
        height: 64px;
        align-self: start;
    }
    &__info {
        grid-area: info;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    &__name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--fs-14);
    }
    &__meta {
        color: var(--text-2);
        font-size: var(--fs-12);
        font-variant-numeric: tabular-nums;
    }
    &__actions {
        grid-area: actions;
        display: flex;
        align-items: center;
        gap: var(--sp-3);
    }
    &__forget {
        border: none;
        background: none;
        padding: var(--sp-1) var(--sp-2);
        color: var(--text-2);
        font-size: var(--fs-12);
        font-weight: 600;
        cursor: pointer;
        border-radius: var(--radius);

        &:hover { color: var(--text); text-decoration: underline; }
        &:focus-visible { outline: none; box-shadow: var(--focus-ring); }
    }
}

// ───────────────────────── relevé : dessin + panneau
.stage {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    min-width: 0;
    min-height: 0;

    &__canvas {
        flex: 1 1 auto;
        min-height: 340px;
        border: 1px solid var(--border);
        border-radius: var(--radius-l);
        overflow: hidden;
    }
    &__hint {
        margin: 0;
        min-height: 20px; // une ligne réservée : rien ne saute
        color: var(--text-2);
        font-size: var(--fs-13);
    }
    &__note {
        margin: 0;
        min-height: 20px;
        color: var(--text);
        font-size: var(--fs-13);
        font-weight: 600;

        &--bad { color: var(--danger); }
    }
}

.panel {
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
    min-height: 0;
    overflow-y: auto;
    padding-right: var(--sp-1);

    &__block {
        display: flex;
        flex-direction: column;
        gap: var(--sp-2);
        min-height: 0;

        &--grow { flex: 1 1 160px; }
    }
    &__label {
        margin: 0;
        color: var(--text-2);
        font-size: var(--fs-12);
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
    }
    &__note {
        margin: 0;
        font-size: var(--fs-12);

        &--bad { color: var(--danger); }
    }
}

.field {
    width: 100%;
    box-sizing: border-box;
    padding: var(--sp-2) var(--sp-3);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background-color: var(--surface);
    color: var(--text);
    font-family: inherit;
    font-size: var(--fs-14);

    &:focus-visible { outline: none; border-color: var(--accent); box-shadow: var(--focus-ring); }
    &--invalid { border-color: var(--danger); }
}

.facts {
    display: flex;
    flex-direction: column;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background-color: var(--surface);

    &__row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: var(--sp-3);
        padding: var(--sp-2) var(--sp-3);
        font-size: var(--fs-13);

        & + & { border-top: 1px solid var(--border); }

        dt { color: var(--text-2); }
        dd {
            margin: 0;
            color: var(--text);
            font-weight: 600;
            font-variant-numeric: tabular-nums;
            text-align: right;
        }
    }
}

.facts__pending { opacity: 0.5; }

.notice {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: var(--sp-3);
    border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
    border-radius: var(--radius);
    background-color: var(--warn-bg);

    &__text {
        margin: 0;
        color: var(--text);
        font-size: var(--fs-13);
        line-height: var(--lh-text);
    }
}

.ignored {
    margin: 0;
    padding-left: var(--sp-4);
    color: var(--text-2);
    font-size: var(--fs-13);
    line-height: var(--lh-text);
}

.zhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--sp-2);

    &__tools {
        display: flex;
        flex-wrap: wrap;
        gap: var(--sp-1);
    }
}
.chip {
    padding: var(--sp-1) var(--sp-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-2);
    font-size: var(--fs-12);
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s, background-color 0.2s;

    @media (hover: hover) {
        &:hover { color: var(--text); background-color: var(--surface-2); }
    }
    &:focus-visible { outline: none; box-shadow: var(--focus-ring); }
}

.zlist {
    flex: 1 1 auto;
    min-height: 120px;
    max-height: 100%;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background-color: var(--surface);
}
// Thème sombre : la barre native claire jurait ; on la teinte avec les jetons.
:global([data-theme='primary']) .zlist {
    color-scheme: dark;
    scrollbar-color: var(--border-strong) var(--surface);
}
.zrow {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    min-height: 48px; // hauteur fixe : basculer un état ne décale rien
    box-sizing: border-box;
    padding: var(--sp-2) var(--sp-3);
    border: none;
    border-left: 3px solid transparent;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    font-size: var(--fs-13);
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s;

    li + li > & { border-top: 1px solid var(--border); }

    &--hover { background-color: var(--surface-2); }
    &:focus-visible { outline: none; box-shadow: inset var(--focus-ring); }
    &:disabled { cursor: default; color: var(--text-3); }

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

        em { font-style: normal; color: var(--text-3); }
    }
    &__state {
        min-width: 72px;
        text-align: right;
        color: var(--text-2);
        font-size: var(--fs-12);
        font-weight: 600;
    }
    &--forbidden {
        border-left-color: var(--danger);
        background-color: var(--danger-bg);

        .zrow__state { color: var(--danger); }
    }
    &--implied .zrow__state { color: var(--danger); font-weight: 500; }
}

// ───────────────────────── étroit : tout s'empile, la fenêtre défile
@media (max-width: 900px) {
    .sid {
        padding: var(--sp-4);

        &--review { height: auto; }
        &__title { font-size: var(--fs-18); }

        &__body--review {
            grid-template-columns: minmax(0, 1fr);
        }
        &__foot {
            position: sticky;
            bottom: 0;
            z-index: 3;
            padding-bottom: var(--sp-3);
            background-color: var(--background-primary);
        }
        &__actions { justify-content: stretch; }
        &__actions > * { flex: 1 1 100%; width: auto; }
        &__confirm { min-width: 0; }
    }
    // Une seule zone de défilement (la fenêtre) : ni le dessin, ni le panneau,
    // ni la liste ne défilent chacun dans leur coin ; le pied reste collé en bas.
    .stage__canvas { min-height: 0; height: auto; overflow: visible; }
    .panel { overflow: visible; flex: 0 0 auto; }
    // flex-basis 160 px (colonne) bornait la liste à 120 px : hauteur naturelle.
    .panel__block--grow { flex: 0 0 auto; }
    .zlist { flex: 0 0 auto; min-height: 0; max-height: none; overflow: visible; }
    .sid__body--review { padding-bottom: var(--sp-2); }
    .card { grid-template-columns: 80px minmax(0, 1fr); }
    .card__thumb { width: 80px; height: 56px; }
}
</style>
