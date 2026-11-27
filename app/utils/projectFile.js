/**
 * Fichier de projet `.nestorcut` : enregistrer un projet « Cet appareil » dans
 * un fichier, puis le rouvrir. Logique PURE : ni IndexedDB, ni DOM, ni horloge
 * (la date et les identifiants neufs viennent de l'appelant). Empreintes par
 * `crypto.subtle` (navigateur et Node).
 *
 * Archive ZIP (fflate) :
 *   manifest.json         le projet : réglages, quantités, liste des éléments
 *                         et empreinte SHA-256 de chacun
 *   manifest.sha256       empreinte de manifest.json, donc de tout le fichier
 *   pieces/<id>.json      une fiche sans ses octets (géométrie lue, couleurs,
 *                         constats, échelle, éclatement, réglages du `.job`)
 *   pieces/<id>.dxf       le DXF en mm tel que l'application le garde
 *   pieces/<id>.orig.dxf  les octets d'origine d'une fiche mise à l'échelle
 *   pieces/<id>.job       le `.job` SheetCam d'origine
 *   toles/<id>.json       une tôle importée : de quoi la reconstruire
 *                         (makeSheetRecord refait et revérifie tout)
 *
 * Jamais dedans : résultats, fichiers de coupe, rapport. Le fichier ne
 * débloque donc rien : tout se recalcule sous les limites du compte qui
 * l'ouvre. Pas de compte, d'e-mail ni de slug du serveur non plus.
 *
 * Versions : `version` = format écrit, `minReader` = plus petite version de
 * lecteur qui sait le lire. Un ajout facultatif ne monte pas `minReader` ; un
 * fichier dont `minReader` dépasse PROJECT_FILE_READER est refusé (too_new).
 *
 * Un fichier ouvert est une entrée inconnue (il peut venir d'un collègue) :
 * empreintes vérifiées, tailles bornées, chaque valeur contrôlée. Toute
 * anomalie lève ProjectFileError et rien n'est créé.
 */
import { unzipSync, zipSync } from 'fflate'
import { ringArea, ringBbox } from './sheetShape.js'

export const PROJECT_FILE_EXTENSION = '.nestorcut'
export const PROJECT_FILE_FORMAT = 'nestorcut-project'
/** Version du format écrit par ce code. */
export const PROJECT_FILE_VERSION = 1
/** Plus haute version de lecteur exigée (`minReader`) que ce code sait lire. */
export const PROJECT_FILE_READER = 1

/** Bornes de lecture : un fichier reçu ne doit ni saturer la mémoire ni le stockage. */
export const PROJECT_FILE_LIMITS = Object.freeze({
    fileBytes: 256 * 1024 * 1024,
    unpackedBytes: 512 * 1024 * 1024,
    pieces: 2000,
    sheets: 100,
    sheetFormats: 50,
    partsPerPiece: 20000,
    pointsPerPiece: 2000000,
    titleLength: 200,
    nameLength: 1024,
    count: 999,
    contoursPerSheet: 5000,
    pointsPerSheet: 500000,
    zonesPerSheet: 200,
    startsPerPiece: 100000,
})

const MANIFEST = 'manifest.json'
const MANIFEST_HASH = 'manifest.sha256'
// Les noms d'éléments sont fabriqués ici : jamais un nom venu du fichier.
const ID_RE = /^[a-z][0-9]{1,6}$/
const ENTRY_RE = /^(pieces\/[a-z][0-9]{1,6}(\.json|\.dxf|\.orig\.dxf|\.job)|toles\/[a-z][0-9]{1,6}\.json)$/
const HEX64_RE = /^[0-9a-f]{64}$/
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

// Champs d'une fiche qui voyagent dans son JSON : liste FERMÉE, à l'écriture
// comme à la lecture (un fichier reçu ne met rien d'autre dans IndexedDB). Les
// octets voyagent à part ; slug et projectSlug jamais. Un champ ajouté à une
// fiche (localImport.js, storeFiche) s'ajoute ICI, sinon il ne survit pas à un
// aller-retour par fichier. L'aperçu SVG voyage (les amorces d'un `.job` ne se
// redessinent pas sans lui) : contrôlé, il ne s'affiche que dans une <img>.
export const PIECE_FIELDS = Object.freeze([
    'name', 'addedAt', 'parts', 'sourceUnits', 'entityCount', 'warnings', 'findings', 'previewSvg',
    'sheetcam', 'source', 'importScale', 'importScaleApplied',
    'explodedFrom', 'explodedIndex', 'explodedFromSlug', 'explodeFallback',
])

