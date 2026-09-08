<template>
    <!-- U3 passe 2 : espace de resultat plein ecran (24 px de marge) —
         onglets d'alternatives en haut, visionneuse 2/3 a gauche, rapport
         1/3 a droite (le rapport defile, jamais le dialogue). Sous 768 px
         les deux volets s'empilent, visionneuse d'abord. -->
    <DialogWrapper trackingTag="result" fullscreen>
        <div class="modal result-space" data-testid="result-space">
            <ResultAlternatives
                class="result-space__alts"
                :d="bundle"
                @select="selectAlt"
            />
            <div class="result-space__panes">
                <ResultViewer
                    class="result-space__viewer"
                    :d="bundle"
                    @view-mode="selectViewMode"
                    @toggle-fullscreen="updateFullScreen"
                    @download-sheet="downloadLocalSheet"
                    @part="updatePartPage"
                />
                <ResultReport
                    ref="reportChild"
                    class="result-space__report"
                    :d="bundle"
                    @unfit-add-sheet="$emit('unfit-add-sheet')"
                    @unfit-reduce-spacing="$emit('unfit-reduce-spacing', $event)"
                    @export="onExportIntent"
                    @download-all="downloadLocalAll"
                    @download-single="downloadLocalSingle"
                    @copy-slug="copySlug"
                    @close="resultDialog = false"
                />
            </div>
        </div>
    </DialogWrapper>
</template>

<script setup>
import { altDensityPctOf, whyFirstKind } from '~/utils/resultQuality'
import { iconType } from '~~/constants/icon.constants'
import { sizeType } from '~~/constants/size.constants'
import { themeType } from '~~/constants/theme.constants'
import { statusType } from '~~/constants/status.constants'
import { trackEvent } from '~/utils/track'
import { SQMM_PER_SQIN } from '~/utils/units'
import { displayDirectionArrow } from '~/utils/sheetView'
import { onMounted, nextTick } from 'vue'
import { reportExportState } from '~/utils/reportExport'

// Z1/Z3 (vérif 2026-09-05) : actions correctives des bandeaux unfit /
// partiel — écoutées par UserResults (ajout tôle / réduction espacement).
const emit = defineEmits(['unfit-add-sheet', 'unfit-reduce-spacing'])

const { getters } = globalStore
const resultModalData = computed(() => getters.resultModalData)
const { t, fmtPercent, fmtNumber } = useLocale()
const { unit, fmtArea, fmtLength, fmtLengthValue, unitLabel } = useUnit()

// J-082 : job Mode Local hydraté depuis IndexedDB — les téléchargements
// passent par les contenus persistés (localDownloads), jamais par une URL
// serveur (il n'y a pas de fichiers GridFS pour ces jobs).
const isLocal = computed(() => Boolean(unref(resultModalData)?.isLocal))
const localRecord = computed(() => unref(resultModalData)?.localRecord || null)
const downloadLocalSingle = () => {
    try {
        downloadLocalDxf(unref(localRecord), unref(activeAlt), 0)
    } catch (e) {
        console.warn('local download failed', e)
    }
}
const downloadLocalSheet = () => {
    try {
        downloadLocalDxf(unref(localRecord), unref(activeAlt), unref(activePart))
    } catch (e) {
        console.warn('local download failed', e)
    }
}
const downloadLocalAll = () => {
    try {
        downloadLocalZip(unref(localRecord))
    } catch (e) {
        console.warn('local download failed', e)
    }
}

