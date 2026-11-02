import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// d8 (02/11) : POST /api/track lit la liste blanche PARTAGÉE
// (shared/constants/trackActions.js) — plus aucune liste littérale qui dérive
// des émetteurs de l'app (38 noms étaient rejetés en 400 silencieux). Le
// contrôle « chaque nom émis par l'app est dans la liste » vit dans
// app/tests/trackParity.test.js ; ici, le serveur.

// track/index.post.ts importe readBody depuis h3 (pas le global) : on le
// remplace par la lecture de l'événement factice.
vi.mock('h3', async (orig) => ({ ...(await orig()), readBody: async (e) => e._body }))

const state = vi.hoisted(() => ({ saved: [] }))
vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => ({
        collection: () => ({
            insertOne: async () => ({ insertedId: 'm1' }),
            findOne: async () => null,
        }),
    }),
}))
vi.mock('~~/server/tracking/add', () => ({
    saveTrackRecordInBackground: vi.fn(async (record) => {
        state.saved.push(record)
    }),
}))
vi.mock('~~/server/utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import trackPost from '~~/server/api/track/index.post'
import { TRACK_ACTIONS } from '~~/shared/constants/trackActions'

let n = 0
const uniq = (p) => `${p}-${Date.now()}-${n++}`

// Un utilisateur distinct par appel : la limite de débit (120/min) ne doit
// jamais interférer avec ces cas.
function ev(body) {
    return {
        path: '/api/track',
        _body: body,
        context: { auth: { userId: uniq('u') } },
        node: {
            req: { method: 'POST', url: '/api/track', headers: {}, socket: { remoteAddress: '9.9.9.9' } },
            res: {},
        },
    }
}
const status = async (fn) => {
    try {
        await fn()
        return 200
    } catch (e) {
        return e.statusCode
    }
}

beforeEach(() => {
    state.saved = []
})

describe('POST /api/track — liste blanche partagée', () => {
    for (const [action, data] of [
        ['dialog_view_subscription', {}],
        ['checkout_return', { status: 'active', page: 'project', source: 'locked_sheets' }],
        ['locked_sheets_unlock_click', { surface: 'card', sheets: '5', cap: '2', compute: 'browser' }],
    ]) {
        it(`${action} avec des données en chaînes : 200, enregistré`, async () => {
            expect(await status(() => trackPost(ev({ action, data })))).toBe(200)
            expect(state.saved).toHaveLength(1)
            expect(state.saved[0].action).toBe(action)
            expect(state.saved[0].data).toEqual(data)
        })
    }

    it('chaque nom de la liste partagée est accepté (anciens, réparés et nouveaux)', async () => {
        const refused = []
        for (const action of TRACK_ACTIONS) {
            if ((await status(() => trackPost(ev({ action, data: {} })))) !== 200) refused.push(action)
        }
        expect(refused).toEqual([])
        expect(state.saved).toHaveLength(TRACK_ACTIONS.length)
    })

    it('nom inconnu : 400, rien enregistré', async () => {
        expect(await status(() => trackPost(ev({ action: 'not_an_event', data: {} })))).toBe(400)
        expect(state.saved).toHaveLength(0)
    })

    it('donnée non-chaîne : 400, rien enregistré', async () => {
        expect(await status(() => trackPost(ev({ action: 'page_view', data: { a: true } })))).toBe(400)
        expect(state.saved).toHaveLength(0)
    })

    it("l'événement serveur du verrou DXF n'est PAS dans la liste (il contourne /api/track)", async () => {
        expect(TRACK_ACTIONS).not.toContain('download_nested_result_dxf_locked')
        expect(await status(() => trackPost(ev({ action: 'download_nested_result_dxf_locked', data: {} })))).toBe(400)
    })
})

describe('index.post.ts — source unique (§3.12 c)', () => {
    const source = readFileSync(fileURLToPath(new URL('../api/track/index.post.ts', import.meta.url)), 'utf8')

    it('importe la liste partagée en chemin relatif (AGENTS #29c) et en fait le Set autorisé', () => {
        expect(source).toContain("from '../../../shared/constants/trackActions'")
        expect(source).toContain('new Set(TRACK_ACTIONS)')
    })

    it('ne contient plus aucune entrée littérale de liste', () => {
        const literalEntries = source.split(/\r?\n/).filter((line) => /^\s+'[a-z0-9_]+',$/.test(line))
        expect(literalEntries).toEqual([])
    })
})
