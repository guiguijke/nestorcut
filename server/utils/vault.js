import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { connectDB } from '../db/mongo'
import { DEMO_OWNER_ID } from '../../shared/constants/demo.constants'
import {
    ENC_FLAG,
    createDecryptStream,
    createEncryptStream,
    decryptBuffer,
    polygonPartsAadId,
} from './crypto'

/**
 * Vault session cache (D-PRV-7) — the only place a DEK exists server-side.
 *
 * Process-local RAM only: userId → { dek, expiresAt }. NOTHING is persisted
 * (the legacy `session_keys` Mongo collection with its master-key-wrapped
 * DEKs is dropped at boot by the vault-dprv7 plugin): a database dump or
 * backup can no longer expose even a wrapped DEK. Sliding TTL (2h) refreshed
 * on activity; expired entries are wiped (Buffer.fill(0)) opportunistically
 * on access — no timers. A process restart drops every session (users simply
 * re-unlock). Mono-instance deployment is assumed: future app replicas will
 * need sticky sessions.
 */

export const VAULT_SESSION_TTL_MS = 2 * 60 * 60 * 1000

/** @type {Map<string, { dek: Buffer, expiresAt: number }>} */
const sessions = new Map()

function wipeEntry(entry) {
    entry.dek.fill(0)
}

/**
 * Opportunistic sweep of expired sessions (wipe + delete). The Map is tiny
 * (one entry per unlocked user), so an O(n) scan on each access is fine and
 * avoids any timer.
 */
function sweepExpired(now) {
    for (const [userId, entry] of sessions) {
        if (entry.expiresAt <= now) {
            wipeEntry(entry)
            sessions.delete(userId)
        }
    }
}

/**
 * Opens (or replaces) a vault session. Stores a DEFENSIVE COPY of the DEK —
 * the session owns its buffer regardless of what the caller does with its
 * own. Any previous session for the user is wiped first.
 */
export async function createVaultSession(userId, dekBuffer) {
    const previous = sessions.get(userId)
    if (previous) wipeEntry(previous)
    const expiresAt = Date.now() + VAULT_SESSION_TTL_MS
    sessions.set(userId, { dek: Buffer.from(dekBuffer), expiresAt })
    return { expiresAt: new Date(expiresAt) }
}

/**
 * Returns a COPY of the live DEK when an active session exists (sliding TTL
 * refresh), null otherwise. Expired entries are wiped on the way.
 *
 * Une copie : une requête garde sa clé jusqu'au bout. Rendue partagée, une
 * déconnexion, un déverrouillage depuis un autre onglet ou l'expiration la
 * remettait à zéro pendant un envoi, et les fichiers partaient chiffrés avec
 * une clé nulle (illisibles avec la clé de l'utilisateur, lisibles par tous).
 */
export async function getVaultSession(userId) {
    const entry = touchSession(userId)
    if (!entry) return null
    return { dek: Buffer.from(entry.dek), expiresAt: new Date(entry.expiresAt) }
}

// Session vivante (TTL glissant) sans copier la clé : le statut, interrogé
// souvent, n'a pas à semer des copies dans la mémoire.
function touchSession(userId) {
    const now = Date.now()
    sweepExpired(now)
    const entry = sessions.get(userId)
    if (!entry) return null
    entry.expiresAt = now + VAULT_SESSION_TTL_MS
    return entry
}

/**
 * Remplace la clé d'une session OUVERTE (fin de rotation). Sans session, rien
 * n'est créé et la réponse est null : une déconnexion survenue pendant la
 * rotation laisse le coffre verrouillé.
 */
export async function replaceOpenVaultSession(userId, dekBuffer) {
    sweepExpired(Date.now())
    if (!sessions.has(userId)) return null
    return createVaultSession(userId, dekBuffer)
}

export async function clearVaultSessions(userId) {
    const entry = sessions.get(userId)
    if (entry) {
        wipeEntry(entry)
        sessions.delete(userId)
    }
}

