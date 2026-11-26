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
    realSheetDims,
    edgeShiftOf,
    realStripExtent,
} from './localBridge'
import { sheetCentre, sheetPositions } from '../utils/partPositions.js'
import { entityIndexOf } from '../utils/dxfEntities.js'

/** Contour d'une tôle importée (repère de la tôle : la tôle ENTIÈRE, la
 * VRAIE — à distance au bord, le contour d'origine de `sheetFrames`, jamais le
 * contour moteur décalé), ou null pour un rectangle. Ne sort jamais d'ici. */
function importedOutline(container, payload) {
    const id = container?.container_id
    const bin = payload?.instance?.bins?.[id]
    const shaped = Array.isArray(payload?.shapedSheets)
        && payload.shapedSheets.some((s) => s.id === bin?.id)
    if (!shaped) return null
    const frame = edgeShiftOf(payload) ? payload?.sheetFrames?.[id] : null
    if (frame) return Array.isArray(frame.outer) ? frame.outer : null
    return bin.shape?.data?.outer ?? null
}

/** Centre (mm) de la tôle d'un container : celui que « Centre de la tôle » met
 * en (0, 0). */
export function containerCentre(container, payload) {
    return sheetCentre([container.bin_width, container.bin_height], importedOutline(container, payload))
}

/** Positions des pièces de CHAQUE tôle d'une alternative (CSV « Positions »),
 * ou null : tout ou rien — une tôle sans positions ne doit pas disparaître en
 * silence d'un CSV qui aurait l'air complet. Ne fait JAMAIS échouer le job. */
export function alternativePositions(containers, payload, entityIndex) {
    try {
        if (!containers?.length) return null
        const partsById = new Map((payload?.parts || []).map((p) => [String(p.id), p]))
        const out = []
        for (let li = 0; li < containers.length; li++) {
            const c = containers[li]
            const rows = sheetPositions(c, partsById, entityIndex)
            if (!rows) return null
            out.push({
                sheet: li + 1,
                box: [c.bin_width, c.bin_height],
                center: containerCentre(c, payload),
                rows,
            })
        }
        return out
    } catch {
        return null
    }
}

/** Les positions n'existent que pour un job construit DANS le navigateur
 * (`mode === 'client-built'`, projet « Cet appareil ») : le payload préparé par le
 * serveur a perdu `blockParts` et les noms de fichiers. Retire `positions` des
 * alternatives sinon (mutation). */
export function dropPositionsUnlessBrowserBuilt(alternatives, mode) {
    if (mode === 'client-built') return alternatives
    for (const alt of alternatives || []) delete alt.positions
    return alternatives
}

/** Frame finale synthétique pour la vue live (même forme que le reveal
 * serveur : [item_id, bin, rot_deg, x, y]). */