export class ProjectFileError extends Error {
    /**
     * @param {'not_project'|'too_new'|'damaged'|'invalid'|'too_large'} code
     * @param {string} [detail] cause précise (journal et tests, jamais affichée)
     */
    constructor(code, detail = '') {
        super(detail ? `${code}: ${detail}` : code)
        this.name = 'ProjectFileError'
        this.code = code
        this.detail = detail
    }
}

const fail = (code, detail) => { throw new ProjectFileError(code, detail) }

/** Un nom de fichier qui se termine par `.nestorcut` (casse indifférente). */
export function isProjectFileName(name) {
    return /\.nestorcut$/i.test(String(name ?? ''))
}

/** Nom proposé au téléchargement : le titre nettoyé, sinon « projet ». */
export function projectFileName(title) {
    const base = String(title ?? '')
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
        .replace(/[. ]+$/, '')
    return `${base || 'projet'}${PROJECT_FILE_EXTENSION}`
}

async function sha256Hex(bytes) {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) fail('damaged', 'crypto_unavailable')
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes))
    return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const encoder = new TextEncoder()
const toBytes = (value) => {
    if (value instanceof Uint8Array) return value
    if (value instanceof ArrayBuffer) return new Uint8Array(value)
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    return null
}
/** Copie dans un ArrayBuffer propre (IndexedDB garde des ArrayBuffer). */
const toArrayBuffer = (bytes) => bytes.slice().buffer

// ------------------------------------------------------------------ écrire

/**
 * Données simples, sans Proxy ni octets : ce qui part en JSON. Les ArrayBuffer
 * éventuels restés dans un champ inconnu sont écartés (jamais sérialisés en
 * objet vide trompeur).
 */
function plainJson(value) {
    return JSON.parse(JSON.stringify(value, (key, v) => (
        v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? undefined : v
    )))
}

/** Ce que makeSheetRecord doit recevoir pour refaire la tôle à l'identique. */
function sheetInputOf(record) {
    const cut = Array.isArray(record.drawn) && record.drawn.length > 0
    return plainJson({
        name: record.name,
        sourceFileName: record.sourceFileName ?? null,
        sourceUnits: record.sourceUnits ?? 0,
        addedAt: record.addedAt ?? null,
        contours: cut ? record.contoursV2 : record.contours,
        outlineIndex: cut ? record.outlineIndexV2 : record.outlineIndex,
        forbidden: record.forbidden ?? [],
        ...(cut ? { drawn: record.drawn, cut: record.cut } : {}),
    })
}

/**
 * Construit le fichier `.nestorcut`.
 *
 * @param {object} input
 * @param {string} input.title       titre affiché du projet
 * @param {string} input.appVersion  version de l'application (information)
 * @param {string} input.savedAt     date ISO (fournie par l'appelant)
 * @param {string} input.unit        unité d'affichage au moment d'enregistrer
 * @param {object} input.params      réglages du projet (chaînes en unité `paramsUnit`)
 * @param {string} input.paramsUnit
 * @param {{record: object, count: number, rotation: (string|null)}[]} input.pieces
 *        fiches IndexedDB dans l'ordre du projet
 * @param {object[]} input.sheets    tôles importées du projet (IndexedDB)
 * @returns {Promise<Uint8Array>}
 */
