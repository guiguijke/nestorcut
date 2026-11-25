/**
 * Origine du DXF livré : translation d'un fichier de tôle écrit par NOTRE
 * écrivain (workers/geometry/crates/nest-export/src/dxf_writer.rs), pour que le
 * zéro de la machine soit le centre de la tôle au lieu de son coin bas-gauche.
 * Fichier PUR (aucune E/S, aucun DOM), testé contre le vrai bundle wasm.
 *
 * Ce que l'écrivain produit, et donc ce qui est géré ici :
 *  - HEADER : $ACADVER, $INSUNITS, $MEASUREMENT seulement. Aucune étendue
 *    ($EXTMIN/$EXTMAX), aucun point de base ($INSBASE) : rien ne dépend des
 *    coordonnées.
 *  - TABLES : la seule table LAYER (nom, drapeau, couleur). Aucun VPORT, aucune
 *    étendue.
 *  - ENTITIES : LINE, LWPOLYLINE, POLYLINE/VERTEX/SEQEND, ARC, CIRCLE, ELLIPSE,
 *    SPLINE, POINT ; pas de BLOCKS, pas d'INSERT, pas de cote de hauteur (30).
 * Tout le reste (autre section, autre entité, point dans l'en-tête ou les
 * tables, groupe de coordonnée inattendu) lève `dxf_origin_unsupported` :
 * jamais un fichier faux, l'appelant affiche une erreur et ne livre rien.
 *
 * Le fichier reste octet pour octet identique en dehors des nombres déplacés
 * (fins de ligne, handles, calques, ordre).
 */

export const DXF_ORIGIN_UNSUPPORTED = 'dxf_origin_unsupported'
const unsupported = () => new Error(DXF_ORIGIN_UNSUPPORTED)

const MM_PER_INCH = 25.4

// Groupes déplacés par type d'entité : 'x' / 'y' = coordonnée absolue,
// 'keep' = groupe de la plage des coordonnées qui est un VECTEUR (le vecteur de
// l'axe majeur d'une ELLIPSE : il ne bouge pas avec l'origine).
const AXIS = {
    LINE: { 10: 'x', 20: 'y', 11: 'x', 21: 'y' },
    LWPOLYLINE: { 10: 'x', 20: 'y' },
    POLYLINE: {},
    VERTEX: { 10: 'x', 20: 'y' },
    SEQEND: {},
    ARC: { 10: 'x', 20: 'y' },
    CIRCLE: { 10: 'x', 20: 'y' },
    ELLIPSE: { 10: 'x', 20: 'y', 11: 'keep', 21: 'keep' },
    SPLINE: { 10: 'x', 20: 'y' },
    POINT: { 10: 'x', 20: 'y' },
}
// Plage des groupes de coordonnées DXF : 10-18 (X), 20-28 (Y), 30-37 (Z).
const isCoordinateCode = (code) => (code >= 10 && code <= 18) || (code >= 20 && code <= 28) || (code >= 30 && code <= 37)
const SECTIONS_SANS_POINT = new Set(['HEADER', 'TABLES'])

/** `str(float)` de Python, comme l'écrivain (pyfloat.rs `py_str`) : plus court
 * aller-retour, toujours un point décimal (`1.0`), notation scientifique
 * `1e-05` / `1e+16` hors de l'exposant [-4, 15]. Jamais « -0.0 » : un zéro
 * s'écrit `0.0`. Nombres finis seulement. */
export function pyFloatStr(v) {
    if (!Number.isFinite(v)) throw unsupported()
    if (v === 0) return '0.0'
    const sign = v < 0 ? '-' : ''
    // toExponential() sans argument : les chiffres les PLUS COURTS qui relisent
    // la même valeur (même contrat que le `{:e}` de Rust).
    const [mant, ex] = Math.abs(v).toExponential().split('e')
    const exp = Number(ex)
    const digits = mant.replace('.', '')
    if (exp >= -4 && exp <= 15) {
        const n = digits.length
        const intLen = exp + 1
        if (intLen >= n) return `${sign}${digits}${'0'.repeat(intLen - n)}.0`
        if (intLen <= 0) return `${sign}0.${'0'.repeat(-intLen)}${digits}`
        return `${sign}${digits.slice(0, intLen)}.${digits.slice(intLen)}`
    }
    const rest = digits.slice(1)
    const e = Math.abs(exp)
    return `${sign}${digits[0]}${rest ? `.${rest}` : ''}e${exp < 0 ? '-' : '+'}${e < 10 ? `0${e}` : e}`
}

