
import { computed, reactive, readonly } from 'vue'
import { processingType } from '~~/constants/files.constants'
import { convertInputValue, displayToMm, mmToDisplay, DEFAULT_SHEET, equivalentSheetPreset, MM_PER_INCH } from '~/utils/units'
import { spacingFromKerfSafety, withKerfDefaults } from '~/utils/spacingParams'
import { getUnitState } from '~/composables/useUnit'
import { MAX_UPLOAD_FILES } from '~~/shared/constants/upload.constants'

const { actions } = globalStore
const { getProjects, setModalNestData } = actions

/**
 * Factory defaults for the nesting form (display-unit strings, mm factory).
 * Extracted so a project switch can RESET to a clean form without leaking
 * the previous project's (or the demo's) settings.
 */
function factoryParams() {
    return {
        sheets: [{ width: '1000', height: '2000', count: '1' }],
        // B.4 / masterplan 3.10 : l'espacement est porté par deux réglages
        // explicites — kerf (largeur de coupe de l'outil) et sécurité
        // (marge gardée autour de chaque pièce). `space` reste LA clé
        // envoyée à l'API/moteur (contrat inchangé, jobs en base
        // intacts) et vaut 2 × kerf + sécurité depuis le 13/09 (étude
        // SheetCam §9.40 : la bande de kerf déborde d'un kerf ENTIER hors de
        // chaque pièce). Défaut usine 2 mm, INCHANGÉ (B.4 : 0,1 mm était
        // irréaliste) — c'est la sécurité qui le porte désormais.
        kerf: '0',
        safety: '2',
        space: '2',
        addOutShape: false,
        // Allow nesting smaller parts inside the cutouts of holed parts
        // (engine opens them with a hairline channel; off = sealed cutouts).
        fillHoles: true,
        rotationCount: 4,
        // D-MOT-5 amendé : 1 sens = 1 layout (le meilleur). Cocher plus
        // de sens = plus de propositions.
        directions: ['left'],
    }
}

// Cloisonnement par projet (QA 2026-08-30 : changer de projet pendant un
// nesting RÉINITIALISAIT les quantités saisies et laissait les params
// fuiter d'un projet à l'autre — la démo écrasait les réglages des vrais
// projets). Snapshot par slug : params (+ leur unité d'expression) et
// quantités/rotations par fichier — sauvegardé en quittant le projet,
// restauré en y revenant. Les fichiers sont rechargés depuis le serveur ;
// seul le choix utilisateur est snapshoté.
const projectSnapshots = new Map()
const PROJECT_SNAPSHOT_MAX = 20
// Backing sessionStorage : un RECHARGEMENT complet (F5, lien externe) vide
// la Map module — le sessionStorage la restitue (durée de vie = l'onglet,
// les bons semantics pour des brouillons de réglages).
const SNAPSHOT_STORAGE_KEY = 'nestorcut:projectSnapshots'
function loadSnapshotsFromStorage() {
    if (typeof sessionStorage === 'undefined') return
    try {
        const raw = sessionStorage.getItem(SNAPSHOT_STORAGE_KEY)
        if (!raw) return
        for (const [slug, snap] of Object.entries(JSON.parse(raw))) {
            projectSnapshots.set(slug, snap)
        }
    } catch { /* stockage indisponible/corrompu : mémoire seule */ }
}
function persistSnapshotsToStorage() {
    if (typeof sessionStorage === 'undefined') return
    try {
        sessionStorage.setItem(
            SNAPSHOT_STORAGE_KEY,
            JSON.stringify(Object.fromEntries(projectSnapshots))
        )
    } catch { /* quota plein : mémoire seule */ }
}
loadSnapshotsFromStorage()

// Posé par la page (démo) juste après avoir appliqué ses défauts curated
// au montage : setProjectFiles (async, APRÈS le setup) ne doit alors pas
// écraser ces params par les défauts d'usine — première visite seulement.
// Une fois le projet chargé, le drapeau est consommé ; au RETOUR sur le
// projet, c'est le snapshot qui gagne (les curated defaults ne repassent
// pas par-dessus les réglages de l'utilisateur).
let pendingCuratedDefaults = false
function markCuratedDefaults() {
    pendingCuratedDefaults = true
}

function snapshotCurrentProject() {
    if (state.projectSlug == null) return
    projectSnapshots.set(state.projectSlug, {
        params: JSON.parse(JSON.stringify(state.params)),
        paramsUnit,
        countBySlug: Object.fromEntries(
            (state.projectFiles || []).map((file) => [file.slug, file.count])
        ),
        rotationBySlug: Object.fromEntries(
            (state.projectFiles || []).map((file) => [file.slug, file.rotation])
        ),
    })
    if (projectSnapshots.size > PROJECT_SNAPSHOT_MAX) {
        projectSnapshots.delete(projectSnapshots.keys().next().value)
    }
    persistSnapshotsToStorage()
}

// R-7 (audit 2026-08-31 §R-6) : la persistance ne se déclenchait qu'au
// CHANGEMENT de projet — un F5 SANS navigation préalable ramenait les
// défauts d'usine (et au retour sur un projet déjà snapshoté, l'ANCIEN
// snapshot). Débounce sur chaque mutation des réglages/quantités, plus
// pagehide en filet de sécurité (charge d'onglet, F5).
let snapshotPersistTimer = null
function scheduleSnapshotPersist() {
    if (snapshotPersistTimer) clearTimeout(snapshotPersistTimer)
    snapshotPersistTimer = setTimeout(() => {
        snapshotPersistTimer = null
        snapshotCurrentProject()
    }, 500)
}
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', snapshotCurrentProject)
}