/*
 * Coffre occupé. Une rotation de clé, un retrait ou une destruction réécrit
 * ou efface TOUS les fichiers chiffrés de l'utilisateur. Un envoi d'un autre
 * onglet ou un worker qui tient déjà la clé écrivait pendant ce temps avec
 * l'ANCIENNE clé : ces fichiers ne s'ouvraient plus (reproduit en production
 * le 26/11). Règles :
 *  - l'opération marque le coffre occupé, puis attend la fin des envois déjà
 *    partis (ils tiennent l'ancienne clé) ;
 *  - un envoi qui arrive pendant l'opération attend sa fin, puis relit la
 *    clé (nouvelle clé, ou envoi en clair après un retrait) ;
 *  - un worker qui tient la clé (job réclamé, battement récent) fait refuser
 *    la rotation et le retrait : il garde sa clé jusqu'au bout du job ;
 *  - /job-dek ne remet aucune clé pendant l'opération ; il attend sa fin.
 * Tout est en mémoire, comme les sessions : une seule instance d'app.
 */

/** Un envoi qui arrive pendant une rotation ou un retrait attend au plus ce délai. */
export const VAULT_BUSY_WAIT_MS = 30_000
/** Une rotation ou un retrait attend au plus ce délai la fin des envois en cours. */
export const VAULT_DRAIN_WAIT_MS = 30_000
/** /job-dek attend au plus ce délai : sous les 15 s d'attente du worker (crypto.py). */
export const JOB_DEK_BUSY_WAIT_MS = 12_000
/** Battement du worker toutes les 10 s (worker_loop.py) : au-delà, il est mort. */
export const WORKER_STALE_MS = 15 * 60 * 1000
// Collections des jobs dont un worker peut tenir la clé (mêmes que job-dek).
const WORKER_COLLECTIONS = ['nesting_jobs', 'user_dxf_files']

/** @type {Map<string, { op: string, done: Promise<void> }>} */
const busyOps = new Map()
/** @type {Map<string, { count: number, waiters: Set<() => void> }>} */
const writeLeases = new Map()
// Une unité de plus à chaque opération commencée : un déverrouillage qui a lu
// l'empreinte avant une rotation ne rouvre pas la session sur l'ancienne clé.
/** @type {Map<string, number>} */
const generations = new Map()

function vaultBusyError() {
    return createError({
        statusCode: 409,
        statusMessage: 'vault_busy',
        message: 'Your vault is busy (key change, removal, upload or job in progress). Try again in a moment.',
    })
}

/** Numéro de la dernière opération commencée sur le coffre de l'utilisateur. */
export function vaultGeneration(userId) {
    return generations.get(userId) || 0
}

/**
 * Déverrouillage : à appeler juste avant createVaultSession, dans le même
 * segment synchrone. 409 vault_busy si une opération tourne ou a commencé
 * depuis `generation` (relevé avant de lire l'empreinte) : l'empreinte lue
 * est peut-être celle d'une clé remplacée ou d'un coffre retiré.
 */
export function assertVaultUnchangedSince(userId, generation) {
    if (busyOps.has(userId) || vaultGeneration(userId) !== generation) throw vaultBusyError()
}

// Attend la fin de l'opération en cours, sans dépasser `deadline`. Rend false
// à l'échéance. L'appelant reteste `busyOps` APRÈS, dans le même segment
// synchrone que son action : aucune opération ne peut commencer entre les deux.
async function waitForVaultOperation(userId, deadline) {
    const current = busyOps.get(userId)
    if (!current) return true
    const left = deadline - Date.now()
    if (left <= 0) return false
    let timer
    const finished = await Promise.race([
        current.done.then(() => true),
        new Promise((resolve) => { timer = setTimeout(() => resolve(false), left) }),
    ])
    clearTimeout(timer)
    return finished
}

function takeWriteLease(userId) {
    let lease = writeLeases.get(userId)
    if (!lease) {
        lease = { count: 0, waiters: new Set() }
        writeLeases.set(userId, lease)
    }
    lease.count += 1
    let released = false
    return () => {
        if (released) return
        released = true
        lease.count -= 1
        if (lease.count === 0) {
            if (writeLeases.get(userId) === lease) writeLeases.delete(userId)
            for (const wake of lease.waiters) wake()
        }
    }
}

