import { describe, expect, it } from 'vitest'

// C1-b — filtre et curseur du digest d'inscriptions (fonctions pures
// extraites du plugin admin pour être testées hors Nitro).

import { advanceCursor, digestGraceCutoff, digestScanQuery, filterUnreported, DIGEST_GRACE_MS } from '../../admin/server/utils/signupDigest'

const days = (n) => new Date(Date.now() - n * 24 * 3600 * 1000)
const ahead = (n) => new Date(Date.now() + n * 24 * 3600 * 1000)
const inScan = (createdAt, q) => createdAt > q.createdAt.$gt && createdAt <= q.createdAt.$lte

describe('signupDigest — helpers (D4)', () => {
    it('digestScanQuery : lot examiné = createdAt > curseur ET ≤ now − 2 min', () => {
        const cursor = days(7)
        const now = new Date('2026-09-08T12:00:00.000Z')
        const cap = digestGraceCutoff(now)
        expect(DIGEST_GRACE_MS).toBe(120_000)
        expect(digestScanQuery(cursor, now)).toEqual({ createdAt: { $gt: cursor, $lte: cap } })
    })

    it('C1-b-bis : inscrit à now − 30 s hors lot, à now − 3 min dans le lot', () => {
        const now = new Date('2026-09-08T12:00:00.000Z')
        const cursor = new Date(0)
        const q = digestScanQuery(cursor, now)
        expect(inScan(new Date(now.getTime() - 30_000), q)).toBe(false)
        expect(inScan(new Date(now.getTime() - 3 * 60_000), q)).toBe(true)
    })

    it('C1-b-bis : le curseur ne dépasse jamais la borne de grâce', () => {
        const now = new Date('2026-09-08T12:00:00.000Z')
        const cursor = new Date(0)
        const tooFresh = new Date(now.getTime() - 30_000)
        expect(advanceCursor([{ id: 'local:x', createdAt: tooFresh }], cursor, now).getTime())
            .toBe(digestGraceCutoff(now).getTime())
    })

    it('deux inscrits après le curseur, un marqué → un seul dans l\'envoi', () => {
        const users = [
            { id: 'local:a@x.y', createdAt: days(2) },
            { id: 'local:b@x.y', createdAt: days(1), adminNotifiedAt: days(1) },
        ]
        const out = filterUnreported(users)
        expect(out).toHaveLength(1)
        expect(out[0].id).toBe('local:a@x.y')
    })

    it('le curseur avance sur le dernier EXAMINÉ — même marqué, même non envoyé', () => {
        const cursor = days(7)
        const newest = days(1)
        const users = [
            { id: 'local:a@x.y', createdAt: days(2) },
            // Déjà signalé ET plus récent : il doit néanmoins faire avancer
            // le curseur, sinon le cycle suivant relit la même plage.
            { id: 'local:b@x.y', createdAt: newest, adminNotifiedAt: newest },
        ]
        expect(advanceCursor(users, cursor).getTime()).toBe(newest.getTime())
    })

    it('tout filtré (tout signalé) : le curseur avance quand même', () => {
        const cursor = days(7)
        const newest = ahead(0)
        const users = [
            { id: 'local:a@x.y', createdAt: days(3), adminNotifiedAt: days(3) },
            { id: 'local:b@x.y', createdAt: newest, adminNotifiedAt: newest },
        ]
        expect(filterUnreported(users)).toEqual([])
        expect(advanceCursor(users, cursor).getTime()).toBe(newest.getTime())
    })

    it('lot vide : curseur inchangé', () => {
        const cursor = days(7)
        expect(advanceCursor([], cursor)).toBe(cursor)
    })
})