const state = reactive({
    projectFiles: null,
    projectSlug: null,
    projectName: '',
    projectDemo: false,
    // J-090 : projet « 100 % privé » — fichiers en IndexedDB, jamais uploadés.
    projectLocal: false,
    // Clé i18n de la dernière erreur d'import navigateur (affichée en page).
    localImportError: '',
    localImportErrorParams: {},
    // Lot J10-a : INFORMATION de dépôt (zone d'exclusion déclarée) —
    // distincte de l'erreur : le travail se fait, l'atelier est PRÉVENU.
    localImportNotice: '',
    localImportNoticeParams: {},
    lastParams: '',
    // Set when a demo nesting hits the monthly demo quota — shown on the
    // project page instead of the paywall (demo 402s are reason=demo_quota).
    demoQuotaReached: false,
    // Set when the server-side free sheet cap actually fired (403
    // sheet_cap_exceeded) — defense-in-depth: the project page mirror
    // normally disables the launch before this can happen.
    sheetCapError: false,
    // R-2 (audit 2026-08-31 §R-1) : clé i18n de la dernière erreur de
    // soumission non gérée ailleurs (409 concurrent_limit, 5xx…) — avant,
    // l'erreur était avalée ET lastParams marqué → bouton grisé muet.
    nestError: '',
    // Z1 (vérif 2026-09-05) : payload structuré du refus 422 capacité
    // (aire gonflée > seuil) — {reason, ratio, sheetsNeeded,
    // maxPartsAtSpacing, maxSpacingForFitMm} pour le bandeau à leviers.
    nestUnfit: null,
    // Soumission en vol : bloque le double-clic pendant la latence du POST
    // (2 requêtes = 2 charges possibles chez un Free, cf. R-1 serveur).
    nestBusy: false,
    params: factoryParams(),
    isSvgLoaded: computed(
        () =>
            state.projectFiles?.every(
                (file) => file.processingStatus !== processingType.inProgress
            ) || false
    ),
    filesStatusDone: computed(
        () =>
            state.projectFiles?.filter(
                (file) => file.processingStatus === processingType.done
            ) || []
    ),
    filesToNest: computed(() =>
        state.filesStatusDone.map((file) => ({
            slug: file.slug,
            count: file.count,
            // Per-file rotation override wins; otherwise use the global setting.
            rotation: file.rotation || JSON.stringify(buildRotationAngles(Number(state.params.rotationCount))),
            // Projet 100 % privé : pas de `name` — le serveur n'en a pas
            // besoin (quota + slugs opaques suffisent). Le libellé reste
            // dans IndexedDB, affiché ici seulement.
        }))
    ),
    currentFilesSlug: computed(
        () => new Set(state.projectFiles?.map((file) => file.slug) || [])
    ),
    // Nom honnête (m-7 audit 2026-08-31 §R-m.7) : ce computed vaut « les
    // paramètres sont INVALIDES » — l'ancien nom isValidParams (sémantique
    // inversée) était un piège de maintenance.
    isInvalidParams: computed(() => {
        const sheets = normalizedSheets(state.params)
        if (sheets.length === 0) return false
        const invalid = sheets.some(
            (sheet) =>
                !isValidNumber(sheet.width) ||
                !isValidNumber(sheet.height) ||
                !/^\d+$/.test(String(sheet.count)) ||
                Number(sheet.count) < 1
        )
        return invalid || !isValidNumber(state.params.space)
    }),
    requestBody: computed(() => {
        const sheets = normalizedSheets(state.params)
        const first = sheets[0] || { width: 0, height: 0, count: 0 }
        // Params hold DISPLAY-unit strings (the user's preferred unit) — the
        // API and the whole pipeline speak canonical mm, so convert here,
        // at the boundary.
        const unit = getUnitState()
        const toMm = (v) => displayToMm(Number(v), unit)
        return JSON.stringify({
            files: state.filesToNest,
            params: {
                sheets: sheets.map((sheet) => ({
                    width: toMm(sheet.width),
                    height: toMm(sheet.height),
                    count: Number(sheet.count),
                })),
                // Legacy mirror of the first sheet — older workers/APIs only
                // understand width/height/sheetCount.
                width: toMm(first.width),
                height: toMm(first.height),
                sheetCount: Number(first.count),
                tolerance: Number(state.params.tolerance),
                space: toMm(state.params.space),
                addOutShape: state.params.addOutShape,
                fillHoles: state.params.fillHoles !== false,
                rotationCount: Number(state.params.rotationCount),
                // Layout directions to optimize towards (server re-validates
                // against the tier allowance); undefined = server default.
                directions: Array.isArray(state.params.directions) && state.params.directions.length
                    ? state.params.directions
                    : undefined,
                // Demo-only: 1 / 4 / 8 walks (Free / Unlimited / Pro preview).
                // Server allow-lists; ignored on non-demo jobs.
                demoWalks: state.params.demoWalks != null
                    ? Number(state.params.demoWalks)
                    : undefined,
            }
        })
    })
})

let updateTimer

// J-090 : fichiers déposés sur la home à la création d'un projet « 100 %
// privé » — la page projet les consomme à l'arrivée pour l'import navigateur
// (module state : des File objects ne survivent pas une navigation).
let pendingLocalFiles = []
function setPendingLocalFiles(files) {
    pendingLocalFiles = Array.isArray(files) ? files : []
}
function consumePendingLocalFiles() {
    const files = pendingLocalFiles
    pendingLocalFiles = []
    return files
}

// Keep polling the project while any uploaded file is still being processed
// by the file processing worker, so the UI flips from a loader to the
// selectable file as soon as processing completes.
function scheduleFilesRefresh(path) {
    if (updateTimer) {
        clearTimeout(updateTimer)
        updateTimer = null
    }
    const hasProcessing = (state.projectFiles || []).some(
        (file) => file.processingStatus === processingType.inProgress
    )
    // Only re-poll if we are still on the same project — otherwise the timer
    // would keep fetching the previous project after navigating away.
    if (hasProcessing && path && path === state.projectSlug) {
        updateTimer = setTimeout(() => getProject(path), 5000)
    }
}

// m-6 (audit 2026-08-31 §R-m.6) : sur navigation rapide, la réponse la plus
// LENTE gagnait et collait les fichiers/params d'un AUTRE projet sur l'URL
// courante. On ne retient que la réponse de la dernière demande émise.
let lastProjectRequest = null

