/**
 * J-090 — import 100 % navigateur des fichiers d'un projet « 100 % privé ».
 *
 * Le fichier est lu en mémoire, parsé par le bundle géométrie WASM (parité
 * golden avec le pipeline serveur, verrou CI), puis stocké dans IndexedDB :
 * géométrie (parts + handles), bytes DXF canoniques mm (l'export DXF copie
 * les entités par handle depuis ces bytes) et un aperçu SVG (data URI).
 * AUCUN byte ne quitte la machine — DWG refusé (conversion serveur, D-PRV-2).
 */
import {
    geoImportFile, geoCanonicalDxf, geoCanonicalDxfScaled, geoCanonicalDxfPart,
    IMPORT_MAX_ENTITIES,
} from './geometryClient'
import { drawingExtent, resolveScale } from './advancedImport'
import { makeLocalFileSlug } from './localFilesStore'
import { MAX_UPLOAD_FILE_BYTES } from '~~/shared/constants/upload.constants'

// Miroir EXACT de workers/common/worker_common/colors.py — ne pas diverger
// (le rendu liste/live/résultat partage cette palette).
const PART_PALETTE = [
    '#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777',
    '#0D9488', '#EA580C', '#4F46E5', '#65A30D', '#0891B2', '#BE185D',
    '#16A34A', '#9333EA', '#0284C7', '#C026D3', '#CA8A04', '#E11D48',
    '#0F766E', '#9F1239', '#3F6212', '#1D4ED8', '#B45309', '#6D28D9',
]
const FILL_OPACITY_PREVIEW = 0.18

// Lot 2a : la garde « trop lourd » vit DANS le wasm (plafond d'entités posé
// avant la décomposition + budget de temps qui arrête le travail) — voir
// geometryClient.IMPORT_MAX_ENTITIES / IMPORT_TIME_BUDGET_MS, miroirs des
// constantes Rust et du worker Python. Ici, on ne fait plus que traduire le
// refus en message : le plafond n'est plus comparé après coup.
const MAX_ENTITY_LIMIT = IMPORT_MAX_ENTITIES

/** Erreur i18n d'un refus « trop lourd » — la clé porte ses nombres
 * (piège #24 : un nombre nu est incompréhensible). `entitiesAtLeast` vient
 * d'une expansion coupée au plafond dur : le message dit « plus de N ». */
function tooHeavyError(refusal) {
    const params = {
        n: refusal?.entities ?? 0,
        max: refusal?.maxEntities ?? MAX_ENTITY_LIMIT,
        seconds: Math.round((refusal?.timeBudgetMs ?? 0) / 1000),
    }
    let key
    if (refusal?.reason === 'blockDepth') {
        // Le serveur refuse aussi (assert_insert_depth) : ne JAMAIS renvoyer
        // vers un chemin dont on n'a pas vérifié qu'il réussit.
        key = 'localImport.blockDepth'
    } else if (refusal?.reason === 'time') {
        key = 'localImport.tooHeavy'
    } else {
        key = refusal?.entitiesAtLeast
            ? 'localImport.tooManyEntitiesAtLeast'
            : 'localImport.tooManyEntities'
    }
    const err = new Error(key)
    err.params = params
    return err
}

const ACCEPTED_EXTENSIONS = ['.dxf', '.svg']

/** pick_colors Python : sac mélangé par cycles — des pièces d'un même
 * fichier ont des couleurs distinctes. crypto RNG (jamais Math.random). */
function pickColors(count) {
    const out = []
    while (out.length < count) {
        const bag = [...PART_PALETTE]
        for (let i = bag.length - 1; i > 0; i--) {
            const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
            ;[bag[i], bag[j]] = [bag[j], bag[i]]
        }
        out.push(...bag)
    }
    return out.slice(0, count)
}

/** Aperçu SVG (data URI) des pièces d'un fichier : rangée horizontale,
 * chaque pièce normalisée à son bbox. Coords moteur y-up → SVG y-down :
 * flip vertical obligatoire (piège #20b). */
