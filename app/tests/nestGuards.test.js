import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { API_ROUTES } from '../composables/apiRoutes'
import { processingType } from '../../constants/files.constants'
import { MAX_SHEET_FORMATS } from '../../shared/constants/payment.constants'
import { isUntouchedFactorySheet, factorySheetOf } from '../utils/factorySheet'

// Gardes de la soumission : plafond de formats, POST parti au même tour que le clic,
// et remplacement de la tôle d'usine intacte par l'import.

const rectRing = (w, h) => [[0, 0], [w, 0], [w, h], [0, h], [0, 0]]

let store
let posted
let postedBodies
let fetchMock

const setup = async (files) => {
    vi.resetModules()
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('API_ROUTES', API_ROUTES)
    vi.stubGlobal('globalStore', { actions: { getProjects: vi.fn(async () => {}), setModalNestData: vi.fn() } })
    vi.stubGlobal('authStore', { actions: { setUser: vi.fn(async () => {}) } })
    const nuxtApp = { runWithContext: (fn) => fn() }
    vi.stubGlobal('tryUseNuxtApp', () => nuxtApp)
    vi.stubGlobal('navigateTo', vi.fn())
    posted = []
    postedBodies = []
    fetchMock = vi.fn(async (url, opts) => {
        if (opts?.method === 'POST') {
            posted.push(url)
            postedBodies.push(opts.body)
            if (fetchMock.nextError) throw fetchMock.nextError
            return {}
        }
        return { name: 'p', files }
    })
    vi.stubGlobal('$fetch', fetchMock)
    store = (await import('~/composables/files')).filesStore
    await store.actions.getProject(API_ROUTES.PROJECT('p'))
}
const doneFile = (slug, parts) => ({ slug, name: `${slug}.dxf`, processingStatus: processingType.done, parts })

afterEach(() => {
    vi.unstubAllGlobals()
})

const rows = (n) => Array.from({ length: n }, (_, i) => ({ width: String(1000 + i), height: '2000', count: '1' }))

describe('plafond de formats (MAX_SHEET_FORMATS)', () => {
    beforeEach(() => setup([doneFile('f1', [{ coordinates: rectRing(50, 50), holes: [] }])]))

    it('le getter est faux à 10 lignes et vrai à 11 ; « au plafond » dès 10', () => {
        store.actions.updateParams({ sheets: rows(MAX_SHEET_FORMATS) })
        expect(store.getters.sheetFormatsTooMany).toBe(false)
        expect(store.getters.sheetFormatsAtLimit).toBe(true)
        store.actions.updateParams({ sheets: rows(MAX_SHEET_FORMATS + 1) })
        expect(store.getters.sheetFormatsTooMany).toBe(true)
        store.actions.updateParams({ sheets: rows(MAX_SHEET_FORMATS - 1) })
        expect(store.getters.sheetFormatsAtLimit).toBe(false)
    })

    it('addSheet n\'ajoute plus au plafond', () => {
        store.actions.updateParams({ sheets: rows(MAX_SHEET_FORMATS) })
        store.actions.addSheet()
        expect(store.getters.params.sheets).toHaveLength(MAX_SHEET_FORMATS)
        store.actions.updateParams({ sheets: rows(3) })
        store.actions.addSheet()
        expect(store.getters.params.sheets).toHaveLength(4)
    })

    it('nest() à 11 formats : refus nest.error.tooManyFormats, aucun POST', async () => {
        store.actions.updateParams({ sheets: rows(MAX_SHEET_FORMATS + 1), space: '2' })
        await store.actions.nest('p')
        expect(posted).toHaveLength(0)
        expect(store.getters.nestError).toBe('nest.error.tooManyFormats')
        expect(store.getters.nestRefusals).toBe(1)
    })

    it('nest() à 10 formats : le POST part', async () => {
        store.actions.updateParams({ sheets: rows(MAX_SHEET_FORMATS), space: '2' })
        await store.actions.nest('p')
        expect(posted).toHaveLength(1)
        expect(store.getters.nestError).toBe('')
    })

    it('réponse 400 too_many_formats du serveur : même message traduit, pas le générique', async () => {
        store.actions.updateParams({ sheets: rows(2), space: '2' })
        fetchMock.nextError = Object.assign(new Error('400'), { data: { statusMessage: 'too_many_formats' }, response: { status: 400 } })
        await store.actions.nest('p')
        expect(store.getters.nestError).toBe('nest.error.tooManyFormats')
    })
})

