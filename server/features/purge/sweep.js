// Imports RELATIFS (pas d'alias ~~/) : ce module est chargé par un plugin
// Nitro au démarrage — les plugins ne résolvent pas les alias dans ce
// contexte (cf. 4_demoProjectSeed.js, même pattern).
import { connectDB, getBucket } from '../../db/mongo'
import { DEMO_OWNER_ID } from '../../../shared/constants/demo.constants'
import logger from '../../utils/logger'

/**
 * D-PRV-10 / J-091 — purge 24 h du Mode Serveur (spec : specs/81-purge-24h.md).
 *
 * Stricte pour les non-vault : sources uploadées, copies canoniques,
 * previews, blobs résultats et géométries parsées disparaissent 24 h après
 * leur création (+ 1 h de grâce interne — le délai affiché reste 24 h).
 * Persistent : docs job/fichier (métadonnées) et scalaires du rapport —
 * l'historique = les rapports, pas les fichiers.
 *
 * Exemptions :
 * - vault (blobs metadata.enc / docs encPolygonParts — chiffrés au repos,
 *   clé détenue par l'utilisateur) ;
 * - démo (ownerId technique — vitrine partagée, D-PRV3) ;
 * - Mode Local : résultats déjà 100 % navigateur, rien à purger côté blobs.
 *
 * Mécanisme = sweeper (pas de TTL seul : GridFS impose le delete par bucket
 * — files+chunks — un TTL sur .files laisserait les .chunks orphelins).
 */
export const PURGE_AFTER_MS = 24 * 60 * 60 * 1000
// S-1 (audit 2026-09-27) : le journal HTTP (forme des requêtes, sans contenu)
// vit 14 jours. Balayé ici sans attendre un index TTL (écriture en prod).
export const HTTP_LOG_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const GRACE_MS = 60 * 60 * 1000

// Buckets balayés par ancienneté (sources, copies canoniques mm, previews).
//
// Lot S (2026-09-13) : le pipeline « strip » a été retiré, mais ses buckets et
// ses collections RESTENT en base par décision du propriétaire — donc la purge
// 24 h continue de les couvrir. Une purge qui s'arrête laisse des fichiers à
// vie (D-PRV-10) : leur retrait d'ici est une décision séparée, à prendre
// quand les données seront supprimées. Verrou : purge.test.js
// « le strip retiré reste purgé ».
const SOURCE_BUCKETS = ['userDxf', 'stripUserDxf', 'validDxf', 'userDxfFilesSvg', 'userSvg']

// Buckets résultats : balayage piloté par les jobs (pose purgedAt → UI
// « expiré »), puis le filet de sécurité par ancienneté attrape les
// orphelins (jobs ratés après une écriture partielle).
const RESULT_BUCKET_FOR_JOBS = {
    nesting_jobs: 'nestDxf',
    strip_nesting_job_queue: 'stripNestDxf',
}
const SVG_RESULT_BUCKET = 'nestSvg'

const FILE_COLLECTIONS = ['user_dxf_files', 'strip_user_dxf_files']
const JOB_COLLECTIONS = Object.keys(RESULT_BUCKET_FOR_JOBS)

// Balayage des jobs par pages (curseur `_id`) : bornes mémoire/durée d'un run
// quand le rattrapage porte sur beaucoup de jobs. Au-delà de MAX_PAGES le
// reste est repris au run suivant (toutes les 15 min) — les jobs traités ne
// matchent plus (purgedAt posé / artefacts retirés), les exemptés (vault) sont
// simplement re-sautés.
const PAGE_SIZE = 200
const MAX_PAGES = 10

/**
 * Âge d'un job, sur les SEULS champs de date que les jobs portent vraiment
 * (A-2, vérif 2026-09-27 : l'ancien filtre `updatedAt` n'existe sur aucun
 * job → rien ne matchait jamais). `finishedAt` = fin du job (worker, local-
 * result, cancel, expiration) ; sinon `update_ts` (heartbeat / dernière
 * écriture d'un job jamais terminé) ; sinon `createdAt` (posé à la création).
 * Forme $or plutôt que $ifNull : exploitable sans agrégation.
 */
function jobOlderThan(cutoff) {
    return {
        $or: [
            { finishedAt: { $lt: cutoff } },
            { finishedAt: { $exists: false }, update_ts: { $lt: cutoff } },
            { finishedAt: { $exists: false }, update_ts: { $exists: false }, createdAt: { $lt: cutoff } },
        ],
    }
}

/** Parcourt les jobs d'un filtre par pages d'`_id` croissants. */
async function* pagedJobs(db, collName, filter, projection) {
    let lastId = null
    for (let page = 0; page < MAX_PAGES; page++) {
        const q = lastId == null ? filter : { $and: [filter, { _id: { $gt: lastId } }] }
        const batch = await db
            .collection(collName)
            .find(q, { projection })
            .sort({ _id: 1 })
            .limit(PAGE_SIZE)
            .toArray()
        for (const job of batch) yield job
        if (batch.length < PAGE_SIZE) return
        lastId = batch[batch.length - 1]._id
    }
}

