import crypto from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// Coffre occupé : une rotation de clé ou un retrait du coffre réécrit TOUS les
// fichiers chiffrés de l'utilisateur. Avant, rien n'empêchait un envoi d'un
// autre onglet, ou un worker qui tenait déjà la clé, d'écrire pendant ce temps
// avec l'ANCIENNE clé : ces fichiers ne s'ouvraient plus (reproduit en
// production le 26/11). Désormais :
//  - un envoi en cours finit avant que la rotation ou le retrait ne commence ;
//  - un envoi qui arrive pendant l'opération attend sa fin, puis prend la bonne
//    clé (ou part en clair après un retrait) ;
//  - un worker qui tient la clé fait refuser la rotation et le retrait (409) ;
//  - un worker qui demande sa clé pendant l'opération attend sa fin.

const state = vi.hoisted(() => ({ db: null, buckets: new Map(), onWrite: null, readError: null }))

vi.mock('~~/server/db/mongo', () => {
    const named = (name) => async () => state.buckets.get(name)
    return {
        connectDB: async () => state.db,
        getBucket: async (name) => state.buckets.get(name),
        getUserDxfBucket: named('userDxf'),
        getValidUserDxfBucket: named('validUserDxf'),
        getUserDxfFilesSvgBucket: named('svg'),
        getStripUserDxfBucket: named('stripUserDxf'),
        getDxfResultBucket: named('dxfResult'),
        getSvgResultBucket: named('svgResult'),
        getStripNestDxfBucket: named('stripNest'),
    }
})
vi.mock('h3', async (importOriginal) => ({
    ...(await importOriginal()),
    readMultipartFormData: async (event) => event._fields,
}))
vi.mock('~~/server/tracking/add', () => ({ trackEvent: vi.fn() }))

import { matches, fakeDb } from './helpers/fakeMongo'
import { decryptBuffer, fingerprintKey } from '~~/server/utils/crypto'
import {
    beginVaultOperation,
    clearVaultSessions,
    createVaultSession,
    getVaultSession,
    uploadToBucket,
    withVaultWrite,
} from '~~/server/utils/vault'
import { saveFiles } from '~~/server/core/project/dxf'
import { DOMAINS } from '~~/server/core/domains'
import rotateHandler from '~~/server/api/security/vault/rotate.post.js'
import disableHandler from '~~/server/api/security/vault/disable.post.js'
import destroyHandler from '~~/server/api/security/vault/destroy.post.js'
import jobDekHandler from '~~/server/api/security/vault/job-dek.post.js'
import unlockHandler from '~~/server/api/security/vault/unlock.post.js'

const UID = 'u-busy'
const FILES = 8
// Trois trames de 256 Kio par fichier : plusieurs écritures GridFS par fichier.
const BYTES = 600 * 1024
const BUCKETS = ['userDxf', 'validUserDxf', 'svg', 'stripUserDxf', 'dxfResult', 'svgResult', 'stripNest']

// GridFS en mémoire, écritures asynchrones comme le vrai pilote.
function memoryBucket() {
    const files = []
    let n = 0
    return {
        files,
        openUploadStream(filename, { metadata }) {
            const doc = { _id: `f${++n}-${filename}`, filename, metadata, chunks: [] }
            return new Writable({
                write(chunk, _enc, cb) {
                    doc.chunks.push(Buffer.from(chunk))
                    state.onWrite?.()
                    setImmediate(cb)
                },
                final(cb) {
                    doc.data = Buffer.concat(doc.chunks)
                    files.push(doc)
                    cb()
                },
            })
        },
        find(filter) {
            const hit = files.filter((f) => matches({ _id: f._id, metadata: f.metadata }, filter))
            return { toArray: async () => [...hit] }
        },
        openDownloadStream(id) {
            const file = files.find((f) => f._id === id)
            if (!file) throw Object.assign(new Error(`FileNotFound: file ${id} was not found`), { code: 'ENOENT' })
            if (state.readError?.(file)) {
                // Morceau GridFS manquant : le flux source échoue en cours de lecture.
                return new Readable({ read() { this.destroy(new Error('ChunkIsMissing')) } })
            }
            return Readable.from([file.data])
        },
        openDownloadStreamByName(name) {
            return Readable.from([files.find((f) => f.filename === name).data])
        },
        async delete(id) {
            files.splice(files.findIndex((f) => f._id === id), 1)
        },
    }
}

