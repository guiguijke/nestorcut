import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// S-4 — sessions hachées (sha256), migration paresseuse des jetons bruts,
// expiration 90 j, purge à la connexion, plafond par utilisateur.
// Mini-collection `users` en mémoire : uniquement les opérateurs utilisés
// par server/utils/auth.js.

const state = vi.hoisted(() => {
    globalThis.defineNitroPlugin = (fn) => fn
    return { users: [] }
})
vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => ({ collection: () => usersCollection() }),
}))

const cmp = (v, cond) =>
    cond !== null && typeof cond === 'object' && !(cond instanceof Date)
        ? Object.entries(cond).every(([op, a]) => (op === '$lte' ? v != null && v <= a : op === '$lt' ? v != null && v < a : false))
        : v === cond
const elemMatches = (s, em) => Object.entries(em).every(([k, c]) => cmp(s[k], c))
const matchDoc = (u, f) =>
    Object.entries(f).every(([k, c]) =>
        k === 'sessions' && c.$elemMatch ? (u.sessions || []).some((s) => elemMatches(s, c.$elemMatch)) : u[k] === c,
    )

function usersCollection() {
    return {
        find: (f) => ({
            limit: (n) => ({ toArray: async () => state.users.filter((u) => (u.sessions || []).some((s) => 'sessionId' in s)).slice(0, n) }),
        }),
        findOne: async (f) => state.users.find((u) => matchDoc(u, f)) || null,
        updateOne: async (f, upd) => {
            const u = state.users.find((x) => matchDoc(x, f))
            if (!u) return { matchedCount: 0 }
            for (const [k, v] of Object.entries(upd.$set || {})) {
                if (k.startsWith('sessions.$.')) {
                    const idx = u.sessions.findIndex((s) => elemMatches(s, f.sessions.$elemMatch))
                    u.sessions[idx][k.slice('sessions.$.'.length)] = v
                } else u[k] = v
            }
            for (const k of Object.keys(upd.$unset || {})) {
                const idx = u.sessions.findIndex((s) => elemMatches(s, f.sessions.$elemMatch))
                delete u.sessions[idx][k.slice('sessions.$.'.length)]
            }
            if (upd.$pull) u.sessions = u.sessions.filter((s) => !elemMatches(s, upd.$pull.sessions))
            if (upd.$push) {
                const { $each, $slice } = upd.$push.sessions
                u.sessions = [...(u.sessions || []), ...$each].slice($slice)
            }
            return { matchedCount: 1 }
        },
    }
}

import {
    MAX_SESSIONS_PER_USER,
    SESSION_TTL_MS,
    generateSession,
    getUserBySessionId,
    hashSessionId,
    purgeExpiredSessions,
    pushSessionUpdate,
    removeSessionFromUser,
    storedSession,
} from '~~/server/utils/auth'
import { SESSION_RENEW_BELOW_MS } from '~~/server/utils/sessionCore'
import { migrateLegacySessions } from '../plugins/5_sessionMigration'

const DAY = 24 * 3600 * 1000
const db = () => ({ collection: () => usersCollection() })
const user = () => state.users[0]

beforeEach(() => {
    state.users = [{ _id: 1, id: 'local:a@x.fr', sessions: [] }]
})

describe('création', () => {
    it('stocke sha256(jeton), jamais le jeton brut ; échéance = 90 j', async () => {
        const session = generateSession()
        await usersCollection().updateOne({ id: 'local:a@x.fr' }, { $push: pushSessionUpdate(session) })
        const stored = user().sessions[0]
        expect(stored.sessionHash).toBe(hashSessionId(session.sessionId))
        expect(stored.sessionHash).toMatch(/^[0-9a-f]{64}$/)
        expect(JSON.stringify(user())).not.toContain(session.sessionId)
        expect(stored.sessionId).toBeUndefined()
        expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(SESSION_TTL_MS)
        expect(SESSION_TTL_MS).toBe(90 * DAY)
        expect((await getUserBySessionId(session.sessionId)).id).toBe('local:a@x.fr')
    })

    it('rejette un jeton inconnu ou absent', async () => {
        expect(await getUserBySessionId('nope')).toBeNull()
        expect(await getUserBySessionId(undefined)).toBeNull()
    })

    it('un hash copié depuis la base ne vaut pas jeton', async () => {
        const session = generateSession()
        user().sessions.push(storedSession(session))
        expect(await getUserBySessionId(hashSessionId(session.sessionId))).toBeNull()
    })
})

describe('migration paresseuse', () => {
    it('jeton hérité brut : accepté puis réécrit en hash avec échéance plafonnée à 90 j', async () => {
        user().sessions = [{ sessionId: 'RAW-TOKEN', createdAt: new Date(), expiresAt: new Date(Date.now() + 300 * DAY) }]
        expect((await getUserBySessionId('RAW-TOKEN')).id).toBe('local:a@x.fr')
        const s = user().sessions[0]
        expect(s.sessionId).toBeUndefined()
        expect(s.sessionHash).toBe(hashSessionId('RAW-TOKEN'))
        expect(s.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + SESSION_TTL_MS)
        expect(s.expiresAt.getTime()).toBeGreaterThan(Date.now() + 89 * DAY)
        // La requête suivante passe par le hash.
        expect((await getUserBySessionId('RAW-TOKEN')).id).toBe('local:a@x.fr')
    })

    it('hérité avec échéance proche : conserve son échéance', async () => {
        const exp = new Date(Date.now() + 50 * DAY)
        user().sessions = [{ sessionId: 'RAW', expiresAt: exp }]
        await getUserBySessionId('RAW')
        expect(user().sessions[0].expiresAt).toEqual(exp)
    })

    it("hérité sans date : reçoit l'échéance à la migration", async () => {
        user().sessions = [{ sessionId: 'RAW' }]
        expect(await getUserBySessionId('RAW')).not.toBeNull()
        expect(user().sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now() + 89 * DAY)
    })
})

