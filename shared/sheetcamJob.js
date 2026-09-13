/**
 * Lecteur / écrivain de fichier `.job` SheetCam — lot J1 de
 * `docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §8.
 *
 * UN SEUL CODE pour le navigateur et pour le serveur : aucune dépendance
 * Node, aucun `TextDecoder` (l'encodage est traité octet par octet, voir
 * plus bas), entrée et sortie en `Uint8Array`.
 *
 * ---------------------------------------------------------------------------
 * Ce qu'est le fichier, MESURÉ sur les quatorze `.job` réels du propriétaire
 * (SheetCam TNG, `FileVersion=1003`) — chaque point est un fait, pas une
 * hypothèse :
 *
 *  - du TEXTE INI en `CRLF` (287 CRLF, zéro LF nu sur la fixture), puis un
 *    bloc BINAIRE ;
 *  - le fichier commence par une entrée HORS SECTION (`Config=`) : un parseur
 *    qui exige une section en tête perd cette ligne ;
 *  - `[BinaryDataStart]` n'est PAS suivi d'un CRLF : les octets commencent
 *    immédiatement après le crochet fermant. Écrire un saut de ligne ici
 *    décale tout le cache géométrique de SheetCam ;
 *  - le bloc binaire est la géométrie en cache des dessins ORIGINAUX, liée
 *    aux sections `[Part N]` par leur RANG (règle 6 de l'étude) : il est
 *    recopié tel quel, jamais décodé, jamais réordonné ;
 *  - les nombres sont écrits au format `%.15g` (`-1.5707963267949` pour
 *    −π/2, `66.828` sans zéros de queue), et le générateur du 11/09 a écrit
 *    `Angle=-0` pour un angle nul négatif : `formatJobNumber` reproduit les
 *    deux, **y compris le zéro négatif** (`String(-0)` rend « 0 » en
 *    JavaScript — un octet de différence sur le fichier rendu) ;
 *  - l'ordre des sections n'est ni alphabétique sensible à la casse ni
 *    insensible (`[pathRules]` vient APRÈS `[Part 4]` et AVANT `[Table]`) :
 *    c'est l'ordre de QSettings. On ne le recalcule donc jamais — on
 *    PRÉSERVE l'ordre lu, et une section `[Part N]` neuve s'insère juste
 *    après la dernière section `Part …` existante, ce qui reproduit à
 *    l'octet près le fichier de référence du 11/09.
 *
 * Ce module ne convertit AUCUNE pose (c'est le lot J2) : il lit ce qui est
 * écrit et écrit ce qu'on lui donne.
 */

// Versions dont la forme est mesurée. Tout le reste est refusé plutôt que
// deviné : un `.job` d'une autre version peut porter d'autres clés, et un
// fichier réécrit de travers casse le job de découpe d'un atelier.
export const SUPPORTED_JOB_VERSIONS = [1003]

/** Marqueur de début du bloc binaire (section sans saut de ligne derrière). */
const BINARY_MARKER = '[BinaryDataStart]'

/** Ordre de coupe « manuel, pièces groupées » — seul mode qui fait respecter
 *  `[OpOrder]` par l'optimiseur de trajet (règle 8 de l'étude). */
export const OPTIMISATION_MANUAL_KEEP_PARTS = 3

/**
 * Erreur de lecture d'un `.job`. `code` est une clé i18n (`sheetcamJob.*`) et
 * `params` porte les nombres à afficher — jamais de message technique brut à
 * l'écran (piège #24 : un nombre nu est incompréhensible).
 */
export class SheetCamJobError extends Error {
    constructor(code, params = {}) {
        super(code)
        this.name = 'SheetCamJobError'
        this.code = code
        this.params = params
    }
}

// --- encodage --------------------------------------------------------------
//
// La partie texte est traitée en latin-1 : un octet = un point de code. Ce
// n'est pas une hypothèse sur l'encodage de SheetCam, c'est le seul moyen de
// garantir que « lire puis écrire » rende les MÊMES OCTETS, quel que soit
// l'encodage réel des noms (un nom accentué en UTF-8 traverse intact, ses
// deux octets restant deux points de code). Un appelant qui veut AFFICHER un
// nom le décode lui-même à sa frontière (AGENTS #25, même discipline que les
// unités).

function bytesToLatin1(bytes) {
    let out = ''
    const CHUNK = 8192
    for (let i = 0; i < bytes.length; i += CHUNK) {
        out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
    }
    return out
}

