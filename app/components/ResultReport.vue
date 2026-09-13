<!--
    U3 passe 1 (PLAN-UI-PRO §U3) - EXTRACTION PURE de ResultModal.vue.
    Aucun changement de rendu : les blocs de template sont deplaces tels
    quels et les styles qui les visent suivent. Toute la logique reste dans
    l'orchestrateur (ResultModal.vue) : ce composant recoit un objet unique
    et le re-expose sous les memes noms, pour que le template n'ait pas eu
    a etre reecrit. La refonte deux volets est la passe 2.
-->
<template>
    <div class="result-report">
        <!-- U3 passe 2 : l'en-tete du rapport porte l'identite du resultat
             (methode, explication, identifiant copiable) et la densite en
             grand — elle etait au-dessus du dialogue, elle appartient au
             volet rapport. -->
        <header
            v-if="!isHaveError"
            class="result-report__head headline"
        >
            <p class="headline__title" data-testid="result-headline">{{ headlineTitle }}</p>
            <p
                v-if="activeStrategyExplain"
                class="headline__explain"
                data-testid="result-explain"
            >
                {{ activeStrategyExplain }}
            </p>
            <button
                type="button"
                class="result-report__slug headline__slug"
                data-testid="copy-id"
                :title="t('result.copyId')"
                @click="$emit('copy-slug')"
            >{{ name }}</button>
            <div
                v-if="activeReport && densityPct != null"
                class="modal__summary summary"
                data-testid="result-density"
            >
                <span class="summary__label">{{ t('result.densityFull') }}</span>
                <span class="summary__value num" data-testid="result-density-value">{{ fmtPercent(densityPct) }}</span>
                <div class="summary__bar">
                    <div class="summary__bar-fill" :style="{ width: `${densityPct}%` }" />
                </div>
            </div>
            <!-- U3 passe 3 : l'etat de placement etait une phrase centree
                 orpheline entre l'en-tete et la carte. C'est un badge
                 d'etat, aligne a gauche, sous la densite. -->
            <div class="result-report__state" data-testid="result-state">
                <UiBadge
                    v-if="resultModalData.requested === resultModalData.placed"
                    tone="ok"
                    dot
                    data-testid="badge-all-placed"
                >
                    {{ t('result.allPlaced') }}
                </UiBadge>
                <template v-else>
                    <UiBadge tone="warn" dot data-testid="badge-partial-placed">
                        {{ t('result.placed', { n: resultModalData.placed }) }}
                    </UiBadge>
                    <span class="result-report__state-note">
                        {{ t('result.neededToPlace', { n: resultModalData.requested }) }}
                    </span>
                </template>
            </div>
        </header>
            <div v-if="isHaveError" class="modal__name modal__info info">
                <span class="info__label">
                    {{ t('result.noSolution') }}
                </span>
                <span v-if="resultModalData.information" class="info__label info__label--detail">
                    {{ resultModalData.information }}
                </span>
                <span class="info__label">
                    {{ t('result.neededToPlace', { n: resultModalData.requested }) }}
                </span>
                <span class="info__label">
                    {{ t('result.placed', { n: resultModalData.placed }) }}
                </span>
            </div>
            <div
                v-if="!isHaveError && activeReport"
                ref="reportEl"
                class="modal__report report"
            >
                <!-- U3 passe 2 : la densite vit dans l'en-tete du volet
                     (grand chiffre) — la repeter ici faisait doublon. -->
                <div class="report__row report__row--detail">
                    <span>{{ t('report.areas', { parts: fmtArea(activeReport.partsAreaMm2), free: fmtArea(freeAreaMm2) }) }}</span>
                    <span v-if="activeReportOffcut" class="report__offcut">
                        {{ t('report.offcut', { w: fmtLengthValue(activeReportOffcut.widthMm), h: fmtLengthValue(activeReportOffcut.heightMm), unit: unitLabel }) }}
                        · {{ fmtArea(activeReportOffcut.areaMm2) }}
                        <span
                            class="report__badge"
                            :class="{ 'report__badge--scrap': !activeReportOffcut.reusable }"
                        >
                            {{ activeReportOffcut.reusable ? t('report.offcut.reusable') : t('report.offcut.scrap') }}
                        </span>
                        <span class="report__hint">&nbsp;({{ t('report.offcut.atLeast') }})</span>
                    </span>
                    <span v-else-if="activeOffcut">{{ t('report.offcut', { w: fmtLengthValue(activeOffcut.width), h: fmtLengthValue(activeOffcut.height), unit: unitLabel }) }}</span>
                </div>
                <div
                    v-if="reportTotals"
                    class="report__row report__row--detail report__material"
                >
                    <span class="report__label">{{ t('report.material') }}</span>
                    <span class="report__value">{{ materialFormats }}</span>
                </div>
                <!-- a11y : une zone qui défile doit être atteignable au
                     clavier (axe « scrollable-region-focusable » en mobile,
                     ou le tableau n'est jamais lisible sans souris). -->
                <div
                    v-if="reportSheets.length"
                    class="report__table-wrap"
                    tabindex="0"
                    role="region"
                    :aria-label="t('report.material')"
                >
                    <table class="report__table">
                        <thead>
                            <tr>
                                <th>{{ t('report.sheet.num') }}</th>
                                <th>{{ t('report.sheet.format') }}</th>
                                <th>{{ t('report.sheet.parts') }}</th>
                                <th class="report__col-area">{{ t('report.sheet.used') }}</th>
                                <th class="report__col-area">{{ t('report.sheet.free') }}</th>
                                <th>{{ t('report.sheet.density') }}</th>
                                <th>{{ t('report.sheet.offcut') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="s in reportSheets" :key="s.index" data-testid="report-row">
                                <td>{{ s.index + 1 }}</td>
                                <td class="report__cell-sheet">
                                    {{ fmtLengthValue(s.widthMm) }} × {{ fmtLengthValue(s.heightMm) }} {{ unitLabel }}
                                    <!-- Volet etroit : « Utilise » et « Libre »
                                         ne sont pas perdus, ils passent en
                                         ligne secondaire sous le format. -->
                                    <span class="report__sheet-sub" data-testid="report-row-areas">
                                        {{ t('report.sheet.used') }} {{ fmtArea(s.partsAreaMm2) }}
                                        · {{ t('report.sheet.free') }} {{ fmtArea(s.freeAreaMm2) }}
                                    </span>
                                </td>
                                <td>{{ s.partCount }}</td>
                                <td class="report__col-area">
                                    <span class="report__area">{{ fmtAreaStacked(s.partsAreaMm2).main }}</span>
                                    <span v-if="fmtAreaStacked(s.partsAreaMm2).sub" class="report__area-sub">{{ fmtAreaStacked(s.partsAreaMm2).sub }}</span>
                                </td>
                                <td class="report__col-area">
                                    <span class="report__area">{{ fmtAreaStacked(s.freeAreaMm2).main }}</span>
                                    <span v-if="fmtAreaStacked(s.freeAreaMm2).sub" class="report__area-sub">{{ fmtAreaStacked(s.freeAreaMm2).sub }}</span>
                                </td>
                                <td>{{ s.densityPct != null ? fmtPercent(s.densityPct) : '—' }}</td>
                                <td class="report__cell-offcut">
                                    <template v-if="s.offcut">
                                        {{ fmtLengthValue(s.offcut.widthMm) }} × {{ fmtLengthValue(s.offcut.heightMm) }} {{ unitLabel }}
                                        <span
                                            class="report__badge report__badge--block"
                                            :class="{ 'report__badge--scrap': !s.offcut.reusable }"
                                        >
                                            {{ s.offcut.reusable ? t('report.offcut.reusable') : t('report.offcut.scrap') }}
                                        </span>
                                    </template>
                                    <span v-else>—</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div
                    v-if="activeReport.holesFilled > 0"
                    class="report__row report__row--detail"
                >
                    <span>{{ t('report.holesFilled', { n: activeReport.holesFilled }) }}</span>
                </div>
                <!-- Plan 2026-09-05 §1.2c : verdict unique — un résultat non
                     découpage n'affiche JAMAIS de badge vert.
                     U3 passe 3 : les bandeaux maison `report__unfit` /
                     `report__partial` sont remplacés par `CapacityPanel`,
                     le composant des leviers chiffrés de la page projet —
                     mêmes leviers, mêmes actions, une seule implémentation.
                     Le partiel garde son ton ambre (Z3). -->
                <CapacityPanel
                    v-if="isUnfit && capacityPanel"
                    :panel="capacityPanel"
                    tone="danger"
                    :title="t('report.unfit.title')"
                    :detail="unfitDetail"
                    :show-retry="false"
                    data-testid="report-unfit"
                    @add-sheet="$emit('unfit-add-sheet')"
                    @reduce-spacing="$emit('unfit-reduce-spacing', capacityPanel.reduceSpacingToMm)"
                />
                <CapacityPanel
                    v-else-if="isPartial && partialHasLevers && capacityPanel"
                    :panel="capacityPanel"
                    tone="warn"
                    :title="t('report.partial.title', { n: partialUnplacedCount })"
                    :detail="t('report.partial.detail')"
                    :show-retry="false"
                    data-testid="report-partial"
                    @add-sheet="$emit('unfit-add-sheet')"
                    @reduce-spacing="$emit('unfit-reduce-spacing', capacityPanel.reduceSpacingToMm)"
                />
                <!-- Lot E2 : pièces plus fines que l'espacement demandé. Le
                     moteur les a préparées autrement et le job est livré :
                     une INFORMATION, jamais un badge rouge. -->
                <p
                    v-if="thinPartsLine"
                    class="report__thin"
                    data-testid="report-thin-parts"
                >
                    {{ thinPartsLine }}
                </p>
                <div class="report__badges" data-testid="report-badges">
                    <span
                        v-for="badge in reportBadges"
                        :key="badge.label"
                        class="report__badge"
                        :class="{ 'report__badge--ko': badge.ok === false }"
                        data-testid="report-badge"
                        :data-ok="badge.ok === false ? 'false' : 'true'"
                    >
                        {{ badge.ok === false ? '✗' : '✓' }} {{ badge.label }}
                    </span>
                </div>
                <!-- C03/C12 (audit UX 2026-09-05) : le post-pass (rollback
                     compris) et les paramètres moteur ne sont plus des
                     badges — un résultat découpable n'affiche JAMAIS de
                     rouge « Post-pass … rollback ». Ils vivent repliés
                     dans les détails techniques ; seed/cores absents
                     masqués ; « combinations tested » reformulé honnêtement
                     (ce sont les itérations du recuit moteur). -->
                <details v-if="hasTechDetails" class="report__tech" data-testid="report-tech">
                    <summary>{{ t('report.techDetails') }}</summary>
                    <!-- AB2 (L2-bis) : une option écartée au filet final
                         n'est plus perdue en silence — info repliée. -->
                    <p v-if="discardedCount" class="report__tech-line" data-testid="report-discarded">
                        {{ t('report.discarded', { n: discardedCount }) }}
                    </p>
                    <div class="report__engine" data-testid="report-engine">
                        nest-engine<template v-if="activeAltSeed"> · seed {{ activeAltSeed }}</template>
                        <template v-if="activeReport.iterations"> · {{ activeReport.iterations === 1 ? t('report.iterationsOne') : t('report.iterations', { n: activeReport.iterations }) }}</template>
                        <template v-if="activeReport.vcores"> · {{ activeReport.vcores === 1 ? t('report.coresOne') : t('report.cores', { n: activeReport.vcores }) }}</template>
                    </div>
                    <p v-for="(line, i) in postPassLines" :key="i" class="report__tech-line">
                        {{ line }}
                    </p>
                </details>
            </div>
            <div class="controls" data-testid="report-actions">
                <MainButton
                    v-if="reportSheets.length"
                    :label="exportLocked ? t('report.exportLocked') : (copied ? t('report.copied') : t('report.copy'))"
                    :icon="exportLocked ? iconType.lock : undefined"
                    :isDisable="exportDisabled"
                    :size="sizeType.s"
                    :theme="themeType.secondary"
                    trackingTag="report_copy"
                    @click="onExportClick(copyReport, 'report_copy_locked_click')"
                />
                <MainButton
                    v-if="reportSheets.length"
                    :label="exportLocked ? t('report.exportLocked') : t('report.csv')"
                    :icon="exportLocked ? iconType.lock : undefined"
                    :isDisable="exportDisabled"
                    :size="sizeType.s"
                    :theme="themeType.secondary"
                    trackingTag="report_csv"
                    @click="onExportClick(exportCsv, 'report_csv_locked_click')"
                />
                <MainButton
                    v-if="resultModalData.isMultiSheet && !isLocal"
                    :href="resultModalData.zipDownloadUrl"
                    :label="t('results.downloadAll')"
                    tag="a"
                    :isDisable="isHaveError || isUnfit"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download_all"
                />
                <MainButton
                    v-if="resultModalData.isMultiSheet && isLocal"
                    :label="t('results.downloadAll')"
                    :isDisable="isHaveError || isUnfit"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download_all"
                    @click="downloadLocalAll"
                />
                <MainButton
                    v-if="!resultModalData.isMultiSheet && !isLocal"
                    :href="currentDxfs[0]"
                    :label="t('results.download')"
                    tag="a"
                    download
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download"
                />
                <MainButton
                    v-if="!resultModalData.isMultiSheet && isLocal"
                    :label="t('results.download')"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download"
                    @click="downloadLocalSingle"
                />
                <MainButton
                    :label="t('result.tryAgain')"
                    :size="sizeType.s"
                    :theme="themeType.secondary"
                    trackingTag="result_try_again"
                    @click="$emit('close')"
                />
            </div>
    </div>
</template>

<script setup>
import { iconType } from '~~/constants/icon.constants'
import { sizeType } from '~~/constants/size.constants'
import { themeType } from '~~/constants/theme.constants'

const props = defineProps({ d: { type: Object, required: true } })
const emit = defineEmits([
    'unfit-add-sheet', 'unfit-reduce-spacing', 'export', 'download-all',
    'download-single', 'close', 'copy-slug',
])

const t = (...a) => props.d.t(...a)
const fmtPercent = (...a) => props.d.fmtPercent(...a)
const fmtArea = (...a) => props.d.fmtArea(...a)
const fmtLength = (...a) => props.d.fmtLength(...a)
const fmtLengthValue = (...a) => props.d.fmtLengthValue(...a)
const fmtAreaStacked = (...a) => props.d.fmtAreaStacked(...a)
const unitLabel = computed(() => props.d.unitLabel)
const resultModalData = computed(() => props.d.resultModalData)
const isHaveError = computed(() => props.d.isHaveError)
const isUnfit = computed(() => props.d.isUnfit)
const isPartial = computed(() => props.d.isPartial)
const isLocal = computed(() => props.d.isLocal)
const partialHasLevers = computed(() => props.d.partialHasLevers)
const partialUnplacedCount = computed(() => props.d.partialUnplacedCount)
const unfitData = computed(() => props.d.unfitData)
const activeReport = computed(() => props.d.activeReport)
const activeReportOffcut = computed(() => props.d.activeReportOffcut)
const activeOffcut = computed(() => props.d.activeOffcut)
const activeAltSeed = computed(() => props.d.activeAltSeed)
const densityPct = computed(() => props.d.densityPct)
const freeAreaMm2 = computed(() => props.d.freeAreaMm2)
const reportTotals = computed(() => props.d.reportTotals)
const reportSheets = computed(() => props.d.reportSheets)
const reportBadges = computed(() => props.d.reportBadges)
const thinPartsLine = computed(() => props.d.thinPartsLine)
const materialFormats = computed(() => props.d.materialFormats)
const postPassLines = computed(() => props.d.postPassLines)
const hasTechDetails = computed(() => props.d.hasTechDetails)
const discardedCount = computed(() => props.d.discardedCount)
const currentDxfs = computed(() => props.d.currentDxfs)
const capacityPanel = computed(() => props.d.capacityPanel)
// Le detail du refus : le depassement mesure quand on l'a.
const unfitDetail = computed(() => {
    const u = unref(unfitData) || {}
    return t('report.unfit.detail', {
        n: u.overflowMm != null
            ? fmtLengthValue(u.overflowMm, unref(unitLabel) === '"' ? 4 : 2)
            : null,
        unit: unref(unitLabel),
    })
})
const headlineTitle = computed(() => props.d.headlineTitle)
const activeStrategyExplain = computed(() => props.d.activeStrategyExplain)
const name = computed(() => props.d.name)
const exportLocked = computed(() => props.d.exportLocked)
const exportDisabled = computed(() => props.d.exportDisabled)
const copied = computed(() => props.d.copied)

// L'orchestrateur garde la politique d'export (paywall) : on lui passe
// l'intention, il decide.
const onExportClick = (action, trackingTag) => emit('export', { action, trackingTag })
const copyReport = 'copy'
const exportCsv = 'csv'
const downloadLocalAll = () => emit('download-all')
const downloadLocalSingle = () => emit('download-single')
// Le bloc rapport doit rester atteignable par scrollIntoView (ouverture
// « Rapport de nesting » depuis la carte de resultat).
const reportEl = ref(null)
defineExpose({ reportEl })
</script>

<style lang="scss" scoped>
/* U3 passe 2 : le volet rapport. Il defile seul (le dialogue ne bouge
   pas) et son en-tete porte l'identite du resultat. */
.result-report {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);

    &__head {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding-bottom: var(--sp-2);
        border-bottom: 1px solid var(--separator-secondary);
        text-align: left;
    }

    /* U3 passe 3 : etat de placement — badge, aligne a gauche. */
    &__state {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--sp-2);
        margin-top: var(--sp-2);
    }

    &__state-note {
        font-size: var(--fs-12);
        color: var(--label-tertiary);
    }

    /* Le slug etait une ligne morte : c'est un bouton « Copier
       l'identifiant » (toast a la copie). */
    &__slug {
        align-self: flex-start;
        max-width: 100%;
        padding: 2px 0;
        border: 0;
        background: none;
        text-align: left;
        cursor: pointer;
        word-break: break-all;

        @media (hover: hover) {
            &:hover {
                color: var(--accent-primary);
                text-decoration: underline;
            }
        }
    }
}

.headline {
    &__title {
        margin: 0;
        font-size: var(--fs-16);
        font-weight: 700;
        color: var(--label-primary);
    }

    &__slug {
        margin: 4px 0 0;
        font-size: var(--fs-12);
        color: var(--label-tertiary);
        word-break: break-all;
        font-family: $sf_mono;
    }

    &__explain {
        margin: 2px 0 0;
        font-size: var(--fs-12);
        color: var(--label-tertiary);
    }
}

.summary {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px var(--sp-2);
    margin-top: var(--sp-2);
    font-size: var(--fs-13);

    &__label {
        flex-shrink: 0;
        font-weight: 600;
        color: var(--label-primary);
    }

    /* En-tete de densite : le grand chiffre du plan. */
    &__value {
        flex-shrink: 0;
        font-size: var(--fs-32);
        font-weight: 800;
        line-height: 1;
        color: var(--label-primary);
        font-variant-numeric: tabular-nums;
    }

    &__bar {
        flex: 1 1 100%;
        height: 6px;
        border-radius: var(--radius-s);
        background-color: var(--fill-tertiary);
        overflow: hidden;
    }

    &__bar-fill {
        height: 100%;
        border-radius: var(--radius-s);
        background-color: var(--accent-primary);
    }
}
.modal {
    &__name {
        display: flex;
        justify-content: center;
        align-items: center;
        text-align: center;
        margin-top: 10px;
        margin-bottom: 10px;
        min-height: 42px;
        color: var(--label-primary);
        margin-left: auto;
        margin-right: auto;
        word-break: break-all;

        @media (min-width: 567px) {
            max-width: 620px;
        }
    }

    &__info {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        color: var(--label-primary);

        &>* {
            margin-bottom: 10px;
        }
    }
}

.report {
    margin-top: 12px;
    padding: 14px 16px;
    border: 1px solid var(--separator-secondary);
    border-radius: var(--radius-l);
    background-color: var(--background-primary);
    text-align: left;
    font-size: var(--fs-14);
    line-height: 1.45;
    color: var(--label-secondary);

    &__row {
        display: flex;
        align-items: center;
        gap: 8px;

        &:not(:last-child) {
            margin-bottom: 8px;
        }

        &--detail {
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 4px 12px;
            font-variant-numeric: tabular-nums;
        }
    }

    &__label {
        flex-shrink: 0;
        font-weight: 600;
        color: var(--label-primary);
    }

    &__bar {
        flex: 1;
        height: 6px;
        border-radius: var(--radius-s);
        background-color: var(--fill-tertiary);
        overflow: hidden;
    }

    &__bar-fill {
        height: 100%;
        border-radius: var(--radius-s);
        background-color: var(--accent-primary);
        transition: width 0.4s ease;
    }

    &__value {
        flex-shrink: 0;
        font-weight: 700;
        color: var(--label-primary);
        font-variant-numeric: tabular-nums;
    }

    &__thin {
        margin: 0 0 6px;
        color: var(--label-secondary);
        font-size: 13px;
    }
    &__badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
    }

    &__badge {
        padding: 2px 9px;
        border-radius: var(--radius-l);
        font-size: var(--fs-12);
        font-weight: 700;
        /* a11y : rgb(46,125,50) sur son propre fond teinté = 4,23:1.
           `--ok` (#157036) donne 5,09:1 — c'est aussi le vert de la charte. */
        background-color: color-mix(in srgb, var(--ok) 12%, transparent);
        color: var(--ok);

        &--ko {
            background-color: color-mix(in srgb, var(--error-border, rgb(198, 40, 40)) 12%, transparent);
            color: var(--error-text, rgb(198, 40, 40));
        }

        // Scrap offcut: informational, never alarming (not an error).
        &--scrap {
            background-color: color-mix(in srgb, var(--label-tertiary, rgb(138, 147, 159)) 14%, transparent);
            color: var(--label-tertiary, rgb(138, 147, 159));
        }
    }

    &__hint {
        font-size: var(--fs-12);
        color: var(--label-tertiary);
    }

    // ft² under in² in the per-sheet table (both units, narrow columns).
    &__area-sub {
        display: block;
        font-size: var(--fs-12);
        color: var(--label-tertiary);
    }

    &__material {
        padding-top: 10px;
        margin-top: 2px;
        border-top: 1px solid var(--separator-secondary);
        font-size: var(--fs-14);
    }

    /* U3 passe 3 : le tableau s'adapte a la LARGEUR DU VOLET (requete de
       conteneur), pas a celle de la fenetre. Sous 1200 px de volet il
       tombe a cinq colonnes — #, Tole, Pieces, Densite, Chute — et
       « Utilise » / « Libre » passent en ligne secondaire sous le format :
       rien n'est rogne et il n'y a pas de defilement horizontal cache. */
    &__table-wrap {
        container-type: inline-size;
        overflow-x: auto;
        margin-bottom: 8px;
    }

    &__col-area {
        display: none;
    }

    /* Dans un volet etroit ces deux cellules RESPIRENT sur deux lignes :
       c'est ce qui fait tenir les cinq colonnes sans rien rogner. */
    &__sheet-sub {
        display: block;
        font-size: var(--fs-12);
        color: var(--label-tertiary);
        white-space: normal;
    }

    &__cell-sheet,
    &__cell-offcut {
        white-space: normal;
        min-width: 92px;
    }

    &__badge--block {
        display: inline-block;
        margin-top: 2px;
    }

    &__table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--fs-13);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;

        th,
        td {
            padding: 5px 8px;
            text-align: right;
        }

        // Sheet number and format read left-to-right.
        th:first-child,
        td:first-child,
        th:nth-child(2),
        td:nth-child(2) {
            text-align: left;
        }

        thead th {
            color: var(--label-tertiary);
            font-weight: 600;
            border-bottom: 1px solid var(--separator-secondary);
        }

        tbody tr:not(:last-child) td {
            border-bottom: 1px solid var(--fill-tertiary);
        }

        td {
            vertical-align: top;
        }
    }

    @container (min-width: 1200px) {
        .report__col-area {
            display: table-cell;
        }

        .report__sheet-sub {
            display: none;
        }

        .report__badge--block {
            display: inline;
            margin-top: 0;
        }
    }

    &__engine {
        font-size: var(--fs-12);
        color: var(--label-tertiary);
        font-variant-numeric: tabular-nums;
    }
}

.controls {
    display: flex;
    flex-wrap: wrap;
    row-gap: 8px;
    align-items: center;
    justify-content: center;

    &>* {
        margin-left: 4px;
        margin-right: 4px;
    }
}

/* C03/C12 : details techniques REPLIES — post-pass (rollback compris),
   seed/iterations/coeurs moteur. Un resultat decoupable n'affiche jamais
   de rouge « Post-pass … rollback ». */
.report__tech {
    margin: 6px 0;

    & summary {
        cursor: pointer;
        font-size: var(--fs-12);
        color: var(--label-tertiary);
        user-select: none;
    }

    & .report__engine {
        margin: 4px 0 0;
        font-size: var(--fs-12);
        color: var(--label-tertiary);
        font-variant-numeric: tabular-nums;
    }

    & .report__tech-line {
        margin: 2px 0 0;
        font-size: var(--fs-12);
        color: var(--label-tertiary);
    }
}
</style>