export async function writeProjectFile({
    title, appVersion, savedAt, unit, params, paramsUnit, pieces = [], sheets = [],
}) {
    const entries = {}
    const hashes = {}
    const put = async (path, bytes) => {
        entries[path] = bytes
        hashes[path] = await sha256Hex(bytes)
    }

    // Tôles : identifiants du fichier s1, s2… ; les réglages les citent par là.
    const sheetIdBySlug = new Map()
    const sheetList = []
    for (const record of sheets) {
        if (!record?.slug || sheetIdBySlug.has(record.slug)) continue
        const id = `s${sheetList.length + 1}`
        sheetIdBySlug.set(record.slug, id)
        const path = `toles/${id}.json`
        await put(path, encoder.encode(JSON.stringify(sheetInputOf(record))))
        sheetList.push({ id, data: path })
    }

    // Fiches : p1, p2… ; le parent d'éclatement devient une clé de groupe du
    // fichier (pN si le parent est une fiche du projet, gN sinon).
    const pieceIdBySlug = new Map()
    pieces.forEach(({ record }, i) => { if (record?.slug) pieceIdBySlug.set(record.slug, `p${i + 1}`) })
    const groupIdBySlug = new Map()
    const groupOf = (slug) => {
        if (pieceIdBySlug.has(slug)) return pieceIdBySlug.get(slug)
        if (!groupIdBySlug.has(slug)) groupIdBySlug.set(slug, `g${groupIdBySlug.size + 1}`)
        return groupIdBySlug.get(slug)
    }
    const pieceList = []
    for (let i = 0; i < pieces.length; i++) {
        const { record, count, rotation } = pieces[i]
        const id = `p${i + 1}`
        const dxf = toBytes(record?.dxfBytes)
        if (!dxf) fail('invalid', `piece_${id}_dxf_missing`)
        const meta = {}
        for (const key of PIECE_FIELDS) {
            if (record[key] !== undefined) meta[key] = record[key]
        }
        if (record.explodedFromSlug) meta.explodedFromSlug = groupOf(record.explodedFromSlug)
        const entry = { id, count: Number(count) || 0, rotation: rotation ?? null, meta: `pieces/${id}.json`, dxf: `pieces/${id}.dxf` }
        await put(entry.meta, encoder.encode(JSON.stringify(plainJson(meta))))
        await put(entry.dxf, dxf)
        const orig = toBytes(record.origDxfBytes)
        if (orig) {
            entry.origDxf = `pieces/${id}.orig.dxf`
            await put(entry.origDxf, orig)
        }
        const job = toBytes(record.sheetcamJobBytes)
        if (job) {
            entry.job = `pieces/${id}.job`
            await put(entry.job, job)
        }
        pieceList.push(entry)
    }

    // Réglages : la tôle importée est citée par son identifiant du fichier.
    // Une tôle introuvable dans ce navigateur ne peut pas voyager : la ligne
    // garde ses cotes, sans forme (le calcul l'aurait refusée de toute façon).
    const savedParams = plainJson(params ?? {})
    if (Array.isArray(savedParams.sheets)) {
        savedParams.sheets = savedParams.sheets.map((sheet) => {
            if (!sheet || sheet.shapeId == null) return sheet
            const { shapeId, ...rest } = sheet
            const id = sheetIdBySlug.get(String(shapeId))
            return id ? { ...rest, shapeId: id } : rest
        })
    }
    delete savedParams.demoWalks

    const manifest = {
        format: PROJECT_FILE_FORMAT,
        version: PROJECT_FILE_VERSION,
        minReader: 1,
        app: String(appVersion ?? ''),
        savedAt: String(savedAt ?? ''),
        title: String(title ?? '').slice(0, PROJECT_FILE_LIMITS.titleLength),
        unit: unit === 'inch' ? 'inch' : 'mm',
        settings: { params: savedParams, paramsUnit: paramsUnit === 'inch' ? 'inch' : 'mm' },
        pieces: pieceList,
        sheets: sheetList,
        hashes,
    }
    const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 1))
    entries[MANIFEST] = manifestBytes
    entries[MANIFEST_HASH] = encoder.encode(`${await sha256Hex(manifestBytes)}\n`)
    // Le manifeste en premier : lisible d'un coup d'œil dans un outil d'archive.
    const ordered = { [MANIFEST]: entries[MANIFEST], [MANIFEST_HASH]: entries[MANIFEST_HASH] }
    for (const [path, bytes] of Object.entries(entries)) {
        if (!(path in ordered)) ordered[path] = bytes
    }
    return zipSync(ordered, { level: 6 })
}

// ------------------------------------------------------------------- lire

const decoder = new TextDecoder('utf-8', { fatal: true })