function buildPreviewSvg(parts) {
    const GAP_RATIO = 0.08
    const entries = parts.map((p) => {
        const xs = p.coordinates.map((c) => c[0])
        const ys = p.coordinates.map((c) => c[1])
        const minX = Math.min(...xs)
        const minY = Math.min(...ys)
        const maxX = Math.max(...xs)
        const maxY = Math.max(...ys)
        return { p, minX, minY, w: Math.max(1e-6, maxX - minX), h: Math.max(1e-6, maxY - minY) }
    })
    const maxH = Math.max(1e-6, ...entries.map((e) => e.h))
    const gap = maxH * GAP_RATIO
    const totalW = entries.reduce((acc, e) => acc + e.w, 0) + gap * Math.max(0, entries.length - 1)

    let cursor = 0
    const paths = []
    for (const e of entries) {
        const ty = (maxH - e.h) / 2 // centrage vertical dans la rangée
        const ringToD = (ring) =>
            ring
                .map((c, i) => {
                    const x = cursor + (c[0] - e.minX)
                    const y = ty + (e.h - (c[1] - e.minY)) // flip y
                    return `${i === 0 ? 'M' : 'L'}${x.toFixed(3)} ${y.toFixed(3)}`
                })
                .join('') + 'Z'
        const d = [e.p.coordinates, ...(e.p.holes || [])].map(ringToD).join(' ')
        paths.push(
            `<path d="${d}" fill="${e.p.color}" fill-opacity="${FILL_OPACITY_PREVIEW}" fill-rule="evenodd" stroke="${e.p.color}" stroke-width="${(maxH / 200).toFixed(3)}"/>`,
        )
        cursor += e.w + gap
    }
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW.toFixed(3)} ${maxH.toFixed(3)}">` +
        paths.join('') +
        '</svg>'
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * Importe UN File (DXF/SVG) d'un projet local et rend la LISTE des fiches
 * stockées — une seule d'ordinaire, une par pièce quand l'« import
 * avancé » demande l'éclatement (lot E1).
 *
 * La chaîne est unique : échelle du dessin complet (DXF canonique mis à
 * l'échelle) → import ordinaire → éclatement (un DXF canonique par pièce,
 * écrit depuis ses handles) → import ordinaire de chaque pièce. Chaque fiche
 * produite est une fiche NORMALE : quantité, rotations, couleur, aperçu,
 * suppression, export par handle.
 *
 * `options` : `{ scale = 1, explode = false }`. Options par défaut = aucun
 * appel supplémentaire, aucun octet de plus, comportement d'avant le lot E1.
 * Lève des Error à clé i18n (localImport.*) pour l'UI.
 */