function latin1ToBytes(text) {
    const out = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
    return out
}

// --- nombres ---------------------------------------------------------------

/**
 * Format `%.15g` du C, celui qu'emploie le fichier de référence.
 *
 * Quinze chiffres significatifs, zéros de queue retirés, bascule en notation
 * exponentielle quand l'exposant sort de [−4, 15[ — et **zéro négatif rendu
 * « -0 »**, parce que le fichier de référence l'écrit ainsi (`Angle=-0` pour
 * un angle moteur nul, la règle 3 posant `Angle = −θ`).
 */
export function formatJobNumber(value) {
    const x = Number(value)
    if (!Number.isFinite(x)) {
        throw new SheetCamJobError('sheetcamJob.badNumber', { value: String(value) })
    }
    if (x === 0) return Object.is(x, -0) ? '-0' : '0'

    const exp = Math.floor(Math.log10(Math.abs(x)))
    if (exp < -4 || exp >= 15) {
        // %g : mantisse à 15 chiffres, zéros de queue retirés, exposant à
        // deux chiffres au moins (« 1e+16 », « 1.5e-07 »).
        let [mant, e] = x.toExponential(14).split('e')
        if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '')
        const sign = e[0] === '-' ? '-' : '+'
        const digits = e.slice(1).padStart(2, '0')
        return `${mant}e${sign}${digits}`
    }
    let s = x.toPrecision(15)
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
    return s
}

function parseNumber(raw, fallback = null) {
    if (raw == null || raw === '') return fallback
    const x = Number(raw)
    return Number.isFinite(x) ? x : fallback
}

// --- lecture ---------------------------------------------------------------

/**
 * Découpe le `.job` en lignes STRUCTURÉES + bloc binaire.
 *
 * `lines` est la vérité de forme : chaque entrée est `{kind}` avec
 * `kind: 'section' | 'entry' | 'raw'`, et la sérialisation les réémet dans
 * l'ordre. Rien n'est trié, rien n'est normalisé.
 */
function splitJob(bytes) {
    const all = bytesToLatin1(bytes)
    const at = all.indexOf(BINARY_MARKER)
    if (at < 0) throw new SheetCamJobError('sheetcamJob.noBinaryBlock')

    const text = all.slice(0, at)
    // Le marqueur ET tout ce qui suit : recopiés en octets, jamais touchés.
    const binary = bytes.subarray(at)

    const lines = []
    // Le texte finit par un CRLF juste avant le marqueur : le dernier
    // morceau du split est vide et ne doit pas devenir une ligne.
    const rawLines = text.split('\r\n')
    if (rawLines.length && rawLines[rawLines.length - 1] === '') rawLines.pop()
    for (const line of rawLines) {
        if (line.startsWith('[') && line.endsWith(']')) {
            lines.push({ kind: 'section', name: line.slice(1, -1) })
            continue
        }
        const eq = line.indexOf('=')
        if (eq > 0) {
            lines.push({ kind: 'entry', key: line.slice(0, eq), value: line.slice(eq + 1) })
            continue
        }
        lines.push({ kind: 'raw', text: line })
    }
    return { lines, binary }
}

/** Valeur d'une clé dans une section (première occurrence), ou null. */
function getEntry(lines, section, key) {
    let inside = section === null
    for (const line of lines) {
        if (line.kind === 'section') {
            inside = line.name === section
            continue
        }
        if (inside && line.kind === 'entry' && line.key === key) return line.value
    }
    return null
}

/** Noms de sections présents, dans l'ordre du fichier. */
function sectionNames(lines) {
    return lines.filter((l) => l.kind === 'section').map((l) => l.name)
}

/** Toutes les entrées d'une section, dans l'ordre. */
function sectionEntries(lines, section) {
    const out = []
    let inside = false
    for (const line of lines) {
        if (line.kind === 'section') { inside = line.name === section; continue }
        if (inside && line.kind === 'entry') out.push(line)
    }
    return out
}

/** Nom de fichier seul, chemin Windows ou POSIX (règle 9 : un `.job` déposé
 *  chez nous porte le chemin absolu du disque de l'utilisateur). */
export function jobDrawingName(drawingFile) {
    const s = String(drawingFile || '')
    const cut = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
    return cut >= 0 ? s.slice(cut + 1) : s
}