function parseJson(bytes, what) {
    try {
        return JSON.parse(decoder.decode(bytes))
    } catch {
        return fail('damaged', `${what}_json`)
    }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const shortString = (v, max) => typeof v === 'string' && v.length <= max

const SVG_DATA_RE = /^data:image\/svg\+xml(;[\w=.-]+)*,/

/**
 * Données JSON simples et peu profondes : nombres finis, chaînes courtes,
 * booléens, null, tableaux et objets. Rien qui puisse faire boucler ou planter
 * le code qui les lira.
 */
function plainData(value, depth = 0) {
    if (value === null || typeof value === 'boolean') return true
    if (typeof value === 'number') return Number.isFinite(value)
    if (typeof value === 'string') return value.length <= 4000
    if (depth >= 6) return false
    if (Array.isArray(value)) return value.every((v) => plainData(v, depth + 1))
    if (isObject(value)) return Object.values(value).every((v) => plainData(v, depth + 1))
    return false
}

/** Réglages de coupe d'un `.job` : ce que localImport.js et localJobPrivate.js lisent. */
function checkSheetcam(sc, id) {
    if (!isObject(sc) || !plainData(sc)) fail('invalid', `piece_${id}_sheetcam`)
    if (sc.starts != null && !(Array.isArray(sc.starts) && sc.starts.length <= PROJECT_FILE_LIMITS.startsPerPiece
        && sc.starts.every(isObject))) {
        fail('invalid', `piece_${id}_sheetcam_starts`)
    }
    for (const key of ['partIndex', 'originalRank', 'blockIndex']) {
        if (sc[key] != null && !Number.isInteger(sc[key])) fail('invalid', `piece_${id}_sheetcam_${key}`)
    }
    for (const key of ['drawingName', 'drawingLabel', 'jobName']) {
        if (sc[key] != null && !shortString(sc[key], PROJECT_FILE_LIMITS.nameLength)) fail('invalid', `piece_${id}_sheetcam_${key}`)
    }
}

function checkRing(ring, what) {
    if (!Array.isArray(ring) || ring.length < 3) fail('invalid', `${what}_ring`)
    for (const pt of ring) {
        if (!Array.isArray(pt) || pt.length < 2 || !isFiniteNumber(pt[0]) || !isFiniteNumber(pt[1])) {
            fail('invalid', `${what}_point`)
        }
    }
    return ring.length
}

/** Contrôle une fiche relue : la géométrie part au moteur, le reste à l'écran. */
function checkPieceMeta(meta, id) {
    if (!isObject(meta)) fail('invalid', `piece_${id}_meta`)
    if (!shortString(meta.name, PROJECT_FILE_LIMITS.nameLength) || !meta.name.trim()) fail('invalid', `piece_${id}_name`)
    if (meta.addedAt != null && !shortString(meta.addedAt, 64)) fail('invalid', `piece_${id}_addedAt`)
    const parts = meta.parts
    if (!Array.isArray(parts) || parts.length === 0 || parts.length > PROJECT_FILE_LIMITS.partsPerPiece) {
        fail('invalid', `piece_${id}_parts`)
    }
    let points = 0
    for (const part of parts) {
        if (!isObject(part)) fail('invalid', `piece_${id}_part`)
        const outer = part.coordinates ?? part.coords
        points += checkRing(outer, `piece_${id}`)
        if (part.holes != null) {
            if (!Array.isArray(part.holes)) fail('invalid', `piece_${id}_holes`)
            for (const hole of part.holes) points += checkRing(hole, `piece_${id}_hole`)
        }
        if (!isFiniteNumber(part.width) || part.width < 0 || !isFiniteNumber(part.height) || part.height < 0) {
            fail('invalid', `piece_${id}_size`)
        }
        if (part.color != null && !(typeof part.color === 'string' && COLOR_RE.test(part.color))) {
            fail('invalid', `piece_${id}_color`)
        }
        if (part.handles != null && !(Array.isArray(part.handles)
            && part.handles.every((h) => shortString(h, 64) || isFiniteNumber(h)))) {
            fail('invalid', `piece_${id}_handles`)
        }
    }
    if (points > PROJECT_FILE_LIMITS.pointsPerPiece) fail('too_large', `piece_${id}_points`)
    // Aperçu : `data:image/svg+xml;utf8,…` (buildPreviewSvg), affiché dans une <img>.
    if (meta.previewSvg != null
        && !(typeof meta.previewSvg === 'string' && SVG_DATA_RE.test(meta.previewSvg))) {
        fail('invalid', `piece_${id}_preview`)
    }
    for (const key of ['findings', 'warnings']) {
        if (meta[key] != null && !Array.isArray(meta[key])) fail('invalid', `piece_${id}_${key}`)
    }
    if (Array.isArray(meta.warnings) && !meta.warnings.every((w) => shortString(w, 4000) || plainData(w))) {
        fail('invalid', `piece_${id}_warning`)
    }
    if (Array.isArray(meta.findings)) {
        for (const f of meta.findings) {
            if (!isObject(f) || !shortString(f.code, 200) || !plainData(f)
                || (f.level != null && !shortString(f.level, 32))
                || (f.count != null && !isFiniteNumber(f.count))
                || (f.value != null && !shortString(f.value, 4000) && !isFiniteNumber(f.value))) {
                fail('invalid', `piece_${id}_finding`)
            }
        }
    }
    if (meta.explodedFrom != null && !shortString(meta.explodedFrom, PROJECT_FILE_LIMITS.nameLength)) {
        fail('invalid', `piece_${id}_explodedFrom`)
    }
    for (const key of ['importScaleApplied', 'explodeFallback']) {
        if (meta[key] != null && typeof meta[key] !== 'boolean') fail('invalid', `piece_${id}_${key}`)
    }
    if (meta.importScale != null && !(isFiniteNumber(meta.importScale) && meta.importScale >= 0)) {
        fail('invalid', `piece_${id}_importScale`)
    }
    if (meta.source != null && meta.source !== 'job') fail('invalid', `piece_${id}_source`)
    if (meta.sheetcam != null) checkSheetcam(meta.sheetcam, id)
    if (meta.explodedFromSlug != null && !(typeof meta.explodedFromSlug === 'string' && ID_RE.test(meta.explodedFromSlug))) {
        fail('invalid', `piece_${id}_explodedFrom`)
    }
    for (const key of ['sourceUnits', 'entityCount', 'explodedIndex']) {
        if (meta[key] != null && !Number.isInteger(meta[key])) fail('invalid', `piece_${id}_${key}`)
    }
}

function checkRotation(rotation, id) {
    if (rotation == null) return null
    if (!shortString(rotation, 200)) fail('invalid', `piece_${id}_rotation`)
    let angles
    try { angles = JSON.parse(rotation) } catch { angles = null }
    if (!Array.isArray(angles) || angles.length === 0 || !angles.every(isFiniteNumber)) {
        fail('invalid', `piece_${id}_rotation`)
    }
    return rotation
}

// Réglages : chiffres saisis gardés en chaînes (unité `paramsUnit`), comme dans l'onglet.
const NUMERIC_TEXT_RE = /^-?\d{0,9}([.,]\d{0,9})?$/
const PARAM_TEXT_KEYS = ['kerf', 'safety', 'space', 'edgeDistance', 'tolerance']
const PARAM_BOOL_KEYS = ['addOutShape', 'fillHoles']

function checkNumericText(value, what) {
    if (value == null) return
    if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9) return
    if (!(typeof value === 'string' && value.length <= 20 && NUMERIC_TEXT_RE.test(value.trim()))) {
        fail('invalid', what)
    }
}

