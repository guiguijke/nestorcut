import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { API_ROUTES } from '../composables/apiRoutes'

// Corps de la requête « Nest » : une tôle importée n'envoie QUE son
// identifiant opaque (le slug du dossier local), jamais son nom ni sa forme.

let current
let filesStore
let posted

beforeEach(async () => {
    posted = []
    // Un contexte Nuxt fixe : sans lui, chaque lecture du store voit un état vide.
    current = { runWithContext: (fn) => fn() }
    vi.resetModules()
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('API_ROUTES', API_ROUTES)
    vi.stubGlobal('globalStore', { actions: { getProjects: vi.fn(), setModalNestData: vi.fn() } })
    vi.stubGlobal('authStore', { actions: { setUser: vi.fn() } })
    vi.stubGlobal('tryUseNuxtApp', () => current)
    vi.stubGlobal('$fetch', vi.fn(async (url, opts) => {
        posted.push({ url, body: JSON.parse(opts.body) })
        return {}
    }))
    ;({ filesStore } = await import('~/composables/files'))
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

const sheetsSent = async (sheets) => {
    filesStore.actions.updateParams({ sheets, space: '2' })
    await filesStore.actions.nest('p1')
    return posted[0].body.params.sheets
}

describe('requestBody — tôle importée', () => {
    it('une tôle importée envoie shapeId (chaîne) et ni nom ni forme', async () => {
        const sent = await sheetsSent([
            { width: '100', height: '200', count: '2', shapeId: 'sheet-lx2k9f0a-ab12cd', name: 'Tôle du client' },
        ])
        expect(sent).toEqual([{ width: 100, height: 200, count: 2, shapeId: 'sheet-lx2k9f0a-ab12cd' }])
        const raw = JSON.stringify(posted[0].body)
        expect(raw).not.toContain('Tôle du client')
        for (const key of ['contours', 'ring', 'outer', 'inner', 'forbidden', 'name']) {
            expect(raw).not.toContain(`"${key}"`)
        }
    })

    it('une tôle rectangulaire n\'envoie pas la clé shapeId (corps inchangé)', async () => {
        const sent = await sheetsSent([{ width: '1000', height: '500', count: '3' }])
        expect(sent).toEqual([{ width: 1000, height: 500, count: 3 }])
        expect('shapeId' in sent[0]).toBe(false)
    })

    it('format mixte : seule la tôle importée porte un shapeId', async () => {
        const sent = await sheetsSent([
            { width: '1000', height: '500', count: '1' },
            { width: '100', height: '200', count: '1', shapeId: 'sheet-lx2k9f0a-ab12cd', name: 'X' },
        ])
        expect(sent.map((s) => 'shapeId' in s)).toEqual([false, true])
    })
})
