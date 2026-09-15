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
import { assignJobBlocks, drawingLeadShapes } from '~~/shared/sheetcamReserve.js'

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
 * flip vertical obligatoire (piège #20b).
 *
 * Lot J8-b : `ringLeads` (les amorces de `drawingLeadShapes`, indexées par
 * anneau À PLAT contour+trous) se dessinent PAR-DESSUS le contour, dans la
 * case de LEUR pièce, sous la MÊME normalisation + flip. Une amorce n'est
 * pas de la matière : trait fin ambré sans remplissage, l'éventail tangent
 * en zone translucide, le disque de perçage en pointillé (§9.73 points
 * 7 et 9). Sans `ringLeads`, la sortie est IDENTIQUE à avant — une fiche
 * ordinaire ne change pas d'un pixel (verrou). */
function buildPreviewSvg(parts, ringLeads = null) {
    const GAP_RATIO = 0.08
    // L'ambre est distinct de la palette des pièces (bleu/rouge/vert/violet…)
    // et lisible sur les deux thèmes — couleurs EXPLICITES (piège #21).
    const LEAD_COLOR = '#D97706'
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

    // Anneau à plat → (pièce, ième anneau de la pièce) : pour poser chaque
    // amorce dans la case de SA pièce.
    const ringOwner = new Map()
    {
        let flat = 0
        parts.forEach((p, k) => {
            ringOwner.set(flat, { part: k, ring: 0 })
            flat++
            for (let h = 0; h < (p.holes || []).length; h++) ringOwner.set(flat++, { part: k, ring: h + 1 })
        })
    }

    let cursor = 0
    const paths = []
    for (let eIndex = 0; eIndex < entries.length; eIndex++) {
        const e = entries[eIndex]
        const ty = (maxH - e.h) / 2 // centrage vertical dans la rangée
        const mapPt = (c) => [cursor + (c[0] - e.minX), ty + (e.h - (c[1] - e.minY))] // flip y
        const ringToD = (ring) =>
            ring
                .map((c, i) => {
                    const [x, y] = mapPt(c)
                    return `${i === 0 ? 'M' : 'L'}${x.toFixed(3)} ${y.toFixed(3)}`
                })
                .join('') + 'Z'
        const d = [e.p.coordinates, ...(e.p.holes || [])].map(ringToD).join(' ')
        paths.push(
            `<path d="${d}" fill="${e.p.color}" fill-opacity="${FILL_OPACITY_PREVIEW}" fill-rule="evenodd" stroke="${e.p.color}" stroke-width="${(maxH / 200).toFixed(3)}"/>`,
        )
        // Les amorces des anneaux de CETTE pièce (J8-b).
        if (ringLeads) {
            const thin = Math.max(maxH / 300, 0.5).toFixed(3)
            for (const lead of ringLeads) {
                const owner = ringOwner.get(lead.ringIndex)
                if (!owner || owner.part !== eIndex) continue
                const toD = (pts) => pts
                    .map((c, i) => {
                        const [x, y] = mapPt(c)
                        return `${i === 0 ? 'M' : 'L'}${x.toFixed(3)} ${y.toFixed(3)}`
                    })
                    .join('')
                if (lead.inPath?.points) {
                    paths.push(`<path d="${toD(lead.inPath.points)}" fill="none" stroke="${LEAD_COLOR}" stroke-width="${thin}"/>`)
                }
                if (lead.outPath?.points) {
                    paths.push(`<path d="${toD(lead.outPath.points)}" fill="none" stroke="${LEAD_COLOR}" stroke-width="${thin}"/>`)
                }
                // Tangente : l'éventail d'incertitude, en zone translucide —
                // jamais une droite certaine (§9.73 point 10).
                for (const zone of [lead.inPath?.zone, lead.outPath?.zone]) {
                    if (zone) paths.push(`<path d="${toD(zone)}Z" fill="${LEAD_COLOR}" fill-opacity="0.16" stroke="none"/>`)
                }
                if (lead.pierce) {
                    const [cx, cy] = mapPt(lead.pierce.c)
                    paths.push(`<circle cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" r="${lead.pierce.r.toFixed(3)}" fill="${LEAD_COLOR}" fill-opacity="0.10" stroke="${LEAD_COLOR}" stroke-width="${thin}" stroke-dasharray="${(lead.pierce.r / 2).toFixed(3)} ${(lead.pierce.r / 3).toFixed(3)}"/>`)
                }
            }
        }
        cursor += e.w + gap
    }
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW.toFixed(3)} ${maxH.toFixed(3)}">` +
        paths.join('') +
        '</svg>'
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * Lot J8-b — reconstruit l'aperçu d'une fiche `.job` avec ses AMORCES, une
 * fois les points de départ attachés (`assignJobStarts`, files.js 2-bis) :
 * c'est là que l'atelier vérifie ses points AVANT de lancer le nesting
 * (§9.73 point 7 — « la surface la plus utile du lot »). Sans points posables,
 * l'aperçu est reconstruit À L'IDENTIQUE (aucune amorce inventée, point 11).
 */
export function previewSvgWithLeads(record) {
    const rings = []
    const isHole = []
    for (const part of record.parts || []) {
        rings.push(part.coordinates)
        isHole.push(false)
        for (const hole of part.holes || []) {
            rings.push(hole)
            isHole.push(true)
        }
    }
    const sc = record.sheetcam || {}
    const leads = drawingLeadShapes({
        rings,
        isHole,
        starts: sc.starts || [],
        origin: sc.origin || null,
        kerf: Number(sc.kerfWidth) || 0,
        leadIn: Number(sc.leadIn) || 0,
        leadInType: Number(sc.leadInType) || 0,
        leadOut: Number(sc.leadOut) || 0,
        leadOutType: Number(sc.leadOutType) || 0,
    })
    return buildPreviewSvg(record.parts || [], leads)
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
    // Lot J9 (§9.76) — UNE ENTRÉE PAR SECTION ORIGINALE, plus une par nom.
    //
    // Le modèle de SheetCam porte un jeu de points de départ PAR PIÈCE, le
    // nôtre les portait PAR DESSIN : sur un `.job` à plusieurs originaux du
    // même dessin (j9-1 : 4 originaux, 4 blocs, 1 nom), les points
    // « supplémentaires » étaient perdus et le lien bloc↔dessin cassait.
    // Désormais CHAQUE originale donne sa fiche, de quantité 1 + le nombre
    // de SES copies (`copyOf` = rang de l'originale). Sur les 53 fichiers
    // du verrou J6 (une originale par dessin), les entrées sont
    // INDISCERNABLES d'avant : même nom, même quantité — non-régression.
    // Le `label` ajoute le rang quand plusieurs fiches partagent un nom
    // (« nom (2/4) », comme l'éclatement E4-c) ; `name` reste le NOM NU,
    // celui qui apparie le DXF déposé.
    const originals = job.parts.filter((p) => p.copyOf < 0)
    const copiesOf = new Map()
    for (const part of job.parts) {
        if (part.copyOf >= 0) {
            copiesOf.set(part.copyOf, (copiesOf.get(part.copyOf) || 0) + 1)
        }
    }
    const nameCounts = new Map()
    for (const part of originals) {
        const name = jobDrawingName(part.drawingFile)
        nameCounts.set(name, (nameCounts.get(name) || 0) + 1)
    }
    const seenOfName = new Map()
    const drawings = originals.map((part, originalRank) => {
        const name = jobDrawingName(part.drawingFile)
        const nth = (seenOfName.get(name) || 0) + 1
        seenOfName.set(name, nth)
        const entry = {
            name,
            label: nameCounts.get(name) > 1 ? `${name} (${nth}/${nameCounts.get(name)})` : name,
            // Le rang de CETTE originale parmi les originales — le lien au
            // k-ième bloc du cache binaire (lot J9, §9.76 point 1).
            originalRank,
            partIndex: part.index,
            quantity: 1 + (copiesOf.get(part.index) || 0),
            parts: [part.index, ...job.parts.filter((p) => p.copyOf === part.index).map((p) => p.index)],
            leadIn: null,
            leadInType: null,
            leadOut: null,
            leadOutType: null,
            startPosition: null,
            starts: [],
            origin: null,
            operations: [],
        }
        // Les opérations ne vivent que sur les ORIGINAUX : une copie `copyOf`
        // n'a ni section `Operation`, ni géométrie propre — elle rejoue celle
        // de son original (règle 4).
        if (part.operations.length) {
            entry.operations = part.operations
            const op = part.operations.find((o) => o.enabled) || part.operations[0]
            entry.leadIn = op.leadIn
            entry.leadInType = op.leadInType
            entry.leadOut = op.leadOut
            entry.leadOutType = op.leadOutType
            entry.startPosition = op.startPosition
        }
        return entry
    })
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
        // `partWithReserve`). Lot J9 : la cohérence se mesure en SECTIONS
        // ORIGINALES (le lien du cache), plus en noms distincts.
        startsUnread: !blocks || blocks.length !== originals.length,
        drawings,
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
 * stockées — une seule : depuis le lot E4, le dépôt est TOUJOURS l'import
 * ordinaire (un dessin multi-pièces devient un bloc rigide, E4-a).
 * L'échelle et l'éclatement sont des actions SUR LA FICHE après import
 * (`scaleLocalFiche`, `explodeLocalFiche` ci-dessous).
 *
 * La chaîne reste unique : import ordinaire (parse wasm) → octets canoniques
 * mm. Chaque fiche est une fiche NORMALE : quantité, rotations, couleur,
 * aperçu, suppression, export par handle.
 *
 * `options` : `{ sheetcam, sheetcamJobBytes }` (provenance `.job`, lot J4).
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
    // En temps normal ce fichier ne passe JAMAIS ici : la dépose d'un `.job`
    // est interceptée par `addSheetCamJobDrop` (files.js, lot J4/J6) qui lit
    // le job, importe ses dessins — DXF déposé prioritaire, sinon géométrie
    // du bloc binaire — et pré-remplit les réglages. Ce refus est la défense
    // du chemin ordinaire pour un `.job` qui lui échapperait.
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

    return importLocalBytes(source, name, projectSlug, options)
}

/**
 * Lot J6 — import d'octets DXF/SVG DÉJÀ EN MÉMOIRE, par le chemin ordinaire.
 *
 * C'est l'entrée du dépôt `.job` seul : la géométrie d'un dessin est décodée
 * du bloc binaire (`jobDrawings`), écrite en DXF canonique
 * (`drawingCanonicalDxf`), puis repasse PAR ICI — même importeur, mêmes
 * fiches, mêmes constats qu'un DXF déposé. AUCUNE chaîne parallèle.
 *
 * Les gardes de `importLocalFiles` (extension, taille) ne se rejouent pas :
 * elles sont celles du fichier DÉPOSÉ par l'utilisateur ; ici l'entrée est
 * un document que NOUS venons d'écrire, dont nous connaissons le format et
 * la taille (bornées par celles du `.job` lui-même).
 *
 * `options.sheetcamSource = 'job'` marque la fiche : champ additif
 * `source: 'job'` + constat d'information « géométrie lue dans le fichier
 * de travail » — la fiche le DIT, elle ne se fait pas passer pour un DXF
 * (le DXF d'origine, s'il est déposé ou déjà dans le projet, gagne toujours).
 */
export async function importLocalBytes(source, label, projectSlug, options = {}) {
    source = source instanceof Uint8Array ? source : new Uint8Array(source)
    const ext = (label.lastIndexOf('.') >= 0
        ? label.slice(label.lastIndexOf('.')).toLowerCase() : '')

    if (ext === '.svg') {
        const head = new TextDecoder('utf-8', { fatal: false }).decode(source.subarray(0, 65536))
        if (/<!ENTITY\b/i.test(head)) {
            throw new Error('localImport.parseError')
        }
    }

    let imported
    try {
        imported = await geoImportFile(source)
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
        canonical = await geoCanonicalDxf(source)
    } catch {
        throw new Error('localImport.parseError')
    }

    // Lot J6-bis — REMPLACEMENT EN PLACE d'une fiche issue du binaire : le
    // DXF d'origine déposé après coup (seul ou dans un lot `.job`) prend la
    // place de la fiche `source: 'job'` du même nom — MÊME slug, MÊME rang
    // (`addedAt`), réglages et octets du `.job` portés par les options.
    // Sans cela, l'utilisateur qui obéit au constat « DXF d'origine non
    // fourni » DOUBLAIT ses quantités sans le voir (mesure §9.64).
    const replace = options.replace || null
    return [await storeFiche(imported, canonical, label, projectSlug, options, {
        ...(replace?.slug ? { slug: String(replace.slug) } : {}),
        ...(replace?.addedAt ? { addedAt: String(replace.addedAt) } : {}),
    })]
}

/**
 * Compatibilité : un seul File, une seule fiche. Les appelants qui peuvent
 * recevoir plusieurs fiches passent par `importLocalFiles`.
 */
export async function importLocalFile(file, projectSlug, options = {}) {
    const records = await importLocalFiles(file, projectSlug, options)
    return records[0]
}

/**
 * Fabrique + stocke une fiche depuis un import et ses octets DXF — le seul
 * endroit qui construit un enregistrement (dépôt, échelle, éclatement).
 *
 * `extra` : champs additifs (provenance, drapeaux d'échelle…) ; `addedAt`
 * explicite pour remplacer une fiche EN PLACE (échelle : même rang) ou
 * étager des filles (éclatement : ordre des pièces, miroir du serveur).
 */
async function storeFiche(imp, dxf, label, projectSlug, options = {}, extra = {}) {
    const { saveLocalFile } = await import('./localFilesStore')
    const scale = Number(extra.appliedScale) || 0
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
        slug: extra.slug || makeLocalFileSlug(label),
        projectSlug,
        name: label,
        addedAt: extra.addedAt || new Date().toISOString(),
        dxfBytes: dxf.slice().buffer,
        parts,
        sourceUnits: imp.source_units ?? 0,
        entityCount: imp.entity_count ?? 0,
        warnings: imp.warnings || [],
        // Lot 2c : les constats d'import (perte de matière, unité supposée,
        // tracés ouverts) — c'est le maillon qui manquait entre le wasm et la
        // fiche fichier. Lot E2/E4-b : + la mise à l'échelle, avec le même
        // niveau et la même forme que les autres constats — un dessin n'est
        // jamais multiplié en silence.
        findings: [
            ...(imp.findings || []),
            ...(scale && scale !== 1
                ? [{
                    code: 'import.scaleApplied',
                    level: 'info',
                    count: 1,
                    value: String(Math.round(scale * 10000) / 10000),
                }]
                : []),
            // Lot J6 — la fiche vient du BLOC BINAIRE du `.job`, pas d'un DXF
            // déposé : elle le dit (§9.62 point 3). Le DXF d'origine, lui,
            // gagne toujours quand il est là — cette fiche n'existe que
            // parce qu'il n'est PAS là.
            ...(options.sheetcamSource === 'job'
                ? [{ code: 'sheetcam.jobGeometry', level: 'info', count: 1 }]
                : []),
        ],
        previewSvg: buildPreviewSvg(parts),
        // Provenance `.job` (lot J4) : réglages de coupe de CE dessin et
        // octets du `.job`, pour le réécrire à la fin du solve. Recopiés sur
        // chaque fiche : chacune reste AUTONOME (aucune dépendance entre
        // enregistrements IndexedDB).
        ...(options.sheetcam ? { sheetcam: options.sheetcam } : {}),
        ...(options.sheetcamJobBytes
            ? { sheetcamJobBytes: options.sheetcamJobBytes.slice().buffer }
            : {}),
        // Lot J6 — provenance GÉOMÉTRIQUE de la fiche : 'job' = décodée du
        // bloc binaire (le DXF d'origine n'a pas été fourni) ; absent = DXF.
        ...(options.sheetcamSource === 'job' ? { source: 'job' } : {}),
        ...(extra.fields || {}),
    }
    await saveLocalFile(record)
    return record
}

