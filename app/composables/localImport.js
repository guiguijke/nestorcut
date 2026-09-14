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
import {
    isSheetCamJob, jobDrawingName, jobPathRecords, jobSheet, parseSheetCamJob,
} from '~~/shared/sheetcamJob.js'
import { assignJobBlocks } from '~~/shared/sheetcamReserve.js'

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

// Ces extensions ne servent qu'à FILTRER : le sélecteur de fichiers du
// système, la passoire de DxfUpload, et ce garde-ci. La VÉRITÉ du format est
// la SIGNATURE de contenu (piège #31), lue plus bas sur les octets — un `.job`
// renommé `.dxf` est reconnu comme `.job`, un DXF nommé `.job` repart dans la
// chaîne DXF. Lot J4 : `.job` sur le chemin navigateur seulement (le miroir
// serveur est le lot J5).
const ACCEPTED_EXTENSIONS = ['.dxf', '.svg', '.job']

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

// --- `.job` SheetCam (lot J4) ----------------------------------------------
//
// Un `.job` n'est PAS un dessin : il ne porte aucune géométrie exploitable
// (son bloc binaire est le cache interne de SheetCam, jamais décodé — lot J1).
// Il porte la TÔLE, le KERF, et la liste des dessins référencés par leur
// chemin sur le disque de l'utilisateur, avec leur quantité et leur opération
// de coupe. Les DXF, eux, sont à déposer à côté (règle 9 de l'étude).
//
// Pourquoi ce routage doit vivre EN JS, avant le wasm : le détecteur de
// l'importeur wasm n'a que DEUX branches (premier octet non blanc `<` ⇒ SVG,
// tout le reste ⇒ DXF). Un `.job` parfaitement valide n'y est donc pas
// rejeté — il part dans l'importeur DXF et ressort en « erreur d'analyse »
// générique, un message FAUX pour un fichier valide. On ne touche pas au
// détecteur Rust : l'étendre imposerait un rebuild du wasm (piège #33b).

/**
 * Lit un `.job` SheetCam depuis ses OCTETS et rend ce dont l'UI a besoin :
 * `{ job, sheet, kerfWidth, drawings }`.
 *
 *  - `job` : la lecture complète du lot J1 (forme préservée, bloc binaire) ;
 *  - `sheet` : `{ width, height }` en millimètres, lus dans `[Work]` ;
 *  - `kerfWidth` : largeur de saignée de `[Tool0]`, en millimètres, ou `null`
 *    si le fichier n'en déclare pas (l'espacement se déduit du kerf par
 *    `spacingFromKerf`, lot J3 — ce module ne le calcule pas) ;
 *  - `drawings` : une entrée par NOM de dessin (le chemin absolu est réduit au
 *    nom de fichier — règle 9), avec :
 *      `quantity`   nombre d'exemplaires dans le `.job`, **copies `copyOf`
 *                   comprises** (c'est la quantité à nester) ;
 *      `parts`      les rangs des sections `Part N` concernées, copies incluses
 *                   (l'ordre du fichier, jamais retrié — règle 6) ;
 *      `leadIn`, `leadInType`, `startPosition` : l'opération de coupe de
 *                   l'ORIGINAL, celle dont le lot J3 déduit la réserve
 *                   d'amorce. `null` si le fichier ne la déclare pas ;
 *      `operations` toutes les opérations de l'original, telles que lues.
 *
 * Lève un `SheetCamJobError` (son `code` EST une clé i18n `sheetcamJob.*`) si
 * le fichier n'est pas un `.job` lisible : version inconnue, bloc binaire
 * absent, aucune pièce. On refuse plutôt que de deviner.
 */
