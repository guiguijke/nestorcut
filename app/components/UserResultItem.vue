<template>
    <div class="result">
        <template v-if="isResultNexting">
            <MainLoader
                :size="sizeType.s"
                :theme="themeType.secondary"
                class="result__display"
            />
            <template v-if="progress">
                <div class="result__progress progress">
                    <div
                        class="progress__bar"
                        :style="{ width: `${progressPercent}%` }"
                    />
                </div>
                <p class="result__text result__text--count">
                    <CoresSpinner
                        v-if="cores"
                        :cores="cores"
                        :size="14"
                        class="result__cores"
                    />
                    {{ progressPercent }}%<template v-if="progress.elapsed_sec != null"> · {{ formatElapsed(progress.elapsed_sec) }}</template>
                </p>
            </template>
            <p v-else class="result__text">
                {{ t('results.nesting') }}
            </p>
            <UiButton
                class="result__cancel"
                variant="ghost"
                size="s"
                :disabled="cancelling"
                @click.stop="cancelNesting"
            >
                {{ cancelling ? t('results.cancelling') : t('results.cancel') }}
            </UiButton>
        </template>
        <template v-else>
            <!-- U2 passe : pas de rectangle gris vide sans vignette
                 (échec / autre appareil). Vignette seulement s'il y a
                 un SVG à montrer. -->
            <div
                v-if="!isResultFailed && !result.localElsewhere && !result.purgedAt && result.svgs?.length"
                :class="svgRowClasses"
                class="result__svg-row"
            >
                <SheetSvgPreview
                    v-for="(svg, svgIndex) in result.svgs"
                    :key="`svg-${svgIndex}`"
                    :src="svg"
                    :width="sheetSizeAt(svgIndex).w"
                    :height="sheetSizeAt(svgIndex).h"
                    class="result__display"
                />
            </div>
            <p class="result__name" data-testid="result-name">
                {{ resultTitle }}
                <UiBadge
                    v-if="stateLabel"
                    :tone="stateTone"
                    dot
                    class="result__state"
                >{{ stateLabel }}</UiBadge>
                <PrivacyChip
                    v-if="privacyMode"
                    :mode="privacyMode"
                    class="result__chip"
                />
            </p>
            <p v-if="timeAgo" class="result__when">
                {{ timeAgo }}
            </p>
            <p v-if="isLocal" class="result__local" :title="t('localMode.done')">
                {{ t('localMode.done') }}
            </p>
            <p v-if="degradedKey" class="result__degraded" data-testid="result-degraded">
                {{ t(degradedKey) }}
            </p>
            <!-- D-PRV-10 : blobs résultats purgés à 24 h — téléchargements
                 masqués, le rapport (scalaires) reste consultable. -->
            <p v-if="result.purgedAt" class="result__expired">
                {{ t('results.expired') }}
            </p>
            <!-- D27 (02/11) : la classe `controls--locked` n'existe QUE si le
                 verrou s'applique (seconde ligne pour « Débloquer ») — la
                 carte d'un payant reste identique au pixel près. -->
            <div
                class="result__controls controls"
                :class="{ 'controls--locked': lockedControls }"
            >
                <MainButton
                    v-if="hasReport"
                    :label="t('result.nestingReport')"
                    :size="sizeType.s"
                    :theme="themeType.secondary"
                    class="controls__report"
                    data-testid="result-report-btn"
                    @click="openReport"
                />
                <!-- Job serveur : href GridFS. Job local (J-082) : contenus
                     persistés en IndexedDB, téléchargement 100 % navigateur.
                     C05 : job localOnly calculé ailleurs — RIEN à télécharger
                     ici (l'ancien « Download All » sans contenu masqué).
                     O2 (02/11) : href inchangé — la route ZIP sert elle-même
                     les seules tôles 1-2 à un compte verrouillé. -->
                <MainButton
                    v-if="isResultCompleted && !isLocal && !result.purgedAt && !result.localElsewhere"
                    :href="downloadUrl"
                    :label="downloadButtonText"
                    tag="a"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    class="controls__download"
                    v-bind="downloadButtonAttrs"
                    @click="onDownload"
                />
                <MainButton
                    v-if="isResultCompleted && isLocal"
                    :label="downloadButtonText"
                    :size="sizeType.s"
                    :theme="themeType.primary"
                    class="controls__download"
                    v-bind="downloadButtonAttrs"
                    @click="downloadLocal"
                />
                <!-- O2 (02/11) : déblocage des tôles 3+ (alternative 0, celle
                     que le bouton télécharge). Libellé court visible, libellé
                     complet en aria-label/title (D27). Pas de trackingTag
                     (D18) : l'événement est tracé avec ses données. -->
                <MainButton
                    v-if="showUnlock"
                    :label="checkoutChecking ? t('sub.return.activating') : t('results.unlockShort')"
                    :aria-label="t('results.unlockSheets', { n: gate.total })"
                    :title="t('results.unlockSheets', { n: gate.total })"
                    :icon="iconType.lock"
                    :isDisable="checkoutChecking"
                    :size="sizeType.s"
                    :theme="themeType.secondary"
                    class="controls__unlock"
                    data-testid="result-unlock"
                    @click="onUnlock"
                />
            </div>
            <UiButton
                variant="ghost"
                class="result__area"
                data-testid="result-area"
                aria-label="Open result details"
                @click="openModal"
            />
        </template>
    </div>
</template>

<script setup>
import { sizeType } from '~~/constants/size.constants';
import { themeType } from '~~/constants/theme.constants';
import { statusType } from "~~/constants/status.constants";
import { trackEvent } from '~/utils/track';
import { altDensityPctOf } from '~/utils/resultQuality';
import { degradedNoteKey, failureReasonKey } from '~/utils/failureReason';
import { computed, ref } from "vue";
import { iconType } from '~~/constants/icon.constants'
import { maxDownloadableSheet, sheetDownloadState } from '~/utils/sheetDownloadState'
import { altLayoutCount, altSheetNames, lockedSheetsTrackData, sheetGateModel } from '~/utils/sheetDownloadGate'

const props = defineProps({
    result: {
        type: Object,
        required: true
    },
    privacyMode: {
        type: String,
        default: null,
    },
});

const emit = defineEmits(["openModal"]);

const { t, fmtPercent } = useLocale();

// Cancel a running nesting: asks the API to flag the job; the worker kills
// the engine within ~2s and the SSE stream updates the card to failed with
// the cancellation note.
const cancelling = ref(false);
const cancelNesting = async () => {
    if (cancelling.value) return;
    cancelling.value = true;
    try {
        // R-3 (audit 2026-08-31 §R-2) : passer par le REGISTRE de solves
        // locaux — cancelJob fait le POST /cancel (le serveur finalise +
        // refund, le worker tue l'engine sous ~2 s), termine les pools par
        // PRÉFIXE (zones du pass structurel comprises) ET retire un
        // éventuel job EN FILE (l'ancien chemin POST+cancelPool ne voyait
        // pas la file : le job relancé par pump() échouait ensuite en 409
        // avec un bandeau d'erreur mensonger sur un job annulé).
        const { cancelJob } = await import('~/composables/localSolverRegistry');
        await cancelJob(props.result.slug);
        // AA2 (vérif L1 2026-09-05) : annulation depuis la carte — le bouton
        // Nest doit redevenir actif avec les MÊMES paramètres.
        const { filesStore } = await import('~/composables/files');
        filesStore.actions.resetLastParams();
    } catch (e) {
        console.warn('cancel failed', e);
        cancelling.value = false;
    }
};

const isMultiSheet = computed(() => {
    return props.result?.isMultiSheet ?? false;
});

// J-082 : résultat hydraté depuis IndexedDB (Mode Local productisé) — les
// artefacts ne viennent JAMAIS du serveur pour ces jobs.
const isLocal = computed(() => Boolean(props.result?.isLocal));

// O2 (02/11) : verrou de téléchargement des tôles sur la carte, calculé sur
// l'ALTERNATIVE 0 (celle que le bouton télécharge, D4). Palier du moment
// (d1) ; K et démo passés EXPLICITEMENT — la carte ne lisait que globalStore
// et les défauts verrouilleraient la démo et K en silence (C1-4).
const { data: userData } = useNuxtData('user')
const config = useRuntimeConfig()
const downloadState = computed(() => sheetDownloadState(unref(userData), {
    paidPlansDisabled: config.public.paidPlansDisabled,
    projectSlug: props.result?.projectSlug ?? null,
}))
const gate = computed(() => sheetGateModel(altSheetNames(props.result, 0), unref(downloadState),
    altLayoutCount(props.result, 0)))
// D17 : retour de Checkout en cours de vérification — « Débloquer » inactif.
const checkoutReturnState = useCheckoutReturnState()
const checkoutChecking = computed(() => unref(checkoutReturnState) === 'checking')
const openBuyCredits = useBuyCreditsOpener()

// Mêmes conditions que les deux boutons de téléchargement du gabarit : pas de
// déblocage proposé sur une carte en échec, purgée ou « autre appareil ».
const hasDownloadButton = computed(() => isResultCompleted.value
    && (isLocal.value || (!props.result?.purgedAt && !props.result?.localElsewhere)))
const showUnlock = computed(() => hasDownloadButton.value && gate.value.anyLocked)
const lockedControls = computed(() => showUnlock.value)

// §3.12 : données en chaînes, sans slug de job.
const downloadTrackData = () => ({
    isMultiSheet: String(Boolean(isMultiSheet.value)),
    isLocal: String(isLocal.value),
    locked: String(gate.value.anyLocked),
})

const onUnlock = () => {
    if (checkoutChecking.value) return
    const g = gate.value
    trackEvent('locked_sheets_unlock_click', lockedSheetsTrackData('card', g, isLocal.value))
    openBuyCredits({
        source: 'locked_sheets',
        lockedSheets: {
            total: g.total,
            cap: g.cap,
            resultSlug: props.result?.slug,
            projectSlug: props.result?.projectSlug ?? null,
        },
    })
}

const downloadLocal = () => {
    const record = props.result?.localRecord;
    if (!record) return;
    trackEvent('click_download_button', downloadTrackData());
    try {
        downloadLocalResult(record, 0, { maxSheet: maxDownloadableSheet(unref(downloadState)) });
    } catch (e) {
        // §3.11 : filet (l'archive écarte déjà les tôles verrouillées).
        if (e?.message === 'sheet_locked') {
            onUnlock()
            return
        }
        console.warn('local download failed', e);
    }
};

const downloadUrl = computed(() => {
    return props.result?.downloadUrl ?? '';
});

// D27 : libellé court visible quand le verrou s'applique (colonne de 260 px),
// libellé complet en aria-label/title ; sinon libellés inchangés.
const downloadButtonText = computed(() => {
    if (gate.value.anyLocked) return t('results.downloadFirstSheetsShort', { n: gate.value.cap })
    return isMultiSheet.value ? t('results.downloadAll') : t('results.download');
});
const downloadButtonAttrs = computed(() => {
    if (!gate.value.anyLocked) return {}
    const full = t('results.downloadFirstSheets', { n: gate.value.cap })
    return { 'aria-label': full, title: full }
});

const hasMultipleSvgs = computed(() => {
    return (props.result?.svgs?.length ?? 0) > 1;
});

const sheetSizeAt = (index) => {
    const sheets = props.result?.alternatives?.[0]?.report?.sheets
    const s = Array.isArray(sheets) ? sheets[index] || sheets[0] : null
    if (s?.widthMm && s?.heightMm) return { w: s.widthMm, h: s.heightMm }
    return { w: 0, h: 0 }
}

const svgRowClasses = computed(() => {
    return ['result__svg-row', { 'result__svg-row--multi': hasMultipleSvgs.value }];
});

const isResultNexting = computed(() => {
    const status = props.result?.status;
    // C01 (audit UX 2026-09-05) : awaiting_local = calcul navigateur EN
    // COURS — carte « en cours » (loader + Annuler), pas « échec fantôme ».
    return status === statusType.unfinished
        || status === statusType.pending
        || status === statusType.awaitingLocal;
});

// Live progress pushed by the nesting worker ({stage, label, done, total}).
const progress = computed(() => {
    const p = props.result?.progress;
    return p && p.total > 0 ? p : null;
});

// Vcores at work on this job (tier compute profile); null on legacy jobs.
const cores = computed(() => {
    const n = props.result?.compute?.vcores;
    return n ? Math.min(8, Math.max(1, Number(n) || 1)) : null;
});

const progressPercent = computed(() => {
    if (!progress.value) return 0;
    // Live percentage from the engine's time budget when available.
    if (progress.value.pct != null) return Math.min(100, progress.value.pct);
    return Math.min(100, Math.round((progress.value.done / progress.value.total) * 100));
});

// Stage label: translated when we know the stage, worker-provided label
// otherwise (forward-compatible with future stages).
const stageLabel = computed(() => {
    const p = progress.value;
    if (!p) return '';
    const key = `progress.stage.${p.stage}`;
    const translated = t(key);
    return translated === key ? (p.label || key) : translated;
});

// done/total duplicates the elapsed seconds for engine-driven jobs (pct
// present) — only show it for count-based progress (legacy readers).
const showDoneTotal = computed(() => {
    return progress.value && progress.value.pct == null;
});

const formatElapsed = (sec) => {
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    return `${min}m${String(sec % 60).padStart(2, '0')}`;
};

const isResultFailed = computed(() => {
    return props.result?.status === statusType.failed;
});

const primaryAlt = computed(() => {
    const alts = props.result?.alternatives
    return Array.isArray(alts) && alts.length ? alts[0] : null
})

const isNoFit = computed(() => {
    const info = String(props.result?.information || '')
    return /no feasible solution|Not all items could be placed/i.test(info)
})
// C09 : refus capacité (422 API ou refus navigateur refundé) — la carte
// étiquette « ne tient pas », jamais « Nesting failed ».
const isCapacityRefusal = computed(() =>
    props.result?.unfit?.reason === 'capacity')
// A3 (lot 4) : orphelin awaiting_local expiré — carte explicite au lieu
// d'un échec muet qui bloque l'utilisateur en 409.
const isOrphanExpired = computed(() =>
    props.result?.information === 'awaiting_local_expired')
const failureKey = computed(() => failureReasonKey(props.result?.information))
const failureTitle = computed(() =>
    isOrphanExpired.value ? t('results.orphanExpired.short')
    : isCapacityRefusal.value ? t('nest.capacity.title')
    : isNoFit.value ? t('result.failed.nofit') : t('result.failed'))

// U1 passe 2 : résolution du nom de projet côté client (le flux SSE ne
// porte que projectSlug — pas de changement d'API, la liste des projets
// vit déjà dans le store global).
const { getters: globalGetters } = globalStore
const projectEntry = computed(() =>
    (globalGetters.projectsList || []).find((p) => p.slug === props.result?.projectSlug) || null)
const projectName = computed(() => {
    const p = projectEntry.value
    if (!p) return ''
    return p.isDemo ? t('demo.projectName') : String(p.name || '')
})

// État sémantique (§U1 carte résultat) : Terminé / Partiel / Échec —
// jamais un « Nesting failed » fantôme ni un « Results · 0 sheets ».
const isPartial = computed(() => {
    if (!isResultCompleted.value) return false
    if (props.result?.unfit?.reason === 'partial') return true
    const placed = props.result?.placed || 0
    const requested = props.result?.requested || 0
    return placed > 0 && requested > 0 && placed < requested
})
const degradedKey = computed(() =>
    isResultCompleted.value ? degradedNoteKey(props.result?.degraded) : null)
const stateTone = computed(() => {
    if (isResultFailed.value) return 'danger'
    if (isPartial.value || degradedKey.value) return 'warn'
    return 'ok'
})
const stateLabel = computed(() => {
    if (!isResultCompleted.value && !isResultFailed.value) return ''
    return isResultFailed.value
        ? t('result.state.failed')
        : isPartial.value ? t('result.state.partial') : t('result.state.done')
})

const resultTitle = computed(() => {
    if (isResultFailed.value) {
        // U2 : le badge porte déjà « Échec » — le titre dit la CAUSE,
        // jamais un second « Échec du nesting ».
        if (isOrphanExpired.value) return t('results.orphanExpired')
        if (isCapacityRefusal.value) return t('nest.capacity.title')
        // Code d'échec stable (local-fail / sweeper) → explication traduite,
        // jamais le seul nom du projet sans raison.
        if (failureKey.value) return t(failureKey.value)
        if (isNoFit.value) return t('result.failed.nofitHint')
        return projectName.value || t('result.failed.nofitHint')
    }
    // C05 (lot 3) : job calculé dans le navigateur d'un AUTRE appareil —
    // la géométrie n'existe pas ici : message explicite, pas « 0 tôles ».
    if (props.result?.localElsewhere) {
        // Lot J11-a (B2) : le NOM DU PROJET distingue les cartes — le mur de
        // « autre appareil » identiques ne disait rien. La raison reste en
        // sous-titre (statusLabel la porte déjà).
        return projectName.value
            ? `${projectName.value} · ${t('results.otherDevice')}`
            : t('results.otherDevice')
    }
    // Plan 2026-09-05 §1.2c : un résultat unfit (hors tôle mesuré) est
    // étiqueté « ne tient pas » — jamais « Results · 1 sheet ».
    const r0 = props.result?.alternatives?.[0]?.report
    if (r0 && (r0.insideSheet === false || r0.overlapFree === false
        || (r0.duplicatePoses || 0) > 0)) {
        return t('results.unfit')
    }
    // U1 passe 2 : posé = 0 sans échec → « Aucune pièce posée », plus
    // jamais « Results · 0 sheets ».
    if ((props.result?.placed || 0) === 0) {
        return t('results.nothingPlaced')
    }
    // « nom du projet · densité · N tôles » (§U1) — la densité mesurée
    // du rapport vérifié (AA1) ; si elle manque, on ne fabriche rien.
    const alt = primaryAlt.value
    const parts = []
    if (projectName.value) parts.push(projectName.value)
    const densityPct = altDensityPctOf(alt)
    if (densityPct != null) {
        parts.push(`${fmtPercent(densityPct)} ${t('result.densityShort')}`)
    }
    const sheetN = alt?.layoutCount
        || (props.result?.isMultiSheet ? (props.result?.svgs?.length || 0) : 1)
    parts.push(sheetN === 1
        ? t('result.sheetCountOne')
        : t('result.sheetCount', { n: sheetN }))
    return parts.join(' · ')
})

const timeAgo = computed(() => {
    const raw = props.result?.createdAt
    if (!raw) return ''
    const past = new Date(raw)
    if (Number.isNaN(past.getTime())) return ''
    const diffMinutes = Math.floor((Date.now() - past.getTime()) / 60000)
    const diffHours = Math.floor(diffMinutes / 60)
    const diffDays = Math.floor(diffMinutes / 1440)
    if (diffMinutes < 1) return t('time.justNow')
    if (diffHours >= 1 && diffHours < 24) return t('time.hoursAgo', { n: diffHours })
    if (diffDays >= 1) return diffDays === 1 ? t('time.dayAgo') : t('time.daysAgo', { n: diffDays })
    return t('time.minAgo', { n: diffMinutes })
})

const isResultCompleted = computed(() => {
    const status = props.result?.status;
    return status === statusType.completed || status === statusType.done;
});

const openModal = () => {
    emit('openModal');
};

// Quoting report (per-sheet measured metrics) available on this result?
// Drives the dedicated "Nesting report" button: it opens the same result
// modal but scrolled straight to the report block.
const hasReport = computed(() => {
    if (!isResultCompleted.value) return false;
    return (props.result?.alternatives || []).some(
        (alt) => Array.isArray(alt?.report?.sheets) && alt.report.sheets.length > 0
    );
});

const scrollToReport = useResultScrollToReport();
const openReport = () => {
    scrollToReport.value = true;
    trackEvent('click_nesting_report_button', { slug: props.result?.slug });
    emit('openModal');
};

const onDownload = () => {
    trackEvent('click_download_button', downloadTrackData());
};
</script>
<style lang="scss" scoped>
.result {
    $self: &;
    position: relative;
    display: block;
    padding: 14px;
    border: 1px solid var(--separator-secondary);
    border-radius: var(--radius-l);
    transition: border-color 0.3s;

    &__cancel {
        margin-top: 8px;
    }

    /* U1 passe 2 : annuleur migré sur UiButton ghost — le ton danger ne
       revient qu'au survol (spécificité .result .result__cancel > .ui-btn). */
    &.result .result__cancel:hover:not(:disabled) {
        color: var(--danger);
        background: var(--danger-bg);
    }

    /* Miniature lisible : une tôle seule occupe la largeur de la carte
       (plus 64 × 36 px), plusieurs tôles se rangent sur deux colonnes. */
    &__svg-row {
        max-width: 220px;
        display: grid;
        grid-template-columns: 1fr;
        gap: 6px;
        margin-bottom: 8px;

        &--multi {
            grid-template-columns: repeat(2, 1fr);
        }
    }

    /* U1 passe 2 : miniature 64 px (§U1 carte résultat). */
    &__display,
    &__placeholder {
        width: 64px;
        height: 36px;
        min-height: 36px;
        overflow: hidden;
    }

    &__svg-row &__display {
        width: 100%;
        height: 96px;
        min-height: 96px;
        border: 1px solid var(--separator-secondary);
        border-radius: var(--radius);
    }

    &__svg-row--multi &__display {
        height: 60px;
        min-height: 60px;
    }

    &__placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        border-radius: var(--radius);
        background-color: var(--error-background);
        border: solid 1px var(--error-border);
        color: var(--label-primary);
        font-size: var(--fs-12);
        font-weight: 700;
        padding: 4px;
        line-height: 1.2;
        width: auto;
        min-width: 40px;
        max-width: 120px;
        height: auto;
        min-height: 40px;
    }

    // C05 : état « autre appareil » — discret, pas une erreur (la géométrie
    // n'a jamais quitté l'appareil qui a calculé : comportement attendu du
    // mode privé).
    &__placeholder--elsewhere {
        background-color: var(--fill-tertiary);
        border-color: var(--separator-secondary);
        font-weight: 600;
    }

    /* U2 : miniature muette — plus de texte dans un bloc bordé. */
    &__placeholder--silent {
        width: 64px;
        height: 36px;
        min-width: 64px;
        max-width: 64px;
        min-height: 36px;
        padding: 0;
        font-size: 0;
        font-weight: 400;
        border-color: var(--separator-secondary);
        background-color: var(--fill-tertiary);
    }

    &__name {
        max-width: 240px;
        word-break: break-word;
        font-weight: 600;
        color: var(--label-primary);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
    }

    &__when {
        margin-top: 4px;
        font-size: var(--fs-12);
        /* U1 passe 2 (a11y) : contraste AA sur fond de page. */
        color: var(--label-secondary);
    }

    // J-082 : mention « calculé localement » des jobs Mode Local.
    &__local {
        margin-top: 4px;
        font-size: var(--fs-12);
        color: var(--label-secondary);
    }

    // Livraison dégradée : toutes les pièces sont posées, sans la dernière étape.
    &__degraded {
        margin-top: 4px;
        font-size: var(--fs-12);
        color: var(--label-primary);
    }

    // D-PRV-10 : mention « expiré » des résultats purgés (24 h).
    &__expired {
        margin-top: 4px;
        font-size: var(--fs-12);
        color: var(--label-secondary);
    }

    &__name,
    &__text {
        margin-top: 10px;
        color: var(--label-secondary);
        transition: color 0.3s;
    }

    &__text {
        &::after {
            content: '';
            animation: dots 2s infinite linear;
        }

        &--stage {
            font-weight: 600;
            color: var(--label-primary);

            &::after {
                content: none;
            }
        }

        &--count {
            font-size: var(--fs-12);
            font-variant-numeric: tabular-nums;

            &::after {
                content: none;
            }
        }
    }

    &__progress {
        margin-top: 8px;
    }

    &__area {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        cursor: pointer;
        border: none;
        background: transparent;
        padding: 0;
        min-height: 0;
    }

    /* U1 passe 2 : la zone cliquable est un UiButton ghost invisible —
       le survol ne teinte PAS la carte (surcharges .ui-btn--ghost:hover). */
    &.result .result__area:hover:not(:disabled) {
        color: inherit;
        background: transparent;
    }

    /* U2 passe : boutons SOUS la vignette, jamais superposés. */
    &__controls {
        position: relative;
        z-index: 1;
        margin-top: 8px;
    }

    @media (hover:hover) {
        &:hover {
            .controls {
                &__delete {
                    opacity: 1;
                }
            }

            border-color: var(--separator-primary);

            #{$self}__name {
                color: var(--label-primary);
            }
        }
    }
}

.progress {
    height: 6px;
    border-radius: var(--radius-s);
    background-color: var(--fill-tertiary);
    overflow: hidden;

    &__bar {
        height: 100%;
        border-radius: var(--radius-s);
        background-color: var(--accent-primary);
        transition: width 0.6s ease;
    }
}

@keyframes dots {
    0% {
        content: '';
    }

    33.33% {
        content: '.';
    }

    66.66% {
        content: '..';
    }

    100% {
        content: '...';
    }
}

.controls {
    display: flex;
    align-items: center;

    &__delete {
        opacity: 0;
        transition: opacity 0.3s;
    }

    &__download {
        margin-left: 5px;
    }

    &__report {
        margin-right: 5px;
    }

    /* D27 (02/11) : carte verrouillée — « Débloquer » prend une seconde
       ligne (colonne de 260 px, rien d'écrasé). Classe absente sans verrou. */
    &--locked {
        flex-wrap: wrap;
        row-gap: 5px;
    }

    &__unlock {
        flex-basis: 100%;
    }
}
</style>
