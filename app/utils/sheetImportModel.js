/**
 * Fenêtre d'import de tôle : toute la logique qui n'est pas du rendu
 * (aucune E/S, pas de Date.now, pas de Math.random : l'horloge et le hasard
 * viennent du composant). Testée dans app/tests/sheetImportModel.test.js.
 *
 * Entrée : le résultat du lecteur (`geoImportSheet`) ou un enregistrement de
 * tôle déjà gardé (localSheetsStore). Les contours sont en millimètres, y vers
 * le haut, dans le repère du DXF (voir sheetShape.js).
 */
import {
    describeOutline,
    makeSheetRecord,
    normalizeForbidden,
    pickOutlineIndex,
    ringBbox,
    usableAreaMm2,
    zoneCandidates,
} from './sheetShape.js'
import { fmtLengthValue, MM_PER_INCH } from './units.js'

/** Un contour plus petit que ça à l'écran (px) n'est plus cliquable : liste seulement. */
export const MIN_ZONE_PX = 6
/** Fichier sans unité déclarée plus petit que ça (mm) : sans doute en pouces. */
export const INCH_HINT_MAX_MM = 30
export const INCH_FACTOR = MM_PER_INCH
export const MAX_NAME_LENGTH = 60

// ------------------------------------------------------------------ erreurs

/** Clés de message (dictionnaires, préfixe sheetImport.err.*). */
export const ERROR_KEYS = {
    unreadable: 'sheetImport.err.unreadable',
    notDxf: 'sheetImport.err.notDxf',
    notDxfContent: 'sheetImport.err.notDxfContent',
    tooHeavy: 'sheetImport.err.tooHeavy',
    noContour: 'sheetImport.err.noContour',
    badGeometry: 'sheetImport.err.badGeometry',
    tooManyVertices: 'sheetImport.err.tooManyVertices',
    tooManyZones: 'sheetImport.err.tooManyZones',
    nameRequired: 'sheetImport.err.nameRequired',
    storage: 'sheetImport.err.storage',
}

const CODE_TO_KEY = {
    sheet_no_outline: ERROR_KEYS.noContour,
    sheet_bad_geometry: ERROR_KEYS.badGeometry,
    sheet_too_many_vertices: ERROR_KEYS.tooManyVertices,
    sheet_too_many_zones: ERROR_KEYS.tooManyZones,
    indexeddb_unavailable: ERROR_KEYS.storage,
    indexeddb_blocked: ERROR_KEYS.storage,
}

/**
 * Message d'erreur de tout ce qui peut mal tourner, en une clé :
 *   - une Error du modèle (`sheet_*`) ou du stockage ;
 *   - un résultat du lecteur : `{ refusal, message }` (trop lourd, le
 *     message du lecteur est montré tel quel : `detail`), `{ ok: false }`
 *     (illisible), contours vides (aucun contour fermé).
 * Rend `{ key, detail }` ; `detail` n'est posé que pour le refus « trop lourd ».
 */
export function importErrorOf(input) {
    if (input instanceof Error) {
        return { key: CODE_TO_KEY[input.message] || ERROR_KEYS.unreadable, detail: null }
    }
    if (typeof input === 'string') {
        return { key: CODE_TO_KEY[input] || ERROR_KEYS.unreadable, detail: null }
    }
    if (!input || typeof input !== 'object') return { key: ERROR_KEYS.unreadable, detail: null }
    if (input.refusal) {
        return { key: ERROR_KEYS.tooHeavy, detail: typeof input.message === 'string' && input.message ? input.message : null }
    }
    if (input.ok === false) return { key: ERROR_KEYS.unreadable, detail: null }
    if (!Array.isArray(input.contours) || input.contours.length === 0) {
        return { key: ERROR_KEYS.noContour, detail: null }
    }
    if (pickOutlineIndex(input.contours) < 0) return { key: ERROR_KEYS.noContour, detail: null }
    return null
}