function checkParams(params, sheetIds) {
    if (!isObject(params)) fail('invalid', 'params')
    for (const key of PARAM_TEXT_KEYS) checkNumericText(params[key], `params_${key}`)
    for (const key of PARAM_BOOL_KEYS) {
        if (params[key] != null && typeof params[key] !== 'boolean') fail('invalid', `params_${key}`)
    }
    if (params.rotationCount != null) {
        const n = Number(params.rotationCount)
        if (!Number.isInteger(n) || n < 1 || n > 360) fail('invalid', 'params_rotationCount')
    }
    if (params.directions != null) {
        if (!Array.isArray(params.directions) || params.directions.length > 8
            // Le serveur garde seulement les sens qu'il connaît (validateDirections).
            || !params.directions.every((d) => shortString(d, 20))) {
            fail('invalid', 'params_directions')
        }
    }
    if (params.sheets != null) {
        if (!Array.isArray(params.sheets) || params.sheets.length > PROJECT_FILE_LIMITS.sheetFormats) {
            fail('invalid', 'params_sheets')
        }
        for (const sheet of params.sheets) {
            if (!isObject(sheet)) fail('invalid', 'params_sheet')
            checkNumericText(sheet.width, 'params_sheet_width')
            checkNumericText(sheet.height, 'params_sheet_height')
            checkNumericText(sheet.count, 'params_sheet_count')
            if (sheet.shapeId != null && !(typeof sheet.shapeId === 'string' && sheetIds.has(sheet.shapeId))) {
                fail('invalid', 'params_sheet_shape')
            }
            for (const [key, value] of Object.entries(sheet)) {
                if (typeof value === 'object' && value !== null) fail('invalid', `params_sheet_${key}`)
                if (typeof value === 'string' && value.length > PROJECT_FILE_LIMITS.nameLength) fail('invalid', `params_sheet_${key}`)
            }
        }
    }
    delete params.demoWalks
    return params
}

/**
 * Tôle relue : bornée AVANT makeSheetRecord (ses calculs de zones croissent
 * vite avec le nombre de contours). Tous les contours sont contrôlés, pas
 * seulement ceux qui servent : la fenêtre de la tôle les relit tous.
 */