async function getProject(path, fetchOpts = {}) {
    lastProjectRequest = path
    try {
        // SSR: the caller (page setup) passes useRequestHeaders(['cookie'])
        // — useApiFetch() inside this store action has no Nuxt context
        // (watch/async) and 401'd → navigateTo('/home') on F5.
        const data = await $fetch(path, fetchOpts)
        if (path !== lastProjectRequest) return
        state.projectLocal = Boolean(data.local)
        state.projectDemo = Boolean(data.isDemo)
        if (data.local) {
            // J-090 : les fichiers d'un projet « 100 % privé » vivent dans
            // IndexedDB — le serveur ne sert que le nom/slug du projet.
            // SSR : pas d'IndexedDB — poser le slug/nom et laisser le
            // client hydrater. Sans ça F5 bounce vers /home (constat P4).
            if (import.meta.server) {
                setProjectFiles([], path)
                setProjectName(data.name || '')
                return
            }
            const { listLocalFiles } = await import('./localFilesStore')
            const { localRecordToUiFile } = await import('./localImport')
            const { titleFromFileName } = await import('../utils/projectTitle')
            const records = await listLocalFiles(data.slug)
            setProjectFiles(records.map(localRecordToUiFile), path)
            // Display name from the first file, IndexedDB only — never PATCH.
            const fromFile = titleFromFileName(records[0]?.name)
            setProjectName(fromFile || data.name || '')
        } else {
            if (data.name) setProjectName(data.name)
            setProjectFiles(data.files, path)
        }
    } catch (error) {
        if (path !== lastProjectRequest) return
        if (error?.data?.statusMessage === 'vault_locked') {
            const vaultUnlockDialog = useVaultUnlockDialog();
            vaultUnlockDialog.value = true;
            return
        }
        console.error('Error fetching project:', error)
        navigateTo("/home");
    }
}
function setProjectName(name) {
    state.projectName = name
}
function setProjectFiles(files, path) {
    // Cloisonnement (QA 2026-08-30) : en QUITTANT un projet on snapshotte
    // ses réglages ; en ARRIVANT sur un autre, on restaure SON snapshot —
    // ou les défauts d'usine (plus de fuite des params d'un projet à
    // l'autre, la démo comprise). Sur un rechargement du MÊME projet
    // (upload de fichiers), le comportement historique est conservé :
    // les counts/rotations sélectionnés sont portés par slug.
    const sameProject = path != null && path === state.projectSlug
    if (!sameProject) {
        snapshotCurrentProject()
    }
    const snap = (!sameProject && path != null)
        ? projectSnapshots.get(path)
        : null
    const countBySlug = new Map(
        sameProject
            ? (state.projectFiles || []).map((file) => [file.slug, file.count])
            : Object.entries(snap?.countBySlug || {})
    )
    const rotationBySlug = new Map(
        sameProject
            ? (state.projectFiles || []).map((file) => [file.slug, file.rotation])
            : Object.entries(snap?.rotationBySlug || {})
    )
    state.projectFiles = files.map((file) => ({
        ...file,
        // Demo files carry their suggested quantity from the seed; anything
        // else starts at 1 (or keeps the user's previous pick on reload —
        // désormais aussi au RETOUR sur le projet, via le snapshot).
        count: countBySlug.has(file.slug) ? countBySlug.get(file.slug) : (file.demoQuantity ?? 1),
        rotation: rotationBySlug.has(file.slug) ? rotationBySlug.get(file.slug) : null
    }))
    state.projectSlug = path ?? null
    if (!sameProject) {
        // Reset the "already nested" marker so the Nest button reflects the
        // newly loaded project rather than the previous one.
        state.lastParams = ''
        // Params du projet visité : son snapshot s'il existe (l'utilisateur
        // était déjà passé), sinon les curated defaults posés au montage
        // (démo), sinon les défauts d'usine.
        if (snap) {
            // withKerfDefaults : snapshot posé avant le chantier kerf
            // (B.4) — même espacement effectif après migration.
            state.params = withKerfDefaults(JSON.parse(JSON.stringify(snap.params)))
            paramsUnit = snap.paramsUnit
        } else if (!pendingCuratedDefaults) {
            state.params = factoryParams()
            paramsUnit = 'mm'
        }
        pendingCuratedDefaults = false
    }
    scheduleFilesRefresh(path)
}
/**
 * Lot E4-b — ouvre l'aperçu d'échelle sur UNE FICHE.
 *
 * La géométrie vient de la fiche elle-même : enregistrement IndexedDB en
 * local, `/api/files/project/geometry/:slug` côté serveur. Aucune lecture
 * wasm, aucun changement avant « Appliquer ».
 */
async function openFicheScale(file) {
    const { useAdvancedImport } = await import('./advancedImport')
    const adv = useAdvancedImport()
    try {
        let parts
        if (state.projectLocal) {
            const { getLocalFile } = await import('./localFilesStore')
            const record = await getLocalFile(file.slug)
            parts = record?.parts || []
        } else {
            const data = await $fetch(`/api/files/project/geometry/${file.slug}`)
            parts = data?.parts || []
        }
        if (!parts.length) throw new Error('localImport.noParts')
        adv.openFicheScale({ slug: file.slug, name: file.name, parts })
        if (!adv.preview.sheet) {
            // Tôle de référence : celle du projet si elle est valide. Les
            // params portent des valeurs d'AFFICHAGE : conversion ici, à la
            // frontière (AGENTS #25).
            const first = normalizedSheets(state.params)[0]
            const u = getUnitState()
            adv.setSheet(
                displayToMm(Number(first?.width), u),
                displayToMm(Number(first?.height), u),
            )
        }
    } catch (err) {
        state.localImportError = err?.message || 'localImport.parseError'
        state.localImportErrorParams = err?.params || {}
    }
}

/**
 * Attend que les fiches du projet serveur en cours de retraitement soient
 * toutes traitées (échelle : la fiche redevient « done » ; éclatement : les
 * filles naissent « in-progress » puis finissent). Boucle côté Node — un
 * prédicat async dans `waitForFunction` est jugé vrai immédiatement (mesuré
 * au lot E2). `projectPath` est le CHEMIN d'API (`state.projectSlug`), pas
 * le slug nu.
 */
async function awaitFilesDone(projectPath, timeoutMs = 300000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeoutMs) {
        try {
            const data = await $fetch(projectPath)
            const files = data?.files || []
            const inProgress = files.some((f) => f.processingStatus === 'in-progress')
            if (files.length && !inProgress) {
                if (files.some((f) => f.processingStatus === 'error')) {
                    throw new Error('files.error')
                }
                return files
            }
        } catch (err) {
            if (err?.message === 'files.error') throw err
        }
        await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error('files.timeout')
}

/** Applique l'échelle réglée dans l'aperçu à la fiche ouverte (E4-b). */
async function applyFicheScale(options) {
    const { useAdvancedImport } = await import('./advancedImport')
    const adv = useAdvancedImport()
    const slug = adv.preview.pending[0]?.ficheSlug
    adv.cancel()
    if (!slug) return
    state.localImportError = ''
    state.localImportErrorParams = {}
    try {
        if (state.projectLocal) {
            const { getLocalFile } = await import('./localFilesStore')
            const { scaleLocalFiche } = await import('./localImport')
            const record = await getLocalFile(slug)
            if (record) await scaleLocalFiche(record, options)
        } else {
            const body = options?.scaleTarget
                ? { mode: options.scaleTarget.mode, mm: Number(options.scaleTarget.mm) }
                : { mode: 'factor', value: Number(options?.scale) || 1 }
            await $fetch(`/api/files/${slug}/scale`, { method: 'PATCH', body })
            await awaitFilesDone(state.projectSlug)
        }
    } catch (err) {
        state.localImportError = err?.message || 'localImport.parseError'
        state.localImportErrorParams = err?.params || {}
    }
    // `state.projectSlug` porte déjà le CHEMIN d'API complet, pas le slug nu.
    await getProject(state.projectSlug)
}