const plainOf = (i) => Buffer.alloc(BYTES, (i % 250) + 1)
const readable = (key, f) => {
    try {
        decryptBuffer(key, f.filename, UID, f.data)
        return true
    } catch {
        return false
    }
}
const allFiles = () => BUCKETS.flatMap((b) => state.buckets.get(b).files)
const ev = (body) => ({ context: { auth: { userId: UID } }, _body: body })

let dek
let users
let fileDocs
let jobs

beforeEach(async () => {
    await clearVaultSessions(UID)
    dek = crypto.randomBytes(32)
    users = [{
        id: UID,
        sessions: [{ sessionId: 'sess-a', expiresAt: new Date(Date.now() + 86_400_000) }],
        encryption: { enabled: true, fingerprint: fingerprintKey(dek), keyId: 'k' },
    }]
    fileDocs = []
    jobs = []
    const base = fakeDb({ users, user_dxf_files: fileDocs, strip_user_dxf_files: [], nesting_jobs: jobs })
    state.db = {
        collection(name) {
            const col = base.collection(name)
            col.insertMany ??= async (docs) => { for (const d of docs) await col.insertOne(d) }
            if (name !== 'users') return col
            // Comme le vrai pilote : une COPIE du document, pas une référence
            // que la rotation modifierait sous les yeux du lecteur.
            return { ...col, findOne: async (...args) => structuredClone(await col.findOne(...args)) }
        },
    }
    state.buckets = new Map(BUCKETS.map((b) => [b, memoryBucket()]))
    state.onWrite = null
    state.readError = null
})

// Déclenche `action` (sans l'attendre) à la n-ième écriture GridFS.
function atWrite(n, action) {
    let count = 0
    let pending = null
    state.onWrite = () => {
        count += 1
        if (count === n) {
            pending = action()
            // Une erreur attendue par le test ne doit pas sortir en « unhandled ».
            pending?.catch?.(() => {})
        }
    }
    return () => pending
}

let uploadRound = 0
const upload = (count = FILES) => {
    const offset = 100 + uploadRound++ * count
    return saveFiles(DOMAINS.bin, {
        _fields: Array.from({ length: count }, (_, i) => ({ name: 'dxf', filename: `busy-${offset + i}.dxf`, data: plainOf(offset + i) })),
    }, 'p1', UID)
}

async function seedEncrypted() {
    await createVaultSession(UID, dek)
    await upload()
}

// Joue le worker : paire ECDH éphémère, clé publique posée sur le job, puis
// ouverture de la parcelle rendue par /job-dek (même contrat que vault-jobdek.test.js).
function makeWorker() {
    let ecdh
    try {
        ecdh = crypto.createECDH('secp256r1')
    } catch {
        ecdh = crypto.createECDH('prime256v1')
    }
    ecdh.generateKeys()
    return { ecdh, pubB64: ecdh.getPublicKey().toString('base64') }
}
function openParcel(worker, slug, res) {
    const shared = worker.ecdh.computeSecret(Buffer.from(res.serverPub, 'base64'))
    const transport = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(32), 'nest2d-job-dek-v1', 32))
    const parcel = Buffer.from(res.parcel, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', transport, parcel.subarray(0, 12), { authTagLength: 16 })
    decipher.setAAD(Buffer.from(slug, 'utf8'))
    decipher.setAuthTag(parcel.subarray(parcel.length - 16))
    return Buffer.concat([decipher.update(parcel.subarray(12, parcel.length - 16)), decipher.final()])
}
// Un job réclamé par un worker vivant (battement récent, clé publique posée).
function claimJob(collection, slug, worker, { updateTs = new Date() } = {}) {
    const doc = { slug, ownerId: UID, workerKeyPub: worker.pubB64, update_ts: updateTs }
    if (collection === 'nesting_jobs') {
        doc.status = 'processing'
        jobs.push(doc)
    } else {
        doc.processingStatus = 'processing'
        fileDocs.push(doc)
    }
    return doc
}