// Report export gating (D-RAP-11): content visible on every plan; exports
// (copy / CSV) are Unlimited+. COMMERCIAL gate, 100% client-side — the
// report is on screen anyway, a free user could retype the numbers (A3).
// Plan from the already-loaded user payload (J-044), never a new endpoint.
// useNuxtData returns { data: Ref } — destructure it (same pattern as
// useUnit.js); unref'ing the wrapper itself never sees .compute and locks
// every tier, paid included.
const { data: userData } = useNuxtData('user')
const exportState = computed(() =>
    reportExportState(
        unref(userData)?.compute?.level ?? null,
        useRuntimeConfig().public.paidPlansDisabled === true,
    )
)
const exportLocked = computed(() => unref(exportState) === 'locked')
const exportDisabled = computed(() => unref(exportState) === 'disabled')
const buyCreditsDialog = useBuyCreditsDialog()
// Locked state: the click opens the EXISTING paywall dialog (explicit label
// + CTA, J-054) instead of running the export.
const onExportClick = (action, trackingTag) => {
    if (unref(exportLocked)) {
        trackEvent(trackingTag)
        buyCreditsDialog.value = true
        return
    }
    action()
}

const resultDialog = useResultDialog()

// The "Nesting report" button on a result card opens this modal already
// scrolled to the quoting report (the card click opens the sheet preview).
const scrollToReportFlag = useResultScrollToReport()
// U3 : le bloc rapport est passe dans ResultReport — on garde une poignee
// sur l'enfant pour le scrollIntoView de l'ouverture « Rapport de nesting ».
const reportChild = ref(null)

const isHaveError = computed(() => {
    return unref(resultModalData).status === statusType.failed
})
// Plan 2026-09-05 §1.2c — verdict UNIQUE calculé depuis le rapport (plus
// jamais de badges contradictoires « Overlap-free ✓ / Inside sheet ✗ /
// All parts placed ✓ » sur un résultat hors tôle).
const activeVerdict = computed(() => {
    const r = unref(activeReport)
    if (!r) return 'valid'
    if (r.insideSheet === false || r.overlapFree === false
        || (r.duplicatePoses || 0) > 0) return 'unfit'
    if ((r.unplaced || 0) > 0) return 'partial'
    if (r.verifyStatus === 'skipped') return 'unverified'
    return 'valid'
})
const isUnfit = computed(() => unref(activeVerdict) === 'unfit')
// Z3 (vérif 2026-09-05) : solution partielle — bandeau ambre avec leviers
// (le posé est découpage : jamais le bandeau rouge unfit).
const isPartial = computed(() => unref(activeVerdict) === 'partial')
const partialUnplacedCount = computed(() =>
    (unref(activeReport)?.unplaced || 0) || unref(unfitData)?.unplaced || 0)
const partialHasLevers = computed(() => {
    const u = unref(unfitData) || {}
    return Boolean(u.sheetsNeeded || u.maxParts != null || u.maxSpacingMm != null)
})
const unfitData = computed(() => {
    // Leviers : du job (pré-contrôle / moteur infaisable) ou dérivés du
    // rapport (gap négatif = dépassement mesuré).
    const jobUnfit = unref(resultModalData).unfit || null
    const r = unref(activeReport) || {}
    const overflowMm = (typeof r.smallestGapMm === 'number' && r.smallestGapMm < 0)
        ? Math.abs(r.smallestGapMm) : null
    return {
        sheetsNeeded: jobUnfit?.sheetsNeeded ?? null,
        maxParts: jobUnfit?.maxPartsAtSpacing ?? null,
        maxSpacingMm: jobUnfit?.maxSpacingForFitMm ?? null,
        unplaced: jobUnfit?.unplaced ?? null,
        overflowMm,
        reason: jobUnfit?.reason ?? (overflowMm != null ? 'strip' : 'layout'),
    }
})
const isInProgress = computed(() => {
    const status = unref(resultModalData).status
    return status === statusType.unfinished || status === statusType.pending
})
const isFullScreen = useFullScreen()
const updateFullScreen = () => {
    isFullScreen.value = !unref(isFullScreen)
    localStorage.setItem('isFullScreen', unref(isFullScreen))
}
onMounted(() => {
    activePart.value = 0
    isFullScreen.value = localStorage.getItem('isFullScreen') === 'true'
})

watch(resultDialog, async (isOpen) => {
    if (isOpen) {
        activePart.value = 0
        activeAlt.value = 0
        viewMode.value = 'color'
        if (scrollToReportFlag.value) {
            scrollToReportFlag.value = false
            await nextTick()
            // Let the dialog transition settle before scrolling.
            setTimeout(() => {
                reportChild.value?.reportEl?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            }, 120)
        }
    }
})