/** « Réinitialiser l'échelle » d'une fiche (E4-b) — retour bit-identique. */
async function resetFicheScale(file) {
    state.localImportError = ''
    state.localImportErrorParams = {}
    try {
        if (state.projectLocal) {
            const { getLocalFile } = await import('./localFilesStore')
            const { resetLocalFicheScale } = await import('./localImport')
            const record = await getLocalFile(file.slug)
            if (record) await resetLocalFicheScale(record)
        } else {
            await $fetch(`/api/files/${file.slug}/scale`, {
                method: 'PATCH',
                body: { reset: true },
            })
            await awaitFilesDone(state.projectSlug)
        }
    } catch (err) {
        state.localImportError = err?.message || 'localImport.parseError'
        state.localImportErrorParams = err?.params || {}
    }
    // `state.projectSlug` porte déjà le CHEMIN d'API complet, pas le slug nu.
    await getProject(state.projectSlug)
}

/**
 * « Éclater en pièces » une fiche (E4-c) : la fiche devient N fiches, la
 * quantité de la fiche est HÉRITÉE par chacune.
 */
async function explodeFiche(file) {
    state.localImportError = ''
    state.localImportErrorParams = {}
    const parentCount = Number(file.count) || 1
    const parentSlug = file.slug
    try {
        if (state.projectLocal) {
            const { getLocalFile } = await import('./localFilesStore')
            const { explodeLocalFiche } = await import('./localImport')
            const record = await getLocalFile(parentSlug)
            if (record) await explodeLocalFiche(record)
        } else {
            await $fetch(`/api/files/${parentSlug}/explode`, { method: 'POST' })
            await awaitFilesDone(state.projectSlug, 600000)
        }
    } catch (err) {
        state.localImportError = err?.message || 'localImport.parseError'
        state.localImportErrorParams = err?.params || {}
    }
    // `state.projectSlug` porte déjà le CHEMIN d'API complet, pas le slug nu.
    await getProject(state.projectSlug)
    // Quantité héritée : les filles portent le parent (explodedFromSlug).
    state.projectFiles.forEach((f, index) => {
        if (f.explodedFromSlug === parentSlug && f.count !== parentCount) {
            updateCount(String(parentCount), index)
        }
    })
}

/**
 * Lot J6-bis — un DXF déposé pour un nom dont la fiche vient du BINAIRE du
 * `.job` REMPLACE cette fiche en place (§9.64, réserve mesurée au
 * vérificateur : sinon, l'utilisateur qui obéit au constat « DXF d'origine
 * non fourni » double ses quantités sans le voir).
 *
 * Même slug, même rang (`addedAt`) — la quantité réglée à l'écran et les
 * réglages de coupe restent ceux de la fiche remplacée quand le dépôt n'en
 * porte pas (DXF déposé SEUL : réglages et octets du `.job` conservés depuis
 * la fiche ; lot `.job` : ceux du dépôt, plus frais, gagnent). Un DXF
 * redéposé pour une fiche déjà DXF reste le comportement historique —
 * seules les fiches `source: 'job'` se remplacent.
 *
 * Lot J6-ter (§9.66) : le remplacement passe PAR `importLocalFiles`, ses
 * gardes d'entrée comprises (extension, taille, signature `.job`) —
 * `replace` voyage dans les options jusqu'à `importLocalBytes`. Auparavant
 * le chemin court-circuitait ces gardes : un DWG déposé sous le nom d'une
 * fiche du binaire rendait « Aucune pièce fermée trouvée » au lieu du refus
 * actionnable, et le plafond de taille tombait avec.
 */
async function importDxfReplacingJobFiche(file, slug, options = {}) {
    const { importLocalFiles } = await import('./localImport')
    const nameEq = (a, b) => String(a || '').trim().toLowerCase()
        === String(b || '').trim().toLowerCase()
    const existing = (state.projectFiles || []).find(
        (f) => f?.source === 'job' && nameEq(f.name, file.name))
    if (!existing) return importLocalFiles(file, slug, options)
    const { getLocalFile } = await import('./localFilesStore')
    const previous = await getLocalFile(existing.slug)
    return importLocalFiles(file, slug, {
        ...options,
        ...(previous?.sheetcam && !options.sheetcam ? { sheetcam: previous.sheetcam } : {}),
        ...(previous?.sheetcamJobBytes && !options.sheetcamJobBytes
            ? { sheetcamJobBytes: new Uint8Array(previous.sheetcamJobBytes) }
            : {}),
        replace: { slug: existing.slug, addedAt: previous?.addedAt },
    })
}

async function addFiles(files, slug) {
    if (state.projectLocal) {
        // J-090 : import 100 % navigateur (parse wasm + IndexedDB) — aucun
        // byte ne transite par le serveur.
        state.localImportError = ''
        state.localImportErrorParams = {}
        state.localImportNotice = ''
        state.localImportNoticeParams = {}
        // Lot J4 — un `.job` SheetCam dans la dépose. Il passe AVANT tout :
        // un `.job` porte déjà sa tôle, son espacement et ses quantités.
        // Reconnu par SIGNATURE (piège #31) ; sans `.job` dans la dépose,
        // `splitSheetCamDrop` rend `null` et rien ne change.
        //
        // Lot J8-c : la dépose peut porter PLUSIEURS `.job` — chacun est un
        // job de découpe, aucun n'est ignoré (le second disparaissait en
        // silence). Réglages pré-remplis : le DERNIER `.job` gagne (ordre du
        // dépôt), les fiches et quantités s'accumulent.
        {
            const { splitSheetCamDrop } = await import('./sheetcamJobImport')
            const drop = await splitSheetCamDrop(files)
            if (drop) {
                const wanted = new Map()
                for (const one of drop.jobs) {
                    const w = await addSheetCamJobDrop(
                        { ...one, drawings: drop.drawings },
                        slug,
                    )
                    for (const [k, v] of w || []) wanted.set(k, v)
                }
                await getProject(API_ROUTES.PROJECT(slug))
                // Les quantités du `.job`, une fois la liste rechargée.
                if (wanted.size) {
                    state.projectFiles.forEach((f, index) => {
                        const n = wanted.get(f.slug)
                        if (n != null) updateCount(n, index)
                    })
                }
                return
            }
        }
        // Lot E4-d : le dépôt est TOUJOURS l'import ordinaire — la fenêtre
        // de choix et l'interrupteur ont disparu, l'échelle et l'éclatement
        // vivent sur la fiche (E4-b/E4-c). Lot J6-bis : un DXF déposé pour
        // un nom venu du binaire d'un `.job` remplace cette fiche en place.
        try {
            for (const file of files) {
                await importDxfReplacingJobFiche(file, slug)
            }
        } catch (err) {
            state.localImportError = err?.message || 'localImport.parseError'
            // Lot 2a : les refus « trop lourd » portent leurs nombres
            // (entités, budget) — le message les affiche.
            state.localImportErrorParams = err?.params || {}
        }
        await getProject(API_ROUTES.PROJECT(slug))
        return
    }
    // Lot J6 — un `.job` ne se traite que sur le chemin NAVIGATEUR : le
    // serveur n'accepte que .dxf/.svg/.dwg à l'upload et le miroir `.job`
    // côté worker est le lot J5. Un `.job` déposé sur un projet serveur
    // serait filtré en silence — on le DIT, avec la voie qui marche.
    const jobFiles = files.filter((f) => /\.job$/i.test(f?.name || ''))
    if (jobFiles.length) {
        state.localImportError = 'jobImport.serverUnsupported'
        state.localImportErrorParams = {
            names: jobFiles.map((f) => f.name).join(', '),
        }
    }
    await uploadToServer(files, slug)
}