describe('envoi en cours pendant une rotation', () => {
    it("rotation lancée au milieu d'un envoi : tous les fichiers sur la nouvelle clé", async () => {
        await seedEncrypted()
        const newDek = crypto.randomBytes(32)
        const rotation = atWrite(7, () => rotateHandler(ev({ key: newDek.toString('base64') })))
        const records = await upload()
        await expect(rotation()).resolves.toMatchObject({ ok: true })
        expect(records).toHaveLength(FILES)
        const files = state.buckets.get('userDxf').files
        expect(files).toHaveLength(2 * FILES)
        expect(files.filter((f) => readable(newDek, f))).toHaveLength(2 * FILES)
        expect(users[0].encryption.fingerprint).toBe(fingerprintKey(newDek))
    })

    it("envoi lancé pendant la rotation : il attend la fin et prend la nouvelle clé", async () => {
        await seedEncrypted()
        const newDek = crypto.randomBytes(32)
        const late = atWrite(5, () => upload())
        await rotateHandler(ev({ key: newDek.toString('base64') }))
        await expect(late()).resolves.toHaveLength(FILES)
        const files = state.buckets.get('userDxf').files
        expect(files).toHaveLength(2 * FILES)
        expect(files.filter((f) => readable(newDek, f))).toHaveLength(2 * FILES)
    })

    it('deux rotations en même temps : la seconde est refusée (409 vault_busy), rien ne se mélange', async () => {
        await seedEncrypted()
        const keyA = crypto.randomBytes(32)
        const keyB = crypto.randomBytes(32)
        const second = atWrite(5, () => rotateHandler(ev({ key: keyB.toString('base64') })))
        await rotateHandler(ev({ key: keyA.toString('base64') }))
        await expect(second()).rejects.toMatchObject({ statusCode: 409, statusMessage: 'vault_busy' })
        const files = state.buckets.get('userDxf').files
        expect(files.filter((f) => readable(keyA, f))).toHaveLength(FILES)
        expect(users[0].encryption.fingerprint).toBe(fingerprintKey(keyA))
    })
})

describe('envoi en cours pendant un retrait du coffre', () => {
    const allPlainAndIntact = (files) => {
        for (const f of files) {
            expect(f.metadata.enc).toBeUndefined()
            expect(f.data.length).toBe(BYTES)
            expect(f.data.every((b) => b === f.data[0])).toBe(true)
        }
    }

    it("retrait (déchiffrement) lancé au milieu d'un envoi : tous les fichiers en clair, intacts", async () => {
        await seedEncrypted()
        const removal = atWrite(7, () => disableHandler(ev({ mode: 'decrypt' })))
        await upload()
        await expect(removal()).resolves.toEqual({ ok: true, mode: 'decrypt' })
        const files = state.buckets.get('userDxf').files
        expect(files).toHaveLength(2 * FILES)
        allPlainAndIntact(files)
        expect(users[0].encryption).toBeUndefined()
    })

    it('envoi lancé pendant le retrait : il attend la fin et part en clair', async () => {
        await seedEncrypted()
        const late = atWrite(5, () => upload())
        await disableHandler(ev({ mode: 'decrypt' }))
        await expect(late()).resolves.toHaveLength(FILES)
        const files = state.buckets.get('userDxf').files
        expect(files).toHaveLength(2 * FILES)
        allPlainAndIntact(files)
    })

    it("retrait avec destruction lancé au milieu d'un envoi : plus aucun fichier ni fiche", async () => {
        await seedEncrypted()
        const removal = atWrite(7, () => disableHandler(ev({ mode: 'destroy' })))
        await upload()
        await expect(removal()).resolves.toEqual({ ok: true, mode: 'destroy' })
        expect(allFiles()).toHaveLength(0)
        expect(fileDocs).toHaveLength(0)
    })

    it("destruction du coffre (route de secours) au milieu d'un envoi : plus aucun fichier ni fiche", async () => {
        await seedEncrypted()
        const removal = atWrite(7, () => destroyHandler(ev({ confirm: 'DESTROY' })))
        await upload()
        await expect(removal()).resolves.toMatchObject({ ok: true, destroyed: true })
        expect(allFiles()).toHaveLength(0)
        expect(fileDocs).toHaveLength(0)
    })
})