// ------------------------------------------------------------ fichier choisi

/** Extension .dxf (casse libre) : la VÉRITÉ du contenu reste au lecteur. */
export function isDxfName(name) {
    return /\.dxf$/i.test(String(name || '').trim())
}

/**
 * Contrôle bon marché du contenu AVANT d'appeler le lecteur : un DXF binaire
 * commence par « AutoCAD Binary DXF » ; un DXF texte est une suite de paires
 * de lignes (code de groupe entier, valeur) et ouvre une SECTION près du
 * début (après d'éventuels commentaires, code 999). `head` : les premiers
 * octets du fichier (Uint8Array). Un vrai DXF sans contour fermé passe ici :
 * c'est le lecteur qui dit « aucun contour fermé ».
 */
export function looksLikeDxf(head) {
    if (!head || typeof head.length !== 'number' || head.length === 0) return false
    const bytes = head.length > 4096 ? head.subarray(0, 4096) : head
    let text = ''
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i])
    if (text.startsWith('AutoCAD Binary DXF')) return true
    if (text.includes('\u0000')) return false
    if (text.charCodeAt(0) === 0xef && text.charCodeAt(1) === 0xbb && text.charCodeAt(2) === 0xbf) text = text.slice(3)
    const lines = text.split(/\r\n|\r|\n/)
    // la dernière ligne peut être coupée par la fenêtre de lecture
    const cut = head.length >= 4096 && !text.endsWith('\n') && !text.endsWith('\r')
    const complete = cut ? lines.slice(0, -1) : lines
    for (let i = 0; i + 1 < complete.length && i < 80; i += 2) {
        const code = complete[i].trim()
        if (!/^-?\d{1,4}$/.test(code)) return false
        if (code === '0' && complete[i + 1].trim().toUpperCase() === 'SECTION') return true
    }
    return false
}

/** « plan.dxf » -> « plan » ; sert de repli au nom de la tôle. */
export function baseName(fileName) {
    return String(fileName || '').replace(/^.*[\\/]/, '').replace(/\.[^./\\]+$/, '')
}

/**
 * Décimales communes pour la largeur et la hauteur (jamais « 507,8 » à côté
 * de « 507,9 » : l'écart vient du polygone qui approche un cercle). Entier
 * quand les deux valeurs en sont proches (0,25 mm ; 0,01"), sinon la
 * précision d'affichage habituelle.
 */
export function pairDecimals(unit, widthMm, heightMm) {
    const inch = unit === 'inch'
    const tol = inch ? 0.01 : 0.25
    const near = (mm) => {
        const v = inch ? mm / MM_PER_INCH : mm
        return Math.abs(v - Math.round(v)) <= tol
    }
    if (near(widthMm) && near(heightMm)) return 0
    return inch ? 3 : 1
}

// ------------------------------------------------------------- vue de zones

function ancestorsOf(contours, index, outlineIndex) {
    const out = []
    let cur = contours[index]?.parent
    let guard = contours.length + 1
    while (Number.isInteger(cur) && cur !== outlineIndex && guard-- > 0) {
        out.push(cur)
        cur = contours[cur]?.parent
    }
    return out
}

/**
 * Vue d'un jeu de contours : contour de tôle, zones candidates (tous les
 * descendants du contour de tôle, ordre du tableau : profondeur puis aire
 * décroissante), numérotées à partir de 1.
 * `otherOutlines` : contours extérieurs (profondeur 1) autres que la tôle —
 * ignorés, la fenêtre le dit.
 */