/**
 * Dépose SERVEUR (« nos serveurs ») : les octets partent, le worker importe.
 * Lot E4-d : dépôt ordinaire, sans options — l'échelle et l'éclatement se
 * demandent sur la fiche après import (E4-b/E4-c).
 *
 * Lot J8-e (étude §9.73, 8.3-quater) — PAR LOTS AUTOMATIQUES. Le plafond
 * serveur de MAX_UPLOAD_FILES protège la TAILLE DU CORPS HTTP
 * (5 Mo × 20 + 1 Mo), pas une règle produit : cinquante fichiers partent en
 * trois requêtes, personne n'a à compter ses fichiers. Le plafond reste en
 * place côté serveur (garde de taille), il n'est simplement plus rencontré.
 *
 * Les erreurs d'envoi S'AFFICHENT — défaut muet mesuré en production : un
 * dépôt de plus de vingt fichiers échouait sans rien dire (console.error
 * seul, projet vide), et le même silence avalait coffre verrouillé, quota et
 * panne réseau. Un lot qui échoue est NOMMÉ avec ses fichiers ; les lots
 * suivants partent quand même — mieux vaut un projet rempli à moitié DIT
 * qu'un échec total muet.
 */
async function uploadToServer(files, slug) {
    const list = [...files]
    const failedNames = []
    const reasons = new Set()
    for (let i = 0; i < list.length; i += MAX_UPLOAD_FILES) {
        const lot = list.slice(i, i + MAX_UPLOAD_FILES)
        const formData = new FormData()
        formData.append('projectName', state.projectName)
        lot.forEach((file) => formData.append('dxf', file))
        try {
            await $fetch(API_ROUTES.ADDFILES(slug), { method: 'POST', body: formData })
        } catch (error) {
            // Le message du serveur quand il en porte un (Nitro createError
            // voyage dans error.data), sinon le status — jamais de bulldozer.
            reasons.add(String(
                error?.data?.message || error?.message
                || `HTTP ${error?.status ?? error?.statusCode ?? '?'}`,
            ))
            failedNames.push(...lot.map((f) => f?.name || '?'))
        }
    }
    if (failedNames.length) {
        state.localImportError = 'upload.batchFailed'
        state.localImportErrorParams = {
            n: failedNames.length,
            names: failedNames.join(', '),
            reasons: [...reasons].join(' · '),
        }
    }
    await getProject(API_ROUTES.PROJECT(slug))
}

/**
 * Dépose d'un `.job` SheetCam et de ses dessins — lots J4 puis J6.
 *
 * Ce que cette fonction fait, dans cet ordre et pour ces raisons :
 *
 *  1. PRÉ-REMPLIT la tôle (`[Work]`) et l'espacement (kerf de `[Tool0]`),
 *     avant d'importer : si un dessin échoue ensuite, l'utilisateur a déjà
 *     les réglages que son fichier annonce. L'espacement passe par
 *     `updateKerfSafety`, JAMAIS par `updateParams({ space })` — c'est le
 *     seul chemin qui garde `space = kerf + 2 × sécurité` cohérent, et
 *     l'écrire directement ferait re-dériver une autre valeur à la
 *     réouverture du projet.
 *  2. RÉSOUT LA SOURCE DE GÉOMÉTRIE de chaque dessin (lot J6, §9.62) :
 *     le DXF déposé gagne (géométrie source exacte) ; sinon la fiche du
 *     même nom déjà dans le projet (le DXF y a été importé — on lui attache
 *     les réglages, pas de doublon) ; sinon le BLOC BINAIRE du `.job`,
 *     décodé puis repassé par l'import ordinaire — la fiche porte alors
 *     `source: 'job'` et le constat « géométrie lue dans le fichier de
 *     travail ». Plus AUCUN « dessin manquant, déposez-le » : ce message
 *     n'a plus de sens depuis que le `.job` porte ses contours.
 *  3. NOMME les refus, par dessin : segment inconnu, contour ouvert, arc
 *     incohérent — les autres fiches vivent, le refus dit QUI est concerné.
 *
 * Les réglages restent MODIFIABLES : on pré-remplit, on n'impose pas
 * (consigne §5 point 2).
 */
