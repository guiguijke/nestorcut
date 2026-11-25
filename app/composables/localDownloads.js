/**
 * PR5 (Phase 5, J-082) : téléchargements 100 % navigateur depuis le record
 * IndexedDB — contenus PERSISTÉS au solve (aucune régénération, aucun
 * réseau : relecture et téléchargements hors-ligne). Parité des noms avec le
 * chemin serveur : DXF `{slug}_alt{r}_part_{n}.dxf`, ZIP `nesting-{slug}.zip`
 * contenant les DXF de la meilleure alternative (comme la route zip serveur).
 *
 * O2/d4 (02/11) : POINT D'ÉTRANGLEMENT du verrou des tôles côté navigateur.
 * Chaque export prend un dernier paramètre `{ maxSheet }` (numéro de tôle le
 * plus haut téléchargeable, lu dans le NOM du fichier — jamais l'index).
 * Ouvert par défaut (Infinity) pour ne pas casser les appelants hérités ; le
 * test statique de localDownloads.test.js exige que CHAQUE appelant de l'app
 * le passe. Aucun composable Nuxt ici : le module est testé en node.
 *
 * Essai Free d'une tôle importée (20/11) : si le record porte une tôle
 * importée (rapport stocké, `alternativesHoldImportedSheet`) et que le
 * plafond reçu est FINI (compte verrouillé), le plafond tombe à 0 : aucun
 * fichier de coupe du job (DXF, ZIP, .job) n'est livré, quels que soient les
 * numéros de tôle. C'est un verrou d'INTERFACE sur un projet local : les
 * fichiers vivent dans le navigateur (IndexedDB), un utilisateur outillé peut
 * le contourner, comme le verrou des 2 premières tôles (AGENTS #63, J-057).
 * Il vit ICI, au point d'étranglement, pour qu'un appelant qui oublie la
 * règle ne livre pas tout ; un compte ouvert (Infinity) n'est pas touché.
 */
import { zipSync, strToU8 } from 'fflate'
import {
    effectiveSheetCap,
    isSheetFileAllowed,
    sheetNumberFromFileName,
} from '~~/shared/constants/sheetDownload.constants'
import { alternativesHoldImportedSheet, recordHoldsImportedSheet } from '~/utils/sheetDownloadGate'
import { DXF_ORIGIN_UNSUPPORTED, dxfUnitScale, shiftDxf } from '~/utils/dxfOrigin'
import { positionsCsv, storedCentre } from '~/utils/partPositions'

// Deux signaux : le rapport stocké, ET la frame finale du record (binFormats)
// qui survit à un rapport en échec.
const capFor = (record, maxSheet) =>
    effectiveSheetCap(
        maxSheet,
        alternativesHoldImportedSheet(record?.alternatives) || recordHoldsImportedSheet(record),
    )

