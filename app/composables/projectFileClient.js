/**
 * Fichier de projet `.nestorcut` côté navigateur (note du coffre « Fichier de
 * projet nestorcut ») : enregistrer le projet « Cet appareil » ouvert, et
 * rouvrir un fichier en NOUVEAU projet « Cet appareil ». Le format, ses
 * empreintes et ses contrôles sont dans utils/projectFile.js.
 *
 * Le serveur ne voit que la création `{ local: true }` d'un projet neuf (et sa
 * suppression si l'ouverture échoue à mi-chemin) : ni le nom du fichier, ni le
 * titre, ni le dessin, comme pour tout projet « Cet appareil ».
 *
 * Imports dynamiques relatifs, comme projects.js : IndexedDB et fflate ne se
 * chargent qu'au clic, jamais au rendu serveur.
 */
import { API_ROUTES } from './apiRoutes'

/** Clé i18n d'un refus à l'ouverture, selon le code de ProjectFileError (sinon échec générique). */
export function projectFileErrorKey(err) {
    switch (err?.code) {
        case 'not_project': return 'projectFile.error.notProject'
        case 'too_new': return 'projectFile.error.tooNew'
        case 'damaged': return 'projectFile.error.damaged'
        case 'invalid': return 'projectFile.error.invalid'
        case 'too_large': return 'projectFile.error.tooLarge'
        default: return 'projectFile.error.open'
    }
}

function download(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Construit le fichier du projet « Cet appareil » `slug` et le télécharge.
 *
 * @param {object} args
 * @param {string} args.slug         slug du projet (clé IndexedDB des fiches et tôles)
 * @param {string} args.title        titre affiché (nom du fichier proposé)
 * @param {string} args.unit         unité d'affichage
 * @param {string} args.appVersion
 * @param {{ params: object, paramsUnit: string, files: {slug: string, count: number, rotation: (string|null)}[] }} args.settings
 *        filesStore.actions.projectFileSettings()
 * @returns {Promise<{ filename: string, bytes: number }>}
 */
export async function saveProjectFile({ slug, title, unit, appVersion, settings }) {
    const { getLocalFile } = await import('./localFilesStore')
    const { listProjectSheets } = await import('./localSheetsStore')
    const { writeProjectFile, readProjectFile, materializeProject, projectFileName, ProjectFileError } = await import('../utils/projectFile')
    const { makeSheetRecord } = await import('../utils/sheetShape')
    const pieces = []
    for (const file of settings.files) {
        const record = await getLocalFile(file.slug)
        // Une fiche affichée mais absente du navigateur (stockage vidé entre-temps) :
        // jamais un fichier qui manquerait des pièces sans le dire.
        if (!record || record.projectSlug !== slug) throw new ProjectFileError('invalid', 'piece_missing')
        pieces.push({ record, count: file.count, rotation: file.rotation })
    }
    const sheets = await listProjectSheets(slug)
    const bytes = await writeProjectFile({
        title,
        appVersion,
        savedAt: new Date().toISOString(),
        unit,
        params: settings.params,
        paramsUnit: settings.paramsUnit,
        pieces,
        sheets,
    })
    // Relu comme à l'ouverture avant d'être donné : jamais un fichier enregistré
    // sans erreur puis refusé le jour où on en a besoin (bornes, valeurs).
    let n = 0
    materializeProject(await readProjectFile(bytes), {
        projectSlug: '',
        newFileSlug: () => `f-check${++n}`,
        newSheetSlug: () => `sheet-check${++n}`,
        makeSheetRecord,
        snapshotVersion: 0,
    })
    const filename = projectFileName(title)
    download(bytes, filename)
    return { filename, bytes: bytes.byteLength }
}

/**
 * Ouvre un fichier `.nestorcut` en nouveau projet « Cet appareil ». Tout est
 * lu et contrôlé AVANT de créer le projet ; si l'écriture dans le navigateur
 * échoue ensuite, le projet créé est supprimé (jamais de projet à moitié).
 *
 * @param {File|Blob} file
 * @param {{ seedProjectSnapshot: (path: string, snap: object) => void }} deps
 *        filesStore.actions.seedProjectSnapshot
 * @returns {Promise<{ slug: string }>}
 * @throws {ProjectFileError|Error}
 */
export async function openProjectFile(file, { seedProjectSnapshot }) {
    const { readProjectFile, materializeProject, PROJECT_FILE_LIMITS, ProjectFileError } = await import('../utils/projectFile')
    const { makeSheetRecord } = await import('../utils/sheetShape')
    const { newSheetSlug } = await import('../utils/sheetImportModel')
    const { SNAPSHOT_VERSION } = await import('../utils/projectSnapshot')
    const { makeLocalFileSlug } = await import('./localFilesStore')

    // La taille avant la lecture : un fichier énorme n'est jamais chargé en mémoire.
    if (Number(file.size) > PROJECT_FILE_LIMITS.fileBytes) throw new ProjectFileError('too_large', 'file')
    const project = await readProjectFile(new Uint8Array(await file.arrayBuffer()))
    // Contrôle complet (tôles reconstruites comprises) avant toute requête :
    // un fichier refusé ne crée rien, même pas un projet vide.
    const out = materializeProject(project, {
        projectSlug: '',
        newFileSlug: makeLocalFileSlug,
        newSheetSlug: () => newSheetSlug(Date.now(), Math.random()),
        makeSheetRecord,
        snapshotVersion: SNAPSHOT_VERSION,
    })

    const data = await $fetch(API_ROUTES.PROJECT(), { method: 'POST', body: { local: true } })
    try {
        const { saveLocalFile } = await import('./localFilesStore')
        const { saveSheet } = await import('./localSheetsStore')
        for (const record of out.sheetRecords) await saveSheet({ ...record, projectSlug: data.slug })
        for (const record of out.fileRecords) await saveLocalFile({ ...record, projectSlug: data.slug })
        seedProjectSnapshot(API_ROUTES.PROJECT(data.slug), out.snapshot)
    } catch (err) {
        // Retour arrière : le projet serveur, puis ce que le navigateur a reçu.
        // deleteProject ne purge le navigateur qu'après un 200 : la purge est
        // refaite ici, quoi que réponde le serveur.
        try {
            const { deleteProject } = await import('./projects')
            await deleteProject({ slug: data.slug, local: true })
        } catch {
            // Le projet reste dans la liste ; l'utilisateur peut le supprimer.
        }
        try {
            const { purgeProjectFiles } = await import('./localFilesStore')
            const { deleteProjectSheets } = await import('./localSheetsStore')
            await purgeProjectFiles(data.slug)
            await deleteProjectSheets(data.slug)
        } catch {
            // Stockage indisponible : rien de plus à faire ici.
        }
        throw err
    }
    return { slug: data.slug }
}
