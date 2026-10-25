import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/db/mongo', () => ({ connectDB: vi.fn(), getAvatarBucket: vi.fn() }))
vi.mock('../../server/utils/logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

globalThis.defineNitroPlugin = (fn) => fn
const { runAvatarSyncOnce, backoffMs, MAX_ATTEMPTS } = await import('~~/server/plugins/1_avatarSync')

import { assertAllowedAvatarUrl, fetchAvatarBuffer, downloadAndStoreAvatar, AVATAR_MAX_BYTES } from '~~/server/utils/avatar'
import { getAvatarBucket } from '../../server/db/mongo'
import { fakeDb } from './helpers/fakeMongo'

const GOOD = 'https://lh3.googleusercontent.com/a/abc'

const okResponse = (body = Buffer.from('img'), headers = { 'content-type': 'image/jpeg' }) => {
    const h = new Headers(headers)
    return {
        ok: true,
        status: 200,
        headers: h,
        body: (async function* () {
            yield body
        })(),
    }
}

describe('fetchAvatarBuffer', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('refuse http, hotes tiers, credentials et URL invalides sans fetch', async () => {
        const f = vi.fn()
        vi.stubGlobal('fetch', f)
        for (const u of [
            'http://lh3.googleusercontent.com/a',
            'https://evil.example.com/a',
            'https://googleusercontent.com.evil.io/a',
            'https://user:pw@lh3.googleusercontent.com/a',
            'not a url',
        ]) {
            await expect(fetchAvatarBuffer(u)).rejects.toThrow()
        }
        expect(f).not.toHaveBeenCalled()
        expect(assertAllowedAvatarUrl(GOOD).hostname).toBe('lh3.googleusercontent.com')
    })

    it('renvoie le contenu d\'une image valide', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => okResponse()))
        expect((await fetchAvatarBuffer(GOOD)).toString()).toBe('img')
    })

    it('refuse un mauvais content-type', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => okResponse(Buffer.from('x'), { 'content-type': 'text/html' })))
        await expect(fetchAvatarBuffer(GOOD)).rejects.toThrow(/content-type/)
    })

    it('refuse un flux trop gros (sans content-length)', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => okResponse(Buffer.alloc(AVATAR_MAX_BYTES + 1))))
        await expect(fetchAvatarBuffer(GOOD)).rejects.toThrow(/too large/)
    })

    it('refuse un content-length declare trop gros', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => okResponse(Buffer.from('x'), { 'content-type': 'image/png', 'content-length': String(AVATAR_MAX_BYTES + 1) }))
        )
        await expect(fetchAvatarBuffer(GOOD)).rejects.toThrow(/too large/)
    })

    it('abandonne sur timeout', async () => {
        vi.useFakeTimers()
        vi.stubGlobal(
            'fetch',
            vi.fn((_u, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))
        )
        try {
            const p = expect(fetchAvatarBuffer(GOOD)).rejects.toThrow('aborted')
            await vi.advanceTimersByTimeAsync(10_001)
            await p
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('runAvatarSyncOnce', () => {
    const now = new Date('2026-10-25T10:00:00Z')
    const bucket = () => ({
        find: () => ({ toArray: async () => [] }),
        delete: vi.fn(),
        openUploadStream: () => {
            const handlers = {}
            return {
                on: (e, cb) => (handlers[e] = cb),
                write: () => {},
                end: () => setTimeout(() => handlers.finish?.(), 0),
            }
        },
    })
    const users = [{ id: 'u1', avatarSource: 'origin', avatarUrl: 'https://evil.example.com/a' }]

    beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => okResponse())))
    afterEach(() => vi.unstubAllGlobals())

    it('un echec ne reprend pas immediatement (backoff) puis abandonne apres N essais', async () => {
        const db = fakeDb({ users: structuredClone(users) })
        expect(await runAvatarSyncOnce(db, bucket(), now)).toBe(true)
        const u = db.collection('users')
        const doc = await u.findOne({ id: 'u1' })
        expect(doc.avatarSyncAttempts).toBe(1)
        expect(doc.nextAvatarSyncAt.getTime()).toBe(now.getTime() + backoffMs(1))
        // meme instant : plus rien d'eligible
        expect(await runAvatarSyncOnce(db, bucket(), now)).toBe(false)

        let t = now
        for (let i = 1; i < MAX_ATTEMPTS; i++) {
            t = new Date(t.getTime() + backoffMs(i) + 1)
            expect(await runAvatarSyncOnce(db, bucket(), t)).toBe(true)
        }
        const final = await u.findOne({ id: 'u1' })
        expect(final.avatarSource).toBe('failed')
        expect(final.avatarUrl).toBeUndefined()
        t = new Date(t.getTime() + 10 * 24 * 3600 * 1000)
        expect(await runAvatarSyncOnce(db, bucket(), t)).toBe(false)
    })

    it('un succes passe en mongo et nettoie les champs de reprise', async () => {
        const db = fakeDb({ users: [{ id: 'u2', avatarSource: 'origin', avatarUrl: GOOD, avatarSyncAttempts: 2 }] })
        expect(await runAvatarSyncOnce(db, bucket(), now)).toBe(true)
        const doc = await db.collection('users').findOne({ id: 'u2' })
        expect(doc.avatarSource).toBe('mongo')
        expect(doc.avatarFileName).toBe('avatar-u2.jpg')
        expect(doc.avatarUrl).toBeUndefined()
        expect(doc.avatarSyncAttempts).toBeUndefined()
    })

    it('une erreur Mongo remonte a l\'appelant (la boucle l\'attrape et continue)', async () => {
        const db = { collection: () => ({ findOne: async () => { throw new Error('mongo down') } }) }
        await expect(runAvatarSyncOnce(db, bucket(), now)).rejects.toThrow('mongo down')
        // l'iteration suivante repart normalement (rien n'est fige)
        const ok = fakeDb({ users: [] })
        expect(await runAvatarSyncOnce(ok, bucket(), now)).toBe(false)
    })
})

describe('downloadAndStoreAvatar (chemin de login)', () => {
    afterEach(() => vi.unstubAllGlobals())
    const mkBucket = (files) => ({
        find: () => ({ toArray: async () => files }),
        delete: vi.fn(),
        openUploadStream: vi.fn(),
    })

    it('un avatar refuse (hote tiers) ne jette pas : null si aucun avatar stocke', async () => {
        const f = vi.fn()
        vi.stubGlobal('fetch', f)
        getAvatarBucket.mockResolvedValue(mkBucket([]))
        expect(await downloadAndStoreAvatar('p1', 'https://evil.example.com/a')).toBeNull()
        expect(f).not.toHaveBeenCalled()
    })

    it('un echec (HTTP 403) conserve avatar deja stocke', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, headers: new Headers() })))
        const b = mkBucket([{ _id: 1 }])
        getAvatarBucket.mockResolvedValue(b)
        expect(await downloadAndStoreAvatar('p1', GOOD)).toBe('avatar-p1.jpg')
        expect(b.delete).not.toHaveBeenCalled()
    })
})
