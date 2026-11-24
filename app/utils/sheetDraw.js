/**
 * Dessin d'une tôle importée (vrai contour + zones interdites) : fonctions
 * PURES, sans E/S, sans DOM, sans Math.random. Deux usagers :
 *   - le SVG couleur d'un résultat local (`withSheetShapeSvg`), calculé dans le
 *     navigateur et gardé avec le résultat (IndexedDB) ;
 *   - la vue live pendant le calcul (`liveShapeFields`, `livePaneShape`).
 *
 * Les anneaux sont ceux du conteneur moteur : fermés (piège #5c), boîte du
 * contour en (0,0), y vers le haut, en mm. Le dessin SVG retourne l'axe y
 * (`H - y`, piège #20b), exactement comme la pose des pièces. Aucun anneau
 * ne quitte le navigateur : ces chaînes ne servent qu'à l'écran.
 *
 * Couleurs EXPLICITES (piège #21) : un dessin qui vit dans un fichier SVG ne
 * peut pas dépendre des variables de thème de la page.
 */

/** Rouge « interdit » : même langage visuel que la fenêtre d'import de tôle. */
export const ZONE_RED = '#DC2626'
/** Cadre de la tôle : celui du SVG rectangulaire (svg.rs SHEET_FRAME_COLOR). */
export const SHEET_FRAME = '#3B82F6'
/** Fond de la tôle : celui du SVG rectangulaire (svg.rs SHEET_FILL). */
export const SHEET_FILL = '#FFFFFF'

/** Nombre en notation décimale courte, déterministe (3 décimales, sans zéros inutiles). */
export function fmtNum(n) {
    const v = Number(n)
    if (!Number.isFinite(v)) return '0'
    const s = v.toFixed(3)
    if (!s.includes('.')) return s
    const t = s.replace(/0+$/, '').replace(/\.$/, '')
    return t === '-0' ? '0' : t
}

/**
 * Chemin SVG d'un anneau, axe y retourné (`height - y`). L'anneau fermé
 * (premier point répété) perd son doublon : `Z` ferme déjà. Moins de 3
 * sommets distincts ou un point non fini : '' (rien n'est dessiné).
 */
export function ringToPath(ring, height) {
    if (!Array.isArray(ring) || ring.length < 3) return ''
    const pts = ring.slice()
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (pts.length > 1 && a[0] === b[0] && a[1] === b[1]) pts.pop()
    if (pts.length < 3) return ''
    const out = []
    for (const p of pts) {
        if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return ''
        out.push(`${fmtNum(p[0])} ${fmtNum(height - p[1])}`)
    }
    return `M${out.join(' ')}Z`
}

/** Boîte [w, h] d'un contour dont la boîte commence en (0,0) ; null si vide. */
export function outlineSize(outer) {
    if (!Array.isArray(outer) || !outer.length) return null
    let w = 0
    let h = 0
    for (const p of outer) {
        if (!Array.isArray(p)) return null
        if (p[0] > w) w = p[0]
        if (p[1] > h) h = p[1]
    }
    return w > 0 && h > 0 ? [w, h] : null
}

/**
 * { outline, zones } : chemins du contour et de TOUTES les zones (un seul
 * chemin, sous-chemins séparés), axe y retourné pour une tôle de hauteur
 * `height`. null si le contour est illisible (l'appelant dessine alors le
 * rectangle, jamais une forme fausse).
 */
export function shapeToDrawPaths(shape, height) {
    const outline = ringToPath(shape?.outer, height)
    if (!outline) return null
    const zones = (Array.isArray(shape?.inner) ? shape.inner : [])
        .map((r) => ringToPath(r, height))
        .filter(Boolean)
        .join(' ')
    return { outline, zones }
}

/** Hachure rouge à 45 degrés, pas relatif à la tôle (lisible de la vignette au plein écran). */
function hatchPattern(id, pitch, strokeWidth) {
    return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${fmtNum(pitch)}" height="${fmtNum(pitch)}" patternTransform="rotate(45)">`
        + `<line x1="0" y1="0" x2="0" y2="${fmtNum(pitch)}" stroke="${ZONE_RED}" stroke-width="${fmtNum(strokeWidth)}" /></pattern>`
}

const RECT_LINE = /^<rect x="0" y="0" width="[^"]*" height="[^"]*" fill="[^"]*" stroke="[^"]*" stroke-width="([^"]*)" \/>$/