function isPurgeableBlob(fileDoc, cutoff) {
    const md = fileDoc.metadata || {}
    return fileDoc.uploadDate < cutoff && !md.enc && md.ownerId !== DEMO_OWNER_ID
}

/** Tous les noms de blobs résultats d'un job (canonical + alternatives). */
function jobBlobNames(job) {
    const alts = Array.isArray(job.alternatives) ? job.alternatives : []
    return {
        dxfs: [
            ...(job.dxf_files || []),
            ...alts.flatMap((a) => a?.dxf_files || []),
        ],
        svgs: [
            ...(job.svg_files || []),
            ...alts.flatMap((a) => a?.svg_files || []),
        ],
    }
}

/**
 * Passe 1 — résultats pilotés par les jobs done > cutoff : supprime les
 * blobs listés par le job et pose `purgedAt` (l'UI affiche « expiré »).
 * Un job dont un blob est chiffré (vault) est intégralement exempté.
 *
 * Rattrapage (A-2) : la passe 2 a pu supprimer les blobs d'un job avant que
 * cette passe ne le marque (ancien filtre cassé) — ces jobs n'ont pas de
 * `purgedAt` et listent encore des noms de blobs. Ils matchent ici comme les
 * autres : plus aucun blob à supprimer (`candidates` vide), le job est
 * marqué. Idempotent (le filtre exige `purgedAt` absent). Un job sans aucun
 * blob listé (résultat 100 % navigateur, rien côté serveur) n'est PAS marqué :
 * « expiré » mentirait sur un résultat qui vit dans IndexedDB.
 */
async function sweepJobResults(db, jobsName, cutoff, now, deleteBlob) {
    const filter = {
        $and: [
            {
                status: 'done',
                purgedAt: { $exists: false },
                // Coffre déjà constaté (marqué plus bas) : exclu dans la
                // requête, sinon ces jobs rematchent à vie et épuisent le
                // budget de pages au détriment des jobs serveur plus récents.
                purgeExempt: { $exists: false },
                ownerId: { $ne: DEMO_OWNER_ID },
            },
            // Seul un job qui liste au moins un blob serveur est concerné :
            // un résultat 100 % navigateur (local-result n'écrit ni dxf_files
            // ni svg_files) n'a rien à expirer et ne doit pas rematcher.
            {
                $or: [
                    { 'dxf_files.0': { $exists: true } },
                    { 'svg_files.0': { $exists: true } },
                    { 'alternatives.dxf_files.0': { $exists: true } },
                    { 'alternatives.svg_files.0': { $exists: true } },
                ],
            },
            jobOlderThan(cutoff),
        ],
    }
    const projection = { dxf_files: 1, svg_files: 1, 'alternatives.dxf_files': 1, 'alternatives.svg_files': 1 }

    const dxfBucket = RESULT_BUCKET_FOR_JOBS[jobsName]
    let purged = 0
    for await (const job of pagedJobs(db, jobsName, filter, projection)) {
        const { dxfs, svgs } = jobBlobNames(job)
        const candidates = []
        for (const [bucket, names] of [[dxfBucket, dxfs], [SVG_RESULT_BUCKET, svgs]]) {
            if (!names.length) continue
            const docs = await db
                .collection(`${bucket}.files`)
                .find({ filename: { $in: names } })
                .toArray()
            for (const d of docs) candidates.push({ bucket, doc: d })
        }
        // Vault : le moindre blob chiffré exempte tout le job (la promesse
        // 24 h ne s'applique pas aux contenus chiffrés au repos).
        if (candidates.some((c) => c.doc.metadata?.enc)) {
            await db.collection(jobsName).updateOne({ _id: job._id }, { $set: { purgeExempt: 'vault' } })
            continue
        }

        for (const c of candidates) {
            try {
                await deleteBlob(c.bucket, c.doc._id)
            } catch (err) {
                logger.warn(`purge: blob ${c.bucket}/${c.doc.filename} skip: ${err?.message}`)
            }
        }
        await db.collection(jobsName).updateOne(
            { _id: job._id },
            { $set: { purgedAt: now } }
        )
        purged++
    }
    return purged
}

/** Passe 2 — filet de sécurité buckets : tout blob vieux, non chiffré, non
 * démo (orphelins inclus, toutes sources/copies/previews/résultats). */
async function sweepBuckets(db, cutoff, deleteBlob) {
    const names = [...SOURCE_BUCKETS, ...new Set(Object.values(RESULT_BUCKET_FOR_JOBS)), SVG_RESULT_BUCKET]
    let deleted = 0
    for (const name of names) {
        const old = await db
            .collection(`${name}.files`)
            .find({ uploadDate: { $lt: cutoff } })
            .toArray()
        for (const f of old) {
            if (!isPurgeableBlob(f, cutoff)) continue
            try {
                await deleteBlob(name, f._id)
                deleted++
            } catch (err) {
                logger.warn(`purge: blob ${name}/${f.filename} skip: ${err?.message}`)
            }
        }
    }
    return deleted
}

