import {
    connectDB,
    getDxfResultBucket,
    getStripNestDxfBucket,
    getStripUserDxfBucket,
    getSvgResultBucket,
    getUserDxfBucket,
    getUserDxfFilesSvgBucket,
    getValidUserDxfBucket,
} from '~~/server/db/mongo'
import { decryptBuffer, polygonPartsAadId } from '~~/server/utils/crypto'
import {
    beginVaultOperation,
    clearVaultSessions,
    readDecryptedFile,
    requireFileAccess,
    uploadToBucket,
} from '~~/server/utils/vault'

const BUCKET_GETTERS = [
    getUserDxfBucket,
    getValidUserDxfBucket,
    getUserDxfFilesSvgBucket,
    getStripUserDxfBucket,
    getDxfResultBucket,
    getSvgResultBucket,
    getStripNestDxfBucket,
]

/**
 * Disables the vault. Two modes:
 *  - 'decrypt': re-encrypt nothing — every encrypted file is decrypted and
 *    re-uploaded in clear, the account goes back to standard storage.
 *  - 'destroy': crypto-shredding — every user file is deleted; without the
 *    key they were noise anyway.
 * Requires an unlocked vault (the DEK is needed for 'decrypt').
 */
export default defineEventHandler(async (event) => {
    const userId = event.context?.auth?.userId
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const body = await readBody(event)
    const mode = body?.mode === 'decrypt' ? 'decrypt' : body?.mode === 'destroy' ? 'destroy' : null
    if (!mode) {
        throw createError({ statusCode: 400, statusMessage: "mode must be 'decrypt' or 'destroy'" })
    }

    const db = await connectDB()
    // Coffre occupé pendant tout le retrait : les envois en cours finissent
    // d'abord, les suivants attendent (et partent en clair), un worker qui
    // tient la clé fait refuser le retrait (409 vault_busy) : il écrirait
    // ensuite des fichiers chiffrés que plus personne ne pourrait ouvrir.
    const end = await beginVaultOperation(userId, 'disable', { db })
    try {
        return await disableVault(db, userId, mode)
    } finally {
        end()
    }
})

async function disableVault(db, userId, mode) {
    const user = await db.collection('users').findOne(
        { id: userId },
        { projection: { encryption: 1 } }
    )
    if (!user?.encryption?.enabled) {
        throw createError({ statusCode: 400, statusMessage: 'Vault is not enabled' })
    }

    // The DEK is only needed for 'decrypt' mode (to read ciphertext back to
    // plaintext). 'destroy' is crypto-shredding: it deletes files outright,
    // so it must NOT require an unlocked session — otherwise a user locked
    // out of their vault (lost key, misconfigured master key) can never
    // recover. Only gate 'decrypt' behind requireFileAccess.
    const dek = mode === 'decrypt' ? (await requireFileAccess(userId)).dek : null
    try {
        return await removeVault(db, userId, mode, dek)
    } finally {
        dek?.fill(0)
    }
}

async function removeVault(db, userId, mode, dek) {
    for (const getBucket of BUCKET_GETTERS) {
        const bucket = await getBucket()
        const files = await bucket.find({ 'metadata.ownerId': userId }).toArray()
        for (const file of files) {
            if (mode === 'destroy') {
                await bucket.delete(file._id)
            } else if (file.metadata?.enc) {
                const plain = await readDecryptedFile(bucket, file, dek, userId)
                // Supprimé entre-temps (autre onglet, purge) : rien à réécrire.
                if (!plain) continue
                await bucket.delete(file._id)
                await uploadToBucket(bucket, file.filename, plain, { ownerId: userId })
            }
        }
    }

    if (mode === 'destroy') {
        await db.collection('user_dxf_files').deleteMany({ ownerId: userId })
        await db.collection('strip_user_dxf_files').deleteMany({ ownerId: userId })
    } else {
        // Restore encrypted polygonParts blobs to plaintext as well.
        for (const collectionName of ['user_dxf_files', 'strip_user_dxf_files']) {
            const docs = await db.collection(collectionName)
                .find({ ownerId: userId, encPolygonParts: { $exists: true } })
                .toArray()
            for (const doc of docs) {
                const plain = decryptBuffer(
                    dek,
                    polygonPartsAadId(doc.slug),
                    userId,
                    Buffer.from(doc.encPolygonParts.data, 'base64')
                )
                await db.collection(collectionName).updateOne(
                    { _id: doc._id },
                    {
                        $set: { polygonParts: JSON.parse(plain.toString('utf8')) },
                        $unset: { encPolygonParts: '' },
                    }
                )
            }
        }
    }

    await clearVaultSessions(userId)
    await db.collection('users').updateOne({ id: userId }, { $unset: { encryption: '' } })

    return { ok: true, mode }
}
