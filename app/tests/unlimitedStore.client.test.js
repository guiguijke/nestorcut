import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { API_ROUTES } from '../composables/apiRoutes'
import { processingType } from '../../constants/files.constants'
import { MAX_SHEETS_PER_JOB } from '../../shared/constants/payment.constants'

// Quantité illimitée dans le magasin des réglages : requête, validité, bornes,
// gestes sur les lignes. Hors d'un projet « Cet appareil », la clé est ignorée.

let store

const file = { slug: 'f1', name: 'f1.dxf', demoQuantity: 3, processingStatus: processingType.done, parts: [{ width: 50, height: 50 }] }

const setup = async (local) => {
    vi.resetModules()
    vi.doMock('~/composables/useUnit', () => ({ getUnitState: () => 'mm' }))
    vi.doMock('~/composables/localFilesStore', () => ({
        listLocalFiles: async () => [], getLocalFile: async () => null, saveLocalFile: async () => {},
    }))
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('API_ROUTES', API_ROUTES)
    vi.stubGlobal('globalStore', { actions: { getProjects: vi.fn(async () => {}), setModalNestData: vi.fn() } })
    vi.stubGlobal('authStore', { actions: { setUser: vi.fn(async () => {}) } })
    vi.stubGlobal('tryUseNuxtApp', () => ({ runWithContext: (fn) => fn() }))
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('$fetch', vi.fn(async () => ({ name: 'p', slug: 'p', local, files: [file] })))
    store = (await import('~/composables/files')).filesStore
    await store.actions.getProject(API_ROUTES.PROJECT('p'))
    // Un projet « Cet appareil » lit ses fichiers dans le navigateur : posés ici.
    store.actions.setProjectFiles([file], API_ROUTES.PROJECT('p'))
}

afterEach(() => {
    vi.doUnmock('~/composables/useUnit')
    vi.doUnmock('~/composables/localFilesStore')
    vi.unstubAllGlobals()
})

const sheets = () => store.getters.params.sheets
const body = () => JSON.parse(store.getters.requestBody)
const set = (list) => store.actions.updateParams({ sheets: list })
const A = (count, extra = {}) => ({ width: '1000', height: '2000', count, ...extra })

describe('cocher et décocher', () => {
    it.each([['', '1'], ['0', '1'], ['abc', '1'], ['2.5', '1'], ['7', '7']])(
        'cocher avec la quantité « %s » la garde ou la met à « %s »', async (typed, kept) => {
            await setup(true)
            set([A(typed)])
            store.actions.setSheetUnlimited(0, true)
            expect(sheets()[0]).toEqual(A(kept, { unlimited: true }))
        })

    it('décocher RETIRE la clé et garde la quantité', async () => {
        await setup(true)
        set([A('4'), A('2')])
        store.actions.setSheetUnlimited(1, true)
        store.actions.setSheetUnlimited(1, false)
        expect(sheets()).toEqual([A('4'), A('2')])
        expect('unlimited' in sheets()[1]).toBe(false)
    })

    it('« Ajouter un type de tôle » ne recopie pas la quantité illimitée', async () => {
        await setup(true)
        set([A('3', { unlimited: true })])
        store.actions.addSheet()
        expect(sheets()[1]).toEqual(A('1'))
    })

    it('remplacer la forme d\'une tôle la garde', async () => {
        await setup(true)
        set([A('3', { shapeId: 'sheet-old', name: 'x', unlimited: true }), A('2', { shapeId: 'sheet-b', name: 'y' })])
        store.actions.replaceSheetShape(0, { slug: 'sheet-new', name: 'Neuve', widthMm: 100, heightMm: 60 })
        store.actions.replaceSheetShape(1, { slug: 'sheet-new2', name: 'Autre', widthMm: 100, heightMm: 60 })
        expect(sheets()[0]).toMatchObject({ shapeId: 'sheet-new', count: '3', unlimited: true })
        expect('unlimited' in sheets()[1]).toBe(false)
    })

    it('importer une tôle ne remplace pas une tôle d\'usine cochée illimitée', async () => {
        await setup(true)
        store.actions.setSheetUnlimited(0, true)
        store.actions.addSheetFromShape({ slug: 'sheet-new', name: 'Chute', widthMm: 100, heightMm: 60 })
        expect(sheets()).toHaveLength(2)
        expect(sheets()[0]).toEqual(A('1', { unlimited: true }))
    })

    it('un changement d\'unité garde la quantité illimitée', async () => {
        await setup(true)
        set([A('3', { unlimited: true })])
        store.actions.syncParamsToUnit('inch')
        expect(sheets()[0].unlimited).toBe(true)
    })
})