export function readSheetCamJob(bytes) {
    const job = parseSheetCamJob(bytes)
    const byName = new Map()
    for (const part of job.parts) {
        const name = jobDrawingName(part.drawingFile)
        if (!byName.has(name)) {
            byName.set(name, {
                name,
                quantity: 0,
                parts: [],
                leadIn: null,
                leadInType: null,
                leadOut: null,
                leadOutType: null,
                startPosition: null,
                starts: [],
                origin: null,
                operations: [],
            })
        }
        const entry = byName.get(name)
        entry.quantity += 1
        entry.parts.push(part.index)
        // Les opérations ne vivent que sur les ORIGINAUX : une copie `copyOf`
        // n'a ni section `Operation`, ni géométrie propre — elle rejoue celle
        // de son original (règle 4). On prend donc la première opération
        // ACTIVE du premier original rencontré.
        if (part.copyOf < 0 && entry.operations.length === 0 && part.operations.length) {
            entry.operations = part.operations
            const op = part.operations.find((o) => o.enabled) || part.operations[0]
            entry.leadIn = op.leadIn
            entry.leadInType = op.leadInType
            entry.leadOut = op.leadOut
            entry.leadOutType = op.leadOutType
            entry.startPosition = op.startPosition
        }
    }
    // Les points de départ, LUS dans le bloc binaire (lot J4-bis-2, §9.42).
    //
    // LES BLOCS NE SONT PAS APPARIÉS ICI, ET C'EST LE CORRECTIF DU LOT
    // J4-bis-3. Le lot J4-bis-2 appariait le k-ième bloc au k-ième nom de
    // dessin rencontré dans les sections `[Part N]`. Sur un `.job` dont les
    // sections déclarent les dessins dans un autre ordre que le cache
    // binaire, les dessins sont INVERSÉS : les points tombent tous à côté,
    // les contours sortent en « point non lu » et les trous quittent le
    // nesting (§9.45, trouvé par le vérificateur sur
    // `Piece_Trou+Fill_x4_ordre_TEST.job`).
    //
    // L'appariement demande la GÉOMÉTRIE des dessins, qui n'existe qu'une
    // fois l'import fait : c'est `assignJobStarts` ci-dessous qui le fait, et
    // l'appelant (`files.js`) qui le branche après avoir importé les dessins.
    //
    // Les LONGUEURS d'amorce viennent du binaire (elles y sont par contour),
    // les TYPES de l'opération lue dans le texte (le binaire ne les porte
    // pas : ses deux entiers voisins valent 2 aussi bien pour « None » que
    // pour « Tangent » — mesuré). Un dessin à plusieurs opérations de types
    // différents n'est donc pas distingué contour par contour : c'est la
    // première opération active qui fait foi, comme pour le reste.
    const blocks = jobPathRecords(job.binary)

    return {
        job,
        sheet: jobSheet(job),
        kerfWidth: job.kerfWidth,
        // Les blocs du cache binaire, DANS L'ORDRE DU FICHIER et sans
        // affectation : un bloc n'appartient à un dessin que lorsque la
        // géométrie le dit.
        blocks: blocks || [],
        // Vrai quand AUCUN point de départ n'a pu être lu : l'appelant doit le
        // dire, pas le taire — sans point, aucun trou n'est nesté (voir
        // `partWithReserve`).
        startsUnread: !blocks || blocks.length !== byName.size,
        drawings: [...byName.values()],
    }
}

/** `readSheetCamJob` sur un `File` du navigateur. */
export async function readSheetCamJobFile(file) {
    return readSheetCamJob(new Uint8Array(await file.arrayBuffer()))
}

/**
 * Apparie les blocs du cache binaire aux dessins IMPORTÉS, et rend les points
 * de départ par nom de dessin (lot J4-bis-3, §9.45).
 *
 * `ringsByName` : `{ 'Piece_Trou.DXF': [anneau, ...] }` — tous les anneaux du
 * dessin, contours et trous, tels que notre import les rend. C'est l'appelant
 * qui les fournit, parce qu'ils n'existent qu'après l'import.
 *
 * Rend `{ byName, ambiguous, reason }`. `byName[nom]` porte `{ starts, origin,
 * placed }`. `ambiguous: true` ⇒ AUCUN point n'est attribué : l'appelant garde
 * le comportement « point non lu », qui retire les trous du nesting et le dit.
 * On ne devine pas une affectation qu'on ne sait pas trancher.
 */