/**
 * Lot E4-b — applique une échelle à une fiche locale, EN PLACE : même slug,
 * même nom, même rang (`addedAt`), même provenance. La chaîne E1 : DXF
 * canonique de la fiche mis à l'échelle → import ordinaire. La première
 * application garde les octets d'origine (`origDxfBytes`) : la
 * réinitialisation les restaure BIT-IDENTIQUE (`resetLocalFicheScale`).
 *
 * `options` : `{ scale }` ou `{ scaleTarget: { mode, mm } }` — le facteur se
 * résout sur l'étendue MESURÉE de la fiche (ses pièces, aucune lecture wasm).
 * Un facteur de 1 ne touche rien. Rend l'enregistrement remplacé.
 */
export async function scaleLocalFiche(record, options = {}) {
    const extent = drawingExtent(record.parts || [])
    const factor = resolveScale(options, extent)
    if (factor === 1 || !(factor > 0)) return record

    const source = new Uint8Array(record.dxfBytes || new ArrayBuffer(0))
    let bytes
    try {
        bytes = await geoCanonicalDxfScaled(source, factor)
    } catch {
        throw new Error('localImport.parseError')
    }
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
        throw new Error('localImport.parseError')
    }
    let imported
    try {
        imported = await geoImportFile(bytes)
    } catch {
        throw new Error('localImport.parseError')
    }
    if (imported?.refusal) throw tooHeavyError(imported.refusal)
    if (!imported || !Array.isArray(imported.parts) || imported.parts.length === 0) {
        throw new Error('localImport.parseError')
    }

    const cumulative = Math.round(
        (Number(record.importScale) || 1) * factor * 1e6,
    ) / 1e6
    return storeFiche(imported, bytes, record.name, record.projectSlug, {
        ...(record.sheetcam ? { sheetcam: record.sheetcam } : {}),
        ...(record.sheetcamJobBytes
            ? { sheetcamJobBytes: new Uint8Array(record.sheetcamJobBytes) }
            : {}),
        // Lot J6 : la provenance 'job' survit à la ré-écriture de la fiche.
        ...(record.source === 'job' ? { sheetcamSource: 'job' } : {}),
    }, {
        slug: record.slug,
        addedAt: record.addedAt,
        appliedScale: factor,
        fields: {
            importScale: cumulative,
            importScaleApplied: true,
            // Les octets d'origine ne se gardent qu'UNE fois : à la première
            // application (sinon la deuxième écraserait l'original par le
            // déjà-mis-à-l'échelle, et la réinitialisation perdrait la
            // bit-identicité). `dxfBytes` est un ArrayBuffer : slice(0)
            // copie, sans `.buffer` (qui n'existe pas sur un ArrayBuffer).
            origDxfBytes: (record.origDxfBytes || record.dxfBytes).slice(0),
            ...(record.explodedFrom ? {
                explodedFrom: record.explodedFrom,
                explodedIndex: record.explodedIndex,
                explodedFromSlug: record.explodedFromSlug,
            } : {}),
            ...(record.explodeFallback ? { explodeFallback: true } : {}),
        },
    })
}

