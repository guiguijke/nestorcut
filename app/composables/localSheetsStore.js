/**
 * Tôles importées depuis un DXF : stockage IndexedDB, navigateur seulement.
 * La géométrie (contour, zones) ne part JAMAIS au serveur : ni dans le corps
 * de requête, ni dans le snapshot sessionStorage (seuls shapeId, nom et
 * dimensions y figurent, voir files.js).
 *
 * Base IndexedDB DÉDIÉE `nestorcut-sheets` (v1, store `sheets`, keyPath
 * `slug`, index `projectSlug`), et NON la base partagée `nestorcut-local`.
 * Raison : monter la version de `nestorcut-local` serait bloqué tant qu'un
 * autre onglet fait encore tourner l'ancien code, qui tient une connexion en
 * version 3 sans gestionnaire `versionchange` ; chaque import local du nouvel
 * onglet resterait alors suspendu. Une base à part ne touche jamais au schéma
 * de `results` ni de `files` : leurs listings restent strictement inchangés
 * (listLocalFiles ne voit aucune tôle).
 *
 * Chaque connexion ouverte ici se ferme sur `versionchange` (et oublie sa
 * promesse en cache) pour ne jamais bloquer une future montée de version ;
 * `blocked` rejette avec `indexeddb_blocked`.
 *
 * Deux sortes d'enregistrements, même store :
 *   - tôle de projet : projectSlug = slug du projet ;
 *   - bibliothèque « tôles récentes » : projectSlug null, slug
 *     `recent-{geometryKey}`, copie qui survit aux projets (dédupliquée
 *     par geometryKey, 12 entrées max, la plus ancienne lastUsedAt sort).
 *
 * Jamais appelé côté serveur (SSR) : aucun accès IndexedDB au top level.
 */
const DB_NAME = 'nestorcut-sheets'
const DB_VERSION = 1
const STORE = 'sheets'
export const MAX_RECENT_SHEETS = 12

const hasDrawn = (rec) => Array.isArray(rec?.drawn) && rec.drawn.length > 0

let dbPromise = null

function openDb() {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('indexeddb_unavailable'))
    dbPromise = dbPromise || new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
            const db = req.result
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'slug' })
                    .createIndex('projectSlug', 'projectSlug', { unique: false })
            }
        }
        req.onsuccess = () => {
            const db = req.result
            db.onversionchange = () => {
                db.close()
                dbPromise = null
            }
            // Connexion fermée par le navigateur (stockage purgé, profil fermé) :
            // sans ceci la connexion gardée en cache échouait jusqu'au rechargement.
            db.onclose = () => {
                dbPromise = null
            }
            resolve(db)
        }
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('indexeddb_blocked'))
    })
    // Un échec (navigation privée, quota, blocage) ne doit pas être caché
    // pour toujours : remettre à null permet de retenter au prochain appel.
    dbPromise.catch(() => { dbPromise = null })
    return dbPromise
}

function tx(db, mode) {
    return db.transaction(STORE, mode).objectStore(STORE)
}

function request(makeRequest) {
    return new Promise((resolve, reject) => {
        const r = makeRequest()
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
    })
}

function compareStamp(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b
    return String(a ?? '').localeCompare(String(b ?? ''))
}

export async function saveSheet(record) {
    const db = await openDb()
    await request(() => tx(db, 'readwrite').put(record))
}

export async function getSheet(slug) {
    const db = await openDb()
    return (await request(() => tx(db, 'readonly').get(slug))) || null
}

/** Tôles d'un projet, par date d'ajout croissante. */
export async function listProjectSheets(projectSlug) {
    if (projectSlug == null) return []
    const db = await openDb()
    const all = await request(() => tx(db, 'readonly').index('projectSlug').getAll(projectSlug))
    return [...(all || [])].sort((a, b) => compareStamp(a.addedAt, b.addedAt))
}

export async function deleteSheet(slug) {
    const db = await openDb()
    await request(() => tx(db, 'readwrite').delete(slug))
}

/** Supprime les tôles du projet (jamais la bibliothèque). Au mieux, comme purgeProjectFiles. */
export async function deleteProjectSheets(projectSlug) {
    if (projectSlug == null) return
    const db = await openDb()
    const all = await listProjectSheets(projectSlug)
    await Promise.all(all.map((rec) => new Promise((resolve) => {
        const r = tx(db, 'readwrite').delete(rec.slug)
        r.onsuccess = () => resolve()
        r.onerror = () => resolve()
    })))
}

async function allRecents() {
    const db = await openDb()
    const all = await request(() => tx(db, 'readonly').getAll())
    return (all || []).filter((rec) => rec?.projectSlug == null)
}

/** Bibliothèque : la plus récemment utilisée d'abord. */
export async function listRecentSheets() {
    const recents = await allRecents()
    return recents.sort((a, b) => compareStamp(b.lastUsedAt, a.lastUsedAt) || String(a.slug).localeCompare(String(b.slug)))
}

/**
 * Range une copie (projectSlug null) de la tôle. Même geometryKey déjà
 * présente : seul lastUsedAt est rafraîchi (nom et date d'ajout d'origine
 * gardés). `now` = horodatage ISO (ou nombre) fourni par l'appelant.
 */
export async function rememberRecentSheet(record, now) {
    const all = await allRecents()
    const existing = all.find((rec) => rec.geometryKey === record.geometryKey)
    // `fromSlug` : la tôle de projet dont vient la copie (relie les versions successives d'une même tôle).
    const fromSlug = record.fromSlug ?? record.slug
    const copy = existing
        ? { ...existing, fromSlug: existing.fromSlug ?? fromSlug, lastUsedAt: now }
        : { ...record, slug: `recent-${record.geometryKey}`, projectSlug: null, fromSlug, lastUsedAt: now }
    await saveSheet(copy)
    // Une tôle à défauts remplace les versions à défauts de la MÊME tôle (une retouche ne laisse pas
    // ses brouillons en bibliothèque) ; la version propre, elle, reste.
    if (hasDrawn(copy)) {
        for (const rec of all) {
            if (rec.slug !== copy.slug && hasDrawn(rec) && rec.fromSlug != null && rec.fromSlug === copy.fromSlug) {
                await deleteSheet(rec.slug)
            }
        }
    }
    const recents = await listRecentSheets()
    for (const rec of recents.slice(MAX_RECENT_SHEETS)) {
        await deleteSheet(rec.slug)
    }
    return copy
}

export async function forgetRecentSheet(slug) {
    const rec = await getSheet(slug)
    if (rec && rec.projectSlug == null) await deleteSheet(slug)
}