// Le coffre est déjà marqué occupé : aucun envoi nouveau ne commence, le
// compteur ne peut que descendre.
async function waitWritesDrained(userId, deadline) {
    const lease = writeLeases.get(userId)
    if (!lease || lease.count === 0) return true
    const left = deadline - Date.now()
    if (left <= 0) return false
    let timer
    let wake
    const drained = await new Promise((resolve) => {
        wake = () => resolve(true)
        lease.waiters.add(wake)
        timer = setTimeout(() => resolve(false), left)
    })
    clearTimeout(timer)
    lease.waiters.delete(wake)
    return drained
}

/**
 * Un worker tient-il la clé de l'utilisateur ? `workerKeyPub` est posé avant
 * la demande de clé et retiré à la fin du job (crypto.py). Le statut
 * « processing » compte aussi : un worker qui remet une fiche en file retire
 * le marqueur sans condition, même si un autre worker l'a réclamée entre-temps.
 * Le battement `update_ts` écarte un worker mort.
 */
export async function workerHoldsVaultKey(db, userId, now = Date.now()) {
    const since = new Date(now - WORKER_STALE_MS)
    for (const name of WORKER_COLLECTIONS) {
        const doc = await db.collection(name).findOne(
            {
                ownerId: userId,
                update_ts: { $gte: since },
                $or: [
                    { workerKeyPub: { $exists: true } },
                    { status: 'processing' },
                    { processingStatus: 'processing' },
                ],
            },
            { projection: { _id: 1 } }
        )
        if (doc) return true
    }
    return false
}

/**
 * Marque le coffre occupé pour une rotation, un retrait ou une destruction.
 * 409 vault_busy si une autre opération tourne, si un worker tient la clé
 * (`checkWorkers`) ou si un envoi en cours ne finit pas à temps. Rend `end()`,
 * à appeler dans un `finally`.
 */
export async function beginVaultOperation(userId, op, { db = null, checkWorkers = true, drainMs = VAULT_DRAIN_WAIT_MS } = {}) {
    if (busyOps.has(userId)) throw vaultBusyError()
    let resolveDone
    const entry = { op, done: new Promise((resolve) => { resolveDone = resolve }) }
    busyOps.set(userId, entry)
    generations.set(userId, vaultGeneration(userId) + 1)
    let ended = false
    const end = () => {
        if (ended) return
        ended = true
        if (busyOps.get(userId) === entry) busyOps.delete(userId)
        resolveDone()
    }
    try {
        // Après le marquage : un worker qui demande sa clé désormais attend.
        if (checkWorkers && (await workerHoldsVaultKey(db ?? (await connectDB()), userId))) {
            throw vaultBusyError()
        }
        if (!(await waitWritesDrained(userId, Date.now() + drainMs))) throw vaultBusyError()
    } catch (error) {
        end()
        throw error
    }
    return end
}

/**
 * Écriture de fichiers avec la clé du coffre (envoi). Attend la fin d'une
 * rotation ou d'un retrait en cours, puis tient un bail pendant toute
 * l'écriture : une opération lancée entre-temps attend qu'elle finisse.
 * `fn` reçoit la clé (null sans coffre), effacée à la fin.
 */
export async function withVaultWrite(userId, fn, { waitMs = VAULT_BUSY_WAIT_MS } = {}) {
    const deadline = Date.now() + waitMs
    while (busyOps.has(userId)) {
        if (!(await waitForVaultOperation(userId, deadline))) throw vaultBusyError()
    }
    // Même segment synchrone que le dernier test de la boucle.
    const release = takeWriteLease(userId)
    let dek = null
    try {
        ;({ dek } = await requireFileAccess(userId))
        return await fn(dek)
    } finally {
        release()
        dek?.fill(0)
    }
}

/**
 * Copie de la clé pour /job-dek, jamais pendant une rotation ou un retrait :
 * attend sa fin (409 vault_busy à l'échéance), puis copie la session dans le
 * même segment synchrone que le dernier test.
 */