function checkSheetInput(input, id) {
    const L = PROJECT_FILE_LIMITS
    if (!isObject(input)) fail('invalid', `sheet_${id}`)
    if (!shortString(input.name, L.nameLength) || !input.name.trim()) fail('invalid', `sheet_${id}_name`)
    if (input.sourceFileName != null && !shortString(input.sourceFileName, L.nameLength)) {
        fail('invalid', `sheet_${id}_sourceFileName`)
    }
    if (input.addedAt != null && !shortString(input.addedAt, 64)) fail('invalid', `sheet_${id}_addedAt`)
    if (input.sourceUnits != null && !Number.isInteger(input.sourceUnits)) fail('invalid', `sheet_${id}_sourceUnits`)
    const contours = input.contours
    if (!Array.isArray(contours) || contours.length === 0 || contours.length > L.contoursPerSheet) {
        fail('invalid', `sheet_${id}_contours`)
    }
    let points = 0
    contours.forEach((c, i) => {
        if (!isObject(c)) fail('invalid', `sheet_${id}_contour`)
        points += checkRing(c.ring, `sheet_${id}`)
        if (points > L.pointsPerSheet) fail('too_large', `sheet_${id}_points`)
        if (c.depth != null && !(Number.isInteger(c.depth) && c.depth >= 0)) fail('invalid', `sheet_${id}_depth`)
        if (c.parent != null && !(Number.isInteger(c.parent) && c.parent >= 0 && c.parent < contours.length && c.parent !== i)) {
            fail('invalid', `sheet_${id}_parent`)
        }
        if (c.areaMm2 != null && !(isFiniteNumber(c.areaMm2) && c.areaMm2 >= 0)) fail('invalid', `sheet_${id}_area`)
        if (c.bbox != null && !(Array.isArray(c.bbox) && c.bbox.length === 4 && c.bbox.every(isFiniteNumber))) {
            fail('invalid', `sheet_${id}_bbox`)
        }
        // Champs que l'import écrit toujours : refaits s'ils manquent.
        if (c.areaMm2 == null) c.areaMm2 = ringArea(c.ring)
        if (c.bbox == null) c.bbox = ringBbox(c.ring)
    })
    if (!Number.isInteger(input.outlineIndex) || input.outlineIndex < 0 || input.outlineIndex >= contours.length) {
        fail('invalid', `sheet_${id}_outline`)
    }
    if (!Array.isArray(input.forbidden) || input.forbidden.length > L.zonesPerSheet
        || !input.forbidden.every((i) => Number.isInteger(i) && i >= 0 && i < contours.length)) {
        fail('invalid', `sheet_${id}_forbidden`)
    }
    if (input.drawn != null && !(Array.isArray(input.drawn) && input.drawn.length <= L.zonesPerSheet && plainData(input.drawn))) {
        fail('invalid', `sheet_${id}_drawn`)
    }
    if (input.cut != null && !(isObject(input.cut) && plainData(input.cut))) fail('invalid', `sheet_${id}_cut`)
}

/** Version 1 : rien à transformer. Chaque version future ajoute son passage ici. */
function migrate(manifest) {
    return manifest
}

/**
 * Lit et contrôle un fichier `.nestorcut`.
 *
 * @param {Uint8Array|ArrayBuffer} input octets du fichier
 * @param {{ limits?: Partial<typeof PROJECT_FILE_LIMITS> }} [options] bornes de taille
 *        resserrées (tests)
 * @returns {Promise<{
 *   version: number, app: string, savedAt: string, title: string, unit: string,
 *   params: object, paramsUnit: string,
 *   pieces: {id: string, count: number, rotation: (string|null), meta: object,
 *            dxfBytes: ArrayBuffer, origDxfBytes?: ArrayBuffer, sheetcamJobBytes?: ArrayBuffer}[],
 *   sheets: {id: string, input: object}[],
 * }>}
 * @throws {ProjectFileError}
 */