// Alternative layouts (best density first). When empty (legacy jobs), the
// flat dxfs/svgs of the result are used.
const alternatives = computed(() => unref(resultModalData).alternatives || [])
const activeAlt = ref(0)
const currentDxfs = computed(() => {
    const alts = unref(alternatives)
    if (alts.length > 0 && alts[unref(activeAlt)]) {
        return alts[unref(activeAlt)].dxfs
    }
    return unref(resultModalData).dxfs || []
})
const selectAlt = (altId) => {
    activeAlt.value = altId
    activePart.value = 0
    trackEvent('result_alt_selected', { altId })
}

// Colored per-part SVG preview (default) vs raw DXF inspection view. The
// SVGs are generated server-side with the same colors as the live view; the
// downloadable production DXF is never recolored.
const viewMode = ref('color') // 'color' | 'dxf'
const currentSvgs = computed(() => {
    const alts = unref(alternatives)
    if (alts.length > 0 && alts[unref(activeAlt)]) {
        return alts[unref(activeAlt)].svgs || []
    }
    return unref(resultModalData).svgs || []
})
// Legacy jobs have no server SVGs — they silently stay on the DXF viewer.
const hasColorPreview = computed(() => !unref(isInProgress) && !unref(isHaveError) && unref(currentSvgs).length > 0)
const showColorPreview = computed(() => unref(hasColorPreview) && unref(viewMode) === 'color')
const selectViewMode = (mode) => {
    viewMode.value = mode
    trackEvent('result_view_mode', { mode })
}

// ---- nesting report (measured verification, per active alternative) ------
const activeReport = computed(() => unref(alternatives)[unref(activeAlt)]?.report || null)
// AB2 (L2-bis) : options écartées au filet final (diagnostic conservé).
const discardedCount = computed(() => unref(resultModalData).discardedCount || 0)
// C03 : seed absent → masqué (pas de « seed — »).
const activeAltSeed = computed(() => unref(alternatives)[unref(activeAlt)]?.seed ?? null)
// C02 (audit UX 2026-09-05) : la barre unique est la DENSITÉ MATIÈRE
// (plus = mieux). L'ancienne « Sheet utilization » (emprise/tôle, MOINS =
// mieux) se lisait à l'envers et dévalorisait la Grille proposée en
// premier ; les jobs antérieurs sans densité n'affichent plus de barre.
// AA1 (vérif L1 2026-09-05) : UNE définition MESURÉE — totals.densityPct
// du rapport vérifié (Σ aires pièces / Σ aires tôles), identique pour la
// grille et le moteur. Repli sur alt.density SEULEMENT si l'alternative
// n'a pas de rapport (jobs antérieurs).
const altDensityPct = altDensityPctOf
const densityPct = computed(() => altDensityPct(unref(alternatives)[unref(activeAlt)]))
const freeAreaMm2 = computed(() => {
    const r = unref(activeReport)
    if (!r) return 0
    return Math.max(0, (r.sheetAreaMm2 || 0) - (r.partsAreaMm2 || 0))
})
const activeOffcut = computed(() => {
    const off = unref(alternatives)[unref(activeAlt)]?.offcut
    return off && off.area > 1 ? off : null
})