export function buildLiveLayout(result, payload, bestAlt, measuredDensity = null) {
    const layouts = normalizeLayouts(bestAlt?.solution)
    // Distance au bord : la frame finale est dans le repère RÉEL. Les layouts
    // y sont déjà (buildAlternativeArtifacts, `edgeReal`) ; un layout qui n'y
    // serait pas passé est décalé ici, jamais deux fois. La largeur et la
    // hauteur de bande du moteur deviennent les longueurs réelles (+ d).
    const d = edgeShiftOf(payload)
    const items = []
    layouts.forEach((layout, bin) => {
        const shift = d && !layout?.edgeReal ? d : 0
        for (const pi of layout.placed_items || []) {
            const x = pi.transformation?.translation?.[0] ?? 0
            const y = pi.transformation?.translation?.[1] ?? 0
            items.push([
                pi.item_id,
                bin,
                pi.transformation?.rotation ?? 0,
                shift ? x + shift : x,
                shift ? y + shift : y,
            ])
        }
    })
    const [w, h] = realSheetDims(payload, 0)
    const sheetOf = (l) => realSheetDims(payload, l.container_id ?? 0)
    return {
        stage: 'final',
        feasible: true,
        bias: bestAlt?.bias ?? null,
        // Même définition que le résultat (pièces / tôles) : la densité brute
        // du moteur (pièces / bande) n'est jamais montrée.
        density: measuredDensity,
        densityMeasured: true,
        strip_width: realStripExtent(bestAlt?.solution?.strip_width ?? bestAlt?.strip_width ?? null, d),
        used_height: realStripExtent(bestAlt?.used_height ?? bestAlt?.solution?.used_height ?? null, d),
        bins: layouts.length,
        sheets: [[w, h]],
        // Tôle importée : le format de CHAQUE tôle de la frame finale (le
        // rang n'est pas le format) et sa boîte, pour que la vue live dessine
        // à chacune SA forme. Absent pour un job rectangulaire (frame inchangée).
        ...(Array.isArray(payload?.shapedSheets) && payload.shapedSheets.length
            ? {
                binFormats: layouts.map((l) => l.container_id ?? 0),
                sheets: layouts.map(sheetOf),
            }
            // Plusieurs formats rectangulaires : la boîte de CHAQUE tôle aussi.
            // Avec la seule boîte du premier format, l'image finale dessinait
            // toutes les tôles à sa taille et coupait les pièces des plus
            // grandes (défaut ancien). Un seul format : frame inchangée.
            : (payload?.instance?.bins?.length || 0) > 1
                ? { sheets: layouts.map(sheetOf) }
                : {}),
        isSpp: (result?.problem || payload?.problem) === 'spp',
        items,
        // Distance au bord seulement : frame déjà dans le repère réel (la vue
        // live ne la décale plus) et plus grande longueur de bande qui tient.
        ...(d
            ? {
                edgeReal: true,
                ...(Number.isFinite(Number(payload?.engineConfig?.max_strip_width))
                    && !Array.isArray(payload?.instance?.bins)
                    ? { stripMaxWidth: Number(payload.engineConfig.max_strip_width) + d }
                    : {}),
            }
            : {}),
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
    // Tôle importée : la grille structurelle pave des RECTANGLES de la tôle
    // (largeur × hauteur de la boîte) — elle poserait des pièces hors du
    // contour et dans les zones interdites. Pas d'alternative grille.
    if (Array.isArray(payload?.shapedSheets) && payload.shapedSheets.length) {
        return { built: false, skipped: 'shaped_sheet' }
    }
    const { buildGridLayoutsMulti } = await import('./structureMultiClient')
    const { geoPinwheelCapacity } = await import('./geometryClient')
    const parts = payload?.parts || []
    const partsByIdLocal = new Map(parts.map((p) => [Number(p.id), p]))
    const geomOf = (id) => {
        const p = partsByIdLocal.get(Number(id))
        return {
            coords: p?.coords,
            rotations: (p?.rotations?.length ? p.rotations : [0, 90, 180, 270]),
            // E4-a : drapeau bloc pour detectStructuralCase (§8.1.4).
            ...(p?.block ? { block: p.block } : {}),
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
    // La grille se construit dans le repère MOTEUR (`sheets` ci-dessus : sa marge
    // `space` du conteneur moteur est la distance au bord de la vraie tôle) ;
    // ses poses passent au repère réel avec les autres, dans
    // buildAlternativeArtifacts. Sa densité, elle, se rapporte à la VRAIE tôle.
    const usedArea = gridLayouts.reduce((s, l) => {
        if (edgeShiftOf(payload)) {
            const [rw, rh] = realSheetDims(payload, l.container_id ?? 0)
            return s + rw * rh
        }
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

export async function assembleBrowserArtifacts({ result, payload, sources, jobSlug, qa = null, withPositions = true }) {
    // Entités réelles des sources (positions des pièces), lues une fois par source.
    const entityIndex = entityIndexOf(sources)
    const localDiscarded = []
    // §17.2 : états de poses des alternatives écartées (QA seulement).
    const qaDiscarded = []
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
        let arts = await buildAlternativeArtifacts(result, payload, qa)
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
            // GARDE ANTI-PERTE (lot J4-bis) — AVANT le contrôle par classe,
            // parce que celui-ci ne peut pas voir le défaut : il compare aux
            // comptes du MOTEUR, et le moteur n'a jamais vu les pièces que la
            // réduction lui avait retirées.
            //
            // La réduction retire des pièces de l'instance en pariant que
            // l'expansion les rattachera. Quand le pari est faux, elles ne
            // sont nulle part : mesuré sur la recette, 4 posées sur 5, et le
            // job se terminait « réussi » (étude §9.25). On écarte
            // l'alternative — refuser vaut mieux que livrer une tôle amputée
            // en silence (pièges #45 et #56b).
            const planned = Number(art?.expansionPlanned) || 0
            const attached = Number(art?.expansionAttached) || 0
            if (planned !== attached) {
                localDiscarded.push({
                    reason: 'expansion_lost',
                    strategy,
                    planned,
                    attached,
                })
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
            // Tôle importée : une pose hors du VRAI contour ou sur une zone
            // interdite se traite comme un recouvrement mesuré (piège #56b) :
            // l'option est écartée et tracée, jamais livrée. Les champs
            // n'existent que pour un job à tôle importée (additifs) ; un job
            // rectangulaire garde son chemin d'avant, `insideSheet` compris.
            const outsideOutline = Number(verify?.partsOutsideOutline) || 0
            const zoneHits = Number(verify?.zoneViolations) || 0
            if (outsideOutline > 0 || zoneHits > 0) {
                localDiscarded.push({
                    reason: outsideOutline > 0 ? 'outside_outline' : 'forbidden_zone',
                    strategy,
                    verification: {
                        partsOutsideOutline: outsideOutline,
                        zoneViolations: zoneHits,
                        zoneOverlapAreaMm2: verify.zoneOverlapAreaMm2 ?? null,
                        minDistToOutlineMm: verify.minDistToOutlineMm ?? null,
                        minDistToZoneMm: verify.minDistToZoneMm ?? null,
                    },
                })
                return
            }
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
                // §17.2 : une alternative ÉCARTÉE ne laisse aucun record —
                // c'est justement le cas le plus intéressant à mesurer
                // (« toutes les alternatives rejetées », remboursement). Sous
                // drapeau QA, on garde ses deux états de poses pour dire si
                // le recouvrement existait AVANT le post-pass.
                if (qa?.dumpPrePostPass && art?.qaPrePostPass) {
                    qaDiscarded.push({
                        strategy,
                        reason: 'overlap',
                        verification: {
                            overlapFree: verify.overlapFree,
                            duplicatePoses: verify.duplicatePoses,
                            smallestGapMm: verify.smallestGapMm ?? null,
                        },
                        qaPrePostPass: art.qaPrePostPass,
                    })
                }
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
                if (d) {
                    // Boîte et centre (mm) de la tôle ENTIÈRE : le recentrage du fichier
                    // et le CSV en ont besoin, et un record plus ancien ne la
                    // porte pas (il la relit du rapport).
                    d.box = [containers[li].bin_width, containers[li].bin_height]
                    d.center = containerCentre(containers[li], payload)
                    dxfs.push(d)
                }
            }
            alternatives[rank].dxfs = dxfs
            alternatives[rank].altId = rank
            // Additif : unité du DXF livré (celle du CSV) et positions des
            // pièces. Restent dans le record du navigateur, jamais envoyés.
            alternatives[rank].outputUnit = payload?.outputUnit === 'inch' ? 'inch' : 'mm'
            // `withPositions` faux (job préparé par le serveur) : on ne mesure rien.
            const positions = withPositions ? alternativePositions(containers, payload, entityIndex) : null
            if (positions) alternatives[rank].positions = positions
        }
        liveLayout = buildLiveLayout(result, payload,
            result.alternatives[idx[0]] ?? bestRaw, alternatives[0]?.density ?? null)
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
        // Vide hors drapeau QA.
        qaDiscarded,
    }
}