/**
 * Lot E4-b — réinitialise l'échelle d'une fiche : re-import des octets
 * d'origine, TELS QUELS (aucune réécriture du canonique — bit-identique à
 * l'import d'origine), drapeaux d'échelle retirés. Sans octets d'origine
 * (fiche jamais mise à l'échelle), rend la fiche inchangée.
 */
export async function resetLocalFicheScale(record) {
    if (!record.origDxfBytes || record.importScaleApplied !== true) return record
    const orig = new Uint8Array(record.origDxfBytes)
    let imported
    try {
        imported = await geoImportFile(orig)
    } catch {
        throw new Error('localImport.parseError')
    }
    if (imported?.refusal) throw tooHeavyError(imported.refusal)
    if (!imported || !Array.isArray(imported.parts) || imported.parts.length === 0) {
        throw new Error('localImport.parseError')
    }
    return storeFiche(imported, orig, record.name, record.projectSlug, {
        ...(record.sheetcam ? { sheetcam: record.sheetcam } : {}),
        ...(record.sheetcamJobBytes
            ? { sheetcamJobBytes: new Uint8Array(record.sheetcamJobBytes) }
            : {}),
        // Lot J6 : la provenance 'job' survit à la ré-écriture de la fiche.
        ...(record.source === 'job' ? { sheetcamSource: 'job' } : {}),
    }, {
        slug: record.slug,
        addedAt: record.addedAt,
        // Pas d'appliedScale : le constat d'échelle disparaît, comme avant
        // la première application.
        fields: {
            ...(record.explodedFrom ? {
                explodedFrom: record.explodedFrom,
                explodedIndex: record.explodedIndex,
                explodedFromSlug: record.explodedFromSlug,
            } : {}),
            ...(record.explodeFallback ? { explodeFallback: true } : {}),
        },
    })
}