describe('worker au travail pendant une rotation ou un retrait', () => {
    it('rotation refusée tant que le worker tient la clé ; ses sorties restent lisibles ; acceptée après', async () => {
        await seedEncrypted()
        const worker = makeWorker()
        const job = claimJob('nesting_jobs', 'job-w1', worker)
        const workerDek = openParcel(worker, 'job-w1', await jobDekHandler({ context: {}, _body: { jobSlug: 'job-w1' } }))
        expect(workerDek.equals(dek)).toBe(true)

        const newDek = crypto.randomBytes(32)
        await expect(rotateHandler(ev({ key: newDek.toString('base64') })))
            .rejects.toMatchObject({ statusCode: 409, statusMessage: 'vault_busy' })
        // Rien n'a bougé : même empreinte, même clé de session.
        expect(users[0].encryption.fingerprint).toBe(fingerprintKey(dek))
        expect((await getVaultSession(UID)).dek.equals(dek)).toBe(true)

        // Le worker écrit son résultat avec SA clé : lisible avec celle du coffre.
        await uploadToBucket(state.buckets.get('dxfResult'), 'nest-out.dxf', plainOf(1), { ownerId: UID, dek: workerDek })
        expect(readable(dek, state.buckets.get('dxfResult').files[0])).toBe(true)

        // Fin du job (statut final, puis wipe_job_dek) : la rotation passe et emporte le résultat.
        job.status = 'done'
        delete job.workerKeyPub
        await expect(rotateHandler(ev({ key: newDek.toString('base64') }))).resolves.toMatchObject({ ok: true })
        expect(allFiles().filter((f) => readable(newDek, f))).toHaveLength(FILES + 1)
    })

    it('retrait (déchiffrement) refusé pendant le traitement d\'un fichier ; rien n\'est touché', async () => {
        await seedEncrypted()
        claimJob('user_dxf_files', 'file-w1', makeWorker())
        await expect(disableHandler(ev({ mode: 'decrypt' })))
            .rejects.toMatchObject({ statusCode: 409, statusMessage: 'vault_busy' })
        expect(users[0].encryption.enabled).toBe(true)
        expect(state.buckets.get('userDxf').files.filter((f) => readable(dek, f))).toHaveLength(FILES)
        expect(await getVaultSession(UID)).not.toBeNull()
    })

    it('retrait avec destruction refusé pendant un calcul', async () => {
        await seedEncrypted()
        claimJob('nesting_jobs', 'job-w2', makeWorker())
        await expect(disableHandler(ev({ mode: 'destroy' })))
            .rejects.toMatchObject({ statusCode: 409, statusMessage: 'vault_busy' })
        expect(state.buckets.get('userDxf').files).toHaveLength(FILES)
    })

    it("worker mort (battement vieux d'une heure) : la rotation n'est pas bloquée", async () => {
        await seedEncrypted()
        claimJob('nesting_jobs', 'job-dead', makeWorker(), { updateTs: new Date(Date.now() - 60 * 60 * 1000) })
        const newDek = crypto.randomBytes(32)
        await expect(rotateHandler(ev({ key: newDek.toString('base64') }))).resolves.toMatchObject({ ok: true })
    })

    it('worker qui demande sa clé PENDANT la rotation : il attend et reçoit la nouvelle', async () => {
        await seedEncrypted()
        const newDek = crypto.randomBytes(32)
        const worker = makeWorker()
        const asked = atWrite(5, () => {
            claimJob('nesting_jobs', 'job-mid', worker)
            return jobDekHandler({ context: {}, _body: { jobSlug: 'job-mid' } })
        })
        await rotateHandler(ev({ key: newDek.toString('base64') }))
        const res = await asked()
        expect(openParcel(worker, 'job-mid', res).equals(newDek)).toBe(true)
    })

    it('worker qui demande sa clé PENDANT le retrait : refusé (409), aucune clé ne part', async () => {
        await seedEncrypted()
        const asked = atWrite(5, () => {
            claimJob('user_dxf_files', 'file-mid', makeWorker())
            return jobDekHandler({ context: {}, _body: { jobSlug: 'file-mid' } })
        })
        await disableHandler(ev({ mode: 'decrypt' }))
        await expect(asked()).rejects.toMatchObject({ statusCode: 409 })
    })
})

describe('coffre occupé : délais', () => {
    it("un envoi n'attend pas sans fin : 409 vault_busy à l'échéance, rien d'écrit", async () => {
        await createVaultSession(UID, dek)
        const end = await beginVaultOperation(UID, 'rotate', { db: state.db })
        const fn = vi.fn()
        try {
            await expect(withVaultWrite(UID, fn, { waitMs: 20 }))
                .rejects.toMatchObject({ statusCode: 409, statusMessage: 'vault_busy' })
            expect(fn).not.toHaveBeenCalled()
        } finally {
            end()
        }
        // Libéré : l'écriture suivante passe.
        await expect(withVaultWrite(UID, async (key) => key.equals(dek))).resolves.toBe(true)
    })

    it("une rotation n'attend pas sans fin un envoi bloqué : 409, et le coffre n'est pas laissé occupé", async () => {
        await createVaultSession(UID, dek)
        let finish
        const stuck = withVaultWrite(UID, () => new Promise((r) => { finish = r }))
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
        await expect(beginVaultOperation(UID, 'rotate', { db: state.db, drainMs: 20 }))
            .rejects.toMatchObject({ statusCode: 409, statusMessage: 'vault_busy' })
        finish()
        await stuck
        const end = await beginVaultOperation(UID, 'rotate', { db: state.db })
        end()
    })
})

