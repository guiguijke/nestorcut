import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { API_ROUTES } from '../composables/apiRoutes'
import { processingType } from '../../constants/files.constants'

// Le store de fichiers dans le navigateur (`import.meta.client` vrai, voir
// vitest.config.js) : instantanés de réglages par projet, démo, dépôt d'un `.job`.
// Les fonctions de la page sont jouées dans l'ordre de la page : à l'arrivée sur
// la démo, ses réglages sont posés (setup) AVANT que le projet ne se charge.

let store
let unit

const file = (slug) => ({ slug, name: `${slug}.dxf`, processingStatus: processingType.done, parts: [{ width: 50, height: 50 }] })

const setup = async (extraMocks = () => {}) => {
    vi.resetModules()
    unit = 'mm'
    vi.doMock('~/composables/useUnit', () => ({ getUnitState: () => unit }))
    extraMocks()
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('API_ROUTES', API_ROUTES)
    vi.stubGlobal('globalStore', { actions: { getProjects: vi.fn(async () => {}), setModalNestData: vi.fn() } })
    vi.stubGlobal('authStore', { actions: { setUser: vi.fn(async () => {}) } })
    vi.stubGlobal('tryUseNuxtApp', () => ({ runWithContext: (fn) => fn() }))
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('$fetch', vi.fn(async (url) => {
        const slug = String(url).split('/').pop()
        return { name: slug, slug, local: false, files: [file(`${slug}-f`)] }
    }))
    store = (await import('~/composables/files')).filesStore
}

afterEach(() => {
    vi.useRealTimers()
    vi.doUnmock('~/composables/useUnit')
    vi.doUnmock('~/composables/localImport')
    vi.doUnmock('~/composables/sheetcamJobImport')
    vi.doUnmock('~/composables/localFilesStore')
    vi.unstubAllGlobals()
})

const open = (slug) => store.actions.getProject(API_ROUTES.PROJECT(slug))
const sheetsOf = () => store.getters.params.sheets.map((s) => [s.width, s.height, s.count])
// Ce que fait la page à l'arrivée sur la démo (applyDemoDefaults).
const demoSetup = () => {
    store.actions.markCuratedDefaults(API_ROUTES.PROJECT('demo'))
    store.actions.updateParams({ sheets: [{ width: '1500', height: '3000', count: '3' }], rotationCount: 4 })
    store.actions.updateKerfSafety({ kerf: '0', safety: '2' })
}

describe('démo et réglages du projet quitté', () => {
    it('A → démo → A : les réglages de A reviennent, ceux de la démo restent à la démo', async () => {
        await setup()
        await open('a')
        store.actions.updateParams({ sheets: [{ width: '20', height: '30', count: '5' }] })
        store.actions.updateKerfSafety({ kerf: '1', safety: '0.5' })
        demoSetup()
        await open('demo')
        expect(sheetsOf()).toEqual([['1500', '3000', '3']])
        expect(store.getters.params.space).toBe('2')
        await open('a')
        expect(sheetsOf()).toEqual([['20', '30', '5']])
        expect(store.getters.params.kerf).toBe('1')
        expect(store.getters.params.safety).toBe('0.5')
    })

    it('le débounce ne range pas les réglages de la démo sous le projet quitté', async () => {
        vi.useFakeTimers()
        await setup()
        await open('a')
        store.actions.updateParams({ sheets: [{ width: '20', height: '30', count: '5' }] })
        demoSetup()
        // la réponse de la démo tarde : le débounce (500 ms) passe avant elle
        await vi.advanceTimersByTimeAsync(2000)
        await open('demo')
        await open('a')
        expect(sheetsOf()).toEqual([['20', '30', '5']])
    })

    it('démo → accueil → démo → projet neuf : la démo ne déteint pas', async () => {
        await setup()
        await open('demo')
        demoSetup()
        await open('demo')
        // retour par l'accueil : une nouvelle page repose les réglages de la démo
        demoSetup()
        await open('demo')
        await open('neuf')
        expect(sheetsOf()).toEqual([['1000', '2000', '1']])
        expect(store.getters.params.space).toBe('2')
    })

    it('première visite de la démo : ses réglages tiennent après le chargement', async () => {
        await setup()
        demoSetup()
        await open('demo')
        expect(sheetsOf()).toEqual([['1500', '3000', '3']])
    })
})