/** Empreinte courte (FNV-1a 32 bits, 8 hex) d'un texte : portée d'id de motif. */
export function shortHash(text) {
    let h = 0x811c9dc5
    const t = String(text)
    for (let i = 0; i < t.length; i++) {
        h ^= t.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
}

/**
 * Remplace le rectangle de tôle du SVG couleur (svg.rs, ligne 3) par le vrai
 * contour : l'intérieur du contour est la tôle, le reste de la boîte reste
 * transparent (« pas de la tôle »), les zones interdites sont rouges (fond +
 * hachure + trait) SOUS les pièces. Sans forme (null/illisible) ou si la ligne
 * du rectangle n'est pas reconnue : le SVG est rendu tel quel, octet pour
 * octet. `idSuffix` rend les ids de motif uniques par tôle (piège #22).
 */
export function withSheetShapeSvg(svg, shape, width, height, idSuffix = '0', scope = '') {
    if (typeof svg !== 'string' || !shape) return svg
    const paths = shapeToDrawPaths(shape, height)
    if (!paths) return svg
    const lines = svg.split('\n')
    const at = lines.findIndex((l) => RECT_LINE.test(l))
    if (at < 0) return svg
    const sw = Number(RECT_LINE.exec(lines[at])[1]) || Math.min(width, height) * 0.003
    const layer = [
        `<path d="${paths.outline}" fill="${SHEET_FILL}" stroke="${SHEET_FRAME}" stroke-width="${fmtNum(sw)}" stroke-linejoin="round" fill-rule="evenodd" />`,
    ]
    if (paths.zones) {
        // `scope` (J4) : l'index de tôle n'est unique que DANS un job ; deux
        // résultats inlinés dans la même page se disputeraient `nc-zone-hatch-0`.
        // Le suffixe de portée (empreinte du SVG, du job ou de l'alternative)
        // rend l'id unique entre résultats ; sans portée l'id reste celui d'avant.
        const sc = String(scope).replace(/[^A-Za-z0-9_-]/g, '')
        const id = `nc-zone-hatch-${String(idSuffix).replace(/[^A-Za-z0-9_-]/g, '')}${sc ? `-${sc}` : ''}`
        const pitch = Math.max(Math.min(width, height) * 0.02, sw * 4)
        layer.push(
            `<defs>${hatchPattern(id, pitch, sw * 0.8)}</defs>`,
            `<path d="${paths.zones}" fill="${ZONE_RED}" fill-opacity="0.18" stroke="none" fill-rule="evenodd" />`,
            `<path d="${paths.zones}" fill="url(#${id})" stroke="${ZONE_RED}" stroke-width="${fmtNum(sw)}" stroke-linejoin="round" fill-rule="evenodd" />`,
        )
    }
    lines.splice(at, 1, ...layer)
    return lines.join('\n')
}

// ---- vue live -----------------------------------------------------------------

const _tables = new WeakMap()

/**
 * Une entrée par FORMAT (index de `instance.bins`) : null pour un rectangle,
 * { w, h, outline, zones } pour une tôle importée (chemins déjà retournés en
 * y, prêts à poser dans le groupe d'un panneau). Calculée une fois par
 * payload : les frames live se suivent à haute cadence.
 */
export function liveShapeTable(payload) {
    const bins = payload?.instance?.bins
    const shaped = payload?.shapedSheets
    if (!Array.isArray(bins) || !bins.length || !Array.isArray(shaped) || !shaped.length) return null
    const cached = _tables.get(bins)
    if (cached) return cached
    const ids = new Set(shaped.map((s) => s.id))
    const table = bins.map((bin) => {
        if (!ids.has(bin?.id)) return null
        const data = bin?.shape?.data
        const size = outlineSize(data?.outer)
        if (!size) return null
        // Tôle avec défauts : la taille est celle du moteur (contour original), les
        // chemins ceux de la forme livrée (coupée).
        const deliver = shaped.find((s) => s.id === bin.id)?.shape
        const paths = shapeToDrawPaths(deliver ?? { outer: data.outer, inner: data.inner }, size[1])
        return paths ? { w: size[0], h: size[1], ...paths } : null
    })
    _tables.set(bins, table)
    return table
}

/** Champ à ajouter à une frame live : {} sans tôle importée (frame inchangée). */
export function liveShapeFields(payload) {
    const table = liveShapeTable(payload)
    return table ? { sheetShapes: table } : {}
}

/**
 * Frame FINALE de la scène (J1) : la frame de `buildLiveLayout` connaît le
 * format de chaque tôle (`binFormats`) mais pas leurs formes ; sans la table
 * `sheetShapes`, LiveNestingView (scène de la page projet, via livePaneShape)
 * redessine le rectangle de la boîte à la fin du calcul. Ajoutée au RETOUR du
 * job (révélation), jamais à la frame enregistrée dans le record.
 */
export function withLiveShapes(frame, payload) {
    if (!frame) return frame
    const f = liveShapeFields(payload)
    return Object.keys(f).length ? { ...frame, ...f } : frame
}

/**
 * Format d'une tôle de la frame (`rank` = RANG de tôle, pas format). Connu
 * si la frame le dit (`binFormats`, frame finale : format de chaque layout)
 * ou s'il n'existe qu'UN format. Sinon null : le format d'un rang n'est pas
 * dans une frame moteur, on ne devine pas.
 */
export function liveFormatOfRank(frame, rank) {
    const table = frame?.sheetShapes
    if (!Array.isArray(table) || !table.length) return null
    const given = frame?.binFormats?.[rank]
    if (Number.isInteger(given)) return given >= 0 && given < table.length ? given : null
    return table.length === 1 ? 0 : null
}

/**
 * Forme à dessiner pour un panneau `pane` ({ w, h } de la tôle affichée) : la
 * forme du format du rang, seulement si sa boîte est celle du panneau ; sinon
 * null (le panneau garde son rectangle, jamais une forme fausse).
 */
export function livePaneShape(frame, pane) {
    const format = liveFormatOfRank(frame, pane?.bin ?? 0)
    if (format == null) return null
    const entry = frame.sheetShapes[format]
    if (!entry) return null
    if (Math.abs(entry.w - pane.w) > 0.01 || Math.abs(entry.h - pane.h) > 0.01) return null
    return entry
}

/** Id de motif live, unique par vue, par panneau et par carte (piège #22). */
export function liveHatchId(viewId, cardKey, bin) {
    return `${viewId}-hatch-${String(cardKey).replace(/[^A-Za-z0-9_-]/g, '')}-${Number(bin) || 0}`
}

/** Pas de hachure d'un panneau : relatif à la tôle. */
export function liveHatchPitch(pane) {
    return Math.max(1, Math.min(pane?.w || 1, pane?.h || 1) * 0.02)
}