describe('requête', () => {
    it('projet « Cet appareil » : unlimited et quantité 1, miroir hérité compris', async () => {
        await setup(true)
        set([A('250', { unlimited: true }), A('4')])
        expect(body().params.sheets).toEqual([
            { width: 1000, height: 2000, count: 1, unlimited: true },
            { width: 1000, height: 2000, count: 4 },
        ])
        expect(body().params.sheetCount).toBe(1)
    })

    it('autre projet : la clé est ignorée, la quantité saisie part', async () => {
        await setup(false)
        set([A('250', { unlimited: true }), A('4')])
        expect(store.getters.requestBody).not.toContain('unlimited')
        expect(body().params.sheets.map((s) => s.count)).toEqual([250, 4])
        expect(body().params.sheetCount).toBe(250)
    })

    it.each([[true], [false]])('sans illimitée (projet local : %s), le corps d\'avant à l\'octet', async (local) => {
        await setup(local)
        set([A('3'), A('2', { shapeId: 'sheet-lx2k9f0a-ab12cd', name: 'x' })])
        const base = store.getters.requestBody
        // Le corps d'avant, écrit en clair : mêmes clés, même ordre.
        expect(base).toContain('"sheets":[{"width":1000,"height":2000,"count":3},'
            + '{"width":1000,"height":2000,"count":2,"shapeId":"sheet-lx2k9f0a-ab12cd"}],'
            + '"width":1000,"height":2000,"sheetCount":3,')
        for (const unlimited of [false, undefined, 'true']) {
            set([A('3', { unlimited }), A('2', { shapeId: 'sheet-lx2k9f0a-ab12cd', name: 'x', unlimited })])
            expect(store.getters.requestBody).toBe(base)
        }
        store.actions.setSheetUnlimited(0, false)
        expect(store.getters.requestBody).toBe(base)
    })
})

describe('contrôles', () => {
    it('une illimitée n\'exige pas de quantité valide, sur un projet local seulement', async () => {
        await setup(true)
        set([A('', { unlimited: true })])
        expect(store.getters.nestRequestError).toBe('')
        set([A('')])
        expect(store.getters.nestRequestError).toBe('project.invalidParams')
        // La largeur reste exigée.
        set([{ width: '', height: '10', count: '1', unlimited: true }])
        expect(store.getters.nestRequestError).toBe('project.invalidParams')
        await setup(false)
        set([A('', { unlimited: true })])
        expect(store.getters.nestRequestError).toBe('project.invalidParams')
    })

    it('borne technique : les illimitées actives ne comptent pas', async () => {
        await setup(true)
        set([A(String(MAX_SHEETS_PER_JOB)), A('500', { unlimited: true })])
        expect(store.getters.sheetCountTooHigh).toBe(false)
        set([A(String(MAX_SHEETS_PER_JOB + 1)), A('1', { unlimited: true })])
        expect(store.getters.sheetCountTooHigh).toBe(true)
        await setup(false)
        set([A(String(MAX_SHEETS_PER_JOB)), A('500', { unlimited: true })])
        expect(store.getters.sheetCountTooHigh).toBe(true)
    })
})
