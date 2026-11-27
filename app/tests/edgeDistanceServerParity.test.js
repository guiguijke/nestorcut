import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildLocalPayload } from '../composables/localPayloadBuilder'

// Parité Python -> JS de la distance au bord sur les projets « Nos serveurs » :
// le worker Python prépare le payload moteur d'un job à distance au bord
// (workers/nesting/core/edge.py), `buildLocalPayload` le construit pour le même
// dessin et les mêmes réglages. Les deux doivent sortir IDENTIQUES, refus
// compris (même code, même détail chiffré). Le JS est la référence : si ce
// test échoue, le défaut est côté Python.
// Régénérer : workers/nesting/tests/gen_edge_payload_parity.py.

const CASES = JSON.parse(readFileSync(
    new URL('../../workers/nesting/tests/fixtures/edge_payload_parity.json', import.meta.url),
    'utf-8',
))

describe('parité exacte du payload moteur à distance au bord (worker Python)', () => {
    it('le fichier de fixtures porte les cas attendus', () => {
        expect(CASES.length).toBeGreaterThanOrEqual(7)
        expect(CASES.some((c) => c.expected.error)).toBe(true)
        expect(CASES.some((c) => c.expected.payload?.edgeShift)).toBe(true)
    })

    for (const c of CASES) {
        it(c.name, async () => {
            if (c.expected.error) {
                let err = null
                try {
                    await buildLocalPayload(c.input, {})
                } catch (e) {
                    err = e
                }
                expect(err).not.toBeNull()
                expect(err.message).toBe(c.expected.error)
                expect(err.__edge).toEqual(c.expected.edgeDetail)
                return
            }
            const { payload, seed, itemMap } = await buildLocalPayload(c.input, {})
            expect(payload).toEqual(c.expected.payload)
            expect(seed).toBe(c.expected.seed)
            expect(itemMap).toEqual(c.expected.itemMap)
        })
    }
})