export function assignJobStarts(read, ringsByName) {
    const drawings = (read?.drawings || []).filter((d) => ringsByName?.[d.name])
    const blocks = read?.blocks || []
    if (!drawings.length || !blocks.length) {
        return { byName: {}, ambiguous: true, reason: 'noGeometry' }
    }
    const { pairs, ambiguous, reason } = assignJobBlocks(
        blocks,
        drawings.map((d) => ({ name: d.name, rings: ringsByName[d.name] })),
    )
    if (ambiguous || !pairs) return { byName: {}, ambiguous: true, reason }

    const byName = {}
    for (const pair of pairs) {
        const drawing = drawings[pair.drawing]
        const block = blocks[pair.block]
        byName[drawing.name] = {
            origin: block.origin,
            placed: pair.placed,
            // Lot J4-ter : de quoi RÉÉCRIRE ces points dans le cache binaire.
            // `blockIndex` désigne le dessin dans le bloc, `pathIndex` le
            // contour dans ce dessin — les deux suffisent à retrouver les
            // offsets à l'écriture, sans re-décoder le flux ici.
            blockIndex: pair.block,
            starts: (block.paths || []).map((p, pathIndex) => ({
                pathIndex,
                // Relatif à l'origine que SheetCam mémorise pour ce dessin.
                offset: p.start,
                leadIn: p.leadIn ?? drawing.leadIn,
                leadOut: p.leadOut ?? drawing.leadOut,
                leadInType: drawing.leadInType,
                leadOutType: drawing.leadOutType,
                order: p.order,
                moved: p.moved,
            })),
        }
    }
    return { byName, ambiguous: false, reason: null }
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

    // `.job` SheetCam : reconnu par SIGNATURE (piège #31), JAMAIS envoyé au
    // wasm (il en ressortirait en « erreur d'analyse », un message faux pour
    // un fichier valide — voir le bloc `.job` plus haut).
    //
    // Un `.job` ne crée aucune fiche : il n'a pas de géométrie. Ce que l'on
    // peut dire à l'utilisateur, et qui est vrai, c'est QUELS dessins il doit
    // déposer à côté — chacun nommé, avec sa quantité. Le panneau d'aperçu qui
    // consommera `readSheetCamJob` est un autre chantier du lot J4 ; d'ici là
    // le refus est explicite et actionnable, jamais silencieux.
    if (isSheetCamJob(source)) {
        // `parseSheetCamJob` lève un `SheetCamJobError` dont le `code` est
        // déjà une clé i18n et dont `message === code` : il traverse tel quel
        // vers l'UI (`files.js` lit `err.message` et `err.params`).
        const read = readSheetCamJob(source)
        const err = new Error('jobImport.dropDrawings')
        err.params = {
            n: read.drawings.length,
            names: read.drawings.map((d) => `${d.name} (× ${d.quantity})`).join(', '),
        }
        throw err
    }

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
    // Lot J4 : + d'où vient ce dessin quand il a été appelé par un `.job`
    // SheetCam — les réglages de COUPE de ce dessin (`sheetcam` : longueur
    // d'amorce, coin de départ, marge de perçage), qui servent à réserver la
    // place de l'amorce au nesting, et les octets du `.job` lui-même, pour
    // pouvoir le réécrire à la fin du solve. Le fichier fait quelques
    // kilo-octets et il est recopié sur chaque fiche du dépôt : chaque fiche
    // reste ainsi AUTONOME (aucune dépendance entre enregistrements
    // IndexedDB, aucune montée de version de la base).
    const provenance = {
        ...(scale !== 1 ? { importScale: scale } : {}),
        ...(options.sheetcam ? { sheetcam: options.sheetcam } : {}),
        ...(options.sheetcamJobBytes
            ? { sheetcamJobBytes: options.sheetcamJobBytes.slice().buffer }
            : {}),
    }

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

/** E4-a : résumé de la fiche-bloc — « 1 bloc · N pièces · W × H ». Étendue
 * mesurée sur les coordonnées (l'UI ne garde que width/height par pièce,
 * qui ne somment pas). */
function blockSummary(parts) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of parts) {
        for (const [x, y] of p.coordinates || []) {
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
        }
    }
    if (!Number.isFinite(minX)) return null
    return {
        pieces: parts.length,
        width: Math.round((maxX - minX) * 10) / 10,
        height: Math.round((maxY - minY) * 10) / 10,
    }
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
    const block = (record.parts || []).length > 1 ? blockSummary(record.parts) : null
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
        // E4-a : résumé bloc, ADDITIF (fiches à une pièce inchangées).
        ...(block ? { block } : {}),
    }
}