// Revue du 25/11 : les réglages écrits pour la démo ne valent que pour le
// chemin de la démo, même quand elle n'a pas encore répondu ou a échoué.
describe('démo lente ou en échec : les réglages de la démo restent à la démo', () => {
    // La réponse de la démo est retenue jusqu'à release() ; fail() la fait échouer (500).
    const holdDemo = () => {
        const held = {}
        const base = globalThis.$fetch
        vi.stubGlobal('$fetch', vi.fn((url) => {
            if (String(url).endsWith('/demo')) {
                return new Promise((resolve, reject) => {
                    held.release = () => resolve({ name: 'demo', slug: 'demo', local: false, files: [file('demo-f')] })
                    held.fail = () => reject(Object.assign(new Error('500'), { statusCode: 500 }))
                })
            }
            return base(url)
        }))
        return held
    }
    const setA = () => {
        store.actions.updateParams({ sheets: [{ width: '777', height: '888', count: '5' }] })
        store.actions.updateKerfSafety({ kerf: '0', safety: '3' })
    }
    const expectA = () => {
        expect(sheetsOf()).toEqual([['777', '888', '5']])
        expect(store.getters.params.safety).toBe('3')
    }

    it('(a) A, démo qui tarde, retour sur A avant sa réponse : A garde ses réglages, et son instantané aussi', async () => {
        await setup()
        await open('a')
        setA()
        const demo = holdDemo()
        demoSetup()
        const late = open('demo')
        await open('a')
        expectA()
        demo.release()
        await late // réponse périmée : ignorée
        expectA()
        await open('b')
        await open('a')
        expectA()
    })

    it("(b) la démo répond 500, l'accueil (qui ne touche pas au store), puis A : A garde ses réglages", async () => {
        await setup()
        await open('a')
        setA()
        const demo = holdDemo()
        demoSetup()
        const failed = open('demo')
        demo.fail()
        await failed
        await open('a')
        expectA()
    })

    it("(c) A, démo qui tarde, puis projet neuf B : B part des réglages d'usine", async () => {
        await setup()
        await open('a')
        setA()
        holdDemo()
        demoSetup()
        open('demo')
        await open('b')
        expect(sheetsOf()).toEqual([['1000', '2000', '1']])
        expect(store.getters.params.space).toBe('2')
        // A, rouvert ensuite, retrouve les siens
        await open('a')
        expectA()
    })
})

describe('dépôt d\'un .job par un compte en pouces', () => {
    const dropJob = async (u) => {
        await setup(() => {
            vi.doMock('~/composables/localFilesStore', () => ({
                listLocalFiles: async () => [], getLocalFile: async () => null, saveLocalFile: async () => {},
            }))
            vi.doMock('~/composables/localImport', () => ({
                readSheetCamJob: () => ({ sheet: { width: 1000, height: 2000 }, kerfWidth: 1.5, drawings: [], job: { lines: [] } }),
                importLocalFiles: vi.fn(), importLocalBytes: vi.fn(), assignJobStarts: vi.fn(),
                localRecordToUiFile: (r) => r,
            }))
            vi.doMock('~/composables/sheetcamJobImport', () => ({
                splitSheetCamDrop: async () => ({ jobs: [{ jobBytes: new Uint8Array(1), jobFile: { name: 'x.job' } }], drawings: [] }),
                prefillFromJob: () => ({ sheet: { width: 1000, height: 2000, count: 1 }, kerf: '1.5', safety: '1', space: 4 }),
                cutSettingsFor: () => ({}),
                resolveJobDrawingSources: () => ({ refused: [], matched: [], fromJob: [], reusable: [], blockByName: new Map() }),
            }))
        })
        unit = u
        vi.stubGlobal('$fetch', vi.fn(async () => ({ name: 'p', slug: 'p', local: true, files: [] })))
        await open('p')
        await store.actions.addFiles([{ name: 'x.job' }], 'p')
        return store.getters.params
    }

    it('en pouces : kerf et sécurité sont convertis comme la tôle', async () => {
        const p = await dropJob('inch')
        expect(Number(p.kerf)).toBeCloseTo(1.5 / 25.4, 4)
        expect(Number(p.safety)).toBeCloseTo(1 / 25.4, 4)
        // espacement = 2 × kerf + sécurité, en pouces
        expect(Number(p.space)).toBeCloseTo(4 / 25.4, 3)
        expect(Number(p.sheets[0].width)).toBeCloseTo(1000 / 25.4, 3)
        // champ lisible : 5 décimales au plus en pouces
        expect(p.sheets[0]).toMatchObject({ width: '39.37008', height: '78.74016' })
    })

    it('en millimètres : inchangé', async () => {
        const p = await dropJob('mm')
        expect(p.kerf).toBe('1.5')
        expect(p.safety).toBe('1')
        expect(p.space).toBe('4')
        expect(p.sheets[0]).toMatchObject({ width: '1000', height: '2000' })
    })
})