/**
 * Lit un `.job`. Rend la forme préservée (`lines`, `binary`) ET la lecture
 * produit : tôle, kerf, pièces, opérations.
 *
 * Lève `SheetCamJobError` si le fichier n'a pas de bloc binaire, si la
 * version n'est pas dans la liste blanche, ou s'il ne porte aucune pièce.
 */
export function parseSheetCamJob(bytes) {
    if (!(bytes instanceof Uint8Array)) {
        throw new SheetCamJobError('sheetcamJob.notBytes')
    }
    const { lines, binary } = splitJob(bytes)

    const rawVersion = getEntry(lines, 'Misc', 'FileVersion')
    const fileVersion = parseNumber(rawVersion)
    if (fileVersion === null || !SUPPORTED_JOB_VERSIONS.includes(fileVersion)) {
        throw new SheetCamJobError('sheetcamJob.unsupportedVersion', {
            version: rawVersion == null ? '?' : String(rawVersion),
            supported: SUPPORTED_JOB_VERSIONS.join(', '),
        })
    }

    const names = sectionNames(lines)
    const partIndexes = names
        .map((n) => /^Part (\d+)$/.exec(n))
        .filter(Boolean)
        .map((m) => Number(m[1]))
    if (!partIndexes.length) throw new SheetCamJobError('sheetcamJob.noParts')

    const parts = partIndexes.map((index) => {
        const s = `Part ${index}`
        const drawingFile = getEntry(lines, s, 'DrawingFile') || ''
        const operations = names
            .map((n) => new RegExp(`^Part ${index}/Operation(\\d+)$`).exec(n))
            .filter(Boolean)
            .map((m) => {
                const os = `Part ${index}/Operation${m[1]}`
                return {
                    index: Number(m[1]),
                    type: getEntry(lines, os, 'Type') || '',
                    name: getEntry(lines, os, 'Name') || '',
                    layer: getEntry(lines, os, 'Layer') || '',
                    tool: parseNumber(getEntry(lines, os, 'Tool')),
                    contourMethod: parseNumber(getEntry(lines, os, 'Contour method')),
                    // Amorces : LONGUEUR et TYPE seulement — la géométrie de
                    // l'amorce est dessinée par SheetCam au G-code (§7 de
                    // l'étude). Le lot J3 s'en sert pour PRÉDIRE la réserve.
                    leadIn: parseNumber(getEntry(lines, os, 'Lead in')),
                    leadInType: parseNumber(getEntry(lines, os, 'Lead in type')),
                    leadOut: parseNumber(getEntry(lines, os, 'Lead out')),
                    leadOutType: parseNumber(getEntry(lines, os, 'Lead out type')),
                    startPosition: parseNumber(getEntry(lines, os, 'Start position')),
                    enabled: getEntry(lines, os, 'Enabled') !== '0',
                }
            })
        return {
            index,
            name: getEntry(lines, s, 'name') || '',
            drawingFile,
            drawingName: jobDrawingName(drawingFile),
            drawingDate: getEntry(lines, s, 'DrawingDate'),
            xPos: parseNumber(getEntry(lines, s, 'XPos'), 0),
            yPos: parseNumber(getEntry(lines, s, 'YPos'), 0),
            angle: parseNumber(getEntry(lines, s, 'Angle'), 0),
            hRef: parseNumber(getEntry(lines, s, 'HRef'), 0),
            vRef: parseNumber(getEntry(lines, s, 'VRef'), 0),
            // −1 = original ; sinon le RANG de l'original copié (règle 4).
            copyOf: parseNumber(getEntry(lines, s, 'copyOf'), -1),
            enabled: getEntry(lines, s, 'enabled') !== '0',
            locked: getEntry(lines, s, 'Locked') === '1',
            operations,
        }
    })

    return {
        lines,
        binary,
        fileVersion,
        count: parseNumber(getEntry(lines, 'Misc', 'Count'), parts.length),
        optimisation: parseNumber(getEntry(lines, 'Misc', 'Optimisation'), 0),
        // Tôle : le rectangle de travail, en millimètres (le `.job` est en mm
        // comme tout notre pipeline, AGENTS #25).
        work: {
            x1: parseNumber(getEntry(lines, 'Work', 'X1'), 0),
            x2: parseNumber(getEntry(lines, 'Work', 'X2'), 0),
            y1: parseNumber(getEntry(lines, 'Work', 'Y1'), 0),
            y2: parseNumber(getEntry(lines, 'Work', 'Y2'), 0),
            thickness: parseNumber(getEntry(lines, 'Work', 'Thickness')),
        },
        // Kerf de l'outil : la largeur que le plasma mange. Le lot J3 en
        // déduit l'espacement pré-rempli (kerf + 2 × sécurité).
        kerfWidth: parseNumber(getEntry(lines, 'Tool0', 'Kerf width')),
        toolName: getEntry(lines, 'Tool0', 'Name') || '',
        // Les pièces ORIGINALES, dans l'ordre des rangs — cet ordre est celui
        // du bloc binaire, il ne se réarrange pas (règle 6).
        parts,
    }
}

