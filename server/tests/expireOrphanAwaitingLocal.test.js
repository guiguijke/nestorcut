import { describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

globalThis.useRuntimeConfig = vi.fn(() => ({}))

// AH3 (lot 4) : la transition atomique conditionnée (status + pas de
// takenAt + non remboursé) fait que seul l'appel qui FAIT BASCULER le
// statut rembourse — le test pilote un mini-db in-memory qui applique
// les filtres $eq/$ne/$exists et rend l'updateOne réellement atomique
// (le filtre Mongo exact est relu dans l'utilitaire).
import { expireOrphanAwaitingLocal, expireStaleTakenAwaitingLocal } from '~~/server/utils/expireOrphanAwaitingLocal'

function mkDb(jobs, users) {
    return {
        collection(name) {
            const docs = name === 'nesting_jobs' ? jobs : users
            const getByPath = (doc, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc)
            const setByPath = (doc, path, v) => {
                const ks = path.split('.')
                let o = doc
                while (ks.length > 1) { o = o[ks.shift()] ??= {} }
                o[ks[0]] = v
            }
            const matches = (doc, q) => Object.entries(q).every(([k, v]) => {
                const val = getByPath(doc, k)
                if (v && typeof v === 'object' && '$ne' in v) return val !== v.$ne
                if (v && typeof v === 'object' && '$exists' in v) return v.$exists ? val !== undefined : val === undefined
                if (v && typeof v === 'object' && '$lt' in v) return val < v.$lt
                if (v && typeof v === 'object' && '$gt' in v) return val > v.$gt
                return val === v
            })
            return {
                find: (q) => ({ project: () => ({ toArray: async () => docs.filter((d) => matches(d, q)) }) }),
                findOne: (q) => docs.find((d) => matches(d, q)),
                updateOne: async (q, u) => {
                    const doc = docs.find((d) => matches(d, q))
                    if (!doc) return { matchedCount: 0 }
                    const set = u.$set || {}
                    for (const [k, v] of Object.entries(set)) setByPath(doc, k, v)
                    const incOps = u.$inc || {}
                    for (const [k, v] of Object.entries(incOps)) {
                        doc[k] = (doc[k] || 0) + v
                    }
                    return { matchedCount: 1 }
                },
            }
        },
    }
}

const NOW = new Date('2026-09-06T11:00:00Z').getTime()
const OLD = new Date('2026-09-06T10:00:00Z')
const mkJob = (over = {}) => ({
    slug: 'j1', ownerId: 'u1', status: 'awaiting_local',
    createdAt: OLD, charge: { type: 'free' }, ...over,
})

describe('expireOrphanAwaitingLocal (A3/AH2/AH3)', () => {
    it('expire + rembourse UNE seule fois sur deux appels concurrents', async () => {
        const jobs = [mkJob()]
        const users = [{ id: 'u1', freeNestingUsed: 1 }]
        const db = mkDb(jobs, users)
        const r1 = await expireOrphanAwaitingLocal(db, 'u1', { now: NOW })
        const r2 = await expireOrphanAwaitingLocal(db, 'u1', { now: NOW })
        expect(r1).toEqual(['j1'])
        expect(r2).toEqual([])
        // 1 - 1 = 0, JAMAIS 1 - 2 (la 2e transition ne matche plus).
        expect(users[0].freeNestingUsed).toBe(0)
        expect(jobs[0].status).toBe('cancelled')
        expect(jobs[0].information).toBe('awaiting_local_expired')
        expect(jobs[0].charge.refunded).toBe(true)
    })

    it('un job PRIS (takenAt), RÉCENT ou déjà remboursé nest jamais expiré', async () => {
        const jobs = [
            mkJob({ slug: 'pris', takenAt: new Date('2026-09-06T10:30:00Z') }),
            mkJob({ slug: 'recent', createdAt: new Date('2026-09-06T10:55:00Z') }),
            mkJob({ slug: 'deja', charge: { type: 'free', refunded: true } }),
        ]
        const users = [{ id: 'u1', freeNestingUsed: 3 }]
        const db = mkDb(jobs, users)
        const r = await expireOrphanAwaitingLocal(db, 'u1', { now: NOW })
        expect(r).toEqual([])
        expect(users[0].freeNestingUsed).toBe(3)
        expect(jobs.every((j) => j.status === 'awaiting_local')).toBe(true)
    })
})

describe('expireStaleTakenAwaitingLocal (job pris mais jamais livré)', () => {
    const TAKEN_OLD = new Date('2026-09-06T08:00:00Z') // 3 h avant NOW
    it('passe en error local_interrupted, rembourse UNE fois, ignore pris récent', async () => {
        const jobs = [
            mkJob({ slug: 'vieux', takenAt: TAKEN_OLD }),
            mkJob({ slug: 'recent', takenAt: new Date('2026-09-06T10:30:00Z') }),
            mkJob({ slug: 'orphelin' }), // sans takenAt : autre passe
        ]
        const users = [{ id: 'u1', freeNestingUsed: 2 }]
        const db = mkDb(jobs, users)
        const r1 = await expireStaleTakenAwaitingLocal(db, 'u1', { now: NOW })
        const r2 = await expireStaleTakenAwaitingLocal(db, 'u1', { now: NOW })
        expect(r1).toEqual(['vieux'])
        expect(r2).toEqual([])
        expect(users[0].freeNestingUsed).toBe(1)
        expect(jobs[0]).toMatchObject({
            status: 'error', error: 'local_interrupted', errorCode: 'local_interrupted',
            information: 'local_interrupted', placed: 0,
        })
        expect(jobs[0].charge.refunded).toBe(true)
        expect(jobs[1].status).toBe('awaiting_local')
        expect(jobs[2].status).toBe('awaiting_local')
    })

    it('un job déjà remboursé est fermé SANS second remboursement', async () => {
        const jobs = [mkJob({ slug: 'deja', takenAt: TAKEN_OLD, charge: { type: 'free', refunded: true } })]
        const users = [{ id: 'u1', freeNestingUsed: 2 }]
        const r = await expireStaleTakenAwaitingLocal(mkDb(jobs, users), 'u1', { now: NOW })
        expect(r).toEqual(['deja'])
        expect(users[0].freeNestingUsed).toBe(2)
        expect(jobs[0].status).toBe('error')
    })
})