export function buildSheetView(contours) {
    const outlineIndex = pickOutlineIndex(contours)
    if (outlineIndex < 0) return null
    const candidates = zoneCandidates(contours, outlineIndex)
    const numberOf = new Map(candidates.map((index, i) => [index, i + 1]))
    const zones = candidates.map((index, i) => {
        const [minx, miny, maxx, maxy] = contours[index].bbox || ringBbox(contours[index].ring)
        return {
            index,
            number: i + 1,
            depth: contours[index].depth,
            widthMm: maxx - minx,
            heightMm: maxy - miny,
            areaMm2: contours[index].areaMm2,
            // numéros des zones qui contiennent celle-ci (la plus proche d'abord)
            ancestorNumbers: ancestorsOf(contours, index, outlineIndex)
                .map((a) => numberOf.get(a))
                .filter((n) => Number.isInteger(n)),
        }
    })
    let otherOutlines = 0
    contours.forEach((c, i) => { if (c?.depth === 1 && i !== outlineIndex) otherOutlines++ })
    return { outlineIndex, candidates, zones, otherOutlines, outline: describeOutline(contours, outlineIndex) }
}

/**
 * État de chaque zone, dans l'ordre de `view.zones` :
 *   'forbidden' : interdite (rouge) ;
 *   'implied'   : couverte par une zone interdite qui la contient (rien à faire) ;
 *   'free'      : libre.
 * `coveredBy` : numéro de la zone interdite qui couvre (état 'implied').
 */
export function zoneStates(contours, view, forbidden) {
    if (!view) return []
    const forb = new Set(normalizeForbidden(contours, view.outlineIndex, forbidden))
    const numberOf = new Map(view.zones.map((z) => [z.index, z.number]))
    return view.zones.map((z) => {
        if (forb.has(z.index)) return { index: z.index, number: z.number, state: 'forbidden', coveredBy: null }
        const covering = ancestorsOf(contours, z.index, view.outlineIndex).find((a) => forb.has(a))
        if (covering !== undefined) {
            return { index: z.index, number: z.number, state: 'implied', coveredBy: numberOf.get(covering) }
        }
        return { index: z.index, number: z.number, state: 'free', coveredBy: null }
    })
}

/**
 * Bascule d'une zone. Libre -> interdite (les descendants déjà interdits sont
 * absorbés), interdite -> libre. Une zone couverte ne change pas : sa
 * couverture dépend de la zone qui la contient.
 */
export function toggleZone(contours, view, forbidden, index) {
    if (!view || !view.candidates.includes(index)) return normalizeForbidden(contours, view?.outlineIndex, forbidden)
    const current = normalizeForbidden(contours, view.outlineIndex, forbidden)
    const state = zoneStates(contours, view, current).find((s) => s.index === index)?.state
    if (state === 'implied') return current
    if (state === 'forbidden') return current.filter((i) => i !== index)
    return normalizeForbidden(contours, view.outlineIndex, [...current, index])
}

/** Raccourci « aucune ». */
export function forbidNone() {
    return []
}

/** Raccourci « toutes » : les zones de tête (les autres sont couvertes). */
export function forbidAll(contours, view) {
    if (!view) return []
    return normalizeForbidden(contours, view.outlineIndex, view.candidates)
}

/**
 * Raccourci « inverser » : chaque zone LIBRE devient interdite, chaque zone
 * interdite redevient libre ; les zones couvertes suivent leur parent.
 */
export function forbidInvert(contours, view, forbidden) {
    if (!view) return []
    const free = zoneStates(contours, view, forbidden).filter((s) => s.state === 'free').map((s) => s.index)
    return normalizeForbidden(contours, view.outlineIndex, free)
}

/** Aire utile (mm²) selon les zones choisies. */
export function usableArea(contours, view, forbidden) {
    return view ? usableAreaMm2(contours, view.outlineIndex, forbidden) : 0
}

/**
 * Libellé du bouton de confirmation : le choix y est dit en toutes lettres
 * (c'est le garde-fou contre un clic oublié). `{ key }` sans zone ;
 * `{ plural, n }` sinon (à passer à `tp`).
 */