export async function readProjectFile(input, { limits = {} } = {}) {
    const L = { ...PROJECT_FILE_LIMITS, ...limits }
    const bytes = toBytes(input)
    if (!bytes || bytes.byteLength < 4) fail('not_project', 'empty')
    if (bytes.byteLength > L.fileBytes) fail('too_large', 'file')
    // Signature ZIP « PK\x03\x04 » : un DXF renommé n'est pas un projet.
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) fail('not_project', 'signature')

    let unpacked = 0
    let entryCount = 0
    const maxEntries = L.pieces * 4 + L.sheets + 2
    let files
    try {
        files = unzipSync(bytes, {
            filter: (file) => {
                const known = file.name === MANIFEST || file.name === MANIFEST_HASH || ENTRY_RE.test(file.name)
                if (!known) return false
                entryCount += 1
                unpacked += Number(file.originalSize) || 0
                if (entryCount > maxEntries || unpacked > L.unpackedBytes) {
                    throw new ProjectFileError('too_large', 'unpacked')
                }
                return true
            },
        })
    } catch (err) {
        if (err instanceof ProjectFileError) throw err
        fail('damaged', 'zip')
    }
    // Taille réelle (l'en-tête peut mentir) : bornée elle aussi.
    let real = 0
    for (const data of Object.values(files)) real += data.byteLength
    if (real > L.unpackedBytes) fail('too_large', 'unpacked_real')

    const manifestBytes = files[MANIFEST]
    if (!manifestBytes) fail('not_project', 'no_manifest')
    let manifest
    try {
        manifest = JSON.parse(decoder.decode(manifestBytes))
    } catch {
        fail('damaged', 'manifest_json')
    }
    if (!isObject(manifest) || manifest.format !== PROJECT_FILE_FORMAT) fail('not_project', 'format')
    if (!Number.isInteger(manifest.version) || manifest.version < 1) fail('damaged', 'version')
    const minReader = manifest.minReader ?? manifest.version
    if (!Number.isInteger(minReader) || minReader < 1) fail('damaged', 'minReader')
    if (minReader > PROJECT_FILE_READER) fail('too_new', String(minReader))

    // Empreinte de l'ensemble, puis de chaque élément cité.
    const manifestHash = files[MANIFEST_HASH]
    if (!manifestHash) fail('damaged', 'no_manifest_hash')
    let expected
    try { expected = decoder.decode(manifestHash).trim() } catch { expected = '' }
    if (!HEX64_RE.test(expected) || expected !== await sha256Hex(manifestBytes)) fail('damaged', 'manifest_hash')
    if (!isObject(manifest.hashes)) fail('damaged', 'hashes')
    const entry = async (path) => {
        if (typeof path !== 'string' || !ENTRY_RE.test(path)) fail('damaged', 'entry_name')
        const data = files[path]
        const hash = manifest.hashes[path]
        if (!data || typeof hash !== 'string' || !HEX64_RE.test(hash)) fail('damaged', `entry_missing_${path}`)
        if (hash !== await sha256Hex(data)) fail('damaged', `entry_hash_${path}`)
        return data
    }

    const m = migrate(manifest)
    if (m.title != null && !shortString(m.title, PROJECT_FILE_LIMITS.titleLength)) fail('invalid', 'title')
    if (!Array.isArray(m.pieces) || m.pieces.length > L.pieces) fail('invalid', 'pieces')
    if (!Array.isArray(m.sheets) || m.sheets.length > L.sheets) fail('invalid', 'sheets')
    if (!isObject(m.settings)) fail('invalid', 'settings')

    const seen = new Set()
    const claim = (id, prefix) => {
        if (typeof id !== 'string' || !ID_RE.test(id) || id[0] !== prefix || seen.has(id)) fail('invalid', `id_${id}`)
        seen.add(id)
    }

    const sheets = []
    for (const s of m.sheets) {
        if (!isObject(s)) fail('invalid', 'sheet_entry')
        claim(s.id, 's')
        if (s.data !== `toles/${s.id}.json`) fail('invalid', `sheet_${s.id}_path`)
        const input = parseJson(await entry(s.data), `sheet_${s.id}`)
        checkSheetInput(input, s.id)
        sheets.push({ id: s.id, input })
    }

    const pieces = []
    for (const p of m.pieces) {
        if (!isObject(p)) fail('invalid', 'piece_entry')
        claim(p.id, 'p')
        if (p.meta !== `pieces/${p.id}.json` || p.dxf !== `pieces/${p.id}.dxf`
            || (p.origDxf != null && p.origDxf !== `pieces/${p.id}.orig.dxf`)
            || (p.job != null && p.job !== `pieces/${p.id}.job`)) {
            fail('invalid', `piece_${p.id}_path`)
        }
        if (!Number.isInteger(p.count) || p.count < 0 || p.count > PROJECT_FILE_LIMITS.count) fail('invalid', `piece_${p.id}_count`)
        const rotation = checkRotation(p.rotation, p.id)
        const meta = parseJson(await entry(p.meta), `piece_${p.id}`)
        checkPieceMeta(meta, p.id)
        const known = {}
        for (const key of PIECE_FIELDS) if (meta[key] !== undefined) known[key] = meta[key]
        const dxf = await entry(p.dxf)
        if (dxf.byteLength === 0) fail('invalid', `piece_${p.id}_dxf_empty`)
        const piece = { id: p.id, count: p.count, rotation, meta: known, dxfBytes: toArrayBuffer(dxf) }
        if (p.origDxf != null) piece.origDxfBytes = toArrayBuffer(await entry(p.origDxf))
        if (p.job != null) piece.sheetcamJobBytes = toArrayBuffer(await entry(p.job))
        pieces.push(piece)
    }

    const sheetIds = new Set(sheets.map((s) => s.id))
    const params = checkParams(structuredCloneJson(m.settings.params ?? {}), sheetIds)
    const paramsUnit = m.settings.paramsUnit === 'inch' ? 'inch' : 'mm'

    return {
        version: m.version,
        app: typeof m.app === 'string' ? m.app.slice(0, 40) : '',
        savedAt: typeof m.savedAt === 'string' ? m.savedAt.slice(0, 64) : '',
        title: typeof m.title === 'string' ? m.title : '',
        unit: m.unit === 'inch' ? 'inch' : 'mm',
        params,
        paramsUnit,
        pieces,
        sheets,
    }
}