/** Largeur et hauteur de la tôle lues dans `[Work]`. */
export function jobSheet(job) {
    return {
        width: Math.abs((job.work.x2 ?? 0) - (job.work.x1 ?? 0)),
        height: Math.abs((job.work.y2 ?? 0) - (job.work.y1 ?? 0)),
    }
}

// --- écriture --------------------------------------------------------------

/** Sérialise la forme préservée : lignes + CRLF, puis le bloc binaire COLLÉ
 *  au marqueur (aucun saut de ligne — mesuré). */
export function serializeSheetCamJob(job) {
    let text = ''
    for (const line of job.lines) {
        if (line.kind === 'section') text += `[${line.name}]\r\n`
        else if (line.kind === 'entry') text += `${line.key}=${line.value}\r\n`
        else text += `${line.text}\r\n`
    }
    const head = latin1ToBytes(text)
    const out = new Uint8Array(head.length + job.binary.length)
    out.set(head, 0)
    out.set(job.binary, head.length)
    return out
}

/** Copie profonde des lignes (l'écriture ne mute jamais le job lu). */
function cloneLines(lines) {
    return lines.map((l) => ({ ...l }))
}

/** Pose la valeur d'une clé existante d'une section ; rend false si la clé
 *  n'y est pas (on n'invente pas de clé dans un format qu'on ne maîtrise
 *  pas entièrement). */
function setEntry(lines, section, key, value) {
    let inside = false
    for (const line of lines) {
        if (line.kind === 'section') { inside = line.name === section; continue }
        if (inside && line.kind === 'entry' && line.key === key) {
            line.value = value
            return true
        }
    }
    return false
}

/** Remplace toutes les entrées d'une section par celles données (la section
 *  doit exister : `[OpOrder]` est présente, vide, dans les fichiers réels). */
function replaceSectionEntries(lines, section, entries) {
    const at = lines.findIndex((l) => l.kind === 'section' && l.name === section)
    if (at < 0) return false
    let end = at + 1
    while (end < lines.length && lines[end].kind !== 'section') end++
    lines.splice(at + 1, end - (at + 1), ...entries.map(([key, value]) => ({
        kind: 'entry', key, value,
    })))
    return true
}

/** Index de la ligne qui suit la dernière section `Part …`. */
function afterLastPartSection(lines) {
    let last = -1
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].kind === 'section' && /^Part \d+(\/|$)/.test(lines[i].name)) last = i
    }
    if (last < 0) return lines.length
    let end = last + 1
    while (end < lines.length && lines[end].kind !== 'section') end++
    return end
}

/**
 * Réécrit le `.job` avec de nouvelles poses, ses copies, son ordre de coupe.
 *
 * `placements` : une entrée par EXEMPLAIRE à écrire,
 * `{ part, xPos, yPos, angle, hRef, vRef }` où `part` est le rang de
 * l'original. Le PREMIER exemplaire d'un original réécrit sa section (le
 * rang, donc le lien vers le bloc binaire, est conservé — règle 6) ; les
 * suivants deviennent des sections `copyOf` ajoutées à la suite (règle 4).
 *
 * `order` : liste `[rangDePiece, rangDOperation]` écrite dans `[OpOrder]`,
 * plus `[Misc] Optimisation=3` — sans quoi l'optimiseur de trajet de
 * SheetCam impose le sien (règle 8).
 *
 * `maskPaths` (défaut vrai) : `DrawingFile` réduit au nom de fichier, pour
 * ne pas renvoyer à l'utilisateur le chemin absolu qu'il nous a confié
 * (règle 9). Le mettre à faux sert aux verrous de comparaison.
 */
