import crypto from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// Coffre : une requête longue (envoi de 20 fichiers, rotation, retrait) garde
// la clé qu'elle a reçue, même si une déconnexion, un déverrouillage depuis un
// autre onglet ou la fin de session efface la session pendant ce temps. Avant,
// la clé rendue ÉTAIT celle de la session : remise à zéro au milieu, les
// fichiers suivants partaient chiffrés avec une clé nulle (vu en production
// pour le déverrouillage pendant un envoi).

const state = vi.hoisted(() => ({ db: null, buckets: new Map(), onWrite: null }))

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
const authMocks = vi.hoisted(() => ({ removeSessionFromUser: vi.fn(async () => {}) }))
vi.mock('~~/server/utils/auth', () => authMocks)

import { matches, fakeDb } from './helpers/fakeMongo'
import { createEncryptStream, decryptBuffer, encryptBuffer, fingerprintKey } from '~~/server/utils/crypto'
import { createVaultSession, getVaultSession, uploadToBucket } from '~~/server/utils/vault'
import { saveFiles } from '~~/server/core/project/dxf'
import { DOMAINS } from '~~/server/core/domains'
import logoutHandler from '~~/server/api/auth/logout.post.js'
import unlockHandler from '~~/server/api/security/vault/unlock.post.js'
import rotateHandler from '~~/server/api/security/vault/rotate.post.js'
import disableHandler from '~~/server/api/security/vault/disable.post.js'

globalThis.parseCookies = (event) => event._cookies || {}
globalThis.setCookie = vi.fn()