const structuredCloneJson = (v) => JSON.parse(JSON.stringify(v))

// -------------------------------------------------------- vers le navigateur

/**
 * Transforme un fichier relu en enregistrements prêts pour IndexedDB et en
 * réglages d'onglet, pour un NOUVEAU projet. Pure : les identifiants neufs
 * et la reconstruction des tôles sont fournis par l'appelant.
 *
 * @param {Awaited<ReturnType<typeof readProjectFile>>} project
 * @param {object} deps
 * @param {string} deps.projectSlug
 * @param {(name: string) => string} deps.newFileSlug  identifiant opaque d'une fiche (makeLocalFileSlug)
 * @param {() => string} deps.newSheetSlug             identifiant d'une tôle
 * @param {(input: object) => object} deps.makeSheetRecord  sheetShape.makeSheetRecord
 * @param {number} deps.snapshotVersion                 SNAPSHOT_VERSION de l'onglet
 * @returns {{ fileRecords: object[], sheetRecords: object[], snapshot: object }}
 * @throws {ProjectFileError} invalid si une tôle ne se reconstruit pas
 */
export function materializeProject(project, { projectSlug, newFileSlug, newSheetSlug, makeSheetRecord, snapshotVersion }) {
    const sheetSlugById = new Map()
    const sheetRecords = project.sheets.map(({ id, input }) => {
        const slug = newSheetSlug()
        sheetSlugById.set(id, slug)
        try {
            return makeSheetRecord({ ...input, id: slug, projectSlug })
        } catch (err) {
            throw new ProjectFileError('invalid', `sheet_${id}_${err?.message || 'build'}`)
        }
    })

    const slugById = new Map()
    for (const piece of project.pieces) slugById.set(piece.id, newFileSlug(piece.meta.name))
    const groupSlug = (key) => {
        if (!slugById.has(key)) slugById.set(key, newFileSlug('x.dxf'))
        return slugById.get(key)
    }

    // L'ordre affiché vient de `addedAt` (listLocalFiles) ; deux fiches à la même
    // milliseconde se départageraient par leur slug, tiré au hasard ici. Une
    // égalité (ou un recul) prend la milliseconde suivante : l'ordre du fichier,
    // qui est celui de l'écran au moment d'enregistrer, est gardé.
    let previous = -Infinity
    const addedAtOf = (value) => {
        const t = Date.parse(value)
        if (!Number.isFinite(t)) return value
        if (t > previous) {
            previous = t
            return value
        }
        previous += 1
        return new Date(previous).toISOString()
    }

    const countBySlug = {}
    const rotationBySlug = {}
    const fileRecords = project.pieces.map((piece) => {
        const slug = slugById.get(piece.id)
        const record = {
            ...piece.meta,
            ...(piece.meta.addedAt != null ? { addedAt: addedAtOf(piece.meta.addedAt) } : {}),
            slug,
            projectSlug,
            dxfBytes: piece.dxfBytes,
            ...(piece.origDxfBytes ? { origDxfBytes: piece.origDxfBytes } : {}),
            ...(piece.sheetcamJobBytes ? { sheetcamJobBytes: piece.sheetcamJobBytes } : {}),
        }
        if (piece.meta.explodedFromSlug) record.explodedFromSlug = groupSlug(piece.meta.explodedFromSlug)
        countBySlug[slug] = piece.count
        rotationBySlug[slug] = piece.rotation
        return record
    })

    const params = structuredCloneJson(project.params)
    if (Array.isArray(params.sheets)) {
        params.sheets = params.sheets.map((sheet) => (
            sheet.shapeId != null ? { ...sheet, shapeId: sheetSlugById.get(sheet.shapeId) } : sheet
        ))
    }
    return {
        fileRecords,
        sheetRecords,
        snapshot: {
            v: snapshotVersion,
            params,
            paramsUnit: project.paramsUnit,
            countBySlug,
            rotationBySlug,
        },
    }
}