async function addSheetCamJobDrop(drop, slug) {
    const { readSheetCamJob, importLocalFiles, importLocalBytes, assignJobStarts } = await import('./localImport')
    const {
        prefillFromJob, cutSettingsFor, resolveJobDrawingSources,
    } = await import('./sheetcamJobImport')
    const { drawingCanonicalDxf } = await import('~~/shared/sheetcamJobDxf.js')

    let read
    try {
        read = readSheetCamJob(drop.jobBytes)
    } catch (err) {
        state.localImportError = err?.message || 'sheetcamJob.unreadable'
        state.localImportErrorParams = err?.params || {}
        return
    }

    // 1. Les réglages que le fichier DIT.
    // Pas de `safetyMm` : le pre-remplissage suit la REGLE (kerf + 2 x 0,25),
    // pas la securite d'usine du projet — voir `prefillFromJob`.
    const prefill = prefillFromJob(read)
    if (prefill.sheet) {
        const u = getUnitState()
        updateParams({
            sheets: [{
                width: mmToDisplay(prefill.sheet.width, u),
                height: mmToDisplay(prefill.sheet.height, u),
                count: 1,
            }],
        })
    }
    if (prefill.kerf != null) updateKerfSafety({ kerf: prefill.kerf, safety: prefill.safety })

    // 2. La source de géométrie de chaque dessin (lot J6).
    const sources = resolveJobDrawingSources(
        read,
        drop.drawings,
        (state.projectFiles || []).map((f) => ({ name: f.name, slug: f.slug })),
    )
    const jobName = drop.jobFile?.name || null
    const wanted = new Map()
    let imported = 0
    // Les fiches importées, gardées pour l'attachement des POINTS DE DÉPART
    // — par RANG D'ORIGINALE depuis le lot J9 (le lien du cache binaire,
    // §9.76 point 1 ; l'ancien appariement par géométrie ne peut pas
    // départager quatre originales du MÊME dessin). Aucune lecture de plus :
    // ce sont les mêmes objets.
    const importedByRank = new Map()
    const refused = [...sources.refused]
    // Lot J9 : le nom de FICHE — « nom (2/4) » quand plusieurs originales
    // partagent un dessin, le nom nu sinon (indistinguable d'avant).
    const labelOf = (drawing) => drawing.label || drawing.name
    const remember = (drawing, records) => {
        importedByRank.set(drawing.originalRank ?? drawing.name, records)
        imported += records?.length || 1
        for (const rec of records || []) {
            wanted.set(rec.slug, Number(drawing.quantity) || 1)
        }
    }

    // a) le DXF déposé : la géométrie source exacte gagne. Lot J6-bis : si
    //    la fiche de ce nom dans le projet vient du BINAIRE (dépôt `.job`
    //    seul précédent), le DXF la REMPLACE en place — jamais de doublon.
    for (const { drawing, file } of sources.matched) {
        try {
            const records = await importDxfReplacingJobFiche(file, slug, {
                sheetcam: cutSettingsFor(drawing, { jobName, kerfWidth: read.kerfWidth }),
                sheetcamJobBytes: drop.jobBytes,
            })
            if (records?.length) remember(drawing, records)
        } catch (err) {
            state.localImportError = err?.message || 'localImport.parseError'
            state.localImportErrorParams = err?.params || {}
        }
    }

    // b) la fiche du même nom déjà dans le projet : le DXF y a été importé,
    //    on attache les réglages de coupe du `.job` à CETTE fiche — jamais
    //    de doublon (P4-9 : un `.job` redéposé réutilise ce qui est là).
    //    Une fiche disparue entre-temps retombe sur le bloc binaire : la
    //    source « projet » est une OPTIMISATION, pas une dépendance.
    const fromJob = [...sources.fromJob]
    const { getLocalFile, saveLocalFile } = await import('./localFilesStore')
    for (const { drawing, slug: fileSlug } of sources.reusable) {
        const record = await getLocalFile(fileSlug)
        if (!record) {
            const block = sources.blockByName.get(drawing.name)
            if (block && !block.error) fromJob.push({ drawing, block })
            else refused.push({ drawing, code: 'sheetcamJobDrawing.linkUnknown', params: {} })
            continue
        }
        record.sheetcam = cutSettingsFor(drawing, { jobName, kerfWidth: read.kerfWidth })
        record.sheetcamJobBytes = drop.jobBytes.slice().buffer
        await saveLocalFile(record)
        remember(drawing, [record])
    }

    // c) le bloc binaire : DXF canonique LINE/ARC PUIS IMPORT ORDINAIRE —
    //    une seule chaîne de fiches, de pièces et de trous (§9.62 point 2).
    for (const { drawing, block } of fromJob) {
        let records = null
        try {
            const dxf = drawingCanonicalDxf(block)
            if (!(dxf instanceof Uint8Array)) {
                refused.push({ drawing, code: 'sheetcamJobDrawing.noGeometry', params: {} })
                continue
            }
            records = await importLocalBytes(dxf, labelOf(drawing), slug, {
                sheetcam: cutSettingsFor(drawing, { jobName, kerfWidth: read.kerfWidth }),
                sheetcamJobBytes: drop.jobBytes,
                sheetcamSource: 'job',
            })
        } catch (err) {
            state.localImportError = err?.message || 'localImport.parseError'
            state.localImportErrorParams = err?.params || {}
            continue
        }
        if (records?.length) remember(drawing, records)
    }

    // 2-bis. LES POINTS DE DÉPART, APPARIÉS PAR RANG D'ORIGINALE (lot J9).
    //
    // Le lien du cache binaire EST la section originale (§9.76 point 1,
    // mesuré sur j9-1 : 4 blocs, 4 originales, 1 nom) — l'ancien
    // appariement par GÉOMÉTRIE (lot J4-bis-3, gardé pour les fichiers où
    // les sections ne suivent pas le cache) ne peut pas départager quatre
    // originales du MÊME dessin : leurs anneaux sont identiques. Chaque
    // fiche porte le rang de SON originale, donc SON bloc — et SES points,
    // avec leur drapeau « déplacé » (§9.59 fiche par fiche).
    if (importedByRank.size) {
        const { jobDrawings: blocksOf, previewSvgWithLeads } = await import('./localImport')
            .then(() => import('~~/shared/sheetcamJob.js'))
        const blocks = blocksOf(read.job.binary) || []
        for (const [rankKey, records] of importedByRank) {
            // `rankKey` : le rang d'originale (entier, lot J9) ou le nom
            // (fiches héritées d'un ancien dépôt).
            const drawingEntry = read.drawings.find((d) =>
                (Number.isInteger(d.originalRank) ? d.originalRank : d.name) === rankKey)
            const blockIndex = Number.isInteger(drawingEntry?.originalRank)
                ? drawingEntry.originalRank
                : null
            const block = Number.isInteger(blockIndex) ? blocks[blockIndex] : null
            if (!block || block.error) continue
            const starts = (block.paths || []).map((p, pathIndex) => ({
                pathIndex,
                // Relatif à l'origine RÉSOLUE du bloc (sentinelle comprise) :
                // le point TEL QU'ÉCRIT dans le cache — l'écrivain le
                // réécrit tel quel, et les consommateurs (réserve, aperçu)
                // ajoutent l'origine une seule fois.
                offset: p.startRaw ?? p.start,
                leadIn: p.leadIn ?? drawingEntry?.leadIn,
                leadOut: p.leadOut ?? drawingEntry?.leadOut,
                leadInType: drawingEntry?.leadInType,
                leadOutType: drawingEntry?.leadOutType,
                order: p.order,
                moved: p.moved,
            }))
            for (const record of records) {
                if (!record.sheetcam) continue
                record.sheetcam = {
                    ...record.sheetcam,
                    starts,
                    origin: block.origin,
                    // Lot J4-ter : le rang du dessin dans le cache binaire,
                    // pour pouvoir y RÉÉCRIRE les points de départ.
                    blockIndex,
                }
                // Lot J8-b : l'aperçu se RECONSTRUIT avec les amorces —
                // c'est ici que l'atelier voit ses points de départ et le
                // disque de perçage AVANT de lancer le nesting (§9.73
                // point 7). Sans point posable, aperçu identique.
                try {
                    record.previewSvg = previewSvgWithLeads(record)
                } catch {
                    // L'aperçu d'origine reste : une amorce ratée ne
                    // doit jamais casser la fiche.
                }
                await saveLocalFile(record)
            }
        }
    }

    // 3. Les refus, nommés — et EUX SEULS en erreur : le message « déposez
    //    le DXF manquant » n'existe plus, la fiche issue du binaire porte
    //    son constat d'information (« géométrie lue dans le fichier de
    //    travail ») et le reste du travail est fait.
    //
    // Lot J10-a (§9.77 point 11) : une ZONE D'EXCLUSION déclarée et non
    // nulle sur la tôle est DITE au dépôt — tant que `[Work/keepout]`
    // n'est pas comprise, elle ne doit pas pouvoir coûter de la matière
    // en silence. (Les 50 `.job` du poste la portent à ZÉRO : ce message
    // ne s'affiche que pour un fichier qui l'exerce VRAIMENT.)
    const { jobKeepoutCorners } = await import('~~/shared/sheetcamJob.js')
    const keepout = jobKeepoutCorners(read.job)
    if (keepout.length) {
        state.localImportNotice = 'jobImport.keepoutDeclared'
        state.localImportNoticeParams = {
            n: new Set(keepout.map((k) => k.corner)).size,
        }
    }
    if (refused.length) {
        state.localImportError = 'jobImport.drawingRefused'
        state.localImportErrorParams = {
            n: refused.length,
            names: refused.map((r) => r.drawing.name).join(', '),
            // Codes stables : la page les traduit (elle a le `t`), l'atelier
            // lit « un contour ouvert », pas une clé technique.
            reasonCodes: [...new Set(refused.map((r) => r.code))],
        }
    } else if (!imported && !sources.reusable.length) {
        state.localImportError = 'jobImport.dropDrawings'
        state.localImportErrorParams = {
            n: read.drawings.length,
            names: read.drawings.map((d) => `${d.name} (× ${d.quantity})`).join(', '),
        }
    }
    return wanted
}

