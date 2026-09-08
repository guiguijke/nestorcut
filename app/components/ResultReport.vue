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
                v-if="!isHaveError"
                class="modal__info info"
            >
                <span
                    v-if="resultModalData.requested === resultModalData.placed"
                    class="info__label"
                >
                    {{ t('result.allPlaced') }}
                </span>
                <template v-else>
                    <span class="info__label">
                        {{ t('result.neededToPlace', { n: resultModalData.requested }) }}
                    </span>
                    <span class="info__label">
                        {{ t('result.placed', { n: resultModalData.placed }) }}
                    </span>
                </template>
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
                <div
                    v-if="reportSheets.length"
                    class="report__table-wrap"
                >
                    <table class="report__table">
                        <thead>
                            <tr>
                                <th>{{ t('report.sheet.num') }}</th>
                                <th>{{ t('report.sheet.format') }}</th>
                                <th>{{ t('report.sheet.parts') }}</th>
                                <th>{{ t('report.sheet.used') }}</th>
                                <th>{{ t('report.sheet.free') }}</th>
                                <th>{{ t('report.sheet.density') }}</th>
                                <th>{{ t('report.sheet.offcut') }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="s in reportSheets" :key="s.index" data-testid="report-row">
                                <td>{{ s.index + 1 }}</td>
                                <td>{{ fmtLength(s.widthMm) }} × {{ fmtLength(s.heightMm) }}</td>
                                <td>{{ s.partCount }}</td>
                                <td>
                                    <span class="report__area">{{ fmtAreaStacked(s.partsAreaMm2).main }}</span>
                                    <span v-if="fmtAreaStacked(s.partsAreaMm2).sub" class="report__area-sub">{{ fmtAreaStacked(s.partsAreaMm2).sub }}</span>
                                </td>
                                <td>
                                    <span class="report__area">{{ fmtAreaStacked(s.freeAreaMm2).main }}</span>
                                    <span v-if="fmtAreaStacked(s.freeAreaMm2).sub" class="report__area-sub">{{ fmtAreaStacked(s.freeAreaMm2).sub }}</span>
                                </td>
                                <td>{{ s.densityPct != null ? fmtPercent(s.densityPct) : '—' }}</td>
                                <td>
                                    <template v-if="s.offcut">
                                        {{ fmtLengthValue(s.offcut.widthMm) }} × {{ fmtLengthValue(s.offcut.heightMm) }} {{ unitLabel }}
                                        <span
                                            class="report__badge"
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
                     découpage n'affiche JAMAIS de badge vert. -->
                <div v-if="isUnfit" class="report__unfit">
                    <div class="report__unfit-title">{{ t('report.unfit.title') }}</div>
                    <div class="report__unfit-detail">
                        {{ t('report.unfit.detail', {
                            n: unfitData.overflowMm != null
                                ? fmtLengthValue(unfitData.overflowMm, unitLabel.value === '"' ? 4 : 2)
                                : null,
                            unit: unitLabel,
                        }) }}
                    </div>
                    <ul class="report__unfit-levers">
                        <li v-if="unfitData.sheetsNeeded">
                            {{ t('report.unfit.sheetsNeeded', { n: unfitData.sheetsNeeded }) }}
                        </li>
                        <li v-if="unfitData.maxParts != null">
                            {{ t('report.unfit.maxParts', { n: unfitData.maxParts }) }}
                        </li>
                        <li v-if="unfitData.maxSpacingMm != null">
                            {{ t('report.unfit.maxSpacing', { v: unfitData.maxSpacingMm }) }}
                        </li>
                    </ul>
                    <div class="report__unfit-actions">
                        <MainButton
                            :label="t('report.unfit.addSheet')"
                            :size="sizeType.s"
                            :theme="themeType.primary"
                            @click="$emit('unfit-add-sheet')"
                        />
                        <MainButton
                            v-if="unfitData.maxSpacingMm != null"
                            :label="t('report.unfit.reduceSpacing', { v: unfitData.maxSpacingMm })"
                            :size="sizeType.s"
                            :theme="themeType.secondary"
                            @click="$emit('unfit-reduce-spacing', unfitData.maxSpacingMm)"
                        />
                    </div>
                </div>
                <!-- Z3 (vérif 2026-09-05) : solution partielle UTILE — le
                     résultat posé est découpage (pas de rouge), mais
                     l'utilisateur sait quoi faire du reste : leviers sous le
                     badge « n pièces non placées ». -->
                <div
                    v-if="isPartial && partialHasLevers"
                    class="report__partial"
                    data-testid="report-partial"
                >
                    <div class="report__partial-title">
                        {{ t('report.partial.title', {
                            n: partialUnplacedCount,
                        }) }}
                    </div>
                    <div class="report__partial-detail">{{ t('report.partial.detail') }}</div>
                    <ul class="report__unfit-levers">
                        <li v-if="unfitData.sheetsNeeded">
                            {{ t('report.unfit.sheetsNeeded', { n: unfitData.sheetsNeeded }) }}
                        </li>
                        <li v-if="unfitData.maxParts != null">
                            {{ t('report.unfit.maxParts', { n: unfitData.maxParts }) }}
                        </li>
                        <li v-if="unfitData.maxSpacingMm != null">
                            {{ t('report.unfit.maxSpacing', { v: unfitData.maxSpacingMm }) }}
                        </li>
                    </ul>
                    <div class="report__unfit-actions">
                        <MainButton
                            v-if="unfitData.sheetsNeeded"
                            :label="t('report.unfit.addSheet')"
                            :size="sizeType.s"
                            :theme="themeType.primary"
                            @click="$emit('unfit-add-sheet')"
                        />
                        <MainButton
                            v-if="unfitData.maxSpacingMm != null"
                            :label="t('report.unfit.reduceSpacing', { v: unfitData.maxSpacingMm })"
                            :size="sizeType.s"
                            :theme="themeType.secondary"
                            @click="$emit('unfit-reduce-spacing', unfitData.maxSpacingMm)"
                        />
                    </div>
                </div>
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
const materialFormats = computed(() => props.d.materialFormats)
const postPassLines = computed(() => props.d.postPassLines)
const hasTechDetails = computed(() => props.d.hasTechDetails)
const discardedCount = computed(() => props.d.discardedCount)
const currentDxfs = computed(() => props.d.currentDxfs)
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
.report__unfit {
    grid-column: 1 / -1;
    border: 1px solid var(--danger);
    background: rgba(220, 38, 38, 0.08);
    border-radius: var(--radius-l);
    padding: 10px 12px;
    margin: 6px 0;
}
.report__unfit-title {
    color: var(--danger);
    font-weight: 600;
}
.report__unfit-levers {
    margin: 6px 0 0 18px;
    padding: 0;
}
.report__unfit-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
    flex-wrap: wrap;
}

/* Z3 (vérif 2026-09-05) : solution partielle — ambre, pas rouge : le
   résultat posé est utilisable et découpage. */
.report__partial {
    grid-column: 1 / -1;
    border: 1px solid var(--warn);
    background: rgba(217, 119, 6, 0.08);
    border-radius: var(--radius-l);
    padding: 10px 12px;
    margin: 6px 0;
}
.report__partial-title {
    color: var(--warn);
    font-weight: 600;
}
.report__partial-detail {
    margin-top: 2px;
    font-size: var(--fs-12);
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
        background-color: color-mix(in srgb, var(--system-green, rgb(46, 125, 50)) 12%, transparent);
        color: var(--system-green, rgb(46, 125, 50));

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

    &__table-wrap {
        overflow-x: auto;
        margin-bottom: 8px;
    }

    &__table {
        width: 100%;
        /* U3 passe 2 : dans le volet 1/3 le tableau a 7 colonnes ne tient
           pas — il DEFILE dans son conteneur (report__table-wrap) au lieu
           d'etre rogne a droite. */
        min-width: 620px;
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
