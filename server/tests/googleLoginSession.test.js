import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// Une connexion Google doit ouvrir une session que le serveur sait RELIRE.
// Le lot M4 écrivait `$push: { sessions: pushSessionUpdate(session) }` alors que
// le helper rend déjà `{ sessions: { $each, $slice } }` : Mongo stockait l'objet
// tel quel, la route répondait 200, le cookie était posé et l'utilisateur restait
// anonyme. La collection ci-dessous garde donc la sémantique réelle de `$push` :
// sans `$each` de premier niveau, la valeur est ajoutée telle quelle.
const state = vi.hoisted(() => ({ db: null }))

vi.mock('~~/server/db/mongo', () => ({ connectDB: async () => state.db }))
vi.mock('~~/server/utils/avatar', () => ({ downloadAndStoreAvatar: async () => 'avatar-key' }))
vi.mock('~~/server/features/support/welcomemessage', () => ({ sendWelcomeMessage: async () => {} }))
vi.mock('~~/server/features/notification/adminNotify', () => ({ notifyAdminNewUser: async () => {} }))

import { getUserBySessionId, hashSessionId, MAX_SESSIONS_PER_USER, SESSION_TTL_MS } from '~~/server/utils/auth'
import { createOrUpdateUser } from '~~/server/utils/user'

const fieldMatches = (value, cond) => {
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) return value === cond
    if ('$ne' in cond) return value !== cond.$ne
    if ('$in' in cond) return cond.$in.includes(value)
    if ('$lte' in cond) return value != null && value <= cond.$lte
    throw new Error(`opérateur non prévu : ${Object.keys(cond)}`)
}
const entryMatches = (entry, cond) => Object.entries(cond).every(([k, c]) => fieldMatches(entry[k], c))
const docMatches = (doc, filter) =>
    Object.entries(filter).every(([k, c]) =>
        k === 'sessions' ? (doc.sessions || []).some((s) => entryMatches(s, c.$elemMatch)) : fieldMatches(doc[k], c),
    )

function applyPush(doc, push) {
    for (const [field, value] of Object.entries(push)) {
        const list = doc[field] || []
        if (value && typeof value === 'object' && '$each' in value) {
            const next = [...list, ...value.$each]
            doc[field] = value.$slice === undefined ? next : next.slice(value.$slice)
        } else {
            doc[field] = [...list, value]
        }
    }
}

function usersCollection(docs) {
    return {
        findOne: async (filter) => docs.find((d) => docMatches(d, filter)) || null,
        updateOne: async (filter, update, opts) => {
            let doc = docs.find((d) => docMatches(d, filter))
            if (!doc) {
                if (!opts?.upsert) return { matchedCount: 0 }
                doc = { _id: docs.length + 1, ...filter, ...update.$setOnInsert }
                docs.push(doc)
            }
            Object.assign(doc, update.$set)
            if (update.$pull) doc.sessions = (doc.sessions || []).filter((s) => !entryMatches(s, update.$pull.sessions))
            if (update.$push) applyPush(doc, update.$push)
            return { matchedCount: 1 }
        },
    }
}

const login = () =>
    createOrUpdateUser({ providerId: '123', email: 'ana@b.co', name: 'Ana', avatarUrl: 'https://x/a.png' })
const existingAccount = (sessions) => ({ _id: 1, id: 'google:123', provider: 'google', email: 'ana@b.co', sessions })
const validEntry = (n) => ({
    sessionHash: hashSessionId(`ancienne-${n}`),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    createdAt: new Date(2026, 0, n + 1),
})

let users
beforeEach(() => {
    users = []
    state.db = {
        collection: (name) =>
            name === 'users' ? usersCollection(users) : { updateMany: async () => ({}) },
    }
})

describe('connexion Google — la session ouverte est relue', () => {
    it('compte neuf : le jeton du cookie retrouve le compte', async () => {
        const session = await login()
        expect((await getUserBySessionId(session.sessionId))?.id).toBe('google:123')
    })

    it('compte existant : la nouvelle session est reconnue, les anciennes restent', async () => {
        users.push(existingAccount([validEntry(1)]))
        const session = await login()
        expect((await getUserBySessionId(session.sessionId))?.id).toBe('google:123')
        expect((await getUserBySessionId('ancienne-1'))?.id).toBe('google:123')
    })

    it('forme stockée : haché au premier niveau, jamais le jeton brut', async () => {
        const session = await login()
        const [entry] = users[0].sessions
        expect(Object.keys(entry).sort()).toEqual(['createdAt', 'expiresAt', 'sessionHash'])
        expect(entry.sessionHash).toBe(hashSessionId(session.sessionId))
        expect(JSON.stringify(users[0])).not.toContain(session.sessionId)
    })

    it('le plafond de sessions par compte s’applique', async () => {
        users.push(existingAccount(Array.from({ length: MAX_SESSIONS_PER_USER }, (_, n) => validEntry(n))))
        const session = await login()
        expect(users[0].sessions).toHaveLength(MAX_SESSIONS_PER_USER)
        expect((await getUserBySessionId(session.sessionId))?.id).toBe('google:123')
        expect(await getUserBySessionId('ancienne-0')).toBeNull()
    })

    it('une entrée malformée déjà en base ne gêne pas la connexion suivante', async () => {
        const malformed = { sessions: { $each: [validEntry(9)], $slice: -MAX_SESSIONS_PER_USER } }
        users.push(existingAccount([malformed]))
        const session = await login()
        expect((await getUserBySessionId(session.sessionId))?.id).toBe('google:123')
    })
})