export async function importLocalFiles(file, projectSlug, options = {}) {
    const name = file.name || 'part.dxf'
    const dot = name.lastIndexOf('.')
    const ext = dot >= 0 ? name.slice(dot).toLowerCase() : ''
    if (ext === '.dwg') {
        throw new Error('localImport.dwgRejected')
    }
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        throw new Error('localImport.unsupportedType')
    }
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
        throw new Error('upload.tooLarge')
    }

    const source = new Uint8Array(await file.arrayBuffer())
    if (ext === '.svg') {
        const head = new TextDecoder('utf-8', { fatal: false }).decode(source.subarray(0, 65536))
        if (/<!ENTITY\b/i.test(head)) {
            throw new Error('localImport.parseError')
        }
    }
    // Lot E1 — 1) ÉCHELLE, sur le dessin complet et une seule fois. Un
    // facteur de 1 ne touche rien (aucun appel wasm de plus).
    //
    // Mode « largeur/hauteur cible » : le facteur ne peut pas être connu
    // d'avance — il faut la taille du dessin, donc une lecture. On lit une
    // fois, on mesure l'étendue de TOUTES les pièces (le dessin complet,
    // pas la plus grande pièce), on en déduit le facteur.
    const explode = options.explode === true
    let scale = resolveScale(options, null)
    if (options.scaleTarget) {
        let probe
        try {
            probe = await geoImportFile(source)
        } catch {
            throw new Error('localImport.parseError')
        }
        if (probe?.refusal) throw tooHeavyError(probe.refusal)
        if (!probe || !Array.isArray(probe.parts) || probe.parts.length === 0) {
            throw new Error('localImport.noParts')
        }
        scale = resolveScale(options, drawingExtent(probe.parts))
    }
    let bytes = source
    if (scale !== 1) {
        try {
            bytes = await geoCanonicalDxfScaled(source, scale)
        } catch {
            throw new Error('localImport.parseError')
        }
        if (!(bytes instanceof Uint8Array)) {
            throw new Error('localImport.parseError')
        }
    }

    let imported
    try {
        imported = await geoImportFile(bytes)
    } catch {
        throw new Error('localImport.parseError')
    }
    if (imported?.refusal) {
        throw tooHeavyError(imported.refusal)
    }
    if (!imported || !Array.isArray(imported.parts)) {
        throw new Error('localImport.parseError')
    }
    if (imported.parts.length === 0) {
        throw new Error('localImport.noParts')
    }

    // Bytes canoniques mm (contrat d'export : entités copiées par handle).
    let canonical
    try {
        canonical = await geoCanonicalDxf(bytes)
    } catch {
        throw new Error('localImport.parseError')
    }

    const { saveLocalFile } = await import('./localFilesStore')

    // Provenance (champs ADDITIFS) : ce que le lot E1 a fait au dessin.
    const provenance = scale !== 1 ? { importScale: scale } : {}

    // Lot E1 : les fiches sont triées par `addedAt` (localFilesStore) — sans
    // horodatage distinct, dix-sept fiches écrites dans la même milliseconde
    // s'affichent dans un ordre arbitraire. On avance d'une milliseconde par
    // fiche : la liste suit l'ordre des pièces.
    const t0 = Date.now()
    let written = 0

    /** Fabrique + stocke une fiche depuis un import et ses octets DXF. */
    const store = async (imp, dxf, label, extra) => {
        const colors = pickColors(imp.parts.length)
        const parts = imp.parts.map((p, i) => ({
            coordinates: p.coordinates,
            holes: p.holes || [],
            width: p.width,
            height: p.height,
            handles: p.handles || [],
            color: colors[i],
        }))
        const record = {
            slug: makeLocalFileSlug(label),
            projectSlug,
            name: label,
            addedAt: new Date(t0 + written++).toISOString(),
            dxfBytes: dxf.slice().buffer,
            parts,
            sourceUnits: imp.source_units ?? 0,
            entityCount: imp.entity_count ?? 0,
            warnings: imp.warnings || [],
            // Lot 2c : les constats d'import (perte de matière, unité
            // supposée, tracés ouverts) — c'est le maillon qui manquait
            // entre le wasm et la fiche fichier.
            // Lot E2 : + la mise à l'échelle. Le crate ne peut pas la
            // rapporter (elle est appliquée AVANT lui, sur le DXF) : elle
            // est ajoutée ici, avec le même niveau et la même forme que les
            // autres constats — un dessin n'est jamais multiplié en silence.
            findings: [
                ...(imp.findings || []),
                ...(scale !== 1
                    ? [{
                        code: 'import.scaleApplied',
                        level: 'info',
                        count: 1,
                        value: String(Math.round(scale * 10000) / 10000),
                    }]
                    : []),
            ],
            previewSvg: buildPreviewSvg(parts),
            ...provenance,
            ...(extra || {}),
        }
        await saveLocalFile(record)
        return record
    }

    // Lot E1 — 2) ÉCLATEMENT : un DXF canonique par pièce, écrit depuis ses
    // handles, repassé par l'import ORDINAIRE. Un seul contour ⇒ rien à
    // éclater, on garde la fiche unique et son nom intact.
    if (!explode || imported.parts.length < 2) {
        return [await store(imported, canonical, name, {})]
    }

    const total = imported.parts.length
    const base = dot >= 0 ? name.slice(0, dot) : name
    const suffix = dot >= 0 ? name.slice(dot) : ''
    const out = []
    for (let k = 0; k < total; k++) {
        const part = imported.parts[k]
        const label = `${base} (${k + 1}/${total})${suffix}`
        const extra = { explodedFrom: name, explodedIndex: k + 1 }
        let partBytes = null
        try {
            partBytes = await geoCanonicalDxfPart(canonical, part.handles || [])
        } catch {
            partBytes = null
        }
        let sub = null
        if (partBytes instanceof Uint8Array) {
            try {
                sub = await geoImportFile(partBytes)
            } catch {
                sub = null
            }
        }
        if (sub && Array.isArray(sub.parts) && sub.parts.length >= 1) {
            out.push(await store(sub, partBytes, label, extra))
            continue
        }
        // Repli : le sous-ensemble ne referme rien tout seul (deux pièces qui
        // partagent une arête, par exemple). On NE PERD PAS la pièce : sa
        // géométrie vient de l'import du dessin complet et ses octets du
        // document canonique complet — l'export par handle reste exact.
        out.push(await store(
            { ...imported, parts: [part] },
            canonical,
            label,
            { ...extra, explodeFallback: true },
        ))
    }
    return out
}

/**
 * Compatibilité : un seul File, une seule fiche (le chemin d'avant le lot
 * E1). Les appelants qui peuvent recevoir plusieurs fiches passent par
 * `importLocalFiles`.
 */
export async function importLocalFile(file, projectSlug, options = {}) {
    const records = await importLocalFiles(file, projectSlug, options)
    return records[0]
}

/** Forme UI attendue par ProjectFiles/FileDone (miroir du mapper serveur) —
 * géométrie complète omise (rechargée depuis IndexedDB au nest). */
export function localRecordToUiFile(record) {
    // La visionneuse DXF (FileModal) fetch l'URL — blob: depuis les bytes
    // locaux (jamais de requête réseau). null en SSR/test (pas d'URL API).
    let dxfUrl = null
    try {
        dxfUrl = record.dxfBytes
            ? URL.createObjectURL(new Blob([record.dxfBytes], { type: 'image/vnd.dxf' }))
            : null
    } catch {
        dxfUrl = null
    }
    return {
        slug: record.slug,
        name: record.name,
        svgUrl: record.previewSvg || null,
        dxfUrl,
        processingStatus: 'done',
        expired: false,
        local: true,
        // Lot 2c : les constats voyagent jusqu'à l'UI (ils mouraient ici).
        findings: record.findings || [],
        parts: (record.parts || []).map((p) => ({
            width: Math.round(p.width * 10) / 10,
            height: Math.round(p.height * 10) / 10,
            color: p.color,
        })),
    }
}
