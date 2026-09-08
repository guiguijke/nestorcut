/**
 * P4 : assemblage des artefacts navigateur (post-pass, SVG, DXF, rapport)
 * extraits de localJobPrivate pour tourner AUSSI dans un Web Worker.
 * Même code que le thread principal — bit-identique par construction.
 */
import {
    buildAlternativeArtifacts,
    toServerShapeAlternatives,
    buildSheetDxf,
    normalizeLayouts,
    sheetDims,
} from './localBridge'

/** Frame finale synthétique pour la vue live (même forme que le reveal
 * serveur : [item_id, bin, rot_deg, x, y]). */
export function buildLiveLayout(result, payload, bestAlt) {
    const layouts = normalizeLayouts(bestAlt?.solution)
    const items = []
    layouts.forEach((layout, bin) => {
        for (const pi of layout.placed_items || []) {
            items.push([
                pi.item_id,
                bin,
                pi.transformation?.rotation ?? 0,
                pi.transformation?.translation?.[0] ?? 0,
                pi.transformation?.translation?.[1] ?? 0,
            ])
        }
    })
    const [w, h] = sheetDims(payload, 0)
    return {
        stage: 'final',
        feasible: true,
        bias: bestAlt?.bias ?? null,
        density: bestAlt?.solution?.density ?? bestAlt?.density ?? null,
        strip_width: bestAlt?.solution?.strip_width ?? bestAlt?.strip_width ?? null,
        used_height: bestAlt?.used_height ?? bestAlt?.solution?.used_height ?? null,
        bins: layouts.length,
        sheets: [[w, h]],
        isSpp: (result?.problem || payload?.problem) === 'spp',
        items,
    }
}

/**
 * Post-pass + garde + tri d'affichage + DXF. MUTE `result.alternatives`.
 * @returns {{ alternatives, liveLayout, placed, allAlternativesInvalid, localDiscarded, result }}
 */
async function appendBppGrid(result, payload) {
    if ((result?.problem || payload?.problem) === 'spp') return null
    const inst = payload?.instance || {}
    if (!Array.isArray(inst.bins) || !inst.bins.length) return null
    const { buildGridLayoutsMulti } = await import('./structureMultiClient')
    const { geoPinwheelCapacity } = await import('./geometryClient')
    const parts = payload?.parts || []
    const partsByIdLocal = new Map(parts.map((p) => [Number(p.id), p]))
    const geomOf = (id) => {
        const p = partsByIdLocal.get(Number(id))
        return {
            coords: p?.coords,
            rotations: (p?.rotations?.length ? p.rotations : [0, 90, 180, 270]),
        }
    }
    const sheets = inst.bins.map((b) => {
        const outer = b.shape?.data?.outer || []
        let w = 0, h = 0
        for (const [x, y] of outer) { w = Math.max(w, x); h = Math.max(h, y) }
        return { width: w, height: h, count: Number(b.stock) || 1 }
    })
    const spaceMm = Number(payload?.engineConfig?.min_item_separation) || 0
    const gridStats = { errors: [] }
    const gridLayouts = await buildGridLayoutsMulti(
        parts, geomOf, sheets, spaceMm, gridStats,
        { pinwheelCapacity: geoPinwheelCapacity })
    if (!gridLayouts) return { built: false, errors: gridStats.errors }
    const ringArea = (coords) => {
        let s = 0
        for (let i = 0; i < coords.length; i++) {
            const [x1, y1] = coords[i]
            const [x2, y2] = coords[(i + 1) % coords.length]
            s += x1 * y2 - x2 * y1
        }
        return Math.abs(s) / 2
    }
    let material = 0
    for (const p of parts) {
        const holesArea = (p.holes || []).reduce((s, h) => s + ringArea(h), 0)
        material += Math.max(0, ringArea(p.coords) - holesArea) * (Number(p.count) || 0)
    }
    const usedArea = gridLayouts.reduce((s, l) => {
        const b = inst.bins[l.container_id ?? 0]
        const outer = b?.shape?.data?.outer || []
        let w = 0, h = 0
        for (const [x, y] of outer) { w = Math.max(w, x); h = Math.max(h, y) }
        return s + w * h
    }, 0)
    result.alternatives = [...(result.alternatives || []), {
        rank: (result.alternatives?.length) || 0,
        seed: null,
        bias: null,
        structural: true,
        selfContained: true,
        solution: {
            layouts: gridLayouts,
            density: usedArea > 0 ? material / usedArea : null,
            cost: gridLayouts.length,
        },
    }]
    return {
        built: true,
        layouts: gridLayouts.length,
        perSheet: gridLayouts.map((l) => (l.placed_items || []).length),
    }
}