export function confirmLabel(forbiddenCount) {
    const n = Number.isInteger(forbiddenCount) && forbiddenCount > 0 ? forbiddenCount : 0
    return n === 0 ? { key: 'sheetImport.confirm.none', n: 0 } : { plural: 'sheetImport.confirm.some', n }
}

// ------------------------------------------------------------------- unités

/**
 * Fichier sans unité déclarée (sourceUnits 0) dont la plus grande dimension
 * est sous 30 mm : un disque de 20 mm n'est pas une tôle, 20 pouces oui.
 */
export function looksLikeInches(sourceUnits, widthMm, heightMm) {
    if (sourceUnits !== 0) return false
    const big = Math.max(Number(widthMm) || 0, Number(heightMm) || 0)
    return big > 0 && big < INCH_HINT_MAX_MM
}

// -------------------------------------------------------------------- noms

/**
 * Nom proposé : « Ø 500 mm » pour un disque, « 1200 × 800 mm » sinon, dans
 * l'unité d'affichage (mm ou inch). `outline` vient de describeOutline.
 */
export function defaultSheetName(outline, unit, locale) {
    const decimals = unit === 'inch' ? 2 : 1
    const mark = unit === 'inch' ? '"' : ' mm'
    const v = (mm) => fmtLengthValue(mm, unit, decimals, locale)
    if (outline?.kind === 'disc') return `Ø ${v(outline.diameterMm)}${mark}`
    return `${v(outline?.widthMm ?? 0)} × ${v(outline?.heightMm ?? 0)}${mark}`
}

/** Nom nettoyé : espaces rognés, longueur bornée ; '' s'il ne reste rien. */
export function cleanName(name) {
    return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
}

/** Identifiant frais : l'horloge et le hasard sont fournis par l'appelant. */
export function newSheetSlug(now, random) {
    const t = Math.floor(Number(now) || 0).toString(36)
    const r = Math.floor((Number(random) || 0) * 36 ** 6).toString(36).padStart(6, '0')
    return `sheet-${t}-${r}`
}

// ------------------------------------------------------ ce qui est ignoré

/**
 * Lignes « ce qui a été ignoré » : seulement les compteurs non nuls.
 * Rend [{ key, n }] (clés sheetImport.ignored.*), à passer à `t(key, {n})`.
 */
export function ignoredLines({ openPaths = 0, skippedEntities = 0, otherOutlines = 0 } = {}) {
    const out = []
    const pos = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)
    if (pos(openPaths)) out.push({ key: 'sheetImport.ignored.open', n: pos(openPaths) })
    if (pos(skippedEntities)) out.push({ key: 'sheetImport.ignored.other', n: pos(skippedEntities) })
    if (pos(otherOutlines)) out.push({ key: 'sheetImport.ignored.outlines', n: pos(otherOutlines) })
    return out
}

// ------------------------------------------------------------------ dessin