describe('nest() : le POST part au même tour que le clic', () => {
    const discRow = { width: '153', height: '153', count: '1', shapeId: 'sheet-lx2k9f0a-ab12cd', name: 'Disque 153' }

    it('aucune attente avant le POST, tôle importée comprise : la requête est partie quand nest() rend la main', async () => {
        await setup([doneFile('f1', [{ coordinates: rectRing(150, 150), holes: [] }])])
        store.actions.updateParams({ sheets: [discRow], space: '0.5' })
        const pending = store.actions.nest('p')
        expect(posted).toHaveLength(1)
        await pending
    })

    it('le POST porte le corps pris au clic, même si les réglages et le projet changent juste après', async () => {
        await setup([doneFile('f1', [{ coordinates: rectRing(50, 50), holes: [] }])])
        store.actions.updateParams({ sheets: [{ width: '1200', height: '800', count: '2' }], space: '3' })
        const pending = store.actions.nest('p')
        // tout change tout de suite, avant la réponse
        store.actions.updateParams({ sheets: [{ width: '999', height: '999', count: '9' }], space: '7' })
        store.actions.getProject(API_ROUTES.PROJECT('autre'))
        await pending
        expect(posted).toEqual([API_ROUTES.NEST('p')])
        const body = JSON.parse(postedBodies[0])
        expect(body.params.sheets[0]).toMatchObject({ width: 1200, height: 800, count: 2 })
        expect(body.params.space).toBe(3)
        expect(body.files.map((f) => f.slug)).toEqual(['f1'])
    })

    it('trop de formats : refus synchrone, aucun POST', async () => {
        await setup([doneFile('f1', [{ coordinates: rectRing(50, 50), holes: [] }])])
        store.actions.updateParams({ sheets: rows(MAX_SHEET_FORMATS + 1) })
        const pending = store.actions.nest('p')
        expect(store.getters.nestError).toBe('nest.error.tooManyFormats')
        await pending
        expect(posted).toHaveLength(0)
    })
})

describe('tôle d\'usine intacte remplacée par l\'import', () => {
    const imported = () => ({ slug: 'shape-1', name: 'Disque', widthMm: 123.5, heightMm: 60 })

    beforeEach(() => setup([doneFile('f1', [{ coordinates: rectRing(50, 50), holes: [] }])]))

    it('usine intacte, sans résultat : UNE ligne, l\'importée, quantité 1, note posée', () => {
        store.actions.addSheetFromShape(imported())
        const sheets = store.getters.params.sheets
        expect(sheets).toEqual([{ width: '123.5', height: '60', count: '1', shapeId: 'shape-1', name: 'Disque' }])
        expect(store.getters.factorySheetReplaced).toBe('shape-1')
    })

    it('usine intacte mais un résultat existe : ajoutée comme avant, pas de note', () => {
        store.actions.addSheetFromShape(imported(), { hasResult: true })
        expect(store.getters.params.sheets).toHaveLength(2)
        expect(store.getters.factorySheetReplaced).toBe('')
    })

    it('rectangle modifié par l\'utilisateur : ajoutée', () => {
        store.actions.updateSheet(0, { width: '1200' })
        store.actions.addSheetFromShape(imported())
        expect(store.getters.params.sheets).toHaveLength(2)
        expect(store.getters.factorySheetReplaced).toBe('')
    })

    it('quantité changée : ajoutée', () => {
        store.actions.updateSheet(0, { count: '2' })
        store.actions.addSheetFromShape(imported())
        expect(store.getters.params.sheets).toHaveLength(2)
    })

    it('première importation faite, seconde : ajoutée (2 lignes)', () => {
        store.actions.addSheetFromShape(imported())
        store.actions.addSheetFromShape({ ...imported(), slug: 'shape-2' })
        expect(store.getters.params.sheets).toHaveLength(2)
    })

    it('deux lignes dont une usine : ajoutée', () => {
        store.actions.addSheet()
        store.actions.addSheetFromShape(imported())
        expect(store.getters.params.sheets).toHaveLength(3)
    })

    it('modifiée puis remise aux valeurs d\'usine : encore intacte (c\'est la valeur qui compte)', () => {
        store.actions.updateSheet(0, { width: '1200' })
        store.actions.updateSheet(0, { width: '1000' })
        store.actions.addSheetFromShape(imported())
        expect(store.getters.params.sheets).toHaveLength(1)
    })

    it('unité en pouces : 48 × 96 intact est remplacé, 1000 × 2000 « pouces » ne l\'est pas', () => {
        expect(isUntouchedFactorySheet([{ width: '48', height: '96', count: '1' }], 'inch')).toBe(true)
        expect(isUntouchedFactorySheet([{ width: '1000', height: '2000', count: '1' }], 'inch')).toBe(false)
        expect(isUntouchedFactorySheet([{ width: '1000', height: '2000', count: '1' }], 'mm')).toBe(true)
        expect(isUntouchedFactorySheet([{ width: '1000,0', height: '2000', count: '1' }], 'mm')).toBe(true)
        expect(factorySheetOf('inch')).toEqual({ width: '48', height: '96' })
        expect(factorySheetOf('mm')).toEqual({ width: '1000', height: '2000' })
    })

    it('la tôle d\'usine du magasin en pouces se reconnaît après le changement d\'unité', () => {
        store.actions.syncParamsToUnit('inch')
        expect(store.getters.params.sheets[0]).toMatchObject({ width: '48', height: '96' })
        store.actions.addSheetFromShape(imported())
        expect(store.getters.params.sheets).toHaveLength(1)
        expect(store.getters.params.sheets[0].shapeId).toBe('shape-1')
    })

    it('une ligne importée déjà là : jamais « intacte »', () => {
        expect(isUntouchedFactorySheet([{ width: '1000', height: '2000', count: '1', shapeId: 'x' }], 'mm')).toBe(false)
        expect(isUntouchedFactorySheet([], 'mm')).toBe(false)
        expect(isUntouchedFactorySheet(null, 'mm')).toBe(false)
    })

    it('la note se range en changeant de projet', async () => {
        store.actions.addSheetFromShape(imported())
        expect(store.getters.factorySheetReplaced).toBe('shape-1')
        await store.actions.getProject(API_ROUTES.PROJECT('autre'))
        expect(store.getters.factorySheetReplaced).toBe('')
    })
})
