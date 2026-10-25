import { beforeEach, describe, expect, it, vi } from 'vitest'

// The mocked db is swapped per test through this hoisted state; bucket
// deletions are recorded (the sweeper must go through bucket.delete so
// GridFS chunks follow — a raw .files delete would orphan them).
const state = vi.hoisted(() => ({ db: null, deleted: [] }))

vi.mock('../../server/db/mongo', () => ({
    connectDB: async () => state.db,
    getBucket: vi.fn(),
}))

vi.mock('../../server/utils/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { runPurgeOnce, PURGE_AFTER_MS, HTTP_LOG_RETENTION_MS } from '~~/server/features/purge/sweep'
import { fakeDb as baseFakeDb } from './helpers/fakeMongo'

// fakeMongo ne connait ni .sort() effectif ni .limit() : le balayage pagine
// les jobs par `_id` croissant, on greffe donc ce curseur ici (les `_id` des
// donnees de test sont fournis dans l'ordre).
const fakeDb = (collections) => {
    const db = baseFakeDb(collections)
    const collection = db.collection.bind(db)
    db.collection = (name) => {
        const col = collection(name)
        if (col.__paged) return col
        const find = col.find.bind(col)
        col.find = (filter) => {
            const base = find(filter)
            return {
                ...base,
                sort() { return this },
                limit(n) { return { toArray: async () => (await base.toArray()).slice(0, n) } },
            }
        }
        col.__paged = true
        return col
    }
    return db
}

const NOW = new Date('2026-08-10T12:00:00Z')
const OLD = new Date(NOW.getTime() - PURGE_AFTER_MS - 2 * 60 * 60 * 1000) // 26 h
const FRESH = new Date(NOW.getTime() - 60 * 60 * 1000) // 1 h

const blob = (filename, uploadDate, metadata = { ownerId: 'u1' }) => ({
    _id: `id:${filename}`,
    filename,
    uploadDate,
    metadata,
})

const deleteBlob = async (bucket, id) => {
    state.deleted.push([bucket, id])
}

beforeEach(() => {
    state.db = null
    state.deleted = []
})

describe('runPurgeOnce — buckets (filet de sécurité)', () => {
    it('deletes old plaintext non-demo blobs, keeps fresh/enc/demo ones', async () => {
        state.db = fakeDb({
            'userDxf.files': [
                blob('old-plain.dxf', OLD),
                blob('fresh.dxf', FRESH),
                blob('old-enc.dxf', OLD, { ownerId: 'u1', enc: 'aes-256-gcm' }),
                blob('old-demo.dxf', OLD, { ownerId: 'demo' }),
            ],
            user_dxf_files: [],
            strip_user_dxf_files: [],
            nesting_jobs: [],
            strip_nesting_job_queue: [],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(state.deleted).toEqual([['userDxf', 'id:old-plain.dxf']])
        expect(report.blobs).toBe(1)
    })
})

describe('runPurgeOnce — résultats pilotés par les jobs', () => {
    const job = (overrides = {}) => {
        const slug = overrides.slug || 'nested-abc'
        return {
            _id: 'j1',
            slug,
            ownerId: 'u1',
            status: 'done',
            createdAt: OLD,
            startAt: OLD,
            finishedAt: OLD,
            update_ts: OLD,
            dxf_files: [`${slug}_part_1.dxf`],
            svg_files: [`${slug}_part_1.svg`],
            alternatives: [{ alt_id: 'b', dxf_files: [`${slug}_alt-b_part_1.dxf`], svg_files: [] }],
            ...overrides,
        }
    }

    it('deletes every listed blob (canonical + alternatives) and sets purgedAt', async () => {
        const jobs = [job()]
        state.db = fakeDb({
            nesting_jobs: jobs,
            strip_nesting_job_queue: [],
            user_dxf_files: [],
            strip_user_dxf_files: [],
            'nestDxf.files': [
                blob('nested-abc_part_1.dxf', OLD),
                blob('nested-abc_alt-b_part_1.dxf', OLD),
            ],
            'nestSvg.files': [blob('nested-abc_part_1.svg', OLD)],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(state.deleted).toContainEqual(['nestDxf', 'id:nested-abc_part_1.dxf'])
        expect(state.deleted).toContainEqual(['nestDxf', 'id:nested-abc_alt-b_part_1.dxf'])
        expect(state.deleted).toContainEqual(['nestSvg', 'id:nested-abc_part_1.svg'])
        expect(jobs[0].purgedAt).toEqual(NOW)
        expect(report.jobs).toBe(1)
        // Le filet de sécurité ne re-supprime rien (déjà partis) — les docs
        // .files factices restent listés mais le delete est idempotent côté
        // appelant ; ici chaque blob n'a été supprimé qu'une fois par passe.
    })

    it('exempts a vault job entirely (any enc blob) and skips recent jobs', async () => {
        const jobs = [
            job({ _id: 'j-vault', slug: 'nested-vault' }),
            job({ _id: 'j-fresh', slug: 'nested-fresh', createdAt: FRESH, finishedAt: FRESH, update_ts: FRESH, dxf_files: [], svg_files: [], alternatives: [] }),
        ]
        state.db = fakeDb({
            nesting_jobs: jobs,
            strip_nesting_job_queue: [],
            user_dxf_files: [],
            strip_user_dxf_files: [],
            'nestDxf.files': [blob('nested-vault_part_1.dxf', OLD, { ownerId: 'u1', enc: 'aes-256-gcm' })],
            'nestSvg.files': [blob('nested-vault_part_1.svg', OLD, { ownerId: 'u1', enc: 'aes-256-gcm' })],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(state.deleted).toEqual([])
        expect(jobs[0].purgedAt).toBeUndefined()
        expect(jobs[1].purgedAt).toBeUndefined()
        expect(report.jobs).toBe(0)
    })
})

describe('runPurgeOnce — A-2 : filtre sur les dates RÉELLES des jobs', () => {
    // Forme réelle d'un job (workers + routes local-*) : createdAt, startAt,
    // finishedAt, update_ts. Jamais `updatedAt`. Ces cas échouent avec
    // l'ancien filtre `updatedAt: { $lt: cutoff }` (aucun job ne matchait).
    const done = (id, dates, extra = {}) => ({
        _id: id,
        slug: `nested-${id}`,
        ownerId: 'u1',
        status: 'done',
        dxf_files: [`nested-${id}.dxf`],
        svg_files: [`nested-${id}.svg`],
        ...dates,
        ...extra,
    })
    const empty = { user_dxf_files: [], strip_user_dxf_files: [], strip_nesting_job_queue: [] }

    it('marque purgedAt un job done vieux de 26 h portant finishedAt/update_ts (pas updatedAt)', async () => {
        const jobs = [done('a', { createdAt: OLD, startAt: OLD, finishedAt: OLD, update_ts: OLD })]
        expect(jobs[0].updatedAt).toBeUndefined()
        state.db = fakeDb({
            ...empty,
            nesting_jobs: jobs,
            'nestDxf.files': [blob('nested-a.dxf', OLD)],
            'nestSvg.files': [blob('nested-a.svg', OLD)],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(jobs[0].purgedAt).toEqual(NOW)
        expect(report.jobs).toBe(1)
    })

    it('replis : update_ts si pas de finishedAt, createdAt si pas non plus de update_ts', async () => {
        const jobs = [
            done('b', { createdAt: OLD, update_ts: OLD }),
            done('c', { createdAt: OLD }),
            done('d', { createdAt: OLD, finishedAt: FRESH, update_ts: FRESH }), // fini récemment : épargné
        ]
        state.db = fakeDb({ ...empty, nesting_jobs: jobs })
        await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(jobs[0].purgedAt).toEqual(NOW)
        expect(jobs[1].purgedAt).toEqual(NOW)
        expect(jobs[2].purgedAt).toBeUndefined()
    })

    it('rattrapage : blobs déjà supprimés (passe 2) mais job sans purgedAt → marqué, une seule fois', async () => {
        const jobs = [done('e', { createdAt: OLD, finishedAt: OLD, update_ts: OLD })]
        // Aucun doc dans nestDxf.files / nestSvg.files : fichiers déjà partis.
        state.db = fakeDb({ ...empty, nesting_jobs: jobs })
        const first = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(jobs[0].purgedAt).toEqual(NOW)
        expect(first.jobs).toBe(1)
        expect(state.deleted).toEqual([])
        const later = new Date(NOW.getTime() + 15 * 60 * 1000)
        const second = await runPurgeOnce({ now: later, db: state.db, deleteBlob })
        expect(jobs[0].purgedAt).toEqual(NOW) // pas ré-écrit
        expect(second.jobs).toBe(0)
    })

    it('ne marque pas « expiré » un résultat 100 % navigateur (aucun blob listé) ni un job démo', async () => {
        const jobs = [
            done('f', { createdAt: OLD, finishedAt: OLD }, { dxf_files: undefined, svg_files: undefined, localOnly: true }),
            done('g', { createdAt: OLD, finishedAt: OLD }, { ownerId: 'demo' }),
        ]
        state.db = fakeDb({ ...empty, nesting_jobs: jobs })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(jobs[0].purgedAt).toBeUndefined()
        expect(jobs[1].purgedAt).toBeUndefined()
        expect(report.jobs).toBe(0)
    })

    it('job navigateur abandonné (awaiting_local pris, jamais livré) : instance retirée, statut intact', async () => {
        const jobs = [
            {
                _id: 'w1', slug: 'w1', ownerId: 'u1', status: 'awaiting_local',
                createdAt: OLD, takenAt: OLD, localPayload: { instance: { items: [1] } },
                liveLayout: { sheets: [] },
            },
            { _id: 'w2', slug: 'w2', ownerId: 'u1', status: 'awaiting_local', createdAt: FRESH, localPayload: { instance: {} } },
        ]
        state.db = fakeDb({ ...empty, nesting_jobs: jobs })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(jobs[0].localPayload).toBeUndefined()
        expect(jobs[0].liveLayout).toBeUndefined()
        expect(jobs[0].status).toBe('awaiting_local') // l'expiration/remboursement reste à expireOrphanAwaitingLocal
        expect(jobs[1].localPayload).toBeDefined()
        expect(report.artifacts).toBe(1)
    })

    it('famine : > 2000 jobs sautés (locaux sans blob + coffre) ne bloquent pas un job serveur plus récent', async () => {
        const skipped = Array.from({ length: 2100 }, (_, i) =>
            done(`a${String(i).padStart(4, '0')}`, { createdAt: OLD, finishedAt: OLD }, { dxf_files: undefined, svg_files: undefined, localOnly: true }),
        )
        const vault = Array.from({ length: 30 }, (_, i) =>
            done(`b${String(i).padStart(2, '0')}`, { createdAt: OLD, finishedAt: OLD }, { dxf_files: [], svg_files: ['vault.svg'] }),
        )
        const server = done('z-server', { createdAt: OLD, finishedAt: OLD })
        state.db = fakeDb({
            ...empty,
            nesting_jobs: [...skipped, ...vault, server],
            'nestSvg.files': [blob('vault.svg', OLD, { ownerId: 'u1', enc: 'aes-256-gcm' })],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(server.purgedAt).toEqual(NOW)
        expect(report.jobs).toBe(1)
        expect(skipped.some((j) => j.purgedAt)).toBe(false)
        // Coffre : jamais purgé, mais marqué exempt → exclu des runs suivants.
        expect(vault.every((j) => j.purgeExempt === 'vault' && !j.purgedAt)).toBe(true)
    })

    it('passe 4 : un job done garde son liveLayout final ; un onglet qui vient de prendre le payload est épargné', async () => {
        const jobs = [
            { _id: 'k1', slug: 'k1', ownerId: 'u1', status: 'done', createdAt: OLD, finishedAt: OLD, liveLayout: { stage: 'final', sheets: [[1, 2]] } },
            { _id: 'k2', slug: 'k2', ownerId: 'u1', status: 'awaiting_local', createdAt: OLD, takenAt: FRESH, localPayload: { instance: {} } },
        ]
        state.db = fakeDb({ ...empty, nesting_jobs: jobs })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(jobs[0].liveLayout).toBeDefined()
        expect(jobs[1].localPayload).toBeDefined()
        expect(report.artifacts).toBe(0)
    })

    it('pagine : un rattrapage de 450 jobs est traité en entier, un job vault sauté sans bloquer', async () => {
        const jobs = Array.from({ length: 450 }, (_, i) =>
            done(`p${String(i).padStart(3, '0')}`, { createdAt: OLD, finishedAt: OLD }, { dxf_files: [], svg_files: ['x.svg'] }),
        )
        // Un job vault dans la première page : jamais marqué, ne doit ni
        // boucler ni affamer la suite.
        jobs[10].svg_files = ['vault.svg']
        state.db = fakeDb({
            ...empty,
            nesting_jobs: jobs,
            'nestSvg.files': [blob('vault.svg', OLD, { ownerId: 'u1', enc: 'aes-256-gcm' })],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(jobs.filter((j) => j.purgedAt).length).toBe(449)
        expect(jobs[10].purgedAt).toBeUndefined()
        expect(report.jobs).toBe(449)
    })
})

describe('runPurgeOnce — géométrie des docs fichiers', () => {
    it('$unset polygonParts + purgedAt on old plaintext docs only', async () => {
        const files = [
            { _id: 'f1', slug: 'a.dxf', ownerId: 'u1', uploadAt: OLD, polygonParts: [{ id: 0 }] },
            { _id: 'f2', slug: 'b.dxf', ownerId: 'u1', uploadAt: OLD, encPolygonParts: { data: 'x' } },
            { _id: 'f3', slug: 'c.dxf', ownerId: 'demo', uploadAt: OLD, polygonParts: [{ id: 0 }] },
            { _id: 'f4', slug: 'd.dxf', ownerId: 'u1', uploadAt: FRESH, polygonParts: [{ id: 0 }] },
        ]
        state.db = fakeDb({
            user_dxf_files: files,
            strip_user_dxf_files: [],
            nesting_jobs: [],
            strip_nesting_job_queue: [],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(files[0].polygonParts).toBeUndefined()
        expect(files[0].purgedAt).toEqual(NOW)
        expect(files[1].encPolygonParts).toBeDefined()
        expect(files[1].purgedAt).toBeUndefined()
        expect(files[2].polygonParts).toBeDefined() // démo exemptée
        expect(files[3].polygonParts).toBeDefined() // trop récent
        expect(report.fileDocs).toBe(1)
    })
})

describe('runPurgeOnce — artefacts éphémères de jobs', () => {
    it('unsets localPayload/liveLayout on stale jobs (vault included)', async () => {
        const jobs = [
            { _id: 'j1', slug: 's1', ownerId: 'u1', status: 'awaiting_local', createdAt: OLD, takenAt: OLD, localPayload: { instance: {} } },
            { _id: 'j2', slug: 's2', ownerId: 'u1', status: 'processing', createdAt: OLD, startAt: OLD, update_ts: OLD, liveLayout: { sheets: [] } },
            { _id: 'j3', slug: 's3', ownerId: 'u1', status: 'done', createdAt: OLD, finishedAt: FRESH, update_ts: FRESH, localPayload: { instance: {} } },
        ]
        state.db = fakeDb({
            nesting_jobs: jobs,
            strip_nesting_job_queue: [],
            user_dxf_files: [],
            strip_user_dxf_files: [],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(jobs[0].localPayload).toBeUndefined()
        expect(jobs[1].liveLayout).toBeUndefined()
        expect(jobs[2].localPayload).toBeDefined() // trop récent
        expect(report.artifacts).toBe(2)
    })

    it('is idempotent — a second run finds nothing', async () => {
        state.db = fakeDb({
            nesting_jobs: [
                { _id: 'j1', slug: 's1', ownerId: 'u1', status: 'done', createdAt: OLD, finishedAt: OLD, localPayload: {} },
            ],
            strip_nesting_job_queue: [],
            user_dxf_files: [
                { _id: 'f1', slug: 'a.dxf', ownerId: 'u1', uploadAt: OLD, polygonParts: [] },
            ],
        })
        const first = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(first.artifacts + first.fileDocs + first.jobs).toBeGreaterThan(0)
        const second = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(second).toMatchObject({ jobs: 0, blobs: 0, fileDocs: 0, artifacts: 0 })
    })
})

describe('runPurgeOnce — le strip retiré reste purgé (lot S, 2026-09-13)', () => {
    // Le pipeline « strip » a été retiré du produit, ses DONNÉES restent en
    // base. Une purge qui cesse de les couvrir les laisserait à vie : ce
    // verrou fixe le contrat, buckets ET documents.
    it('balaie stripUserDxf et stripNestDxf comme les buckets bin', async () => {
        state.db = fakeDb({
            'stripUserDxf.files': [blob('vieille-source.dxf', OLD), blob('fraiche.dxf', FRESH)],
            'stripNestDxf.files': [blob('vieux-resultat.dxf', OLD)],
            user_dxf_files: [],
            strip_user_dxf_files: [],
            nesting_jobs: [],
            strip_nesting_job_queue: [],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(state.deleted).toEqual([
            ['stripUserDxf', 'id:vieille-source.dxf'],
            ['stripNestDxf', 'id:vieux-resultat.dxf'],
        ])
        expect(report.blobs).toBe(2)
    })

    it('marque purgedAt et vide la géométrie des fichiers strip', async () => {
        const files = [
            { _id: 'sf1', slug: 's-a.dxf', ownerId: 'u1', uploadAt: OLD, polygonParts: [{ x: 1 }] },
            { _id: 'sf2', slug: 's-b.dxf', ownerId: 'u1', uploadAt: FRESH, polygonParts: [{ x: 2 }] },
        ]
        state.db = fakeDb({
            user_dxf_files: [],
            strip_user_dxf_files: files,
            nesting_jobs: [],
            strip_nesting_job_queue: [],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(files[0].purgedAt).toBeInstanceOf(Date)
        expect(files[0].polygonParts).toBeUndefined()
        expect(files[1].purgedAt).toBeUndefined() // trop récent
        expect(report.fileDocs).toBe(1)
    })
})

describe('runPurgeOnce — journal HTTP 14 jours (S-1)', () => {
    it('supprime les entrées de plus de 14 jours, garde les récentes', async () => {
        const old = { _id: 'h1', route: '/api/x', timestamp: new Date(NOW.getTime() - HTTP_LOG_RETENTION_MS - 60_000) }
        const edge = { _id: 'h2', route: '/api/y', timestamp: new Date(NOW.getTime() - HTTP_LOG_RETENTION_MS + 60_000) }
        const fresh = { _id: 'h3', route: 'page', timestamp: FRESH }
        const http = [old, edge, fresh]
        state.db = fakeDb({
            http,
            user_dxf_files: [],
            strip_user_dxf_files: [],
            nesting_jobs: [],
            strip_nesting_job_queue: [],
        })
        const report = await runPurgeOnce({ now: NOW, db: state.db, deleteBlob })
        expect(http.map((d) => d._id)).toEqual(['h2', 'h3'])
        expect(report.httpLogs).toBe(1)
    })
})