/** Chemin SVG (unités du dessin) d'un anneau fermé. */
export function ringPath(ring) {
    if (!Array.isArray(ring) || ring.length === 0) return ''
    const f = (v) => (Math.round(v * 1000) / 1000).toString()
    return ring.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`).join('') + 'Z'
}

/**
 * Ajustement du dessin (mm, y vers le haut) dans une boîte de `width` x
 * `height` px avec `margin` px autour. La transformation FLIPPE y (piège
 * AGENTS 20b) : x' = s·x + tx ; y' = -s·y + ty. À poser sur un <g>, avec des
 * traits `vector-effect: non-scaling-stroke` (largeur constante à l'écran).
 */
export function fitTransform(bbox, width, height, margin = 24) {
    const w = Math.max(1, Number(width) || 1)
    const h = Math.max(1, Number(height) || 1)
    const m = Math.min(margin, Math.floor(Math.min(w, h) / 4))
    const [minx, miny, maxx, maxy] = Array.isArray(bbox) && bbox.length === 4 ? bbox : [0, 0, 1, 1]
    const bw = maxx - minx
    const bh = maxy - miny
    const availW = Math.max(1, w - 2 * m)
    const availH = Math.max(1, h - 2 * m)
    let scale
    if (bw > 0 && bh > 0) scale = Math.min(availW / bw, availH / bh)
    else if (bw > 0) scale = availW / bw
    else if (bh > 0) scale = availH / bh
    else scale = 1
    const ox = (w - bw * scale) / 2
    const oy = (h - bh * scale) / 2
    const tx = ox - minx * scale
    const ty = h - oy + miny * scale
    const r = (v) => Math.round(v * 1e6) / 1e6
    return {
        scale: r(scale),
        tx: r(tx),
        ty: r(ty),
        width: w,
        height: h,
        viewBox: `0 0 ${w} ${h}`,
        transform: `matrix(${r(scale)} 0 0 ${-r(scale)} ${r(tx)} ${r(ty)})`,
    }
}

/** Taille à l'écran (px) de la plus grande dimension d'un contour. */
export function contourScreenPx(contour, scale) {
    const [minx, miny, maxx, maxy] = contour?.bbox || ringBbox(contour?.ring) || [0, 0, 0, 0]
    return Math.max(maxx - minx, maxy - miny) * scale
}

/** Un contour trop petit à l'écran n'est pas cliquable : il reste dans la liste. */
export function isListOnly(contour, scale, minPx = MIN_ZONE_PX) {
    return contourScreenPx(contour, scale) < minPx
}

/**
 * Modèle de vignette (cartes « récentes ») : contour, zones interdites
 * normalisées, transformation dans une boîte de `width` x `height` px.
 */
export function thumbModel(record, width = 72, height = 56) {
    const contours = record?.contours
    const outlineIndex = record?.outlineIndex
    if (!Array.isArray(contours) || !contours[outlineIndex]) return null
    const fit = fitTransform(contours[outlineIndex].bbox || ringBbox(contours[outlineIndex].ring), width, height, 4)
    const zones = normalizeForbidden(contours, outlineIndex, record.forbidden)
    return {
        ...fit,
        outlineD: ringPath(contours[outlineIndex].ring),
        zonesD: zones.map((i) => ringPath(contours[i].ring)),
    }
}

// ------------------------------------------------------------ enregistrement

/**
 * Copie profonde en données simples (tableaux, objets, nombres, chaînes,
 * booléens, null) : ce qu'IndexedDB sait cloner. Les Proxy réactifs de Vue
 * (ref, reactive) sont refusés par le clone structuré (DataCloneError) ; les
 * lire ici les dissout. Fonctions, symboles et undefined sont abandonnés.
 */
export function toPlain(value) {
    if (Array.isArray(value)) return value.map((v) => toPlain(v))
    if (value && typeof value === 'object') {
        const out = {}
        for (const key of Object.keys(value)) {
            const v = value[key]
            if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue
            out[key] = toPlain(v)
        }
        return out
    }
    if (typeof value === 'function' || typeof value === 'symbol') return undefined
    return value
}

/**
 * Construit l'enregistrement à garder. Rend `{ record }` ou `{ error }` (clé
 * de message). `now` et `slug` viennent du composant. L'enregistrement rendu
 * est toujours en données simples, quoi qu'on lui passe (Proxy réactifs
 * compris) : il part tel quel vers IndexedDB.
 */
export function buildRecord({
    slug, projectSlug, name, sourceFileName, sourceUnits, contours, outlineIndex, forbidden, now,
}) {
    const clean = cleanName(name)
    if (!clean) return { error: ERROR_KEYS.nameRequired }
    try {
        const record = makeSheetRecord({
            id: slug,
            projectSlug,
            name: clean,
            sourceFileName,
            sourceUnits,
            contours: toPlain(contours),
            outlineIndex,
            forbidden: toPlain(forbidden),
            addedAt: now,
        })
        return { record: toPlain(record) }
    } catch (err) {
        return { error: importErrorOf(err).key }
    }
}