export async function getVaultSessionWhenIdle(userId, { waitMs = JOB_DEK_BUSY_WAIT_MS } = {}) {
    const deadline = Date.now() + waitMs
    while (busyOps.has(userId)) {
        if (!(await waitForVaultOperation(userId, deadline))) throw vaultBusyError()
    }
    // getVaultSession copie la clé avant tout await.
    return getVaultSession(userId)
}

/**
 * Compte banni ou sans aucune session valide : l'admin (autre processus) a
 * révoqué les sessions sans pouvoir effacer la clé gardée ici.
 */
export function vaultAccessRevoked(user, now = new Date()) {
    if (!user || user.banned) return true
    const live = (user.sessions || []).some((s) => !s?.expiresAt || new Date(s.expiresAt) > now)
    return !live
}

/**
 * À la connexion, AVANT d'ajouter la nouvelle session : si le compte n'a plus
 * aucune session valide (sessions révoquées ou bannissement levé depuis l'admin,
 * mot de passe changé ailleurs), la clé gardée ici date d'avant la révocation :
 * elle est effacée, le coffre se redéverrouille. Une connexion sur un autre
 * appareil pendant qu'une session vit ne touche pas au coffre.
 */
export async function clearVaultIfNoLiveSession(db, userId, now = new Date()) {
    const user = await db.collection('users').findOne({ id: userId }, { projection: { sessions: 1 } })
    if (vaultAccessRevoked(user ? { sessions: user.sessions } : null, now)) await clearVaultSessions(userId)
}

export async function getVaultStatus(userId) {
    const db = await connectDB()
    const user = await db.collection('users').findOne(
        { id: userId },
        { projection: { encryption: 1 } }
    )
    const enabled = Boolean(user?.encryption?.enabled)
    const entry = enabled ? touchSession(userId) : null
    return {
        enabled,
        locked: enabled && !entry,
        expiresAt: entry ? new Date(entry.expiresAt) : null,
        keyId: user?.encryption?.keyId || null,
        createdAt: user?.encryption?.createdAt || null,
    }
}

/**
 * Gate for file-touching routes. Returns { dek } when the vault is unlocked,
 * { dek: null } when encryption is disabled (legacy plaintext path), and
 * throws 403 vault_locked when the user has an encrypted vault but no active
 * session.
 */
export async function requireFileAccess(userId) {
    const db = await connectDB()
    const user = await db.collection('users').findOne(
        { id: userId },
        { projection: { encryption: 1, banned: 1, sessions: 1 } }
    )
    if (!user?.encryption?.enabled) return { dek: null }

    // Banni ou déconnecté partout depuis l'admin : la clé est effacée ici.
    if (vaultAccessRevoked(user)) {
        await clearVaultSessions(userId)
        throw createError({ statusCode: 403, statusMessage: 'vault_locked' })
    }

    const session = await getVaultSession(userId)
    if (!session) {
        throw createError({ statusCode: 403, statusMessage: 'vault_locked' })
    }
    return { dek: session.dek }
}

/**
 * Upload a buffer to a GridFS bucket, encrypting on the fly when a DEK is
 * provided. Sets metadata.ownerId and the enc flag so readers (Node routes
 * and Python workers) can distinguish encrypted files from legacy plaintext.
 * Returns a promise resolving when the file is fully persisted.
 */
export async function uploadToBucket(bucket, filename, buffer, { ownerId, dek = null, extraMetadata = {} }) {
    const metadata = { ownerId, ...extraMetadata }
    if (dek) metadata.enc = ENC_FLAG

    // Le chiffreur d'abord : une clé refusée lève avant que GridFS n'ouvre le fichier.
    const encrypt = dek ? createEncryptStream(dek, filename, ownerId) : null
    const uploadStream = bucket.openUploadStream(filename, { metadata })
    const source = Readable.from(buffer)
    if (encrypt) {
        await pipeline(source, encrypt, uploadStream)
    } else {
        await pipeline(source, uploadStream)
    }
}

/**
 * Open a download stream, transparently decrypting when the file carries the
 * enc flag. `fileDoc` is the GridFS files document (already fetched by the
 * caller for ownership checks).
 */