export function writeNestedSheetCamJob(job, { placements, order = null, maskPaths = true } = {}) {
    if (!Array.isArray(placements) || placements.length === 0) {
        throw new SheetCamJobError('sheetcamJob.noPlacements')
    }
    const byPart = new Map()
    for (const p of placements) {
        const index = Number(p.part)
        const original = job.parts.find((q) => q.index === index && q.copyOf < 0)
        if (!original) {
            throw new SheetCamJobError('sheetcamJob.unknownPart', { part: String(p.part) })
        }
        if (!byPart.has(index)) byPart.set(index, [])
        byPart.get(index).push(p)
    }

    const lines = cloneLines(job.lines)

    // 1) les ORIGINAUX : première pose, à leur rang, jamais déplacés.
    for (const [index, poses] of byPart) {
        const s = `Part ${index}`
        const first = poses[0]
        setEntry(lines, s, 'XPos', formatJobNumber(first.xPos))
        setEntry(lines, s, 'YPos', formatJobNumber(first.yPos))
        setEntry(lines, s, 'Angle', formatJobNumber(first.angle))
        if (first.hRef != null) setEntry(lines, s, 'HRef', formatJobNumber(first.hRef))
        if (first.vRef != null) setEntry(lines, s, 'VRef', formatJobNumber(first.vRef))
    }

    // 2) les pièces NON posées restent en place mais sortent du job : on ne
    //    les supprime pas (leur rang porte le binaire), on les désactive.
    for (const part of job.parts) {
        if (part.copyOf < 0 && !byPart.has(part.index)) {
            setEntry(lines, `Part ${part.index}`, 'enabled', '0')
        }
    }

    // 3) les COPIES : une section par exemplaire supplémentaire, insérée
    //    après la dernière section `Part …` (l'ordre de QSettings n'est pas
    //    recalculable — voir l'en-tête).
    const existing = job.parts.map((p) => p.index)
    let nextIndex = existing.length ? Math.max(...existing) + 1 : 0
    const copies = []
    for (const [index, poses] of byPart) {
        const original = job.parts.find((q) => q.index === index)
        for (const pose of poses.slice(1)) {
            const rank = nextIndex++
            copies.push({ kind: 'section', name: `Part ${rank}` })
            // MÊMES clés, MÊME ordre que la section d'un original : c'est ce
            // que SheetCam écrit, et ce que le fichier de référence contient.
            copies.push(
                { kind: 'entry', key: 'Angle', value: formatJobNumber(pose.angle) },
                { kind: 'entry', key: 'copyOf', value: String(index) },
                { kind: 'entry', key: 'DrawingDate', value: original.drawingDate ?? '0' },
                { kind: 'entry', key: 'DrawingFile', value: original.drawingFile },
                { kind: 'entry', key: 'enabled', value: '1' },
                { kind: 'entry', key: 'HRef', value: formatJobNumber(pose.hRef ?? original.hRef ?? 0) },
                { kind: 'entry', key: 'Locked', value: '0' },
                { kind: 'entry', key: 'name', value: original.name },
                { kind: 'entry', key: 'VRef', value: formatJobNumber(pose.vRef ?? original.vRef ?? 0) },
                { kind: 'entry', key: 'XPos', value: formatJobNumber(pose.xPos) },
                { kind: 'entry', key: 'YPos', value: formatJobNumber(pose.yPos) },
            )
        }
    }
    if (copies.length) lines.splice(afterLastPartSection(lines), 0, ...copies)

    // 4) `Count` = originaux (toutes sections `Part N` d'origine) + copies.
    setEntry(lines, 'Misc', 'Count', String(job.parts.length + copies.filter(
        (l) => l.kind === 'section').length))

    // 5) l'ordre de coupe.
    if (order && order.length) {
        setEntry(lines, 'Misc', 'Optimisation', String(OPTIMISATION_MANUAL_KEEP_PARTS))
        replaceSectionEntries(lines, 'OpOrder', order.map(([part, op], k) => [
            `Op${String(k).padStart(6, '0')}`, `${part},${op}`,
        ]))
    }

    // 6) chemins masqués (règle 9) — après les copies, pour couvrir les deux.
    if (maskPaths) {
        for (const line of lines) {
            if (line.kind === 'entry' && line.key === 'DrawingFile') {
                line.value = jobDrawingName(line.value)
            }
        }
    }

    return serializeSheetCamJob({ ...job, lines })
}