export async function assembleBrowserArtifacts({ result, payload, sources, jobSlug }) {
    const localDiscarded = []
    let structMultiDiag = null
    try {
        structMultiDiag = await appendBppGrid(result, payload)
    } catch (e) {
        structMultiDiag = { built: false, error: String(e) }
    }
    let alternatives = []
    let liveLayout = null
    let placed = 0
    let allAlternativesInvalid = false
    const rawAlts = result?.alternatives || []
    try {
        const { perClassCountsMatch, enginePlacedById } = await import('./localBridge')
        const preEngineCounts = rawAlts.map((alt) => enginePlacedById(alt))
        let arts = await buildAlternativeArtifacts(result, payload)
        const requestedById = new Map(
            (payload?.parts || []).map((p) => [String(p.id), Number(p.count) || 0]),
        )
        const keptIdx = []
        rawAlts.forEach((alt, i) => {
            const art = arts?.[i]
            const strategy = alt.bias || alt.strategy || 'engine'
            if (alt.structural && art?.report?.verify?.insideSheet === false) {
                localDiscarded.push({ reason: 'outside_sheet', strategy })
                return
            }
            const artCounts = art?.engineCounts
            const enginePlaced = artCounts && Object.keys(artCounts).length
                ? new Map(Object.entries(artCounts).map(([k, v]) => [k, v]))
                : preEngineCounts[i]
            const referenceById = enginePlaced && enginePlaced.size ? enginePlaced : requestedById
            if (art?.containers?.length
                && !perClassCountsMatch(art.containers, referenceById)) {
                localDiscarded.push({ reason: 'class_mismatch', strategy })
                return
            }
            const verify = art?.report?.verify
            if (verify && (verify.overlapFree === false || (verify.duplicatePoses || 0) > 0)) {
                localDiscarded.push({
                    reason: 'overlap',
                    strategy,
                    verification: {
                        overlapFree: verify.overlapFree,
                        duplicatePoses: verify.duplicatePoses,
                        smallestGapMm: verify.smallestGapMm ?? null,
                    },
                })
                return
            }
            keptIdx.push(i)
        })
        if (keptIdx.length !== rawAlts.length) {
            result.alternatives = keptIdx.map((i) => rawAlts[i])
            arts = keptIdx.map((i) => arts?.[i] ?? null)
        }
        if (!keptIdx.length && rawAlts.length) {
            allAlternativesInvalid = true
            throw new Error('all_alternatives_invalid')
        }
        const bestRaw = result.alternatives[0]
        placed = normalizeLayouts(bestRaw?.solution)
            .reduce((n, l) => n + (l.placed_items?.length || 0), 0)
        alternatives = toServerShapeAlternatives(result, payload, arts) || []
        const DIRECTION_ORDER = { grid: -1, left: 0, bottom: 1, balanced: 2 }
        const known = alternatives.some((a) => a.strategy in DIRECTION_ORDER)
        const cmp = (x, y) => {
            if (known) {
                const dx = DIRECTION_ORDER[x.strategy] ?? 99
                const dy = DIRECTION_ORDER[y.strategy] ?? 99
                if (dx !== dy) return dx - dy
            }
            const lx = x.layoutCount || 0
            const ly = y.layoutCount || 0
            if (lx !== ly) return lx - ly
            return (x.usedSheetShare ?? 1.0) - (y.usedSheetShare ?? 1.0)
        }
        const idx = alternatives.map((_, i) => i).sort((a, b) => cmp(alternatives[a], alternatives[b]))
        const containersOrdered = idx.map((i) => arts?.[i]?.containers || [])
        alternatives = idx.map((i) => alternatives[i])
        for (let rank = 0; rank < alternatives.length; rank++) {
            const containers = containersOrdered[rank]
            const dxfs = []
            for (let li = 0; li < containers.length; li++) {
                const d = await buildSheetDxf(
                    `${jobSlug}_alt${rank}`, li + 1, containers[li], payload, sources,
                )
                if (d) dxfs.push(d)
            }
            alternatives[rank].dxfs = dxfs
            alternatives[rank].altId = rank
        }
        liveLayout = buildLiveLayout(result, payload,
            result.alternatives[idx[0]] ?? bestRaw)
    } catch (e) {
        if (e?.message === 'all_alternatives_invalid') {
            allAlternativesInvalid = true
        }
    }
    return {
        alternatives,
        liveLayout,
        placed,
        allAlternativesInvalid,
        localDiscarded,
        result,
        structMultiDiag,
    }
}