function isValidNumber(value) {
    return /^\d+([.,]\d+)?$/.test(value)
}
/**
 * Sheets list with backward compatibility: params written before the
 * multi-sheet feature only had widthPlate/heightPlate/sheetCount.
 */
function normalizedSheets(params) {
    if (Array.isArray(params.sheets) && params.sheets.length > 0) {
        return params.sheets
    }
    if (params.widthPlate != null) {
        return [{
            width: params.widthPlate,
            height: params.heightPlate,
            count: params.sheetCount ?? 1,
        }]
    }
    return []
}
function updateParams(param) {
    state.params = { ...state.params, ...param }
    scheduleSnapshotPersist()
}
/**
 * Chemin d'écriture UNIQUE des deux réglages explicites d'espacement
 * (B.4) : maintient `space` — la clé comprise par l'API et les deux
 * moteurs — en phase avec la règle space = kerf + 2 × sécurité.
 * Écrire `space` directement reste possible (levier capacité, démo),
 * mais alors sans kerf/safety cohérents la réouverture re-dériverait :
 * passer par ici partout.
 */
function updateKerfSafety(patch) {
    const kerf = patch.kerf != null ? String(patch.kerf) : state.params.kerf
    const safety = patch.safety != null ? String(patch.safety) : state.params.safety
    state.params = {
        ...state.params,
        kerf,
        safety,
        space: spacingFromKerfSafety(kerf, safety),
    }
    scheduleSnapshotPersist()
}
function updateSheet(index, patch) {
    const sheets = normalizedSheets(state.params).map((sheet, i) =>
        i === index ? { ...sheet, ...patch } : sheet
    )
    state.params = { ...state.params, sheets }
    scheduleSnapshotPersist()
}
function addSheet() {
    const sheets = normalizedSheets(state.params)
    const last = sheets[sheets.length - 1] || { ...DEFAULT_SHEET.mm, count: '1' }
    state.params = { ...state.params, sheets: [...sheets, { ...last, count: '1' }] }
    scheduleSnapshotPersist()
}

// The unit state.params is CURRENTLY expressed in. Starts at mm (factory
// defaults); tracked so a unit sync is idempotent — re-applying the same
// unit (SPA remount, DB re-sync) never double-converts user values.
let paramsUnit = 'mm'

/**
 * Brings the in-progress form values to `toUnit` (called on unit switch AND
 * on init, when the cookie/DB preference differs from the mm factory
 * defaults). Sheets exactly matching a standard preset snap to the
 * equivalent REGIONAL standard (1000×2000 mm -> 48×96", never
 * 39.37×78.74"); custom sizes and the spacing are converted numerically
 * (0.1 mm <-> 0.004" round-trips exactly through the display trimming).
 */
function syncParamsToUnit(toUnit) {
    if (!toUnit || paramsUnit === toUnit) return
    const fromUnit = paramsUnit
    // B.3/B.4 : kerf et sécurité sont des longueurs comme space — la
    // conversion les prend, puis space est RECALCULÉ depuis eux pour que
    // la règle space = kerf + 2 × sécurité reste exacte après un switch
    // d'unité (pas d'arrondis cumulés indépendants).
    const p = withKerfDefaults(state.params)
    const sheets = normalizedSheets(p)
    const conv = (v) => convertInputValue(v, fromUnit, toUnit)
    // Kerf et sécurité sont des PETITES longueurs (typ. 0-3 mm) : la
    // résolution standard des champs (0,1 mm / 0,001") ferait dériver la
    // demi-valeur héritée d'un ancien espacement (0,05 mm -> 0,1 mm au
    // retour d'inch). Résolution fine dédiée : 0,01 mm / 0,0001".
    const convFine = (v) => {
        if (fromUnit === toUnit) return v
        const n = Number(String(v).replace(',', '.'))
        if (!Number.isFinite(n)) return v
        const mm = fromUnit === 'inch' ? n * MM_PER_INCH : n
        const out = toUnit === 'inch' ? mm / MM_PER_INCH : mm
        const d = toUnit === 'inch' ? 4 : 2
        return out.toFixed(d).replace(/\.?0+$/, '')
    }
    const convSheet = (s) => {
        const eq = equivalentSheetPreset(s.width, s.height, fromUnit, toUnit)
        return eq ? { ...s, ...eq } : { ...s, width: conv(s.width), height: conv(s.height) }
    }
    const kerf = convFine(p.kerf)
    const safety = convFine(p.safety)
    state.params = {
        ...p,
        sheets: sheets.map(convSheet),
        kerf,
        safety,
        space: spacingFromKerfSafety(kerf, safety),
    }
    paramsUnit = toUnit
    scheduleSnapshotPersist()
}
function removeSheet(index) {
    const sheets = normalizedSheets(state.params)
    if (sheets.length <= 1) return
    state.params = { ...state.params, sheets: sheets.filter((_, i) => i !== index) }
    scheduleSnapshotPersist()
}
/**
 * Builds the array of allowed rotation angles (in degrees) from a rotation
 * count. N rotations are spread evenly around the full circle, always
 * including 0°. Examples:
 *   1 -> [0]
 *   2 -> [0, 180]
 *   4 -> [0, 90, 180, 270]
 *   8 -> [0, 45, 90, ..., 315]
 * Clamped to [1, 360] to stay sane.
 */