/**
 * Lot E4-c — éclate une fiche locale en N fiches « nom (k/N) », une pièce
 * chacune, à l'échelle DÉJÀ appliquée (les octets de la fiche sont ceux du
 * dessin mis à l'échelle). Chaîne E1 : un DXF canonique par pièce, écrit
 * depuis ses handles, repassé par l'import ORDINAIRE.
 *
 * La fiche d'origine est SUPPRIMÉE (miroir du serveur : le dessin éclaté
 * n'est plus une fiche). Les filles sont insérées À SON RANG, ordre des
 * pièces (une milliseconde d'écart, miroir du serveur). Une pièce dont le
 * sous-ensemble ne se referme pas n'est PAS perdue (repli : géométrie de
 * l'import complet + octets canoniques du dessin complet).
 *
 * Rend la liste des filles (vide si rien à éclater).
 */
export async function explodeLocalFiche(record) {
    const parts = record.parts || []
    if (parts.length < 2) return []

    const name = record.name || 'part.dxf'
    const dot = name.lastIndexOf('.')
    const base = dot >= 0 ? name.slice(0, dot) : name
    const suffix = dot >= 0 ? name.slice(dot) : ''
    const total = parts.length
    const canonical = new Uint8Array(record.dxfBytes || new ArrayBuffer(0))
    const parentAt = Date.parse(record.addedAt || '') || Date.now()
    const { deleteLocalFile } = await import('./localFilesStore')

    const inherited = {
        ...(record.importScaleApplied ? {
            importScale: record.importScale,
            importScaleApplied: true,
        } : {}),
        explodedFrom: name,
        explodedIndex: 0,
        explodedFromSlug: record.slug,
    }
    const options = {
        ...(record.sheetcam ? { sheetcam: record.sheetcam } : {}),
        ...(record.sheetcamJobBytes
            ? { sheetcamJobBytes: new Uint8Array(record.sheetcamJobBytes) }
            : {}),
        // Lot J6 : la provenance 'job' survit à la ré-écriture de la fiche.
        ...(record.source === 'job' ? { sheetcamSource: 'job' } : {}),
    }

    const out = []
    for (let k = 0; k < total; k++) {
        const part = parts[k]
        const label = `${base} (${k + 1}/${total})${suffix}`
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
        const fields = { ...inherited, explodedIndex: k + 1 }
        if (sub && Array.isArray(sub.parts) && sub.parts.length >= 1) {
            out.push(await storeFiche(sub, partBytes, label, record.projectSlug, options, {
                addedAt: new Date(parentAt + k).toISOString(),
                fields,
            }))
            continue
        }
        // Repli : le sous-ensemble ne referme rien tout seul (deux pièces qui
        // partagent une arête, par exemple). On NE PERD PAS la pièce : sa
        // géométrie vient de la fiche d'origine et ses octets du canonique
        // complet — l'export par handle reste exact.
        out.push(await storeFiche(
            {
                source_units: record.sourceUnits,
                entity_count: record.entityCount,
                warnings: record.warnings || [],
                findings: (record.findings || []).filter((f) => f.code !== 'import.scaleApplied'),
                parts: [part],
            },
            canonical,
            label,
            record.projectSlug,
            options,
            {
                addedAt: new Date(parentAt + k).toISOString(),
                fields: { ...fields, explodeFallback: true },
            },
        ))
    }
    await deleteLocalFile(record.slug)
    return out
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
        // E4-b/E4-c : drapeau d'échelle (montre « Réinitialiser ») et
        // parent d'éclatement (héritage de quantité) — additifs.
        importScaleApplied: record.importScaleApplied === true,
        explodedFromSlug: record.explodedFromSlug || null,
        // Lot J6-bis : provenance géométrique visible dans la liste du
        // projet — un DXF déposé pour un nom dont la fiche vient du binaire
        // doit REMPLACER cette fiche, pas s'ajouter (§9.64).
        source: record.source || null,
        // Lot J8-c : le NOM DU FICHIER `.job` déposé, pour la ligne
        // secondaire de la carte — l'atelier doit dire d'un coup d'œil
        // quelle fiche vient de quel `.job` quand il en dépose cinq.
        sheetcamJobName: record.sheetcam?.jobName || null,
    }
}