// ---- quoting report (per-sheet measured metrics, ADDITIVE report fields) --
// Legacy jobs have no report.sheets: only the classic block above is shown.
const reportSheets = computed(() => {
    const sheets = unref(activeReport)?.sheets
    return Array.isArray(sheets) ? sheets : []
})
const previewSheet = computed(() => {
    const s = unref(reportSheets)[unref(activePart)] || unref(reportSheets)[0]
    if (s?.widthMm && s?.heightMm) return { w: s.widthMm, h: s.heightMm }
    const live = unref(resultModalData)?.liveLayout?.sheets?.[0]
    if (Array.isArray(live) && live.length >= 2) return { w: Number(live[0]), h: Number(live[1]) }
    const p = unref(resultModalData)?.params?.sheets?.[0]
    if (p) return { w: Number(p.width) || 0, h: Number(p.height) || 0 }
    return { w: 0, h: 0 }
})
const reportTotals = computed(() => unref(activeReport)?.totals || null)
// Enriched offcut ({widthMm, heightMm, areaMm2, reusable}) — the legacy
// alternative.offcut {width, height, area} stays the fallback.
const activeReportOffcut = computed(() => {
    const off = unref(activeReport)?.offcut
    return off && off.areaMm2 > 1 ? off : null
})
// "3 × 48\" × 96\"" per distinct sheet format (mixed-format jobs aggregated).
const materialFormats = computed(() => {
    const totals = unref(reportTotals)
    if (!totals || !Array.isArray(totals.formats)) return ''
    return totals.formats
        .map((f) => `${f.count} × ${fmtLength(f.widthMm)} × ${fmtLength(f.heightMm)}`)
        .join(' + ')
})

const offcutText = (off) => {
    if (!off) return '—'
    const label = off.reusable ? t('report.offcut.reusable') : t('report.offcut.scrap')
    return `${fmtLength(off.widthMm)} × ${fmtLength(off.heightMm)} (${fmtArea(off.areaMm2)}, ${label}, ${t('report.offcut.atLeast')})`
}

// "3 376 in² (23.45 ft²)" stacked on two lines in the per-sheet table:
// keeps both units (shop floor reads in², purchasing reads ft²) without
// widening the table past the modal. mm mode: single line, sub is null.
const fmtAreaStacked = (mm2) => {
    const s = fmtArea(mm2)
    const m = s.match(/^(.+?)\s*(\([^)]+\))$/)
    return m ? { main: m[1], sub: m[2] } : { main: s, sub: null }
}

const buildReportText = () => {
    const totals = unref(reportTotals)
    const name = `${unref(resultModalData).slug} · ${t('result.option', { n: unref(activeAlt) + 1 })}`
    const lines = [
        t('report.text.title', { name }),
        t('report.text.material', { formats: unref(materialFormats) }),
        t('report.text.totals', {
            sheets: totals.sheetCount,
            parts: fmtArea(totals.partsAreaMm2),
            free: fmtArea(totals.freeAreaMm2),
            pct: totals.densityPct != null ? fmtNumber(totals.densityPct) : '—',
        }),
    ]
    for (const s of unref(reportSheets)) {
        lines.push(t('report.text.sheetLine', {
            i: s.index + 1,
            w: fmtLength(s.widthMm),
            h: fmtLength(s.heightMm),
            n: s.partCount,
            used: fmtArea(s.partsAreaMm2),
            free: fmtArea(s.freeAreaMm2),
            pct: s.densityPct != null ? fmtNumber(s.densityPct) : '—',
            offcut: offcutText(s.offcut),
        }))
    }
    return lines.join('\n')
}

const copied = ref(false)
let copiedTimer = null
const copyReport = async () => {
    const text = buildReportText()
    try {
        await navigator.clipboard.writeText(text)
    } catch {
        // Clipboard API unavailable (non-secure context): legacy fallback.
        const ta = document.createElement('textarea')
        ta.value = text
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
    }
    copied.value = true
    trackEvent('report_copied', { altId: unref(activeAlt) })
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = false }, 2000)
}

