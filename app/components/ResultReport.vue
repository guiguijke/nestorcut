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
                <!-- E4-a : le badge compte les BLOCS demandés ; le décompte
                     des pièces du dessin voyage en annotation (§8.1.3). -->
                <UiBadge
                    v-if="resultModalData.requested === resultModalData.placed"
                    tone="ok"
                    dot
                    data-testid="badge-all-placed"
                >
                    {{ blocksInfo ? t('result.allPlacedBlocks', { m: blocksInfo.pieces, n: blocksInfo.placed }) : t('result.allPlaced') }}
                </UiBadge>
                <template v-else>
                    <UiBadge tone="warn" dot data-testid="badge-partial-placed">
                        {{ t('result.placed', { n: resultModalData.placed }) }}
                    </UiBadge>
                    <span class="result-report__state-note">
                        {{ t('result.neededToPlace', { n: resultModalData.requested }) }}
                    </span>
                </template>
                <span
                    v-if="blocksInfo"
                    class="result-report__state-note"
                    data-testid="blocks-count"
                >
                    {{ t('report.blocks', { n: blocksInfo.placed, m: blocksInfo.pieces }) }}
                </span>
            </div>
        </header>
            <!-- D10 (02/11) : refus de capacité rouvert (le panneau de la page
                 disparaît au rechargement) — les leviers et l'action au lieu
                 des lignes brutes et du code `capacity_exceeded`. -->
            <CapacityPanel
                v-if="capacityErrorPanel"
                :panel="reportCapacityPanel"
                tone="danger"
                :title="t('nest.capacity.title')"
                :detail="t('nest.capacity.refunded')"
                :show-retry="false"
                :open-project="capacityOpenProject"
                data-testid="report-capacity"
                @add-sheet="$emit('unfit-add-sheet')"
                @reduce-spacing="$emit('unfit-reduce-spacing', capacityPanel.reduceSpacingToMm)"
                @open-project="$emit('unfit-open-project')"
            />
            <div v-if="isHaveError && !capacityErrorPanel" class="modal__name modal__info info">
                <span class="info__label">
                    {{ t('result.noSolution') }}
                </span>
                <span v-if="failureDetail" class="info__label info__label--detail" data-testid="failure-detail">
                    {{ failureDetail }}
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
                <!-- Bloc de tête « quoi commander » : le format et le nombre de
                     tôles en gros, les aires dans UNE seule unité, la chute
                     une seule fois (la densité vit dans l'en-tête du volet). -->
                <section
                    class="report__order order"
                    data-testid="report-order"
                    :aria-label="t('report.material')"
                >
                    <h3 class="order__title">{{ t('report.material') }}</h3>
                    <p
                        v-if="reportTotals && materialFormats"
                        class="order__formats"
                        data-testid="report-material"
                    >{{ materialFormats }}</p>
                    <p class="order__areas" data-testid="report-areas">
                        {{ t('report.areas', { parts: fmtArea(activeReport.partsAreaMm2), free: fmtArea(freeAreaMm2) }) }}
                    </p>
                    <p
                        v-if="activeReportOffcut"
                        class="order__offcut report__offcut"
                        data-testid="report-offcut"
                    >
                        {{ t('report.offcut', { w: fmtLengthValue(activeReportOffcut.widthMm), h: fmtLengthValue(activeReportOffcut.heightMm), unit: unitLabel }) }}
                        · {{ fmtArea(activeReportOffcut.areaMm2) }}
                        <span
                            class="report__badge"
                            :class="{ 'report__badge--scrap': !activeReportOffcut.reusable }"
                        >
                            {{ activeReportOffcut.reusable ? t('report.offcut.reusable') : t('report.offcut.scrap') }}
                        </span>
                        <span class="report__hint">&nbsp;({{ t('report.offcut.atLeast') }})<HelpDot topic="offcut" /></span>
                    </p>
                    <p
                        v-else-if="activeOffcut"
                        class="order__offcut"
                        data-testid="report-offcut"
                    >{{ t('report.offcut', { w: fmtLengthValue(activeOffcut.width), h: fmtLengthValue(activeOffcut.height), unit: unitLabel }) }}</p>
                </section>
                <!-- Lot J4-bis : les constats de réserve d'amorce. Sans eux
                     la dégradation est SÛRE mais MUETTE : un trou laissé vide
                     parce que l'amorce n'y tenait pas ne se voyait nulle part.
                     Bloc ADDITIF, absent pour tout job sans `.job`. -->
                <div
                    v-if="leadInNotes.length"
                    class="report__row report__row--detail report__reserve"
                    data-testid="reserve-notes"
                >
                    <span
                        v-for="(note, i) in leadInNotes"
                        :key="i"
                        class="report__hint"
                    >{{ note }}</span>
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
                    <!-- Rôles explicites : sur téléphone le tableau devient une
                         pile de mini-cartes (display: block) et garde ainsi
                         sa sémantique de tableau. -->
                    <table class="report__table" role="table">
                        <thead role="rowgroup">
                            <tr role="row">
                                <th role="columnheader">{{ t('report.sheet.num') }}</th>
                                <th role="columnheader">{{ t('report.sheet.format') }}</th>
                                <th role="columnheader">{{ t('report.sheet.parts') }}</th>
                                <th role="columnheader" class="report__col-area">{{ t('report.sheet.used') }}</th>
                                <th role="columnheader" class="report__col-area">{{ t('report.sheet.free') }}</th>
                                <th role="columnheader">{{ t('report.sheet.density') }}</th>
                                <th v-if="showOffcutCol" role="columnheader">{{ t('report.sheet.offcut') }}</th>
                            </tr>
                        </thead>
                        <tbody role="rowgroup">
                            <tr v-for="s in reportSheets" :key="s.index" role="row" data-testid="report-row">
                                <td role="cell" :data-label="t('report.sheet.num')">{{ s.index + 1 }}</td>
                                <td role="cell" class="report__cell-sheet" :data-label="t('report.sheet.format')">
                                    <span class="report__dims">{{ sheetDims(s.widthMm, s.heightMm) }}</span>
                                    <!-- Volet etroit : « Utilise » et « Libre »
                                         ne sont pas perdus, ils passent en
                                         ligne secondaire sous le format. -->
                                    <span class="report__sheet-sub" data-testid="report-row-areas">
                                        {{ t('report.sheet.used') }} {{ fmtArea(s.partsAreaMm2) }}
                                        · {{ t('report.sheet.free') }} {{ fmtArea(s.freeAreaMm2) }}
                                    </span>
                                </td>
                                <td role="cell" :data-label="t('report.sheet.parts')">{{ s.partCount }}</td>
                                <td role="cell" class="report__col-area">
                                    <span class="report__area">{{ fmtAreaStacked(s.partsAreaMm2).main }}</span>
                                    <span v-if="fmtAreaStacked(s.partsAreaMm2).sub" class="report__area-sub">{{ fmtAreaStacked(s.partsAreaMm2).sub }}</span>
                                </td>
                                <td role="cell" class="report__col-area">
                                    <span class="report__area">{{ fmtAreaStacked(s.freeAreaMm2).main }}</span>
                                    <span v-if="fmtAreaStacked(s.freeAreaMm2).sub" class="report__area-sub">{{ fmtAreaStacked(s.freeAreaMm2).sub }}</span>
                                </td>
                                <td role="cell" :data-label="t('report.sheet.density')">{{ s.densityPct != null ? fmtPercent(s.densityPct) : '—' }}</td>
                                <td v-if="showOffcutCol" role="cell" class="report__cell-offcut" :data-label="t('report.sheet.offcut')">
                                    <template v-if="s.offcut">
                                        <span class="report__dims">{{ sheetDims(s.offcut.widthMm, s.offcut.heightMm) }}</span>
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
                    :panel="reportCapacityPanel"
                    tone="danger"
                    :title="t('report.unfit.title')"
                    :detail="unfitDetail"
                    :show-retry="false"
                    :open-project="capacityOpenProject"
                    data-testid="report-unfit"
                    @add-sheet="$emit('unfit-add-sheet')"
                    @reduce-spacing="$emit('unfit-reduce-spacing', capacityPanel.reduceSpacingToMm)"
                    @open-project="$emit('unfit-open-project')"
                />
                <CapacityPanel
                    v-else-if="isPartial && partialHasLevers && capacityPanel"
                    :panel="reportCapacityPanel"
                    tone="warn"
                    :title="t('report.partial.title', { n: partialUnplacedCount })"
                    :detail="t('report.partial.detail')"
                    :show-retry="false"
                    :open-project="capacityOpenProject"
                    :free-note="freeDownloadNote"
                    data-testid="report-partial"
                    @add-sheet="$emit('unfit-add-sheet')"
                    @reduce-spacing="$emit('unfit-reduce-spacing', capacityPanel.reduceSpacingToMm)"
                    @open-project="$emit('unfit-open-project')"
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
                <div class="report__badges" data-testid="report-badges"><HelpDot topic="badges" />
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
                    <!-- Lot J11-bis (R4) : le slug technique — l'en-tête
                         montre le NOM DU PROJET, l'identifiant reste
                         visible ici. -->
                    <p v-if="props.d.resultSlug" class="report__tech-line" data-testid="report-slug">
                        {{ t('report.techSlug', { slug: props.d.resultSlug }) }}
                    </p>
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
            <div class="controls" data-testid="report-actions"><HelpDot topic="downloads" />
                <MainButton
                    v-if="reportSheets.length"
                    :label="copied ? t('report.copied') : t('report.copy')"
                    :icon="exportLocked ? iconType.lock : undefined"
                    :isDisable="exportDisabled"
                    :size="sizeType.s"
                    :theme="themeType.ghost"
                    trackingTag="report_copy"
                    @click="onExportClick(copyReport, 'report_copy_locked_click')"
                />
                <MainButton
                    v-if="reportSheets.length"
                    :label="t('report.csv')"
                    :icon="exportLocked ? iconType.lock : undefined"
                    :isDisable="exportDisabled"
                    :size="sizeType.s"
                    :theme="themeType.ghost"
                    trackingTag="report_csv"
                    @click="onExportClick(exportCsv, 'report_csv_locked_click')"
                />
                <!-- Une seule action principale : le téléchargement. Débloquer,
                     copier, CSV et recommencer passent au second plan sans
                     rien perdre (cadenas, message, clic vers l'abonnement). -->
                <!-- O2 (02/11) : le compte télécharge les tôles 1-2 de
                     l'alternative 0 (D4) ; le reste se débloque ici. Pas de
                     trackingTag (D18) : l'orchestrateur trace l'événement
                     avec ses données. Désactivé pendant la vérification d'un
                     retour de paiement (D17). -->
                <MainButton
                    v-if="unlockOffered"
                    :label="checkoutChecking ? t('sub.return.activating') : t('results.unlockSheets', { n: unlockTotal })"
                    :icon="iconType.lock"
                    :isDisable="checkoutChecking"
                    :size="sizeType.s"
                    :theme="themeType.secondary"
                    data-testid="report-unlock"
                    @click="$emit('unlock-sheets', 'modal_actions')"
                />
                <MainButton
                    v-if="resultModalData.isMultiSheet && !isLocal"
                    :href="resultModalData.zipDownloadUrl"
                    :label="downloadGate.anyLocked ? t('results.downloadFirstSheets', { n: downloadGate.cap }) : t('results.downloadAll')"
                    tag="a"
                    :isDisable="isHaveError || isUnfit"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download_all"
                />
                <!-- Lot J8-a — sur un projet issu d'un `.job`, le `.job` EST
                     la sortie attendue (« si je mets des .job, je m'attends à
                     télécharger un .job ») : PRIMAIRE et EN TÊTE ; le DXF
                     devient secondaire et dit son nom. Ordre et thèmes
                     Mesurés au harnais ; sans `.job` déposé, rien ne bouge. -->
                <NewBadge feature="job-download-primary" />
                <MainButton
                    v-if="isLocal && resultModalData.hasJobs && resultModalData.isMultiSheet"
                    :label="jobGate.anyLocked ? t('jobImport.downloadFirstJobs', { n: jobGate.cap }) : t('jobImport.downloadAllJobs')"
                    :isDisable="isHaveError || isUnfit"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download_job_all"
                    @click="downloadLocalAllJobs"
                />
                <MainButton
                    v-if="isLocal && resultModalData.hasJobs && !resultModalData.isMultiSheet"
                    :label="t('jobImport.downloadJob')"
                    :isDisable="isHaveError || isUnfit"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download_job"
                    @click="downloadLocalJob"
                />
                <MainButton
                    v-if="resultModalData.isMultiSheet && isLocal"
                    :label="downloadGate.anyLocked
                        ? t('results.downloadFirstSheets', { n: downloadGate.cap })
                        : t(resultModalData.hasJobs ? 'results.downloadAllDxf' : 'results.downloadAll')"
                    :isDisable="isHaveError || isUnfit"
                    :size="sizeType.s"
                    :theme="resultModalData.hasJobs ? themeType.secondary : themeType.primary"
                    trackingTag="result_download_all"
                    @click="downloadLocalAll"
                />
                <MainButton
                    v-if="!resultModalData.isMultiSheet && !isLocal"
                    :href="currentDxfs[0]"
                    :label="t('results.download')"
                    tag="a"
                    download
                    :isDisable="isHaveError || isUnfit"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    trackingTag="result_download"
                />
                <MainButton
                    v-if="!resultModalData.isMultiSheet && isLocal"
                    :label="t(resultModalData.hasJobs ? 'results.downloadDxf' : 'results.download')"
                    :isDisable="isHaveError || isUnfit"
                    :size="sizeType.s"
                    :theme="resultModalData.hasJobs ? themeType.secondary : themeType.primary"
                    trackingTag="result_download"
                    @click="downloadLocalSingle"
                />
                <MainButton
                    :label="t('result.tryAgain')"
                    :size="sizeType.s"
                    :theme="themeType.ghost"
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
import { nbspDims, showSheetOffcutColumn } from '~/utils/reportLayout'

const props = defineProps({ d: { type: Object, required: true } })
const emit = defineEmits([
    'unfit-add-sheet', 'unfit-reduce-spacing', 'export', 'download-all',
    'download-single', 'download-job', 'download-all-jobs', 'close', 'copy-slug',
    'unlock-sheets', 'unfit-open-project',
])

const t = (...a) => props.d.t(...a)
const fmtPercent = (...a) => props.d.fmtPercent(...a)
const fmtArea = (...a) => props.d.fmtArea(...a)
const fmtLength = (...a) => props.d.fmtLength(...a)
const fmtLengthValue = (...a) => props.d.fmtLengthValue(...a)
const fmtAreaStacked = (...a) => props.d.fmtAreaStacked(...a)
// Dimensions d'un seul tenant (espaces insécables) et colonne « Chute » seulement
// si elle apporte une information que le bloc de tête n'a pas déjà.
const sheetDims = (w, h) => nbspDims(fmtLengthValue(w), fmtLengthValue(h), props.d.unitLabel)
const showOffcutCol = computed(() =>
    showSheetOffcutColumn(props.d.reportSheets, props.d.activeReportOffcut || props.d.activeOffcut))
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
// E4-a : décompte blocs/pièces du rapport (« N blocs (M pièces) »).
const blocksInfo = computed(() => props.d.activeReport?.blocks ?? null)
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
// O2 (02/11) : verrou des tôles, calculé par l'orchestrateur (§3.13).
const EMPTY_GATE = { anyLocked: false, cap: 0, total: 0 }
const downloadGate = computed(() => props.d.downloadGate || EMPTY_GATE)
const jobGate = computed(() => props.d.jobGate || EMPTY_GATE)
const unlockOffered = computed(() => Boolean(props.d.unlockOffered))
const unlockTotal = computed(() => props.d.unlockTotal)
const checkoutChecking = computed(() => Boolean(props.d.checkoutChecking))
const freeDownloadNote = computed(() => props.d.freeDownloadNote || '')
// Cause de l'échec, avec la même règle que le bandeau de la page : jamais la trace brute du moteur.
const failureDetail = computed(() => props.d.failureDetail || '')
const onJobProject = computed(() => Boolean(props.d.onJobProject))
const capacityErrorPanel = computed(() => Boolean(props.d.capacityErrorPanel))
// D12 (02/11) : hors du projet du job, un seul bouton « Ouvrir le projet »
// (ajouter des tôles ou réduire l'espacement agirait sur les réglages d'un
// AUTRE projet) ; job sans projet connu : aucun bouton, les leviers restent.
const jobProjectSlug = computed(() => props.d.resultModalData?.projectSlug || null)
const capacityOpenProject = computed(() => !unref(onJobProject) && Boolean(unref(jobProjectSlug)))
const reportCapacityPanel = computed(() => {
    const p = unref(capacityPanel)
    if (!p || unref(onJobProject) || unref(jobProjectSlug)) return p
    return { ...p, nextSheets: null, addSheets: null, reduceSpacingToMm: null }
})

// L'orchestrateur garde la politique d'export (paywall) : on lui passe
// l'intention, il decide.
const onExportClick = (action, trackingTag) => emit('export', { action, trackingTag })
const copyReport = 'copy'
const exportCsv = 'csv'
const downloadLocalAll = () => emit('download-all')
const downloadLocalSingle = () => emit('download-single')
// Lot J4 : le `.job` SheetCam d'une tole. L'orchestrateur (ResultModal) sait
// quelle alternative et quelle tole sont a l'ecran.
const downloadLocalJob = () => emit('download-job')
const downloadLocalAllJobs = () => emit('download-all-jobs')

// Lot J4-bis : les constats de reserve d'amorce, en phrases. Un refus de
// reserve ou un trou retire du nesting DOIT se voir — la degradation etait
// sure, elle etait muette. Les libelles portent deja leur raison ; on ne
// fabrique aucun nombre nu (piege #24).
const leadInNotes = computed(() => {
    const notes = []
    for (const n of resultModalData.value?.leadInReserve || []) {
        const name = n.file_slug || ''
        if (n.applied === false && n.reason) {
            notes.push(t('jobImport.reserveRefused', {
                name,
                reason: t(`sheetcamReserve.${n.reason}`),
            }))
        }
        const dropped = Number(n.holesDropped) || 0
        if (dropped > 0) notes.push(t('jobImport.holesDropped', { n: dropped }))
    }
    return notes
})
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

    &__dims {
        white-space: nowrap;
    }

    /* Téléphone : le tableau devient une pile de mini-cartes, une par tôle —
       chaque valeur porte son libellé, plus aucune colonne coupée. */
    @container (max-width: 560px) {
        .report__table {
            display: block;
            white-space: normal;

            thead {
                position: absolute;
                width: 1px;
                height: 1px;
                overflow: hidden;
                clip-path: inset(50%);
            }

            tbody {
                display: block;
            }

            tbody tr {
                display: block;
                padding: 8px 0;

                &:not(:last-child) {
                    border-bottom: 1px solid var(--separator-secondary);
                }
            }

            tbody tr:not(:last-child) td {
                border-bottom: 0;
            }

            td {
                display: flex;
                flex-wrap: wrap;
                justify-content: space-between;
                align-items: baseline;
                gap: 2px 12px;
                padding: 2px 0;
                text-align: right;

                &::before {
                    content: attr(data-label);
                    flex-shrink: 0;
                    font-weight: 600;
                    text-align: left;
                    color: var(--label-tertiary);
                }
            }

            td.report__col-area {
                display: none;
            }
        }

        .report__cell-sheet,
        .report__cell-offcut {
            min-width: 0;
        }

        .report__sheet-sub {
            flex: 1 1 100%;
            text-align: right;
        }

        .report__badge--block {
            margin-top: 0;
        }
    }

    &__engine {
        font-size: var(--fs-12);
        color: var(--label-tertiary);
        font-variant-numeric: tabular-nums;
    }
}

/* Bloc de tête « quoi commander » : ce que l'atelier achète, lisible d'un
   coup d'œil — le format et le nombre de tôles en gros, les aires et la chute
   en dessous. */
.order {
    margin: 0 0 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--separator-secondary);
    font-variant-numeric: tabular-nums;

    &__title {
        margin: 0 0 2px;
        font-size: var(--fs-12);
        font-weight: 600;
        color: var(--label-tertiary);
    }

    &__formats {
        margin: 0;
        font-size: var(--fs-18);
        font-weight: 800;
        line-height: 1.25;
        color: var(--label-primary);
    }

    &__areas,
    &__offcut {
        margin: 4px 0 0;
        font-size: var(--fs-14);
        color: var(--label-secondary);
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