/** Passe 3 — géométrie parsée des docs fichiers (le doc et ses métadonnées
 * restent ; `purgedAt` pilote l'affichage « expiré » de la liste projet). */
async function sweepFileGeometry(db, collName, cutoff, now) {
    const docs = await db
        .collection(collName)
        .find({
            uploadAt: { $lt: cutoff },
            ownerId: { $ne: DEMO_OWNER_ID },
            encPolygonParts: { $exists: false },
            polygonParts: { $exists: true },
        })
        .toArray()
    let cleaned = 0
    for (const d of docs) {
        await db.collection(collName).updateOne(
            { _id: d._id },
            { $unset: { polygonParts: '' }, $set: { purgedAt: now } }
        )
        cleaned++
    }
    return cleaned
}

/** Passe 4 — artefacts éphémères de jobs (tous users, vault incluse :
 * localPayload contient l'instance en clair, liveLayout une géométrie —
 * transports/snapshots sans valeur après le job ; piège #18 étendu aux
 * jobs orphelins qui n'ont jamais reçu le $unset final).
 *
 * A-2 : couvre les jobs navigateur abandonnés. `expireOrphanAwaitingLocal`
 * retire `localPayload` à l'expiration, mais seulement quand le PROPRIÉTAIRE
 * revient (POST nest / ouverture du flux SSE) — un compte qui ne revient
 * jamais gardait l'instance en clair (pièces + géométrie) sur un job
 * `awaiting_local`. Cette passe ne touche pas au statut (l'expiration reste
 * à ce module : remboursement, slot de concurrence) : elle ne retire que les
 * données lourdes d'un job sans activité depuis 25 h (et non pris depuis). */
async function sweepJobArtifacts(db, jobsName, cutoff) {
    // Jobs NON terminaux (ou en échec) : les trois artefacts. Jobs `done` :
    // seul `localPayload` (instance en clair) — `liveLayout` d'un job local
    // terminé est la trame finale que le modal lit (dimension de tôle quand
    // le rapport manque), il reste.
    const filter = {
        $and: [
            jobOlderThan(cutoff),
            // Un onglet a pu prendre le payload récemment : calcul possible.
            { $or: [{ takenAt: { $exists: false } }, { takenAt: { $lt: cutoff } }] },
            {
                $or: [
                    {
                        status: { $in: ['pending', 'processing', 'awaiting_local', 'error', 'cancelled'] },
                        $or: [
                            { localPayload: { $exists: true } },
                            { liveLayout: { $exists: true } },
                            { itemMap: { $exists: true } },
                        ],
                    },
                    { status: 'done', localPayload: { $exists: true } },
                ],
            },
        ],
    }
    let cleaned = 0
    for await (const j of pagedJobs(db, jobsName, filter, { status: 1 })) {
        const unset = j.status === 'done'
            ? { localPayload: '' }
            : { localPayload: '', liveLayout: '', itemMap: '', progress: '', compute: '' }
        await db.collection(jobsName).updateOne({ _id: j._id }, { $unset: unset })
        cleaned++
    }
    return cleaned
}

/** Passe 5 — journal HTTP : entrées plus vieilles que 14 jours. */
async function sweepHttpLog(db, now) {
    const res = await db
        .collection('http')
        .deleteMany({ timestamp: { $lt: new Date(now.getTime() - HTTP_LOG_RETENTION_MS) } })
    return res?.deletedCount ?? 0
}

/**
 * Un run de purge. Injectable pour les tests (fakeDb + deleteBlob factice).
 * @param {{now?: Date, db?: any, deleteBlob?: (bucket: string, id: any) => Promise<void>}} opts
 */
export async function runPurgeOnce({ now = new Date(), db = null, deleteBlob = null } = {}) {
    db = db || (await connectDB())
    deleteBlob = deleteBlob || (async (bucket, id) => (await getBucket(bucket)).delete(id))
    const cutoff = new Date(now.getTime() - PURGE_AFTER_MS - GRACE_MS)

    const report = { jobs: 0, blobs: 0, fileDocs: 0, artifacts: 0, httpLogs: 0 }
    for (const jobsName of JOB_COLLECTIONS) {
        report.jobs += await sweepJobResults(db, jobsName, cutoff, now, deleteBlob)
    }
    report.blobs += await sweepBuckets(db, cutoff, deleteBlob)
    for (const collName of FILE_COLLECTIONS) {
        report.fileDocs += await sweepFileGeometry(db, collName, cutoff, now)
    }
    for (const jobsName of JOB_COLLECTIONS) {
        report.artifacts += await sweepJobArtifacts(db, jobsName, cutoff)
    }
    report.httpLogs += await sweepHttpLog(db, now)
    logger.info(`purge: ${JSON.stringify(report)}`)
    return report
}