function buildRotationAngles(count) {
    const n = Math.min(360, Math.max(1, Math.floor(Number(count) || 4)))
    if (n === 1) return [0]
    const step = 360 / n
    return Array.from({ length: n }, (_, i) => Math.round(i * step))
}
function increment(index, event) {
    const step = event && event.shiftKey ? 10 : 1
    if (state.projectFiles[index].count + step <= 999) {
        state.projectFiles[index].count += step
    } else {
        state.projectFiles[index].count = 999
    }
    scheduleSnapshotPersist()
}
function decrement(index, event) {
    const step = event && event.shiftKey ? 10 : 1
    if (state.projectFiles[index].count - step >= 0) {
        state.projectFiles[index].count -= step
    } else {
        state.projectFiles[index].count = 0
    }
    scheduleSnapshotPersist()
}
function updateCount(value, index) {
    if (!isValidNumber(value)) {
        state.projectFiles[index].count = 0
    } else if (Number(value) > 999) {
        state.projectFiles[index].count = 999
    } else {
        state.projectFiles[index].count = Number(value)
    }
    scheduleSnapshotPersist()
}
function updateRotation(value, index) {
    if (state.projectFiles[index]) {
        state.projectFiles[index].rotation = value
    }
    scheduleSnapshotPersist()
}
async function nest(slug) {
    // R-2 (audit 2026-08-31 §R-1) : garde de double soumission — un 2e clic
    // pendant la latence du POST passait le compteur de concurrence serveur
    // et pouvait doubler la charge de quota.
    if (state.nestBusy) return
    state.nestBusy = true
    try {
        try {
            state.nestError = ''
            state.nestUnfit = null
            state.demoQuotaReached = false
            state.sheetCapError = false
            const data = await $fetch(API_ROUTES.NEST(slug), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: state.requestBody
            })
            setModalNestData(data)
            // Refresh the cached user so the free-quota banner reflects the
            // operation that was just consumed.
            await authStore.actions.setUser()
        } catch (error) {
            if (error?.data?.statusMessage === 'capacity_exceeded') {
                // Z1 (vérif 2026-09-05) : refus 422 du pré-contrôle de
                // capacité (SANS quota consommé) — le bandeau à leviers de
                // la page prend le relais du message générique.
                state.nestUnfit = error?.data?.data?.unfit || null
                return
            }
            if (error?.data?.statusMessage === 'sheet_cap_exceeded') {
                // Server-side free sheet cap fired (client mirror bypassed).
                state.sheetCapError = true
                return
            }
            if (error?.response?.status === 402) {
                // Demo nestings draw from their own monthly quota — show the
                // dedicated message, never the subscription paywall.
                if (error?.data?.data?.reason === 'demo_quota') {
                    state.demoQuotaReached = true
                    return
                }
                // Skip the paywall dialog when paid plans are temporarily
                // disabled — it would only offer a "Coming soon" CTA.
                const paidDisabled = useRuntimeConfig().public.paidPlansDisabled === true
                if (!paidDisabled) {
                    const buyCreditsDialog = useBuyCreditsDialog();
                    buyCreditsDialog.value = true;
                }
                return
            }
            if (error?.data?.statusMessage === 'email_not_verified') {
                // Local account without a confirmed email — send the user to
                // the verification page (with a resend button).
                const router = useRouter()
                router.push({ path: '/auth/check-email' })
                return
            }
            if (error?.data?.statusMessage === 'vault_locked') {
                const vaultUnlockDialog = useVaultUnlockDialog();
                vaultUnlockDialog.value = true;
                return
            }
            // Erreur non gérée (409 concurrent_limit, 5xx…) : AVANT, on
            // tombait dans la suite de la fonction — rien à l'écran ET
            // lastParams marqué → bouton grisé jusqu'à modifier les
            // réglages à la main. Message visible + sortie propre :
            // isNewParams reste vrai, le bouton reste utilisable.
            state.nestError = error?.data?.statusMessage === 'concurrent_limit'
                ? 'nest.error.concurrent'
                : 'nest.error.generic'
            return
        }

        await Promise.all([getProjects()])

        state.lastParams = state.requestBody
    } catch (err) {
        console.error('Nest operation failed:', err)
    } finally {
        state.nestBusy = false
    }
}

/** Z1 (vérif 2026-09-05) : ferme le bandeau capacité (après action). */
function dismissNestUnfit() {
    state.nestUnfit = null
}

/** AA2 (vérif L1 2026-09-05) : appelé sur toute annulation — le bouton
 * Nest redevient actif avec les MÊMES paramètres (isNewParams repasse à
 * vrai ; sans ce reset, il fallait modifier un réglage ou recharger). */
function resetLastParams() {
    state.lastParams = ''
}

export const filesStore = readonly({
    getters: {
        projectFiles: computed(() => state.projectFiles),
        projectSlug: computed(() => state.projectSlug),
        projectName: computed(() => state.projectName),
        projectDemo: computed(() => state.projectDemo),
        projectLocal: computed(() => state.projectLocal),
        localImportError: computed(() => state.localImportError),
        localImportNotice: computed(() => state.localImportNotice),
        localImportNoticeParams: computed(() => state.localImportNoticeParams),
        localImportErrorParams: computed(() => state.localImportErrorParams),
        filesCount: computed(() =>
            state.filesStatusDone.reduce((acc, curr) => acc + curr.count, 0)
        ),
        isNewParams: computed(() => state.requestBody !== state.lastParams),
        demoQuotaReached: computed(() => state.demoQuotaReached),
        sheetCapError: computed(() => state.sheetCapError),
        nestError: computed(() => state.nestError),
        nestUnfit: computed(() => state.nestUnfit),
        nestBusy: computed(() => state.nestBusy),
        params: computed(() => state.params),
        nestRequestError: computed(() => {
            if (filesStore.getters.filesCount < 1) {
                // Local empty IndexedDB is a state, not a form error (ux1).
                return state.projectLocal ? '' : 'project.needFiles'
            }
            if (state.isInvalidParams) {
                return 'project.invalidParams'
            }

            return ''
        })
    },
    actions: {
        setProjectFiles,
        setProjectName,
        setPendingLocalFiles,
        consumePendingLocalFiles,
        markCuratedDefaults,
        updateParams,
        updateKerfSafety,
        updateSheet,
        // Lot E4-b/E4-c : actions « Échelle » et « Éclater » SUR LA FICHE.
        openFicheScale,
        applyFicheScale,
        resetFicheScale,
        explodeFiche,
        addSheet,
        removeSheet,
        syncParamsToUnit,
        updateCount,
        updateRotation,
        getProject,
        increment,
        decrement,
        addFiles,
        nest,
        dismissNestUnfit,
        resetLastParams,
    }
})
