/**
 * PR4 (flag-gated internal QA — invisible pour l'utilisateur) : pilote le
 * bundle géométrie WASM côté navigateur, en lazy-loading. Rien n'est chargé
 * tant que le flag est OFF ou qu'aucun job local ne démarre. Un seul worker
 * par onglet, réutilisé (le WASM reste chargé — réutilisation gratuite).
 *
 * Le chemin client est un substitut EXACT du chemin serveur : mêmes sorties
 * (verrou déterminisme natif↔wasm tol. 0 + exports_check natif vs Python).
 */
import { isLocalComputeEnabled } from './localCompute'

let worker = null
let seq = 0
const pending = new Map()

function getWorker() {
    if (worker) return worker
    worker = new Worker('/workers/geometry.worker.js', { type: 'module' })
    worker.onmessage = (event) => {
        const { id, ...rest } = event.data || {}
        const settle = pending.get(id)
        if (settle) {
            pending.delete(id)
            settle(rest)
        }
    }
    worker.onerror = (event) => {
        // crash worker = reject propre de toutes les requêtes en attente,
        // pas de crash de page (pattern localCompute.js).
        for (const [, settle] of pending) settle({ ok: false, error: event.message || 'geometry worker error' })
        pending.clear()
        worker?.terminate()
        worker = null
    }
    return worker
}

function call(op, args) {
    if (!isLocalComputeEnabled()) {
        return Promise.resolve({ ok: false, error: 'local compute disabled' })
    }
    return new Promise((resolve) => {
        const id = ++seq
        pending.set(id, resolve)
        getWorker().postMessage({ id, op, ...args })
    })
}

const parse = (r) => (r.ok ? JSON.parse(r.result) : r)

/**
 * Bornes d'import du chemin navigateur (lot 2a,
 * `docs/PLAN-IMPORT-2026-09-09.md` §9.2). Miroirs EXACTS des constantes
 * Rust (`nest-import::budget`) et du worker Python (`MAX_ENTITY_LIMIT`,
 * `IMPORT_TIME_BUDGET_S`) — ne pas diverger.
 */
export const IMPORT_MAX_ENTITIES = 10000
export const IMPORT_TIME_BUDGET_MS = 20000

/**
 * Import borné : rend l'`ImportResult` (parts/source_units/entity_count/
 * warnings) quand le fichier passe, `{ refusal }` quand une borne le refuse
 * (`reason` = entities | time | blockDepth, avec le compte d'entités et le
 * temps écoulé), `{ ok: false, error }` quand le worker ou le wasm échoue.
 *
 * Les bornes sont posées DANS le wasm, avant la décomposition : un refus
 * « trop lourd » ne coûte plus l'import entier (défaut C9 de la synthèse —
 * 4,9 s et 7,2 s payés pour un refus).
 */
export async function geoImportFile(bytes, tol = 0.01, limits = {}) {
    const r = parse(
        await call('import_file_limited', {
            bytes: Array.from(bytes),
            tol,
            maxEntities: limits.maxEntities ?? IMPORT_MAX_ENTITIES,
            timeBudgetMs: limits.timeBudgetMs ?? IMPORT_TIME_BUDGET_MS,
        }),
    )
    if (!r || r.ok === false) return r
    if (r.status === 'refused') return { refusal: r.refusal, message: r.message }
    return r.result
}
export async function geoOpenHoles(outer, holes, spaceMm) {
    return parse(await call('open_holes', { json: JSON.stringify({ outer, holes, space_mm: spaceMm }) }))
}
export async function geoExportSvgSheet(spec) {
    const r = await call('export_svg_sheet', { json: JSON.stringify(spec) })
    return r.ok ? r.result : r
}
export async function geoComputeReport(spec) {
    return parse(await call('compute_report', { json: JSON.stringify(spec) }))
}
/** J-082 : DXF combiné d'une tôle (multi-sources, jumeau de build_part). */
export async function geoExportDxfSheet(slugs, sourcesBytes, spec) {
    const r = await call('export_dxf_sheet', {
        slugs,
        sources: sourcesBytes.map((b) => Array.from(b)),
        json: JSON.stringify(spec),
    })
    return r.ok ? r.result : r
}

/** J-090 : bytes DXF canoniques mm (import 100 % client — contrat d'export
 * par handle, miroir de la copie validDxf du pipeline serveur). */
export async function geoCanonicalDxf(bytes, tol = 0.01) {
    const r = await call('canonical_dxf', { bytes: Array.from(bytes), tol })
    return r.ok ? new Uint8Array(r.result) : r
}
/** J-090 : rotations pinwheel validées pour un filler dans un trou
 * (pré-passe meta J-085 côté navigateur). */
export async function geoPinwheelCapacity(holeRing, fillerCoords, spaceMm, allowed = null) {
    return parse(await call('pinwheel_capacity', {
        json: JSON.stringify({
            hole_ring: holeRing,
            filler_coords: fillerCoords,
            space_mm: spaceMm,
            allowed,
        }),
    }))
}

/**
 * QA (PR3) : calcule côté navigateur les artefacts d'un résultat résolu
 * (SVG coloré par tôle + rapport) via le PONT localBridge (J-082), pour
 * comparaison client/serveur. `payload` = le localPayload enrichi (parts,
 * engineConfig…) rapporté par local-payload. Best-effort : renvoie null si
 * les données manquent (jamais une rupture du flux).
 */
export async function computeClientArtifacts(result, payload) {
    try {
        const { buildAlternativeArtifacts, toServerShapeAlternatives } = await import('./localBridge')
        const arts = await buildAlternativeArtifacts(result, payload)
        if (!arts) return null
        const alts = toServerShapeAlternatives(result, payload, arts)
        if (!alts.length) return null
        // Forme historique attendue par local-result : sheets + report par alt.
        return alts.map((alt, i) => ({
            sheets: alt.svgs || [],
            report: alt.report || null,
            containers: arts[i]?.containers || [],
        }))
    } catch {
        return null
    }
}