// CSV v1: comma separator, dot decimals, i18n headers with the display unit
// in the header name; values in the display unit (in / mm, in² / mm²).
const csvCell = (v) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const exportCsv = () => {
    const sheets = unref(reportSheets)
    const totals = unref(reportTotals)
    const isInch = unref(unit) === 'inch'
    const lenUnit = isInch ? 'in' : 'mm'
    const areaUnit = isInch ? 'in2' : 'mm2'
    const csvLen = (mm) => fmtLengthValue(mm)
    const csvArea = (mm2) => (isInch ? (mm2 / SQMM_PER_SQIN).toFixed(1) : String(Math.round(mm2)))
    const reusableLabel = (off) => (off.reusable ? t('report.offcut.reusable') : t('report.offcut.scrap'))
    const headers = [
        t('report.sheet.num'),
        `${t('report.sheet.format')} W (${lenUnit})`,
        `${t('report.sheet.format')} H (${lenUnit})`,
        t('report.sheet.parts'),
        `${t('report.sheet.used')} (${areaUnit})`,
        `${t('report.sheet.free')} (${areaUnit})`,
        `${t('report.sheet.density')} (%)`,
        `${t('report.sheet.offcut')} W (${lenUnit})`,
        `${t('report.sheet.offcut')} H (${lenUnit})`,
        `${t('report.sheet.offcut')} (${areaUnit})`,
        t('report.offcut.reusable'),
    ]
    const rows = sheets.map((s) => [
        s.index + 1,
        csvLen(s.widthMm), csvLen(s.heightMm),
        s.partCount,
        csvArea(s.partsAreaMm2), csvArea(s.freeAreaMm2),
        s.densityPct != null ? s.densityPct.toFixed(1) : '',
        s.offcut ? csvLen(s.offcut.widthMm) : '',
        s.offcut ? csvLen(s.offcut.heightMm) : '',
        s.offcut ? csvArea(s.offcut.areaMm2) : '',
        s.offcut ? reusableLabel(s.offcut) : '',
    ])
    if (totals) {
        rows.push([
            t('report.total'), '', '',
            sheets.reduce((acc, s) => acc + s.partCount, 0),
            csvArea(totals.partsAreaMm2), csvArea(totals.freeAreaMm2),
            totals.densityPct != null ? totals.densityPct.toFixed(1) : '',
            '', '', '', '',
        ])
    }
    // BOM: Excel opens UTF-8 (French accents) correctly.
    const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
    const slug = String(unref(resultModalData).slug || 'job').replace(/[^a-zA-Z0-9_-]+/g, '-')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nesting-report-${slug}-alt${unref(activeAlt) + 1}.csv`
    a.click()
    // m-7 (audit 2026-08-31 §R-m.7) : la révocation immédiate pouvait
    // avorter le téléchargement sur certains navigateurs — même filet que
    // localDownloads (grâce 1 s).
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    trackEvent('report_csv_exported', { altId: unref(activeAlt) })
}
const reportBadges = computed(() => {
    const r = unref(activeReport)
    if (!r) return []
    const badges = []
    if (r.overlapFree != null) badges.push({ ok: r.overlapFree, label: t('report.overlapFree') })
    if (r.insideSheet != null) badges.push({ ok: r.insideSheet, label: t('report.insideSheet') })
    if (r.smallestGapMm != null && r.smallestGapMm < 0) {
        // §1.2c : un gap NÉGATIF est un dépassement hors tôle, pas un
        // espacement — libellé dédié, jamais « Gap ≥ −4 mm ».
        const over = fmtLengthValue(Math.abs(r.smallestGapMm), unitLabel.value === '"' ? 4 : 2)
        badges.push({ ok: false, label: t('report.outsideBy', { v: over, unit: unitLabel.value }) })
    } else if (r.spacingOk != null && r.smallestGapMm != null) {
        // Sub-mm resolution: 2 decimals in mm, 4 in inches.
        const gap = fmtLengthValue(r.smallestGapMm, unitLabel.value === '"' ? 4 : 2)
        badges.push({ ok: r.spacingOk, label: t('report.spacing', { v: gap, unit: unitLabel.value }) })
    }
    // A3/U1 : une tôle au-delà du plafond de vérification ne doit JAMAIS
    // paraître « validée par absence de badge » — badge explicite.
    if (r.verifyStatus === 'skipped' || (r.overlapFree == null && r.spacingOk == null)) {
        badges.push({ ok: false, label: t('report.notVerified') })
    }
    // A4 : pose dupliquée = même pièce posée deux fois (la garde anti-perte
    // par total y était aveugle).
    if (r.duplicatePoses > 0) badges.push({ ok: false, label: t('report.duplicates', { n: r.duplicatePoses }) })
    // C03 (audit UX 2026-09-05) : plus de badge post-pass ici — le post-pass
    // (rollback et erreurs compris) vit dans les détails techniques
    // repliés : un résultat découpable n'affiche jamais de rouge
    // « Post-pass … rollback ».
    // §1.2c : « All parts placed » n'est JAMAIS vert quand le verdict est
    // unfit (pièces posées mais hors tôle = pas découpables).
    const allPlaced = unref(resultModalData).requested === unref(resultModalData).placed
    badges.push({
        ok: allPlaced && !unref(isUnfit),
        label: t('report.allPlaced', { n: unref(resultModalData).placed }),
    })
    // X2 (vérif tour 4) : solution partielle — le compte non placé est un
    // badge visible, jamais un job en erreur.
    const unplaced = r.unplaced || 0
    if (unplaced > 0) {
        badges.push({ ok: false, label: t('report.unplaced', { n: unplaced }) })
    }
    return badges
})
// C03 : lignes techniques du post-pass (repliées, jamais en badge).
const postPassLines = computed(() => {
    const pp = unref(activeReport)?.postPass
    if (!pp) return []
    const lines = []
    if ((pp.residualMoved || 0) > 0 || pp.compactRollback || (pp.errors || []).length) {
        lines.push(t('report.postPass', {
            n: pp.residualMoved || 0,
            rb: pp.compactRollback ? ' · rollback' : '',
            e: (pp.errors || []).length ? ` · ${(pp.errors || []).length} err` : '',
        }))
    }
    return lines
})
const hasTechDetails = computed(() => Boolean(
    unref(activeAltSeed)
    || unref(activeReport)?.iterations
    || unref(activeReport)?.vcores
    || unref(postPassLines).length
))
const formatDensity = (density) => {
    if (density == null) return '—'
    return fmtPercent(density * 100)
}
// C02 : un seul indicateur de qualité par option, dans le bon sens —
// tôles · densité matière · chute réutilisable. Remplace « 55% used »
// (emprise, moins = mieux, lu comme une utilisation).
const altQualityLine = (alt) => {
    const parts = [altSheetsCount(alt)]
    const d = altDensityPct(alt)
    if (d != null) parts.push(`${fmtPercent(d)} ${t('result.densityShort')}`)
    const off = alt?.offcut
    if (off && off.area > 1) {
        parts.push(t('result.offcutShort', {
            w: fmtLength(off.width),
            h: fmtLength(off.height),
        }))
    }
    return parts.join(' · ')
}
// Tooltip: what this option is good for, incl. its clean offcut size.
const strategyLabel = (strategy) => {
    // Directional alternatives are tagged by the engine (left/bottom/
    // balanced); legacy names (max offcut, compact) pass through translated
    // when known, raw otherwise.
    const key = `alts.strategy.${strategy}`
    const translated = t(key)
    const name = translated === key ? strategy : translated
    const arrow = displayDirectionArrow(strategy, previewSheet.value.w, previewSheet.value.h)
    return arrow ? `${arrow} ${name}` : name
}
const altTitle = (alt) => {
    const parts = []
    if (alt.strategy) parts.push(strategyLabel(alt.strategy))
    if (alt.offcut && alt.offcut.area > 1) {
        parts.push(t('result.cleanOffcut', {
            w: fmtLength(alt.offcut.width),
            h: fmtLength(alt.offcut.height),
        }))
    }
    // §2.2d : la chute réutilisable PAR TÔLE — c'est ce que l'utilisateur
    // compare entre deux alternatives multi-tôles (la matière réellement
    // économisée), pas seulement la meilleure chute de l'alternative.
    const sheets = alt?.report?.sheets || []
    sheets.forEach((s, i) => {
        const off = s?.offcut
        if (!off || !(off.areaMm2 > 1)) return
        parts.push(t('result.sheetOffcut', {
            n: i + 1,
            w: fmtLengthValue(off.widthMm, unitLabel.value === '"' ? 4 : 2),
            h: fmtLengthValue(off.heightMm, unitLabel.value === '"' ? 4 : 2),
            unit: unitLabel,
        }) + (off.reusable ? '' : ` · ${t('report.offcut.scrap')}`))
    })
    return parts.join('\n') || t('result.layoutOption')
}
// §2.2d : le nombre de tôles de l'alternative dans la ligne du sélecteur.
const altSheetsCount = (alt) => (alt.layoutCount > 1
    ? t('result.sheetsCount', { n: alt.layoutCount })
    : t('result.sheetsCountOne'))
const displayClasses = computed(() => ({
    'modal__display--is-fullscreen': unref(isFullScreen) && !unref(isHaveError)
}))
const placeholderClasses = computed(() => ({
    'modal__placeholder--is-fullscreen':
        unref(isFullScreen) && !unref(isHaveError)
}))
const name = computed(() => {
    const endPart = unref(resultModalData).isMultiSheet ? `.zip` : `.dxf`
    return unref(resultModalData).slug + endPart
})
const headlineTitle = computed(() => {
    const alts = unref(alternatives)
    const alt = alts[unref(activeAlt)] || alts[0]
    const strategy = alt?.strategy ? strategyLabel(alt.strategy) : t('result.option', { n: (alt?.altId ?? 0) + 1 })
    // C02 : qualité = densité matière (plus = mieux) + chute réutilisable.
    const quality = []
    const density = altDensityPct(alt)
    if (density != null) quality.push(`${t('result.densityFull')} ${fmtPercent(density)}`)
    if (alt?.offcut && alt.offcut.area > 1) {
        quality.push(t('result.cleanOffcut', { w: fmtLength(alt.offcut.width), h: fmtLength(alt.offcut.height) }))
    }
    const score = quality.join(' · ')
    return score ? `${strategy} · ${score}` : strategy
})
// C02 : sous-titre explicatif de la méthode (Grille vs Compaction) —
// masqué quand la stratégie est inconnue.
const activeStrategyExplain = computed(() => {
    const alts = unref(alternatives)
    const alt = alts[unref(activeAlt)] || alts[0]
    const s = alt?.strategy
    if (!s) return null
    const key = `alts.explain.${s}`
    const translated = t(key)
    return translated === key ? null : translated
})

// AA1 (vérif L1 2026-09-05) : justification du rang 0, VÉRIFIÉE — « plus
// grande chute propre » si et seulement si la chute du rang 0 est
// maximale (à 1 mm² près) ; sinon la vraie raison de proposer la Grille
// en premier : des rangées régulières, des découpes prévisibles.
const whyFirstLine = computed(() => {
    const alts = unref(alternatives)
    if (!alts || alts.length < 2 || unref(isHaveError)) return null
    if (unref(activeAlt) !== 0) return null
    const kind = whyFirstKind(alts)
    return kind === 'offcut' ? t('result.whyFirst') : t('result.whyFirstGrid')
})
const activePart = ref(0)
const updatePartPage = (partIndex) => {
    if (partIndex < 0 || partIndex >= unref(currentDxfs).length) return
    activePart.value = partIndex
}
// ---------------------------------------------------------------------------
// U3 passe 1 : les trois enfants sont PUREMENT presentatifs — toute la
// logique reste ici et leur est passee dans un objet unique, qu'ils
// re-exposent sous les memes noms. C'est ce qui permet d'avoir DEPLACE les
// blocs de template sans en reecrire une ligne (donc sans changer le rendu).
// ---------------------------------------------------------------------------
const bundle = computed(() => ({
    t,
    fmtPercent,
    fmtArea,
    fmtLength,
    fmtLengthValue,
    fmtAreaStacked,
    unitLabel: unref(unitLabel),
    resultModalData: unref(resultModalData),
    alternatives: unref(alternatives),
    activeAlt: unref(activeAlt),
    activePart: unref(activePart),
    isHaveError: unref(isHaveError),
    isInProgress: unref(isInProgress),
    isUnfit: unref(isUnfit),
    isPartial: unref(isPartial),
    isLocal: unref(isLocal),
    isFullScreen: unref(isFullScreen),
    partialHasLevers: unref(partialHasLevers),
    partialUnplacedCount: unref(partialUnplacedCount),
    unfitData: unref(unfitData),
    hasColorPreview: unref(hasColorPreview),
    showColorPreview: unref(showColorPreview),
    viewMode: unref(viewMode),
    currentSvgs: unref(currentSvgs),
    currentDxfs: unref(currentDxfs),
    previewSheet: unref(previewSheet),
    displayClasses: unref(displayClasses),
    placeholderClasses: unref(placeholderClasses),
    activeReport: unref(activeReport),
    activeReportOffcut: unref(activeReportOffcut),
    activeOffcut: unref(activeOffcut),
    activeAltSeed: unref(activeAltSeed),
    densityPct: unref(densityPct),
    freeAreaMm2: unref(freeAreaMm2),
    reportTotals: unref(reportTotals),
    reportSheets: unref(reportSheets),
    reportBadges: unref(reportBadges),
    materialFormats: unref(materialFormats),
    postPassLines: unref(postPassLines),
    hasTechDetails: unref(hasTechDetails),
    discardedCount: unref(discardedCount),
    exportLocked: unref(exportLocked),
    exportDisabled: unref(exportDisabled),
    copied: unref(copied),
    whyFirstLine: unref(whyFirstLine),
    altTitle,
    strategyLabel,
    altQualityLine,
    headlineTitle: unref(headlineTitle),
    activeStrategyExplain: unref(activeStrategyExplain),
    name: unref(name),
}))

// U3 passe 2 : le slug n'est plus une ligne morte — il se copie.
const { show: showToast } = useToast()
const copySlug = async () => {
    const slug = String(unref(resultModalData).slug || '')
    try {
        await navigator.clipboard.writeText(slug)
    } catch {
        const ta = document.createElement('textarea')
        ta.value = slug
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
    }
    showToast(t('result.slugCopied'))
    trackEvent('result_slug_copied')
}

// L'enfant n'exprime qu'une INTENTION d'export ; la politique (paywall
// D-RAP-11) reste ici, ou elle a toujours ete.
const onExportIntent = ({ action, trackingTag }) => {
    onExportClick(action === 'csv' ? exportCsv : copyReport, trackingTag)
}
</script>

<style lang="scss" scoped>
/* U3 passe 2 — l'espace de resultat. Le dialogue est plein ecran ; c'est
   le volet rapport qui defile, jamais la boite. */
.result-space {
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    padding: 44px var(--sp-4) var(--sp-4);
    height: 100%;
    min-height: 0;
    box-sizing: border-box;

    &__alts {
        flex: 0 0 auto;
    }

    /* Sous 768 px : les deux volets s'EMPILENT (visionneuse d'abord) et
       c'est la colonne qui defile — surtout pas deux zones de defilement
       imbriquees, ni une grille a hauteur fixe (le rapport se peignait
       par-dessus la visionneuse). */
    &__panes {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: var(--sp-3);
        overflow-y: auto;
        overscroll-behavior: contain;

        @media (min-width: 768px) {
            display: grid;
            grid-template-columns: 2fr minmax(320px, 1fr);
            grid-template-rows: minmax(0, 1fr);
            overflow: hidden;
        }
    }

    &__viewer {
        min-width: 0;
        min-height: 55vh;

        @media (min-width: 768px) {
            min-height: 0;
        }
    }

    &__report {
        min-width: 0;
        flex: 0 0 auto;
        border: 1px solid var(--separator-secondary);
        border-radius: var(--radius-l);
        padding: var(--sp-3);
        background-color: var(--fill-tertiary);

        /* Volet droit : c'est LUI qui defile en deux colonnes. */
        @media (min-width: 768px) {
            min-height: 0;
            overflow-y: auto;
            overscroll-behavior: contain;
        }
    }
}
</style>