const UID = 'u-race'
const FILES = 20
// Trois trames de 256 Kio par fichier : la clé peut changer AU MILIEU d'un fichier.
const BYTES = 600 * 1024

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
            const hit = files.filter((f) => matches({ metadata: f.metadata }, filter))
            return { toArray: async () => [...hit] }
        },
        openDownloadStream(id) {
            return Readable.from([files.find((f) => f._id === id).data])
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

let dek
let users
const liveSessions = () => [
    { sessionId: 'sess-a', expiresAt: new Date(Date.now() + 86_400_000) },
    { sessionId: 'sess-b', expiresAt: new Date(Date.now() + 86_400_000) },
]

beforeEach(() => {
    dek = crypto.randomBytes(32)
    users = [{ id: UID, sessions: liveSessions(), encryption: { enabled: true, fingerprint: fingerprintKey(dek), keyId: 'k' } }]
    const base = fakeDb({ users, user_dxf_files: [], strip_user_dxf_files: [] })
    // insertMany : seul ajout dont saveFiles a besoin.
    state.db = {
        collection(name) {
            const col = base.collection(name)
            col.insertMany ??= async (docs) => { for (const d of docs) await col.insertOne(d) }
            return col
        },
    }
    state.buckets = new Map(['userDxf', 'validUserDxf', 'svg', 'stripUserDxf', 'dxfResult', 'svgResult', 'stripNest'].map((b) => [b, memoryBucket()]))
    state.onWrite = null
    authMocks.removeSessionFromUser.mockImplementation(async (sid) => {
        users[0].sessions = users[0].sessions.filter((s) => s.sessionId !== sid)
    })
})

// Déclenche `action` (sans l'attendre) à la n-ième écriture GridFS : en plein fichier.
function atWrite(n, action) {
    let count = 0
    let pending = null
    state.onWrite = () => {
        count += 1
        if (count === n) pending = action()
    }
    return () => pending
}

const logoutOther = () => logoutHandler({ _cookies: { sessionId: 'sess-b' }, context: { auth: { userId: UID } } })
const upload = () => saveFiles(DOMAINS.bin, {
    _fields: Array.from({ length: FILES }, (_, i) => ({ name: 'dxf', filename: `race-${i}.dxf`, data: plainOf(i) })),
}, 'p1', UID)

// Les 20 fichiers déjà chiffrés avec la clé du coffre, comme après un envoi.
async function seedEncrypted() {
    await createVaultSession(UID, dek)
    await upload()
}

describe('coffre : la clé d\'une requête en cours ne bouge plus', () => {
    it('déconnexion (autre session) pendant un envoi de 20 fichiers : les 20 lisibles avec la clé', async () => {
        await createVaultSession(UID, dek)
        const done = atWrite(7, logoutOther)
        const records = await upload()
        await done()
        const files = state.buckets.get('userDxf').files
        expect(records).toHaveLength(FILES)
        expect(files).toHaveLength(FILES)
        expect(files.filter((f) => readable(dek, f))).toHaveLength(FILES)
        expect(files.filter((f) => readable(Buffer.alloc(32), f))).toHaveLength(0)
        files.forEach((f, i) => expect(decryptBuffer(dek, f.filename, UID, f.data).equals(plainOf(i))).toBe(true))
        // la déconnexion a bien fermé le coffre
        expect(await getVaultSession(UID)).toBeNull()
    })

    it('déverrouillage depuis un autre onglet pendant un envoi (la course vue en production)', async () => {
        await createVaultSession(UID, dek)
        const done = atWrite(7, () => unlockHandler({
            context: { auth: { userId: UID } },
            _body: { key: dek.toString('base64') },
        }))
        await upload()
        await expect(done()).resolves.toMatchObject({ ok: true })
        const files = state.buckets.get('userDxf').files
        expect(files.filter((f) => readable(dek, f))).toHaveLength(FILES)
    })

    it('rotation puis déconnexion pendant la rotation : tout sur la nouvelle clé, coffre resté fermé', async () => {
        await seedEncrypted()
        const newDek = crypto.randomBytes(32)
        const done = atWrite(9, logoutOther)
        const res = await rotateHandler({ context: { auth: { userId: UID } }, _body: { key: newDek.toString('base64') } })
        await done()
        expect(res).toMatchObject({ ok: true, expiresAt: null })
        const files = state.buckets.get('userDxf').files
        expect(files).toHaveLength(FILES)
        expect(files.filter((f) => readable(newDek, f))).toHaveLength(FILES)
        expect(users[0].encryption.fingerprint).toBe(fingerprintKey(newDek))
        // pas de session recréée après la déconnexion
        expect(await getVaultSession(UID)).toBeNull()
    })

    it('rotation sans déconnexion : la session ouverte passe sur la nouvelle clé', async () => {
        await seedEncrypted()
        const newDek = crypto.randomBytes(32)
        const res = await rotateHandler({ context: { auth: { userId: UID } }, _body: { key: newDek.toString('base64') } })
        expect(res.expiresAt).toBeInstanceOf(Date)
        expect((await getVaultSession(UID)).dek.equals(newDek)).toBe(true)
    })

    it('rotation vers une clé nulle : refusée avant de toucher un fichier', async () => {
        await seedEncrypted()
        await expect(rotateHandler({ context: { auth: { userId: UID } }, _body: { key: Buffer.alloc(32).toString('base64') } }))
            .rejects.toMatchObject({ statusCode: 400 })
        expect(state.buckets.get('userDxf').files.filter((f) => readable(dek, f))).toHaveLength(FILES)
    })

    it('retrait du coffre (déchiffrement) puis déconnexion pendant le retrait : les 20 en clair, intacts', async () => {
        await seedEncrypted()
        const done = atWrite(9, logoutOther)
        const res = await disableHandler({ context: { auth: { userId: UID } }, _body: { mode: 'decrypt' } })
        await done()
        expect(res).toEqual({ ok: true, mode: 'decrypt' })
        const files = state.buckets.get('userDxf').files
        expect(files).toHaveLength(FILES)
        for (const f of files) expect(f.metadata.enc).toBeUndefined()
        // Noms GridFS opaques : chaque fichier est reconnu à son octet de remplissage.
        const contents = files.map((f) => f.data[0]).sort((a, b) => a - b)
        expect(contents).toEqual(Array.from({ length: FILES }, (_, i) => (i % 250) + 1).sort((a, b) => a - b))
        expect(files.every((f) => f.data.length === BYTES && f.data.every((b) => b === f.data[0]))).toBe(true)
    })
})

describe('clé nulle refusée au chiffrement', () => {
    const zero = Buffer.alloc(32)

    it('encryptBuffer et createEncryptStream lèvent', () => {
        expect(() => encryptBuffer(zero, 'a', UID, Buffer.from('x'))).toThrow(/all zero/)
        expect(() => createEncryptStream(zero, 'a', UID)).toThrow(/all zero/)
        expect(() => createEncryptStream(Buffer.alloc(16, 1), 'a', UID)).toThrow(/32 bytes/)
    })

    it("uploadToBucket : rien n'est ouvert ni écrit dans GridFS", async () => {
        const bucket = memoryBucket()
        const open = vi.spyOn(bucket, 'openUploadStream')
        await expect(uploadToBucket(bucket, 'f', Buffer.alloc(10, 1), { ownerId: UID, dek: zero })).rejects.toThrow(/all zero/)
        expect(open).not.toHaveBeenCalled()
        expect(bucket.files).toHaveLength(0)
    })

    it("le flux garde sa copie : effacer la clé de l'appelant en plein fichier ne change rien", async () => {
        const key = crypto.randomBytes(32)
        const original = Buffer.from(key)
        const bucket = memoryBucket()
        state.onWrite = () => key.fill(0)
        await uploadToBucket(bucket, 'f', plainOf(1), { ownerId: UID, dek: key })
        expect(decryptBuffer(original, 'f', UID, bucket.files[0].data).equals(plainOf(1))).toBe(true)
    })
})
