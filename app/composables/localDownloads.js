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
 */
import { zipSync, strToU8 } from 'fflate'
import { isSheetFileAllowed } from '~~/shared/constants/sheetDownload.constants'

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

/** DXF combiné d'une tôle d'une alternative du record. Une tôle au-delà de
 * `maxSheet` (lue dans le nom) lève `sheet_locked` : rien n'est livré. */
export function downloadLocalDxf(record, altId = 0, sheetIndex = 0, { maxSheet = Infinity } = {}) {
    const alt = (record?.alternatives || [])[altId]
    const dxf = alt?.dxfs?.[sheetIndex]
    if (!dxf?.content) throw new Error('dxf_unavailable')
    if (!isSheetFileAllowed(dxf.fileName, maxSheet)) throw new Error('sheet_locked')
    download(text(dxf.content, 'image/vnd.dxf'), dxf.fileName || `${record.slug}.dxf`)
}

/** ZIP de la meilleure alternative (DXF combinés par tôle) — mêmes fichiers
 * et même nom d'archive que la route zip serveur (dxf_files de la best).
 * D4/D5 (02/11) : toujours l'alternative 0 ; les tôles au-delà de `maxSheet`
 * sont écartées et l'archive partielle s'appelle
 * `nesting-{slug}-sheets-1-{maxSheet}.zip` (même nom que la route serveur). */
export function downloadLocalZip(record, filename = null, { maxSheet = Infinity } = {}) {
    const best = (record?.alternatives || [])[0]
    const files = {}
    let skipped = 0
    for (const dxf of best?.dxfs || []) {
        if (!dxf?.content) continue
        if (!isSheetFileAllowed(dxf.fileName, maxSheet)) {
            skipped++
            continue
        }
        files[dxf.fileName] = dxf.content
    }
    if (!Object.keys(files).length) throw new Error('zip_empty')
    const data = {}
    for (const [name, content] of Object.entries(files)) {
        data[name] = strToU8(content)
    }
    const zipped = zipSync(data, { level: 6 })
    const defaultName = skipped > 0
        ? `nesting-${record.slug}-sheets-1-${maxSheet}.zip`
        : `nesting-${record.slug}.zip`
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
    if (!isSheetFileAllowed(name, maxSheet)) throw new Error('sheet_locked')
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
    let k = 0
    for (const job of jobs) {
        if (!job?.bytes) continue
        const name = job.fileName || `${record.slug}_tole${k + 1}.job`
        if (!isSheetFileAllowed(name, maxSheet)) continue
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
export function downloadLocalResult(record, altId = 0, { maxSheet = Infinity } = {}) {
    const alt = (record?.alternatives || [])[altId]
    if (!alt) throw new Error('result_unavailable')
    if ((alt.layoutCount ?? (alt.dxfs?.length || 0)) > 1) {
        downloadLocalZip(record, null, { maxSheet })
    } else {
        downloadLocalDxf(record, altId, 0, { maxSheet })
    }
}