// Distance au bord de la tôle : réglage séparé de l'espacement, '' = comme l'espacement.
describe('distance au bord (edgeDistance)', () => {
    const edge = () => store.getters.params.edgeDistance
    const body = () => JSON.parse(store.getters.requestBody)
    // Un projet « Cet appareil » (local: true) ou serveur, avec un fichier prêt.
    const openProject = async (slug, local) => {
        vi.stubGlobal('$fetch', vi.fn(async () => ({
            name: slug, slug, local, files: [{ ...file(`${slug}-f`), count: 1 }],
        })))
        await open(slug)
    }
    const localSetup = async () => {
        await setup(() => {
            vi.doMock('~/composables/localFilesStore', () => ({
                listLocalFiles: async () => [], getLocalFile: async () => null, saveLocalFile: async () => {},
            }))
        })
    }

    it('défaut : chaîne vide, et le corps de la requête ne porte aucune clé edgeDistance', async () => {
        await setup()
        await openProject('a', false)
        expect(edge()).toBe('')
        expect(body().params).not.toHaveProperty('edgeDistance')
        expect(store.getters.requestBody).not.toContain('edgeDistance')
    })

    it("le corps par défaut garde les mêmes clés, dans le même ordre", async () => {
        await setup()
        await openProject('a', false)
        expect(Object.keys(body().params)).toEqual([
            'sheets', 'width', 'height', 'sheetCount', 'tolerance', 'space', 'addOutShape', 'fillHoles', 'rotationCount', 'directions',
        ])
    })

    it("updateEdgeDistance n'écrit ni kerf, ni sécurité, ni espacement", async () => {
        await setup()
        await openProject('a', false)
        store.actions.updateKerfSafety({ kerf: '0.2', safety: '1' })
        const before = { ...store.getters.params }
        store.actions.updateEdgeDistance('-3')
        expect(edge()).toBe('-3')
        expect(store.getters.params.kerf).toBe(before.kerf)
        expect(store.getters.params.safety).toBe(before.safety)
        expect(store.getters.params.space).toBe(before.space)
        // et l'inverse : le kerf ne touche pas au bord
        store.actions.updateKerfSafety({ kerf: '0.5' })
        expect(edge()).toBe('-3')
        store.actions.updateEdgeDistance(null)
        expect(edge()).toBe('')
    })

    it('projet « Cet appareil » : la valeur part en mm, négative comprise', async () => {
        await localSetup()
        await openProject('p', true)
        store.actions.updateEdgeDistance('5')
        expect(body().params.edgeDistance).toBe(5)
        store.actions.updateEdgeDistance('-2,5')
        expect(body().params.edgeDistance).toBe(-2.5)
        store.actions.updateEdgeDistance('0')
        expect(body().params.edgeDistance).toBe(0)
        store.actions.updateEdgeDistance('')
        expect(body().params).not.toHaveProperty('edgeDistance')
    })

    it('en pouces, la valeur est envoyée convertie en mm', async () => {
        await localSetup()
        unit = 'inch'
        await openProject('p', true)
        store.actions.updateEdgeDistance('-0.5')
        expect(body().params.edgeDistance).toBeCloseTo(-12.7, 6)
    })

    it("projet serveur ou démo : la clé n'est jamais envoyée, même remplie", async () => {
        await setup()
        await openProject('a', false)
        store.actions.updateEdgeDistance('4')
        expect(store.getters.requestBody).not.toContain('edgeDistance')
    })

    it('validation : négatifs et virgule acceptés, texte refusé, vide accepté', async () => {
        await setup()
        await openProject('a', false)
        for (const ok of ['', '0', '5', '-5', '-0.25', '1,5']) {
            store.actions.updateEdgeDistance(ok)
            expect(store.getters.nestRequestError, `« ${ok} »`).toBe('')
        }
        for (const bad of ['-', 'abc', '1e1', '--2', '2-', '.']) {
            store.actions.updateEdgeDistance(bad)
            expect(store.getters.nestRequestError, `« ${bad} »`).toBe('project.invalidParams')
        }
    })

    it("changement d'unité : le vide reste vide, une valeur explicite (négative comprise) est convertie", async () => {
        await setup()
        await openProject('a', false)
        store.actions.syncParamsToUnit('inch')
        expect(edge()).toBe('')
        store.actions.syncParamsToUnit('mm')
        expect(edge()).toBe('')
        store.actions.updateEdgeDistance('-25.4')
        store.actions.syncParamsToUnit('inch')
        expect(edge()).toBe('-1')
        store.actions.syncParamsToUnit('mm')
        expect(edge()).toBe('-25.4')
        store.actions.updateEdgeDistance('12.7')
        store.actions.syncParamsToUnit('inch')
        expect(edge()).toBe('0.5')
    })

    it('un bord explicite à zéro reste « 0 » (pas confondu avec vide), et -0 est normalisé', async () => {
        await setup()
        await openProject('a', false)
        store.actions.updateEdgeDistance('0')
        store.actions.syncParamsToUnit('inch')
        expect(edge()).toBe('0')
        store.actions.syncParamsToUnit('mm')
        store.actions.updateEdgeDistance('-0.00001')
        store.actions.syncParamsToUnit('inch')
        expect(edge()).toBe('0')
    })

    it("instantané : la valeur revient avec le projet, une autre fiche n'en hérite pas", async () => {
        await setup()
        await open('a')
        store.actions.updateEdgeDistance('-3')
        await open('b')
        expect(edge()).toBe('')
        await open('a')
        expect(edge()).toBe('-3')
    })

    it("un instantané d'avant (sans la clé) se lit comme « comme l'espacement »", async () => {
        const mem = new Map()
        vi.stubGlobal('sessionStorage', { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) })
        mem.set('nestorcut:projectSnapshots', JSON.stringify({
            [API_ROUTES.PROJECT('old')]: { v: 2, params: { sheets: [{ width: '10', height: '20', count: '1' }], kerf: '0', safety: '2', space: '2' }, paramsUnit: 'mm', countBySlug: {}, rotationBySlug: {} },
        }))
        await setup()
        await open('old')
        expect(store.getters.params.edgeDistance ?? '').toBe('')
        expect(store.getters.requestBody).not.toContain('edgeDistance')
    })

    it('la démo repart sans bord, même après un projet qui en avait un', async () => {
        await setup()
        await open('a')
        store.actions.updateEdgeDistance('-3')
        store.actions.markCuratedDefaults(API_ROUTES.PROJECT('demo'))
        store.actions.updateParams({ sheets: [{ width: '1500', height: '3000', count: '3' }], rotationCount: 4, edgeDistance: '' })
        store.actions.updateKerfSafety({ kerf: '0', safety: '2' })
        await open('demo')
        expect(edge()).toBe('')
    })
})
