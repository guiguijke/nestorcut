import { describe, expect, it, vi } from 'vitest'
import { clearVaultIfNoLiveSession, createVaultSession, getVaultSession } from '~~/server/utils/vault'

// Révocation depuis l'admin (autre processus) puis nouvelle connexion : la clé
// gardée en mémoire date d'avant la révocation et doit être effacée.
vi.mock('~~/server/db/mongo', () => ({ connectDB: async () => ({ collection: () => ({ findOne: async () => null }) }) }))

const dbWith = (user) => ({ collection: () => ({ findOne: async () => user }) })
const key = () => Buffer.alloc(32, 7)
const later = new Date(Date.now() + 3600e3)
const earlier = new Date(Date.now() - 3600e3)

describe('connexion sans session valide restante : coffre refermé', () => {
    it('sessions vidées par l’admin : la clé est effacée', async () => {
        await createVaultSession('u1', key())
        await clearVaultIfNoLiveSession(dbWith({ sessions: [] }), 'u1')
        expect(await getVaultSession('u1')).toBeNull()
    })

    it('sessions retirées (bannissement levé) ou seulement expirées : effacée aussi', async () => {
        for (const user of [{}, { sessions: [{ expiresAt: earlier }] }, null]) {
            await createVaultSession('u2', key())
            await clearVaultIfNoLiveSession(dbWith(user), 'u2')
            expect(await getVaultSession('u2')).toBeNull()
        }
    })

    it('une session vit ailleurs : le coffre reste ouvert', async () => {
        await createVaultSession('u3', key())
        await clearVaultIfNoLiveSession(dbWith({ sessions: [{ expiresAt: later }] }), 'u3')
        expect((await getVaultSession('u3'))?.dek?.equals(key())).toBe(true)
    })

    it('les deux chemins de connexion appellent la règle avant d’ajouter la session', async () => {
        const { readFileSync } = await import('node:fs')
        const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
        expect(read('../api/auth/local/login.post.js')).toMatch(/purgeExpiredSessions\(db, \{ id: userId \}\)\s*await clearVaultIfNoLiveSession\(db, userId\)\s*await db\.collection\('users'\)\.updateOne/)
        expect(read('../utils/user.js')).toMatch(/purgeExpiredSessions\(db, \{ id: userId \}\)\s*await clearVaultIfNoLiveSession\(db, userId\)/)
    })
})