describe('expiration', () => {
    it('session hachée expirée : refusée et retirée', async () => {
        user().sessions = [{ sessionHash: hashSessionId('T'), expiresAt: new Date(Date.now() - 1000) }]
        expect(await getUserBySessionId('T')).toBeNull()
        expect(user().sessions).toHaveLength(0)
    })

    it('session héritée expirée : refusée et retirée', async () => {
        user().sessions = [{ sessionId: 'OLD', expiresAt: new Date(Date.now() - 1000) }]
        expect(await getUserBySessionId('OLD')).toBeNull()
        expect(user().sessions).toHaveLength(0)
    })

    it('compte banni refusé', async () => {
        user().banned = true
        user().sessions = [storedSession({ ...generateSession(), sessionId: 'B' })]
        expect(await getUserBySessionId('B')).toBeNull()
    })
})

describe('déconnexion', () => {
    it('retire la session hachée', async () => {
        const session = generateSession()
        user().sessions = [storedSession(session), { sessionHash: 'autre', expiresAt: new Date(Date.now() + DAY) }]
        await removeSessionFromUser(session.sessionId)
        expect(user().sessions.map((s) => s.sessionHash)).toEqual(['autre'])
    })

    it('retire une session héritée (brute)', async () => {
        user().sessions = [{ sessionId: 'RAW', expiresAt: new Date(Date.now() + DAY) }]
        await removeSessionFromUser('RAW')
        expect(user().sessions).toHaveLength(0)
    })
})

describe('purge et plafond', () => {
    it('la purge retire les expirées et garde les valides', async () => {
        user().sessions = [
            { sessionHash: 'old', expiresAt: new Date(Date.now() - DAY) },
            { sessionHash: 'ok', expiresAt: new Date(Date.now() + DAY) },
        ]
        await purgeExpiredSessions(db(), { id: 'local:a@x.fr' })
        expect(user().sessions.map((s) => s.sessionHash)).toEqual(['ok'])
    })

    it(`plafonne à ${MAX_SESSIONS_PER_USER} sessions : les plus anciennes sortent`, async () => {
        const first = generateSession()
        await usersCollection().updateOne({ id: 'local:a@x.fr' }, { $push: pushSessionUpdate(first) })
        for (let i = 0; i < MAX_SESSIONS_PER_USER; i++) {
            await usersCollection().updateOne({ id: 'local:a@x.fr' }, { $push: pushSessionUpdate(generateSession()) })
        }
        expect(user().sessions).toHaveLength(MAX_SESSIONS_PER_USER)
        expect(user().sessions.some((s) => s.sessionHash === hashSessionId(first.sessionId))).toBe(false)
    })
})

describe('renouvellement glissant', () => {
    it('sous 45 j restants : repousse à now + 90 j et signale la nouvelle échéance', async () => {
        user().sessions = [{ sessionHash: hashSessionId('R'), expiresAt: new Date(Date.now() + 10 * DAY) }]
        const u = await getUserBySessionId('R')
        expect(u.sessionRenewedUntil.getTime()).toBeGreaterThan(Date.now() + 89 * DAY)
        expect(user().sessions[0].expiresAt.getTime()).toBe(u.sessionRenewedUntil.getTime())
    })

    it('au-dessus de 45 j restants : aucune écriture, pas de nouveau cookie', async () => {
        const exp = new Date(Date.now() + 80 * DAY)
        user().sessions = [{ sessionHash: hashSessionId('R'), expiresAt: exp }]
        const u = await getUserBySessionId('R')
        expect(u.sessionRenewedUntil).toBeUndefined()
        expect(user().sessions[0].expiresAt).toEqual(exp)
        expect(SESSION_RENEW_BELOW_MS).toBe(45 * DAY)
    })
})

describe('migration en masse au démarrage', () => {
    it('hache toutes les entrées héritées, retire les expirées, est idempotente', async () => {
        state.users = [
            { _id: 1, id: 'local:a@x.fr', sessions: [{ sessionId: 'A1', expiresAt: new Date(Date.now() + 200 * DAY) }, { sessionId: 'A2', expiresAt: new Date(Date.now() - DAY) }] },
            { _id: 2, id: 'local:b@x.fr', sessions: [{ sessionHash: 'deja', expiresAt: new Date(Date.now() + DAY) }] },
            { _id: 3, id: 'google:c', sessions: [{ sessionId: 'C1' }] },
        ]
        const res = await migrateLegacySessions({ collection: () => usersCollection() })
        expect(res).toEqual({ accounts: 2, sessions: 3 })
        expect(JSON.stringify(state.users)).not.toMatch(/"sessionId"/)
        expect(state.users[0].sessions).toHaveLength(1)
        expect(state.users[0].sessions[0].sessionHash).toBe(hashSessionId('A1'))
        expect(state.users[0].sessions[0].expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + SESSION_TTL_MS)
        expect(state.users[2].sessions[0].sessionHash).toBe(hashSessionId('C1'))
        expect(await migrateLegacySessions({ collection: () => usersCollection() })).toEqual({ accounts: 0, sessions: 0 })
        expect((await getUserBySessionId('A1')).id).toBe('local:a@x.fr')
    })
})