function download(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const text = (s, type = 'text/plain') => new Blob([s], { type })

/**
 * Origine du fichier livré (lot positions). 'corner' (défaut) : le fichier
 * stocké, octet pour octet, sous son nom. 'center' : le même fichier dont le
 * centre de SA tôle devient (0, 0) (`shiftDxf`), nom en `_center`.
 * Le verrou lit toujours le nom STOCKÉ ; si le recentrage est impossible
 * (`dxf_origin_unsupported`), RIEN n'est livré : jamais un fichier au coin
 * quand le centre est demandé.
 */
const isCenter = (origin) => origin === 'center'
const centerName = (name) => (/\.dxf$/i.test(name) ? name.replace(/\.dxf$/i, '_center.dxf') : `${name}_center`)

/** Boîte (mm) de la tôle d'un DXF : celle STOCKÉE à la finalisation, sinon, pour
 * un record plus ancien, les dimensions du rapport — retrouvées par le NUMÉRO
 * de tôle du nom de fichier (`_part_N`), jamais par la place dans le tableau
 * (`dxfs[]` saute les tôles sans DXF). null si aucune n'est lisible. */
function sheetBoxOf(alt, dxf) {
    const ok = (w, h) => Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
    if (Array.isArray(dxf?.box) && ok(dxf.box[0], dxf.box[1])) return [dxf.box[0], dxf.box[1]]
    const n = sheetNumberFromFileName(dxf?.fileName)
    if (n == null || !Array.isArray(alt?.report?.sheets)) return null
    const sheet = alt.report.sheets.find((s) => s?.index === n - 1)
    const w = Number(sheet?.widthMm)
    const h = Number(sheet?.heightMm)
    return ok(w, h) ? [w, h] : null
}

/** Contenu du DXF avec le centre de sa tôle en (0, 0). Lève
 * `dxf_origin_unsupported` (boîte inconnue, unité ou structure illisible). */
function centeredContent(alt, dxf) {
    const centre = storedCentre(dxf?.center, sheetBoxOf(alt, dxf))
    if (!centre) throw new Error(DXF_ORIGIN_UNSUPPORTED)
    // L'unité du fichier (mm ou pouces) se lit dans SON en-tête : un record
    // ancien n'a pas gardé l'unité de sortie.
    const k = dxfUnitScale(dxf.content)
    return shiftDxf(dxf.content, centre[0] * k, centre[1] * k)
}

/** DXF combiné d'une tôle d'une alternative du record. Une tôle au-delà de
 * `maxSheet` (lue dans le nom) lève `sheet_locked` : rien n'est livré. */
export function downloadLocalDxf(record, altId = 0, sheetIndex = 0, { maxSheet = Infinity, origin = 'corner' } = {}) {
    const alt = (record?.alternatives || [])[altId]
    const dxf = alt?.dxfs?.[sheetIndex]
    if (!dxf?.content) throw new Error('dxf_unavailable')
    if (!isSheetFileAllowed(dxf.fileName, capFor(record, maxSheet))) throw new Error('sheet_locked')
    const name = dxf.fileName || `${record.slug}.dxf`
    if (isCenter(origin)) {
        download(text(centeredContent(alt, dxf), 'image/vnd.dxf'), centerName(name))
        return
    }
    download(text(dxf.content, 'image/vnd.dxf'), name)
}

/** ZIP de la meilleure alternative (DXF combinés par tôle) — mêmes fichiers
 * et même nom d'archive que la route zip serveur (dxf_files de la best).
 * D4/D5 (02/11) : toujours l'alternative 0 ; les tôles au-delà de `maxSheet`
 * sont écartées et l'archive partielle s'appelle
 * `nesting-{slug}-sheets-1-{maxSheet}.zip` (même nom que la route serveur). */
export function downloadLocalZip(record, filename = null, { maxSheet = Infinity, origin = 'corner' } = {}) {
    const best = (record?.alternatives || [])[0]
    const cap = capFor(record, maxSheet)
    if (cap <= 0) throw new Error('sheet_locked')
    const center = isCenter(origin)
    const files = {}
    let skipped = 0
    for (const dxf of best?.dxfs || []) {
        if (!dxf?.content) continue
        if (!isSheetFileAllowed(dxf.fileName, cap)) {
            skipped++
            continue
        }
        // Centre demandé : TOUS les fichiers de l'archive sont recentrés avant
        // qu'elle parte (un seul qui échoue, et rien n'est livré).
        if (center) files[centerName(dxf.fileName)] = centeredContent(best, dxf)
        else files[dxf.fileName] = dxf.content
    }
    if (!Object.keys(files).length) throw new Error('zip_empty')
    const data = {}
    for (const [name, content] of Object.entries(files)) {
        data[name] = strToU8(content)
    }
    const zipped = zipSync(data, { level: 6 })
    const suffix = center ? '-center' : ''
    const defaultName = skipped > 0
        ? `nesting-${record.slug}-sheets-1-${cap}${suffix}.zip`
        : `nesting-${record.slug}${suffix}.zip`
    download(new Blob([zipped], { type: 'application/zip' }), filename || defaultName)
}

/**
 * `.job` SheetCam d'une tôle — lot J4.
 *
 * LE `.job` EST BINAIRE : il porte un bloc de géométrie en cache après
 * `[BinaryDataStart]`, recopié octet pour octet par le lot J1. Il passe donc
 * DIRECTEMENT au `Blob` en `Uint8Array` — jamais par le helper `text()`
 * ci-dessus, qui forcerait une chaîne et corromprait ce bloc (SheetCam ne
 * retrouverait plus ses dessins).
 *
 * D23 (02/11) : le verrou d'un `.job` se lit dans SON nom (`_toleN.job`).
 */
export function downloadLocalJob(record, altId = 0, sheetIndex = 0, { maxSheet = Infinity } = {}) {
    const alt = (record?.alternatives || [])[altId]
    const job = alt?.jobs?.[sheetIndex]
    if (!job?.bytes) throw new Error('job_unavailable')
    const name = job.fileName || `${record.slug}_tole${sheetIndex + 1}.job`
    if (!isSheetFileAllowed(name, capFor(record, maxSheet))) throw new Error('sheet_locked')
    const bytes = job.bytes instanceof Uint8Array ? job.bytes : new Uint8Array(job.bytes)
    download(new Blob([bytes], { type: 'application/octet-stream' }), name)
}

/**
 * Lot J8-a — TOUS les `.job` de la meilleure alternative, un par tôle, en
 * un seul clic. L'asymétrie mesurée (§9.73) : le DXF avait son « tout
 * télécharger » (zip) et le `.job` exigeait de changer d'onglet et de
 * recliquer une fois par tôle. Chaque fichier garde SON nom (`…_toleK.job`)
 * — pas d'archive : un `.job` s'ouvre tel quel dans SheetCam.
 *
 * O2 (02/11) : un `.job` au-delà de `maxSheet` est sauté — l'interface dit
 * « les N premiers » et propose le déblocage à côté.
 */
export function downloadLocalJobs(record, altId = 0, { maxSheet = Infinity } = {}) {
    const jobs = (record?.alternatives || [])[altId]?.jobs || []
    if (!jobs.length) throw new Error('job_unavailable')
    const cap = capFor(record, maxSheet)
    if (cap <= 0) throw new Error('sheet_locked')
    let k = 0
    for (const job of jobs) {
        if (!job?.bytes) continue
        const name = job.fileName || `${record.slug}_tole${k + 1}.job`
        if (!isSheetFileAllowed(name, cap)) continue
        const bytes = job.bytes instanceof Uint8Array ? job.bytes : new Uint8Array(job.bytes)
        // Étalés de ~300 ms : les navigateurs bloquent les rafales de
        // téléchargements — le premier partirait, les suivants non.
        const blob = new Blob([bytes], { type: 'application/octet-stream' })
        setTimeout(() => download(blob, name), k * 300)
        k++
    }
    if (!k) throw new Error('job_unavailable')
}

/** Téléchargement principal (bouton carte/modal) : DXF seul en mono-tôle,
 * ZIP en multi-tôles — même comportement que les boutons serveur. */
export function downloadLocalResult(record, altId = 0, { maxSheet = Infinity, origin = 'corner' } = {}) {
    const alt = (record?.alternatives || [])[altId]
    if (!alt) throw new Error('result_unavailable')
    if ((alt.layoutCount ?? (alt.dxfs?.length || 0)) > 1) {
        downloadLocalZip(record, null, { maxSheet, origin })
    } else {
        downloadLocalDxf(record, altId, 0, { maxSheet, origin })
    }
}

/**
 * CSV des positions des pièces (fichier, X, Y, diamètre) de l'alternative à
 * l'écran — lot positions. Même verrou que les fichiers de coupe : un compte
 * verrouillé n'a que les tôles autorisées ; plafond 0 (tôle importée, compte
 * Free) -> `sheet_locked`. Les lignes viennent du record (calculées à la
 * finalisation, jamais envoyées au serveur) ; un record d'avant n'en a pas :
 * `positions_unavailable`. `origin` : 'corner' (le zéro des DXF livrés) ou
 * 'center' (centre de CHAQUE tôle, comme le DXF recentré). `headers` : libellés
 * des colonnes (i18n, fournis par l'écran).
 */
export function downloadLocalPositions(record, altId = 0, {
    maxSheet = Infinity, origin = 'corner', headers, nameOf,
} = {}) {
    const alt = (record?.alternatives || [])[altId]
    const all = alt?.positions
    if (!Array.isArray(all) || !all.length) throw new Error('positions_unavailable')
    const cap = capFor(record, maxSheet)
    if (cap <= 0) throw new Error('sheet_locked')
    const sheets = all.filter((s) => isSheetFileAllowed(`x_part_${s.sheet}.dxf`, cap))
    if (!sheets.length) throw new Error('sheet_locked')
    // Noms affichés gardés au calcul ; le mappeur de l'appelant passe devant.
    const names = alt.fileNames || {}
    const csv = positionsCsv({
        sheets,
        origin: isCenter(origin) ? 'center' : 'corner',
        unit: alt.outputUnit === 'inch' ? 'inch' : 'mm',
        nameOf: (slug) => (typeof nameOf === 'function' ? nameOf(slug) : null) || names[slug] || slug,
        headers,
    })
    const slug = String(record.slug || 'job').replace(/[^a-zA-Z0-9_-]+/g, '-')
    download(
        text(csv, 'text/csv;charset=utf-8'),
        // Même jeton 0-based que les DXF (`{slug}_alt{rang}_part_N.dxf`) ; un fichier
        // amputé par le plafond le dit, comme l'archive (`-sheets-1-N`).
        `${slug}_alt${altId}_positions${sheets.length < all.length ? `_sheets-1-${cap}` : ''}${isCenter(origin) ? '_center' : ''}.csv`,
    )
}