/** Facteur mm -> unité du fichier, lu dans son en-tête ($INSUNITS : 4 = mm,
 * 1 = pouces, ce que l'écrivain pose). Autre chose : non pris en charge. */
export function dxfUnitScale(text) {
    const lines = String(text).split(/\r\n|\r|\n/)
    for (let i = 0; i + 3 < lines.length; i += 2) {
        if (lines[i].trim() === '9' && lines[i + 1].trim() === '$INSUNITS') {
            // Number() : les records d'avant le 12/09 écrivaient « 4.0 ».
            const units = Number(lines[i + 3].trim())
            if (units === 4) return 1
            if (units === 1) return 1 / MM_PER_INCH
            throw unsupported()
        }
        if (lines[i].trim() === '0' && lines[i + 1].trim() === 'ENDSEC') break
    }
    throw unsupported()
}

/**
 * Le même DXF, chaque coordonnée absolue de la section ENTITIES translatée de
 * (-dx, -dy) — en unité du FICHIER (mm ou pouces). Le centre d'une tôle devient
 * (0, 0) avec dx = largeur / 2, dy = hauteur / 2.
 */
export function shiftDxf(text, dx, dy) {
    if (typeof text !== 'string' || !Number.isFinite(dx) || !Number.isFinite(dy)) throw unsupported()
    if (dx === 0 && dy === 0) return text
    // Lignes ET séparateurs : on réécrit des valeurs, jamais les fins de ligne.
    const parts = text.split(/(\r\n|\r|\n)/)
    let section = null
    let entity = null
    let polyline = false
    let sawEof = false
    // Une valeur de groupe = 2 « lignes » (code, valeur), chacune suivie de son
    // séparateur : indices pairs de `parts`.
    for (let i = 0; i < parts.length; i += 4) {
        if (i + 2 >= parts.length) {
            // Reste d'une seule ligne : seule une ligne vide finale est permise.
            if (parts[i].trim() === '' && i + 1 >= parts.length - 1) break
            throw unsupported()
        }
        const codeText = parts[i].trim()
        if (!/^-?\d+$/.test(codeText)) throw unsupported()
        const code = Number(codeText)
        const value = parts[i + 2]
        const val = value.trim()
        if (sawEof) throw unsupported()
        if (code === 0) {
            if (val === 'SECTION') {
                if (section !== null) throw unsupported()
                // Le nom de la section est le groupe suivant.
                if (i + 6 >= parts.length || parts[i + 4].trim() !== '2') throw unsupported()
                section = parts[i + 6].trim()
                if (section !== 'HEADER' && section !== 'TABLES' && section !== 'ENTITIES') throw unsupported()
                i += 4
                entity = null
                polyline = false
                continue
            }
            if (val === 'ENDSEC') {
                if (section === null) throw unsupported()
                if (section === 'ENTITIES' && polyline) throw unsupported()
                section = null
                entity = null
                continue
            }
            if (val === 'EOF') {
                if (section !== null) throw unsupported()
                sawEof = true
                continue
            }
            if (section === 'ENTITIES') {
                if (!Object.hasOwn(AXIS, val)) throw unsupported()
                if (val === 'VERTEX' && !polyline) throw unsupported()
                if (val === 'POLYLINE') polyline = true
                else if (val === 'SEQEND') {
                    if (!polyline) throw unsupported()
                    polyline = false
                } else if (val !== 'VERTEX' && polyline) throw unsupported()
                entity = val
            }
            continue
        }
        if (section === null) throw unsupported()
        if (SECTIONS_SANS_POINT.has(section)) {
            // Un point dans l'en-tête ou les tables ($EXTMIN, VPORT…) dépendrait
            // des coordonnées : on ne sait pas le déplacer.
            if (isCoordinateCode(code)) throw unsupported()
            continue
        }
        // Élévation, épaisseur, extrusion : l'écrivain n'en écrit jamais ; un
        // fichier qui en porte déplacerait mal (extrusion -Z) : refus.
        if (entity !== null && (code === 38 || code === 39 || (code >= 210 && code <= 239))) throw unsupported()
        if (entity === null || !isCoordinateCode(code)) continue
        const how = AXIS[entity][code]
        if (how === undefined) throw unsupported()
        if (how === 'keep') continue
        const n = Number(val)
        if (val === '' || !Number.isFinite(n)) throw unsupported()
        parts[i + 2] = pyFloatStr(n - (how === 'x' ? dx : dy))
    }
    if (section !== null || !sawEof) throw unsupported()
    return parts.join('')
}