describe('relecture : robustesse', () => {
    it("flux GridFS en échec pendant la rotation : erreur rendue, le coffre n'est pas laissé occupé", async () => {
        await seedEncrypted()
        const victim = state.buckets.get('userDxf').files[3].filename
        state.readError = (f) => f.filename === victim
        await expect(rotateHandler(ev({ key: crypto.randomBytes(32).toString('base64') }))).rejects.toThrow(/ChunkIsMissing/)
        state.readError = null
        // Libéré tout de suite : un envoi passe, une nouvelle rotation aussi.
        await expect(withVaultWrite(UID, async () => 'ok', { waitMs: 50 })).resolves.toBe('ok')
        const end = await beginVaultOperation(UID, 'rotate', { db: state.db })
        end()
    })

    it("fichier supprimé (autre onglet) pendant la rotation : ignoré, les autres passent sur la nouvelle clé", async () => {
        await seedEncrypted()
        const bucket = state.buckets.get('userDxf')
        const last = bucket.files[FILES - 1]
        const newDek = crypto.randomBytes(32)
        atWrite(1, async () => { await bucket.delete(last._id) })
        await expect(rotateHandler(ev({ key: newDek.toString('base64') }))).resolves.toMatchObject({ ok: true })
        expect(bucket.files).toHaveLength(FILES - 1)
        expect(bucket.files.filter((f) => readable(newDek, f))).toHaveLength(FILES - 1)
    })

    it("déverrouillage à cheval sur une rotation (empreinte lue avant, session ouverte après) : refusé, la session reste sur la nouvelle clé", async () => {
        await seedEncrypted()
        const realReadBody = globalThis.readBody
        let open
        const gate = new Promise((r) => { open = r })
        globalThis.readBody = async (e) => {
            if (e._gate) await e._gate
            return e._body
        }
        try {
            // L'onglet B renvoie l'ancienne clé retenue ; il a lu l'empreinte, puis attend.
            const unlock = unlockHandler({ context: { auth: { userId: UID } }, _body: { key: dek.toString('base64') }, _gate: gate })
            unlock.catch(() => {})
            await new Promise((r) => setImmediate(r))
            const newDek = crypto.randomBytes(32)
            await rotateHandler(ev({ key: newDek.toString('base64') }))
            open()
            await expect(unlock).rejects.toMatchObject({ statusCode: 409, statusMessage: 'vault_busy' })
            expect((await getVaultSession(UID)).dek.equals(newDek)).toBe(true)
        } finally {
            globalThis.readBody = realReadBody
        }
    })

    it('déverrouillage pendant une rotation : 409, rien ne change', async () => {
        await seedEncrypted()
        const asked = atWrite(3, () => unlockHandler({ context: { auth: { userId: UID } }, _body: { key: dek.toString('base64') } }))
        const newDek = crypto.randomBytes(32)
        await rotateHandler(ev({ key: newDek.toString('base64') }))
        await expect(asked()).rejects.toMatchObject({ statusCode: 409, statusMessage: 'vault_busy' })
        expect((await getVaultSession(UID)).dek.equals(newDek)).toBe(true)
    })

    it("job en cours sans marqueur (un autre worker l'a retiré) : la rotation est quand même refusée", async () => {
        await seedEncrypted()
        jobs.push({ slug: 'job-nomark', ownerId: UID, status: 'processing', update_ts: new Date() })
        await expect(rotateHandler(ev({ key: crypto.randomBytes(32).toString('base64') })))
            .rejects.toMatchObject({ statusCode: 409, statusMessage: 'vault_busy' })
    })

    it("clé invalide : 400 tout de suite, sans marquer le coffre occupé ni attendre l'envoi en cours", async () => {
        await createVaultSession(UID, dek)
        let finish
        const stuck = withVaultWrite(UID, () => new Promise((r) => { finish = r }))
        await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
        await expect(rotateHandler(ev({ key: Buffer.alloc(32).toString('base64') })))
            .rejects.toMatchObject({ statusCode: 400 })
        // Pas marqué occupé : un autre envoi passe sans attendre.
        await expect(withVaultWrite(UID, async () => 'ok', { waitMs: 10 })).resolves.toBe('ok')
        finish()
        await stuck
    })
})
