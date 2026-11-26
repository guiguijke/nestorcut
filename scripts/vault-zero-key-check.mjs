// Coffre : un fichier d'un utilisateur a-t-il été chiffré avec la clé NULLE ?
//
// Jusqu'au correctif, une déconnexion, un déverrouillage depuis un autre onglet
// ou la fin de session pendant un envoi remettait à zéro la clé que l'envoi
// utilisait : les trames suivantes partaient chiffrées avec 32 octets à zéro
// (illisibles avec la clé de l'utilisateur, lisibles par quiconque tient la
// base). Ce script le dit, fichier par fichier, SANS la clé de l'utilisateur.
//
// LECTURE SEULE : find et lecture GridFS, aucune écriture, aucun index créé.
// Il n'écrit ni n'affiche aucun contenu : pour chaque trame, seul le résultat
// de l'authentification GCM avec la clé nulle est compté ; le texte déchiffré
// est jeté sans être lu.
//
//   NUXT_MONGO_URI="mongodb://hôte:27017/base" node scripts/vault-zero-key-check.mjs <userId>
//
// Sortie : une ligne JSON par fichier chiffré (seau, _id, taille, trames,
// trames authentifiées par la clé nulle), puis un bilan. Verdict par fichier :
//   zero  : toutes les trames s'ouvrent avec la clé nulle ;
//   mixed : une partie seulement (clé effacée en plein fichier) ;
//   clean : aucune (chiffré avec une autre clé, a priori celle de l'utilisateur).
// Code de sortie : 0 rien trouvé, 3 au moins un fichier zero ou mixed, 1 erreur.

import crypto from 'node:crypto'
import { GridFSBucket, MongoClient } from 'mongodb'

// Même format que server/utils/crypto.js (et les workers Python).
const NONCE_SIZE = 12
const TAG_SIZE = 16
const PLAINTEXT_BLOCK = 256 * 1024
const FRAME_SIZE = NONCE_SIZE + PLAINTEXT_BLOCK + TAG_SIZE
const ZERO_KEY = Buffer.alloc(32)

// Les seaux qu'écrivent l'app et les workers (server/db/mongo.js), comme la rotation.
const BUCKETS = ['userDxf', 'validDxf', 'userDxfFilesSvg', 'stripUserDxf', 'nestDxf', 'nestSvg', 'stripNestDxf']
const PARTS_COLLECTIONS = ['user_dxf_files', 'strip_user_dxf_files']

// Vrai si la trame s'authentifie avec la clé nulle. Le clair n'est jamais gardé.
function opensWithZeroKey(frame, aadId, ownerId, index) {
    if (frame.length <= NONCE_SIZE + TAG_SIZE) return false
    try {
        const d = crypto.createDecipheriv('aes-256-gcm', ZERO_KEY, frame.subarray(0, NONCE_SIZE), { authTagLength: TAG_SIZE })
        d.setAAD(Buffer.from(`${aadId}|${ownerId}|${index}`, 'utf8'))
        d.setAuthTag(frame.subarray(frame.length - TAG_SIZE))
        d.update(frame.subarray(NONCE_SIZE, frame.length - TAG_SIZE)).fill(0)
        d.final()
        return true
    } catch {
        return false
    }
}

// Trames d'un flux GridFS, une à la fois (la dernière peut être plus courte).
async function* frames(stream) {
    let buf = Buffer.alloc(0)
    for await (const chunk of stream) {
        buf = Buffer.concat([buf, chunk])
        while (buf.length > FRAME_SIZE) {
            yield buf.subarray(0, FRAME_SIZE)
            buf = buf.subarray(FRAME_SIZE)
        }
    }
    if (buf.length > 0) yield buf
}

function verdict(total, zero) {
    if (total > 0 && zero === total) return 'zero'
    if (zero > 0) return 'mixed'
    return 'clean'
}

async function main() {
    const uri = process.env.NUXT_MONGO_URI
    const userId = process.argv[2]
    if (!uri || !userId) {
        console.error('usage: NUXT_MONGO_URI=... node scripts/vault-zero-key-check.mjs <userId>')
        return 1
    }
    const client = new MongoClient(uri, { readPreference: 'secondaryPreferred' })
    await client.connect()
    const summary = { userId, files: 0, zero: 0, mixed: 0, clean: 0, parts: 0, partsZero: 0 }
    try {
        const db = client.db()
        for (const name of BUCKETS) {
            const bucket = new GridFSBucket(db, { bucketName: name })
            const docs = await bucket.find({ 'metadata.ownerId': userId, 'metadata.enc': { $exists: true } }).toArray()
            for (const doc of docs) {
                let total = 0
                let zero = 0
                for await (const frame of frames(bucket.openDownloadStream(doc._id))) {
                    if (opensWithZeroKey(frame, doc.filename, userId, total)) zero += 1
                    total += 1
                }
                const v = verdict(total, zero)
                summary.files += 1
                summary[v] += 1
                console.log(JSON.stringify({ bucket: name, id: String(doc._id), length: doc.length, uploadDate: doc.uploadDate, frames: total, zeroKeyFrames: zero, verdict: v }))
            }
        }
        // Pièces chiffrées (polygonParts) : même format, une seule trame en général.
        for (const name of PARTS_COLLECTIONS) {
            const docs = await db.collection(name)
                .find({ ownerId: userId, 'encPolygonParts.data': { $exists: true } }, { projection: { slug: 1, encPolygonParts: 1 } })
                .toArray()
            for (const doc of docs) {
                const data = Buffer.from(doc.encPolygonParts.data, 'base64')
                let total = 0
                let zero = 0
                for (let off = 0; off < data.length; off += FRAME_SIZE) {
                    if (opensWithZeroKey(data.subarray(off, off + FRAME_SIZE), `polygonParts:${doc.slug}`, userId, total)) zero += 1
                    total += 1
                }
                summary.parts += 1
                if (zero > 0) summary.partsZero += 1
                console.log(JSON.stringify({ collection: name, id: String(doc._id), frames: total, zeroKeyFrames: zero, verdict: verdict(total, zero) }))
            }
        }
    } finally {
        await client.close()
    }
    console.log(JSON.stringify({ summary }))
    return summary.zero + summary.mixed + summary.partsZero > 0 ? 3 : 0
}

main().then(
    (code) => { process.exitCode = code },
    (err) => { console.error(String(err?.message || err)); process.exitCode = 1 },
)
