
import { computed, customRef, reactive, readonly } from 'vue'
import { processingType } from '~~/constants/files.constants'
import { convertInputValue, displayToMm, mmToDisplay, DEFAULT_SHEET, equivalentSheetPreset, MM_PER_INCH, unitLabel } from '~/utils/units'
import {
    spacingFromKerfSafety,
    withKerfDefaults,
    isEdgeDistanceSet,
    isValidEdgeDistance,
    edgeDistanceNumber,
    edgeDistanceBlock,
    hasDwgToNest,
} from '~/utils/spacingParams'
import { getUnitState } from '~/composables/useUnit'
import { exceedsMaxSheets } from '~/utils/capacityPanel'
import { isUnlimitedSheet, sheetsForProject } from '~/utils/sheetStock'
import { flagOn } from '~/utils/runtimeFlag'
import { MAX_UPLOAD_FILES } from '~~/shared/constants/upload.constants'
import { MAX_SHEET_FORMATS } from '~~/shared/constants/payment.constants'
import { isUntouchedFactorySheet, factorySheetOf } from '~/utils/factorySheet'
import { SNAPSHOT_VERSION, snapshotUnit } from '~/utils/projectSnapshot'
import { rotationAngles } from '~/utils/partSheetFit'

// Calcul navigateur activé ? (override runtime en CHAÎNE, AGENTS #29). Hors
// Nuxt (tests sans configuration) : coupé, donc rien n'est envoyé de plus.
function browserComputeOn() {
    try {
        return flagOn(useRuntimeConfig().public.localComputeEnabled)
    } catch {
        return false
    }
}

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
        // Distance au bord de la tôle (chaîne en unité d'affichage, signée).
        // '' = comme l'espacement (comportement d'avant). Jamais dérivée de
        // `space`, jamais écrite par updateKerfSafety : updateEdgeDistance.
        edgeDistance: '',
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
// La page écrit ses réglages AVANT que le projet de départ ne soit quitté :
// l'instantané du projet laissé est donc pris ici, avant l'écriture, et plus
// aucun instantané n'est pris tant que le drapeau tient (le débounce ou le
// pagehide rangeraient les réglages de la démo sous le slug du projet quitté).
// `path` = chemin d'API de la démo : seuls ses réglages écrits valent pour
// CE chemin. Si un autre projet se charge d'abord (démo lente, en échec,
// abandonnée), il retrouve les siens.
function markCuratedDefaults(path) {
    snapshotCurrentProject()
    filesState().pendingCuratedFor = path ?? null
}