export function openDownloadFromBucket(bucket, filename, { fileDoc, ownerId, dek = null }) {
    const raw = bucket.openDownloadStreamByName(filename)
    const encrypted = Boolean(fileDoc?.metadata?.enc)
    if (!encrypted) return raw
    if (!dek) {
        throw createError({ statusCode: 403, statusMessage: 'vault_locked' })
    }
    return raw.pipe(createDecryptStream(dek, filename, ownerId))
}

export async function streamToBuffer(stream) {
    const chunks = []
    for await (const chunk of stream) {
        chunks.push(chunk)
    }
    return Buffer.concat(chunks)
}

/**
 * Lit et déchiffre un fichier GridFS entier (rotation, retrait du coffre).
 * `pipeline` et non `.pipe()` : une erreur du flux GridFS remonte ; avec
 * `.pipe()`, le déchiffreur attendait sans fin et le coffre restait occupé.
 * Rend null si le fichier a été supprimé entre-temps (autre onglet, purge) :
 * il n'y a plus rien à réécrire.
 */
export async function readDecryptedFile(bucket, file, dek, ownerId) {
    const chunks = []
    try {
        await pipeline(
            bucket.openDownloadStream(file._id),
            createDecryptStream(dek, file.filename, ownerId),
            async (source) => {
                for await (const chunk of source) chunks.push(chunk)
            }
        )
    } catch (error) {
        const still = await bucket.find({ _id: file._id }).toArray()
        if (still.length === 0) return null
        throw error
    }
    return Buffer.concat(chunks)
}

/**
 * Returns the polygonParts of a file document, decrypting the enc blob when
 * the file was processed while the vault was enabled. Throws 403
 * vault_locked when parts are encrypted but no session is active.
 */
export async function resolvePolygonParts(userId, fileDoc) {
    if (fileDoc?.encPolygonParts?.data) {
        const { dek } = await requireFileAccess(userId)
        const plain = decryptBuffer(
            dek,
            polygonPartsAadId(fileDoc.slug),
            userId,
            Buffer.from(fileDoc.encPolygonParts.data, 'base64')
        )
        return JSON.parse(plain.toString('utf8'))
    }
    return fileDoc?.polygonParts || []
}

/**
 * Shared download gate for /api/files/** routes: auth, ownership (owner or
 * admin), vault unlock check, transparent decryption. Returns the stream to
 * use as response body and whether the file is encrypted (so callers can
 * downgrade Cache-Control to private, no-store).
 */
export async function openOwnedFileStream(event, bucket, fileName) {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const files = await bucket.find({ filename: fileName }).toArray()
    const fileDoc = files[0]
    if (!fileDoc) {
        throw createError({ statusCode: 404, statusMessage: 'File not found' })
    }

    const ownerId = fileDoc.metadata?.ownerId
    // Demo project files (technical DEMO_OWNER_ID account) are world-readable:
    // the shared read-only demo project must be browsable by every user.
    // 404 (not 401) for a foreign file: a 401 on an existing slug was an
    // existence oracle for authenticated brute-force (pentest C-1).
    if (ownerId !== userId && ownerId !== DEMO_OWNER_ID) {
        throw createError({ statusCode: 404, statusMessage: 'File not found' })
    }

    const encrypted = Boolean(fileDoc.metadata?.enc)
    let dek = null
    if (encrypted) {
        // Throws 403 vault_locked when the vault has no active session.
        ;({ dek } = await requireFileAccess(userId))
    }

    let stream
    try {
        stream = openDownloadFromBucket(bucket, fileName, { fileDoc, ownerId, dek })
        if (encrypted) {
            // Decrypt BEFORE sending bytes so a GCM failure is a 404, not a
            // mid-stream 500 (oracle of encryption / existence).
            const plain = await streamToBuffer(stream)
            stream = Readable.from(plain)
        }
    } catch {
        throw createError({ statusCode: 404, statusMessage: 'File not found' })
    }

    return {
        stream,
        encrypted,
        fileDoc,
    }
}
