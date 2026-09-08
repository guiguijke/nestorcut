import { describe, expect, it } from 'vitest'

// C1-b — filtre et curseur du digest d'inscriptions (fonctions pures
// extraites du plugin admin pour être testées hors Nitro).

import { advanceCursor, digestScanQuery, filterUnreported } from '../../admin/server/utils/signupDigest'

const days = (n) => new Date(Date.now() - n * 24 * 3600 * 1000)
const ahead = (n) => new Date(Date.now() + n * 24 * 3600 * 1000)

describe('signupDigest — helpers (D4)', () => {
    it('digestScanQuery : lot examiné = createdAt > curseur, marqueur ignoré', () => {
        const cursor = days(7)
        expect(digestScanQuery(cursor)).toEqual({ createdAt: { $gt: cursor } })
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