function snapshotCurrentProject() {
    // Snapshots belong to the tab (sessionStorage): on the server this Map
    // would be shared by every request of the process.
    if (!import.meta.client) return
    const state = filesState()
    if (state.projectSlug == null) return
    if (state.pendingCuratedFor != null) return
    projectSnapshots.set(state.projectSlug, {
        v: SNAPSHOT_VERSION,
        params: JSON.parse(JSON.stringify(state.params)),
        paramsUnit: state.paramsUnit,
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
    if (!import.meta.client) return
    if (snapshotPersistTimer) clearTimeout(snapshotPersistTimer)
    snapshotPersistTimer = setTimeout(() => {
        snapshotPersistTimer = null
        snapshotCurrentProject()
    }, 500)
}
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', snapshotCurrentProject)
}

function createFilesState() {
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
        // Compteur des formes de tôle remplacées (replaceSheetShape) : une retouche garde le MÊME
        // shapeId ; les lecteurs de la forme (dessin au repos) s'en servent pour relire.
        shapeRevision: 0,
        // Set when a demo nesting hits the monthly demo quota — shown on the
        // project page instead of the paywall (demo 402s are reason=demo_quota).
        demoQuotaReached: false,
        // R-2 (audit 2026-08-31 §R-1) : clé i18n de la dernière erreur de
        // soumission non gérée ailleurs (409 concurrent_limit, 5xx…) — avant,
        // l'erreur était avalée ET lastParams marqué → bouton grisé muet.
        nestError: '',
        // Nombre de refus de soumission posés (nestError) : le texte peut être le
        // même d'un refus au suivant, la page a besoin d'un événement, pas d'un texte.
        nestRefusals: 0,
        // Slug de la tôle importée qui a REMPLACÉ la tôle d'usine intacte (note unique des réglages).
        factorySheetReplaced: '',
        // Ce qui a été remplacé, figé au remplacement : { w, h, unit } (le texte dit
        // la bonne tôle même si l'unité change ensuite).
        factorySheetReplacedLabel: null,
        // Z1 (vérif 2026-09-05) : payload structuré du refus 422 capacité
        // (aire gonflée > seuil) — {reason, ratio, sheetsNeeded,
        // maxPartsAtSpacing, maxSpacingForFitMm} pour le bandeau à leviers.
        nestUnfit: null,
        // Soumission en vol : bloque le double-clic pendant la latence du POST
        // (2 requêtes = 2 charges possibles chez un Free, cf. R-1 serveur).
        nestBusy: false,
        // Le job a échoué ou a été annulé avant que nest() ait fini d'attendre ses
        // réponses : Nest ne doit pas redevenir grisé à la fin de nest().
        nestRearmed: false,
        params: factoryParams(),
        // The unit state.params is CURRENTLY expressed in. Starts at mm (factory
        // defaults); tracked so a unit sync is idempotent — re-applying the same
        // unit (SPA remount, DB re-sync) never double-converts user values.
        paramsUnit: 'mm',
        // Set by markCuratedDefaults() above: API path of the demo, or null.
        pendingCuratedFor: null,
        // Serveur seulement : l'unité d'affichage de la requête qui porte cet état.
        displayUnit: null,
        // m-6 (audit 2026-08-31 §R-m.6) : sur navigation rapide, la réponse la
        // plus LENTE gagnait et collait les fichiers/params d'un AUTRE projet sur
        // l'URL courante. On ne retient que la réponse de la dernière demande.
        lastProjectRequest: null,
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
            // Quantité illimitée (projet « Cet appareil ») : la quantité saisie
            // n'est pas lue, elle n'a pas à être valide.
            const sheets = sheetsForProject(normalizedSheets(state.params), state.projectLocal)
            if (sheets.length === 0) return false
            const invalid = sheets.some(
                (sheet) =>
                    !isValidNumber(sheet.width) ||
                    !isValidNumber(sheet.height) ||
                    (!isUnlimitedSheet(sheet) && !isValidSheetCount(sheet.count))
            )
            return (
                invalid ||
                !isValidNumber(state.params.space) ||
                // Champ grisé : la valeur restée dedans n'est pas envoyée, elle ne
                // bloque donc pas Nest.
                (state.edgeBlock === null && !isValidEdgeDistance(state.params.edgeDistance))
            )
        }),
        // Pourquoi la distance au bord est inactive (null = active) : voir
        // edgeDistanceBlock. Lu par l'écran, par la page et par la requête.
        edgeBlock: computed(() =>
            edgeDistanceBlock({
                local: state.projectLocal,
                isDemo: state.projectDemo,
                hasDwg: hasDwgToNest(state.filesToNest),
                browserCompute: browserComputeOn(),
            })
        ),
        requestBody: computed(() => {
            // Quantité illimitée : lue pour un projet « Cet appareil » seulement ;
            // elle part alors avec `unlimited: true` et une quantité de 1.
            const sheets = sheetsForProject(normalizedSheets(state.params), state.projectLocal)
            const first = sheets[0] || { width: 0, height: 0, count: 0 }
            const sentCount = (sheet) => (isUnlimitedSheet(sheet) ? 1 : Number(sheet.count))
            // Params hold DISPLAY-unit strings (the user's preferred unit) — the
            // API and the whole pipeline speak canonical mm, so convert here,
            // at the boundary.
            const unit = state.displayUnit || getUnitState()
            const toMm = (v) => displayToMm(Number(v), unit)
            // Distance au bord : envoyée SEULEMENT si remplie ET si le champ est
            // actif (« Cet appareil », ou « Nos serveurs » avec calcul navigateur,
            // sans DWG, hors démo). Absente sinon : le corps par défaut reste
            // identique à l'octet, et le serveur n'a rien à refuser.
            const edgeValue = state.edgeBlock === null
                ? edgeDistanceNumber(state.params.edgeDistance)
                : null
            return JSON.stringify({
                files: state.filesToNest,
                params: {
                    sheets: sheets.map((sheet) => ({
                        width: toMm(sheet.width),
                        height: toMm(sheet.height),
                        count: sentCount(sheet),
                        // Tôle importée d'un DXF : l'identifiant opaque (slug du
                        // dossier local) et RIEN d'autre — ni son nom, ni sa
                        // forme, qui restent dans le navigateur.
                        ...(sheet.shapeId ? { shapeId: String(sheet.shapeId) } : {}),
                        // Quantité illimitée : clé absente sinon.
                        ...(isUnlimitedSheet(sheet) ? { unlimited: true } : {}),
                    })),
                    // Legacy mirror of the first sheet — older workers/APIs only
                    // understand width/height/sheetCount.
                    width: toMm(first.width),
                    height: toMm(first.height),
                    sheetCount: sentCount(first),
                    tolerance: Number(state.params.tolerance),
                    space: toMm(state.params.space),
                    ...(edgeValue !== null ? { edgeDistance: displayToMm(edgeValue, unit) } : {}),
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
    return state
}

// Client: one tab = one user, the module singleton is the store.
const clientState = import.meta.client ? createFilesState() : null

// Server: ONE Nitro process renders every request. [slug].vue loads the
// project in an immediate watch that the render does not await, so the HTML
// showed the state left by the PREVIOUS getProject() — another user's
// project title, file names and « Nest N parts » included. The state now
// lives on the request's own nuxtApp.
const serverStates = new WeakMap()

function filesState() {
    if (import.meta.client) return clientState
    // Server reads belong in setup, middleware or render. After an await
    // unctx may hold ANOTHER request's nuxtApp (asyncContext is off): code
    // that awaits captures the state first (see getProject).
    const nuxtApp = tryUseNuxtApp()
    // No Nuxt context at all: an empty state that nothing else shares.
    if (!nuxtApp) return createFilesState()
    let state = serverStates.get(nuxtApp)
    if (!state) {
        state = createFilesState()
        serverStates.set(nuxtApp, state)
        // L'unité de CETTE requête, lue ici, dans son contexte : plus loin le contexte
        // courant peut être celui d'une autre. Les réglages d'usine sont écrits en mm :
        // un compte en pouces est rendu en pouces dès le HTML du serveur.
        const unit = getUnitState(nuxtApp)
        state.displayUnit = unit
        syncParamsToUnit(unit, { state })
    }
    return state
}

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
    // Server: the render is already sent, and a poll would run outside the
    // request (no cookie → 401 → navigateTo() without a Nuxt context).
    if (!import.meta.client) return
    const state = filesState()
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

async function getProject(path, fetchOpts = {}) {
    // Resolve the request's state (and, on the server, its nuxtApp) BEFORE
    // the first await: the Nuxt context is only guaranteed synchronously.
    const state = filesState()
    const nuxtApp = import.meta.client ? null : tryUseNuxtApp()
    state.lastProjectRequest = path
    try {
        // SSR: the caller (page setup) passes useRequestHeaders(['cookie'])
        // — useApiFetch() inside this store action has no Nuxt context
        // (watch/async) and 401'd → navigateTo('/home') on F5.
        const data = await $fetch(path, fetchOpts)
        if (path !== state.lastProjectRequest) return
        state.projectLocal = Boolean(data.local)
        state.projectDemo = Boolean(data.isDemo)
        if (data.local) {
            // J-090 : les fichiers d'un projet « 100 % privé » vivent dans
            // IndexedDB — le serveur ne sert que le nom/slug du projet.
            // SSR : pas d'IndexedDB — poser le slug/nom et laisser le
            // client hydrater. Sans ça F5 bounce vers /home (constat P4).
            if (import.meta.server) {
                setProjectFiles([], path, state)
                setProjectName(data.name || '', state)
                return
            }
            const { listLocalFiles } = await import('./localFilesStore')
            const { localRecordToUiFile } = await import('./localImport')
            const { titleFromFileName } = await import('../utils/projectTitle')
            const records = await listLocalFiles(data.slug)
            setProjectFiles(records.map(localRecordToUiFile), path, state)
            // Display name, IndexedDB only — never PATCH. Lot J11-a (A1) :
            // un projet issu d'un `.job` porte le NOM DU FICHIER `.job`
            // (c'est ce que l'atelier reconnaît), pas celui d'une fiche
            // « dessin (2/4) ». Repli : premier fichier, comme avant.
            const jobName = records.map((r) => r.sheetcam?.jobName).find(Boolean) || null
            const fromFile = titleFromFileName(jobName || records[0]?.name)
            setProjectName(fromFile || data.name || '', state)
        } else {
            if (data.name) setProjectName(data.name, state)
            setProjectFiles(data.files, path, state)
        }
    } catch (error) {
        if (path !== state.lastProjectRequest) return
        const onError = () => {
            if (error?.data?.statusMessage === 'vault_locked') {
                const vaultUnlockDialog = useVaultUnlockDialog();
                vaultUnlockDialog.value = true;
                return
            }
            console.error('Error fetching project:', error)
            navigateTo("/home");
        }
        // Server: run in THIS request's app. Without it the 404 of a foreign
        // slug redirected a concurrent render to /home, or threw NUXT_E1001
        // (no context) and turned the page into a 500.
        if (nuxtApp) nuxtApp.runWithContext(onError)
        else onError()
    }
}
// `state` is passed by getProject() after its await (see filesState()).
function setProjectName(name, state = filesState()) {
    state.projectName = name
}
function setProjectFiles(files, path, state = filesState()) {
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
    // Réglages écrits par la page pour la démo : gardés pour la démo seulement.
    // Un autre projet qui se charge pendant ce temps (même déjà ouvert) reprend
    // son instantané ou les réglages d'usine.
    const pending = state.pendingCuratedFor
    const keepCurated = pending != null && path === pending
    const strayCurated = pending != null && !keepCurated
    const snap = ((!sameProject || strayCurated) && path != null)
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
        // Constat 5 (revue lot V1, 02/11) : le refus de capacité (422) et
        // l'erreur de soumission appartiennent au projet SOUMIS. Sans cette
        // remise à zéro, le panneau à leviers de A s'affichait sur B, et son
        // bouton « Ajouter k tôles et relancer » modifiait B puis le
        // relançait (un crédit consommé) avec les chiffres de A.
        state.nestUnfit = null
        state.nestError = ''
        state.factorySheetReplaced = ''
        state.factorySheetReplacedLabel = null
    }
    if (!sameProject || strayCurated) {
        // Params du projet visité : son snapshot s'il existe (l'utilisateur
        // était déjà passé), sinon les curated defaults posés au montage
        // (démo, pour son seul chemin), sinon les défauts d'usine.
        if (snap) {
            // withKerfDefaults : snapshot posé avant le chantier kerf
            // (B.4) — même espacement effectif après migration.
            state.params = withKerfDefaults(JSON.parse(JSON.stringify(snap.params)))
            state.paramsUnit = snapshotUnit(snap, getUnitState())
        } else if (!keepCurated) {
            state.params = factoryParams()
            state.paramsUnit = 'mm'
        }
        // Réglages d'usine (en mm) ou retrouvés (dans l'unité d'alors) : sans ceci un
        // compte en pouces ouvrait son projet sur une tôle de 1000 × 2000 POUCES et
        // 2 pouces d'espacement (le sélecteur d'unité n'a rien à convertir tant que
        // l'unité ne change pas). Les réglages de la démo, eux, sont posés par la page
        // déjà dans l'unité affichée. Le serveur fait la même conversion, dans l'unité
        // de sa requête : le HTML servi porte déjà 48 × 96, pas 1000 × 2000.
        if (snap || !keepCurated) {
            // Serveur : l'unité de la requête portée par l'état (jamais le contexte
            // courant, voir filesState).
            syncParamsToUnit(state.displayUnit || getUnitState(), { restored: Boolean(snap), state })
        }
    }
    // Consommé à chaque chargement, même sur le projet déjà ouvert (retour à la
    // démo par l'accueil) : resté levé, le projet neuf suivant partait avec les
    // tôles de la démo.
    state.pendingCuratedFor = null
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
    const state = filesState()
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
    const state = filesState()
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
    const state = filesState()
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
    const state = filesState()
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
    const state = filesState()
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
    const state = filesState()
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
    const state = filesState()
    const list = [...files]
    const failedNames = []
    const reasons = new Set()
    let busyLots = 0
    let failedLots = 0
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
            failedLots += 1
            if (error?.data?.statusMessage === 'vault_busy') busyLots += 1
            failedNames.push(...lot.map((f) => f?.name || '?'))
        }
    }
    if (failedNames.length) {
        state.localImportError = 'upload.batchFailed'
        state.localImportErrorParams = {
            n: failedNames.length,
            names: failedNames.join(', '),
            reasons: [...reasons].join(' · '),
            // Coffre occupé pour tous les lots refusés : la raison traduite
            // (la page traduit les `reasonCodes`) plutôt que le texte anglais.
            ...(busyLots && busyLots === failedLots ? { reasonCodes: ['vault.error.busy'] } : {}),
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
 *     seul chemin qui garde `space = 2 × kerf + sécurité` cohérent, et
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
    const state = filesState()
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
    // Pas de `safetyMm` : le pre-remplissage suit la REGLE (2 x kerf + 1 mm),
    // pas la securite d'usine du projet — voir `prefillFromJob`.
    const prefill = prefillFromJob(read)
    if (prefill.sheet) {
        const u = getUnitState()
        updateParams({
            sheets: [{
                // Arrondi d'affichage fin (0,00001 pouce / 0,001 mm), comme une tôle
                // importée : jamais 39.37007874015748 dans le champ.
                width: shapeDisplayLength(prefill.sheet.width, u),
                height: shapeDisplayLength(prefill.sheet.height, u),
                count: 1,
            }],
        })
    }
    // Le fichier parle en mm : kerf et sécurité passent dans l'unité d'affichage,
    // comme la tôle (sinon un kerf de 1,5 mm devenait 1,5 pouce).
    if (prefill.kerf != null) {
        const u = getUnitState()
        updateKerfSafety({
            kerf: convertSmallLength(prefill.kerf, 'mm', u),
            safety: convertSmallLength(prefill.safety, 'mm', u),
        })
    }

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
        // Lot J11-ter : la chaîne `.then(() => import(…))` REMPLAÇAIT le
        // module résolu — `previewSvgWithLeads` était lu sur le MAUVAIS
        // module (undefined), l'appel jetait, et le catch « une amorce
        // ratée ne doit jamais casser la fiche » gardait l'aperçu SANS
        // amorces : la vue enrichie montrait une silhouette nue (NO-GO
        // J11-bis, R10). Deux imports distincts, résolus ensemble.
        const [{ previewSvgWithLeads }, { jobDrawings: blocksOf }] = await Promise.all([
            import('./localImport'),
            import('~~/shared/sheetcamJob.js'),
        ])
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
/** Quantité d'une tôle : un entier d'au moins 1. */
function isValidSheetCount(value) {
    return /^\d+$/.test(String(value)) && Number(value) >= 1
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
    const state = filesState()
    state.params = { ...state.params, ...param }
    scheduleSnapshotPersist()
}
/**
 * Chemin d'écriture UNIQUE des deux réglages explicites d'espacement
 * (B.4) : maintient `space` — la clé comprise par l'API et les deux
 * moteurs — en phase avec la règle space = 2 × kerf + sécurité.
 * Écrire `space` directement reste possible (levier capacité, démo),
 * mais alors sans kerf/safety cohérents la réouverture re-dériverait :
 * passer par ici partout.
 */
function updateKerfSafety(patch) {
    const state = filesState()
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
/**
 * Chemin d'écriture UNIQUE de la distance au bord. Ne touche ni kerf, ni
 * sécurité, ni `space`. '' (ou null) = comme l'espacement. La saisie est
 * gardée telle quelle (le champ est un texte : '-' ou '-1.' en cours de
 * frappe sont admis, la validation est dans isInvalidParams).
 */
function updateEdgeDistance(value) {
    const state = filesState()
    state.params = {
        ...state.params,
        edgeDistance: value == null ? '' : String(value),
    }
    scheduleSnapshotPersist()
}
function updateSheet(index, patch) {
    const state = filesState()
    const sheets = normalizedSheets(state.params).map((sheet, i) => {
        if (i !== index) return sheet
        // Tôle importée (shapeId) : width/height = boîte englobante du contour,
        // pas éditables (seul le nombre l'est) ; shapeId/name passent par
        // replaceSheetShape, jamais par un patch libre.
        if (sheet.shapeId) {
            const rest = { ...patch }
            for (const key of ['width', 'height', 'shapeId', 'name']) delete rest[key]
            return { ...sheet, ...rest }
        }
        return { ...sheet, ...patch }
    })
    state.params = { ...state.params, sheets }
    scheduleSnapshotPersist()
}
/**
 * Coche ou décoche « Quantité illimitée » d'une tôle. Cochée : `unlimited: true`
 * (la quantité saisie est gardée, mise à '1' si elle était invalide ou nulle).
 * Décochée : la clé est RETIRÉE (jamais `false`).
 */
function setSheetUnlimited(index, unlimited) {
    const state = filesState()
    const sheets = normalizedSheets(state.params).map((sheet, i) => {
        if (i !== index) return sheet
        const next = { ...sheet }
        if (!unlimited) {
            delete next.unlimited
            return next
        }
        if (!isValidSheetCount(next.count)) next.count = '1'
        next.unlimited = true
        return next
    })
    state.params = { ...state.params, sheets }
    scheduleSnapshotPersist()
}
function addSheet() {
    const state = filesState()
    const sheets = normalizedSheets(state.params)
    // Au plafond de formats : le bouton est grisé, ceci n'est qu'un filet.
    if (sheets.length >= MAX_SHEET_FORMATS) return
    state.factorySheetReplaced = '' // la note a été lue : elle ne revient pas
    const last = sheets[sheets.length - 1] || { ...DEFAULT_SHEET.mm, count: '1' }
    // Une tôle simple : la copie d'une tôle importée ne reprend pas son
    // shapeId (width/height = sa boîte englobante, éditables), ni la quantité
    // illimitée.
    const plain = { ...last, count: '1' }
    delete plain.shapeId
    delete plain.name
    delete plain.unlimited
    state.params = { ...state.params, sheets: [...sheets, plain] }
    scheduleSnapshotPersist()
}

// Longueur mm -> chaîne d'affichage (unité courante) pour une tôle importée.
// Plus fine que la saisie (0,001 mm / 0,00001") : width/height repartent en mm
// via displayToMm, l'arrondi d'affichage ne doit pas rogner la tôle.
function shapeDisplayLength(mm, unit) {
    const v = mmToDisplay(mm, unit)
    return v.toFixed(unit === 'inch' ? 5 : 3).replace(/\.?0+$/, '') || '0'
}
function shapeSheetEntry(record, count) {
    const unit = getUnitState()
    return {
        width: shapeDisplayLength(record.widthMm, unit),
        height: shapeDisplayLength(record.heightMm, unit),
        count: String(count),
        shapeId: record.slug,
        name: record.name,
    }
}
/**
 * Ajoute une tôle issue d'un DXF. Seuls shapeId, nom et boîte englobante
 * entrent dans les réglages (donc dans le snapshot sessionStorage) ; la
 * géométrie reste dans IndexedDB (localSheetsStore).
 */
function addSheetFromShape(record, { hasResult = false } = {}) {
    const state = filesState()
    const sheets = normalizedSheets(state.params)
    // --- Tôle d'usine intacte REMPLACÉE (à valider par le propriétaire) : ce bloc,
    // `factorySheetReplaced` et la note des réglages s'enlèvent ensemble. Sans
    // résultat encore : un calcul déjà fait garde sa tôle, l'import s'ajoute.
    // Une tôle d'usine cochée « quantité illimitée » a été réglée : elle reste.
    if (!hasResult && isUntouchedFactorySheet(sheets, state.paramsUnit) && !isUnlimitedSheet(sheets[0])) {
        const factory = factorySheetOf(state.paramsUnit)
        state.params = { ...state.params, sheets: [shapeSheetEntry(record, 1)] }
        state.factorySheetReplaced = record.slug
        state.factorySheetReplacedLabel = { w: factory.width, h: factory.height, unit: unitLabel(state.paramsUnit) }
        scheduleSnapshotPersist()
        return
    }
    state.factorySheetReplaced = '' // la note a été lue : elle ne revient pas
    // --- fin du bloc
    state.params = { ...state.params, sheets: [...sheets, shapeSheetEntry(record, 1)] }
    scheduleSnapshotPersist()
}
/** Remplace la forme de la tôle `index` (quantité conservée). */
function replaceSheetShape(index, record) {
    const state = filesState()
    const sheets = normalizedSheets(state.params)
    if (!Number.isInteger(index) || index < 0 || index >= sheets.length) return
    // La quantité de la ligne est gardée, illimitée comprise.
    const replaced = (sheet) => ({
        ...shapeSheetEntry(record, sheet.count),
        ...(isUnlimitedSheet(sheet) ? { unlimited: true } : {}),
    })
    state.params = {
        ...state.params,
        sheets: sheets.map((sheet, i) => (i === index ? replaced(sheet) : sheet)),
    }
    state.shapeRevision++
    // Une retouche qui laisse le corps de la requête identique (même boîte, même nom) ne doit pas
    // griser Nest : la forme, elle, a changé.
    resetLastParams()
    scheduleSnapshotPersist()
}

// Kerf et sécurité : petites longueurs, résolution fine (0,01 mm / 0,0001").
function convertSmallLength(v, fromUnit, toUnit) {
    if (fromUnit === toUnit) return v
    const n = Number(String(v).replace(',', '.'))
    if (!Number.isFinite(n)) return v
    const mm = fromUnit === 'inch' ? n * MM_PER_INCH : n
    const out = toUnit === 'inch' ? mm / MM_PER_INCH : mm
    const d = toUnit === 'inch' ? 4 : 2
    return out.toFixed(d).replace(/\.?0+$/, '')
}
// Distance au bord d'une unité à l'autre : vide intact, '-0' normalisé en '0'.
function convertEdgeDistance(v, fromUnit, toUnit) {
    if (!isEdgeDistanceSet(v)) return ''
    if (edgeDistanceNumber(v) === null) return v
    const out = convertSmallLength(v, fromUnit, toUnit)
    return out === '-0' ? '0' : out
}
/**
 * Brings the in-progress form values to `toUnit` (called on unit switch AND
 * on init, when the cookie/DB preference differs from the mm factory
 * defaults). Sheets exactly matching a standard preset snap to the
 * equivalent REGIONAL standard (1000×2000 mm -> 48×96", never
 * 39.37×78.74"); custom sizes and the spacing are converted numerically
 * (0.1 mm <-> 0.004" round-trips exactly through the display trimming).
 * `restored` : réglages d'un projet simplement ROUVERT dans l'autre unité. Une vraie
 * tôle de 1000 × 2000 ne doit pas devenir un 48 × 96 (puis 1250 × 2500 au retour) :
 * conversion numérique ; seule la tôle d'usine intacte devient celle de l'unité.
 */
function syncParamsToUnit(toUnit, { restored = false, state = filesState() } = {}) {
    if (!toUnit || state.paramsUnit === toUnit) return
    const fromUnit = state.paramsUnit
    // B.3/B.4 : kerf et sécurité sont des longueurs comme space — la
    // conversion les prend, puis space est RECALCULÉ depuis eux pour que
    // la règle space = 2 × kerf + sécurité reste exacte après un switch
    // d'unité (pas d'arrondis cumulés indépendants).
    const p = withKerfDefaults(state.params)
    const sheets = normalizedSheets(p)
    const conv = (v) => convertInputValue(v, fromUnit, toUnit)
    // Kerf et sécurité sont des PETITES longueurs (typ. 0-3 mm) : la
    // résolution standard des champs (0,1 mm / 0,001") ferait dériver la
    // demi-valeur héritée d'un ancien espacement (0,05 mm -> 0,1 mm au
    // retour d'inch). Résolution fine dédiée : 0,01 mm / 0,0001".
    const convFine = (v) => convertSmallLength(v, fromUnit, toUnit)
    const convSheet = (s) => {
        // Tôle importée : conversion numérique fine, jamais calée sur un standard.
        if (s.shapeId) {
            const mm = (v) => (fromUnit === 'inch' ? Number(v) * MM_PER_INCH : Number(v))
            return { ...s, width: shapeDisplayLength(mm(s.width), toUnit), height: shapeDisplayLength(mm(s.height), toUnit) }
        }
        const eq = !restored ? equivalentSheetPreset(s.width, s.height, fromUnit, toUnit)
            : isUntouchedFactorySheet(sheets, fromUnit) ? factorySheetOf(toUnit) : null
        return eq ? { ...s, ...eq } : { ...s, width: conv(s.width), height: conv(s.height) }
    }
    const kerf = convFine(p.kerf)
    const safety = convFine(p.safety)
    // Distance au bord : '' (ou absente) reste telle quelle — convertSmallLength('')
    // rendrait '0', un bord explicite à zéro. Une saisie illisible reste aussi.
    const edgeDistance = convertEdgeDistance(p.edgeDistance, fromUnit, toUnit)
    state.params = {
        ...p,
        edgeDistance,
        sheets: sheets.map(convSheet),
        kerf,
        safety,
        space: spacingFromKerfSafety(kerf, safety),
    }
    state.paramsUnit = toUnit
    scheduleSnapshotPersist()
}
function removeSheet(index) {
    const state = filesState()
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
    return rotationAngles(count)
}
function increment(index, event) {
    const state = filesState()
    const step = event && event.shiftKey ? 10 : 1
    if (state.projectFiles[index].count + step <= 999) {
        state.projectFiles[index].count += step
    } else {
        state.projectFiles[index].count = 999
    }
    scheduleSnapshotPersist()
}
function decrement(index, event) {
    const state = filesState()
    const step = event && event.shiftKey ? 10 : 1
    if (state.projectFiles[index].count - step >= 0) {
        state.projectFiles[index].count -= step
    } else {
        state.projectFiles[index].count = 0
    }
    scheduleSnapshotPersist()
}
function updateCount(value, index) {
    const state = filesState()
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
    const state = filesState()
    if (state.projectFiles[index]) {
        state.projectFiles[index].rotation = value
    }
    scheduleSnapshotPersist()
}
async function nest(slug) {
    const state = filesState()
    // R-2 (audit 2026-08-31 §R-1) : garde de double soumission — un 2e clic
    // pendant la latence du POST passait le compteur de concurrence serveur
    // et pouvait doubler la charge de quota.
    if (state.nestBusy) return
    state.nestBusy = true
    state.nestRearmed = false
    // Course (constat 5 + reliquats de la revue adverse) : tout ce que nest()
    // écrit dans le store MODULE après un await (nestError, nestUnfit,
    // lastParams, fenêtre de résultat) ne vaut que si l'utilisateur est
    // toujours sur le projet soumis. state.projectSlug porte le CHEMIN d'API
    // complet (cf. AGENTS #63), pas le slug nu. Sinon la réponse tardive de
    // A abîmerait B : erreur rouge, bouton Nest grisé (lastParams prend le
    // corps de B), fenêtre de résultat de A.
    const stillOnSubmittedProject = () => state.projectSlug === API_ROUTES.PROJECT(slug)
    const refuseSubmission = (key) => {
        state.nestError = key
        state.nestRefusals += 1
    }
    try {
        try {
            state.nestError = ''
            state.nestUnfit = null
            state.demoQuotaReached = false
            // Défense (le bouton Nest est déjà grisé) : trop de formats. Refus
            // SYNCHRONE : aucun await avant le POST, le corps part tel qu'au clic.
            if (normalizedSheets(state.params).length > MAX_SHEET_FORMATS) {
                refuseSubmission('nest.error.tooManyFormats')
                return
            }
            const data = await $fetch(API_ROUTES.NEST(slug), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: state.requestBody
            })
            if (stillOnSubmittedProject()) setModalNestData(data)
            // Refresh the cached user so the free-quota banner reflects the
            // operation that was just consumed.
            await authStore.actions.setUser()
        } catch (error) {
            if (error?.data?.statusMessage === 'capacity_exceeded') {
                // Z1 (vérif 2026-09-05) : refus 422 du pré-contrôle de
                // capacité (SANS quota consommé) — le bandeau à leviers de
                // la page prend le relais du message générique.
                // Course (constat 5) : le 422 de A qui arrive APRÈS le
                // chargement de B ne se range pas — l'utilisateur n'est plus
                // sur le projet soumis.
                if (!stillOnSubmittedProject()) return
                state.nestUnfit = error?.data?.data?.unfit || null
                return
            }
            if (error?.data?.statusMessage === 'too_many_formats') {
                // Plafond de formats (400, avant toute charge) : le client grise Nest
                // d'ordinaire avant ; ici il a été contourné.
                if (stillOnSubmittedProject()) refuseSubmission('nest.error.tooManyFormats')
                return
            }
            if (error?.data?.statusMessage === 'edge_distance_dwg' || error?.data?.statusMessage === 'edge_distance_local_only') {
                // Distance au bord refusée (400, avant toute charge) : le champ est
                // grisé d'ordinaire (edgeBlock) ; ici l'écran a été contourné.
                if (stillOnSubmittedProject()) {
                    refuseSubmission(error.data.statusMessage === 'edge_distance_dwg'
                        ? 'settings.edgeNoDwg'
                        : 'settings.edgeLocalOnly')
                }
                return
            }
            if (error?.data?.statusMessage === 'too_many_sheets') {
                // d6 (02/11) : borne technique serveur (400, avant toute
                // charge) — le miroir client (sheetCountTooHigh) grise Nest
                // d'ordinaire avant ; ici le client a été contourné.
                if (stillOnSubmittedProject()) refuseSubmission('nest.error.maxSheets')
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
                // AGENTS #29 : l'override runtime arrive en CHAÎNE ('true').
                const paidDisabled = flagOn(useRuntimeConfig().public.paidPlansDisabled)
                if (!paidDisabled) {
                    // D13 : la fenêtre sait pourquoi elle s'ouvre (quota épuisé).
                    useBuyCreditsContext().value = { source: 'quota' }
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
            if (!stillOnSubmittedProject()) return
            refuseSubmission(error?.data?.statusMessage === 'concurrent_limit'
                ? 'nest.error.concurrent'
                : 'nest.error.generic')
            return
        }

        await Promise.all([getProjects()])

        // Succès tardif de A alors que B est chargé : state.requestBody est
        // celui de B — le ranger dans lastParams grisait le bouton Nest de B.
        if (stillOnSubmittedProject() && !state.nestRearmed) state.lastParams = state.requestBody
    } catch (err) {
        console.error('Nest operation failed:', err)
    } finally {
        state.nestBusy = false
    }
}

/** Z1 (vérif 2026-09-05) : ferme le bandeau capacité (après action). */
function dismissNestUnfit() {
    filesState().nestUnfit = null
}

/** AA2 (vérif L1 2026-09-05) : appelé sur toute annulation et tout échec de job —
 * le bouton Nest redevient actif avec les MÊMES paramètres (isNewParams repasse
 * à vrai ; sans ce reset, il fallait modifier un réglage ou recharger). */
function resetLastParams() {
    const state = filesState()
    state.lastParams = ''
    if (state.nestBusy) state.nestRearmed = true
}

/**
 * Fichier de projet `.nestorcut` (note du coffre « Fichier de projet
 * nestorcut ») : ce que le fichier emporte du projet ouvert. Réglages dans
 * leur unité, et quantité et rotation de chaque fiche, dans l'ordre affiché.
 */
function projectFileSettings() {
    const state = filesState()
    return {
        params: JSON.parse(JSON.stringify(state.params)),
        paramsUnit: state.paramsUnit,
        files: (state.projectFiles || []).map((file) => ({
            slug: file.slug,
            count: Number(file.count) || 0,
            rotation: file.rotation ?? null,
        })),
    }
}

/**
 * Réglages d'onglet d'un projet rouvert depuis un fichier, posés AVANT d'y
 * naviguer : son chargement les reprend comme ceux d'un projet déjà visité
 * (setProjectFiles), conversion d'unité comprise.
 */
function seedProjectSnapshot(path, snap) {
    if (!import.meta.client || path == null || !snap) return
    projectSnapshots.delete(path)
    projectSnapshots.set(path, snap)
    if (projectSnapshots.size > PROJECT_SNAPSHOT_MAX) {
        projectSnapshots.delete(projectSnapshots.keys().next().value)
    }
    persistSnapshotsToStorage()
}

// Client: plain computeds over the tab's singleton, as before. Server: a ref
// resolved on every read — a module-level computed would cache the first
// request's state for every later one.
const getter = (read) => import.meta.client
    ? computed(() => read(clientState))
    : customRef(() => ({ get: () => read(filesState()), set: () => {} }))

export const filesStore = readonly({
    getters: {
        projectFiles: getter((state) => state.projectFiles),
        projectSlug: getter((state) => state.projectSlug),
        projectName: getter((state) => state.projectName),
        projectDemo: getter((state) => state.projectDemo),
        projectLocal: getter((state) => state.projectLocal),
        edgeBlock: getter((state) => state.edgeBlock),
        localImportError: getter((state) => state.localImportError),
        localImportNotice: getter((state) => state.localImportNotice),
        localImportNoticeParams: getter((state) => state.localImportNoticeParams),
        localImportErrorParams: getter((state) => state.localImportErrorParams),
        filesCount: getter((state) =>
            state.filesStatusDone.reduce((acc, curr) => acc + curr.count, 0)
        ),
        isNewParams: getter((state) => state.requestBody !== state.lastParams),
        // Corps JSON de la prochaine demande de nesting (lu par les tests).
        requestBody: getter((state) => state.requestBody),
        shapeRevision: getter((state) => state.shapeRevision),
        demoQuotaReached: getter((state) => state.demoQuotaReached),
        // d6 : miroir UX de la borne technique (Σ count > MAX_SHEETS_PER_JOB),
        // quantités illimitées non comptées (comme le serveur).
        sheetCountTooHigh: getter((state) => exceedsMaxSheets(sheetsForProject(normalizedSheets(state.params), state.projectLocal))),
        nestError: getter((state) => state.nestError),
        nestRefusals: getter((state) => state.nestRefusals),
        // Plus de formats que le serveur n'en prend : refusé ici avant le POST.
        sheetFormatsTooMany: getter((state) => normalizedSheets(state.params).length > MAX_SHEET_FORMATS),
        sheetFormatsAtLimit: getter((state) => normalizedSheets(state.params).length >= MAX_SHEET_FORMATS),
        factorySheetReplaced: getter((state) => state.factorySheetReplaced),
        factorySheetReplacedLabel: getter((state) => state.factorySheetReplacedLabel),
        nestUnfit: getter((state) => state.nestUnfit),
        nestBusy: getter((state) => state.nestBusy),
        params: getter((state) => state.params),
        nestRequestError: getter((state) => {
            if (filesStore.getters.filesCount < 1) {
                // Projet demandé, réponse pas encore là (rendu serveur,
                // premier rendu client, navigation entre projets) : zéro
                // fichier n'est pas un constat — sans ce garde, le HTML servi
                // affichait « Select at least one file » en rouge jusqu'au
                // fetch client. Les paramètres invalides, eux, restent signalés.
                const loading = state.lastProjectRequest != null && state.lastProjectRequest !== state.projectSlug
                // Local empty IndexedDB is a state, not a form error (ux1).
                return loading || state.projectLocal ? '' : 'project.needFiles'
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
        updateEdgeDistance,
        updateSheet,
        setSheetUnlimited,
        // Lot E4-b/E4-c : actions « Échelle » et « Éclater » SUR LA FICHE.
        openFicheScale,
        applyFicheScale,
        resetFicheScale,
        explodeFiche,
        addSheet,
        addSheetFromShape,
        replaceSheetShape,
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
        projectFileSettings,
        seedProjectSnapshot,
    }
})
