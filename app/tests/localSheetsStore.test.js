import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { API_ROUTES } from '../composables/apiRoutes'
import { processingType } from '../../constants/files.constants'
import { makeSheetRecord, ringArea, ringBbox } from '../utils/sheetShape'

// IndexedDB factice en memoire (meme surface que localFilesStore.test.js :
// fake-indexeddb n'est pas dans les deps). Persistance entre open() pour
// tester que la base partagee n'est jamais touchee par les tôles.
function createFakeIndexedDB() {
    const dbs = new Map()
    const calls = []
    const handles = []
    const makeRequest = () => ({})
    const makeStoreHandle = (store) => {
        const wrap = (fn) => {
            const req = makeRequest()
            queueMicrotask(() => {
                try {
                    req.result = fn()
                    req.onsuccess?.()
                } catch (error) {
                    req.error = error
                    req.onerror?.()
                }
            })
            return req
        }
        return {
            put: (record) => wrap(() => { store.data.set(record[store.keyPath], record) }),
            get: (key) => wrap(() => store.data.get(key)),
            delete: (key) => wrap(() => { store.data.delete(key) }),
            getAll: () => wrap(() => [...store.data.values()]),
            index: (indexName) => ({
                getAll: (key) => wrap(() => {
                    const field = store.indexes.get(indexName)
                    return [...store.data.values()].filter((rec) => rec?.[field] === key)
                }),
            }),
        }
    }
    const makeDbHandle = (db) => {
        const handle = {
            closed: false,
            close() { handle.closed = true },
            objectStoreNames: { contains: (name) => db.stores.has(name) },
            createObjectStore: (name, options) => {
                const store = { keyPath: options?.keyPath, data: new Map(), indexes: new Map() }
                db.stores.set(name, store)
                return { createIndex: (indexName, keyPath) => { store.indexes.set(indexName, keyPath) } }
            },
            transaction: () => ({ objectStore: (name) => makeStoreHandle(db.stores.get(name)) }),
        }
        handles.push(handle)
        return handle
    }
    const open = (name, version) => {
        const req = makeRequest()
        calls.push([name, version])
        queueMicrotask(() => {
            if (open._blocked) {
                req.onblocked?.()
                return
            }
            let db = dbs.get(name)
            if (!db) {
                db = { version: 0, stores: new Map() }
                dbs.set(name, db)
            }
            req.result = makeDbHandle(db)
            if (version > db.version) {
                req.onupgradeneeded?.()
                db.version = version
            }
            req.onsuccess?.()
        })
        return req
    }
    open._seed = (name, version, storesWithRecords) => {
        const db = { version, stores: new Map() }
        for (const [storeName, records] of Object.entries(storesWithRecords)) {
            db.stores.set(storeName, {
                keyPath: 'slug',
                data: new Map(records.map((r) => [r.slug, r])),
                indexes: new Map([['projectSlug', 'projectSlug']]),
            })
        }
        dbs.set(name, db)
    }
    open._dbs = dbs
    open._calls = calls
    open._handles = handles
    return { open }
}

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const contour = (ring, depth, parent) => ({ ring, depth, parent, areaMm2: ringArea(ring), bbox: ringBbox(ring) })
const CONTOURS = [contour(rect(0, 0, 100, 60), 1, null), contour(rect(10, 10, 30, 30), 2, 0)]

// `shift` : une tôle de géométrie différente (donc de geometryKey différente).
const makeRecord = (over = {}, shift = 0) => makeSheetRecord({
    id: 'sheet-1',
    projectSlug: 'proj-1',
    name: 'Chute',
    sourceFileName: 'chute.dxf',
    sourceUnits: 4,
    contours: [contour(rect(0, 0, 100 + shift, 60), 1, null), CONTOURS[1]],
    outlineIndex: 0,
    forbidden: [1],
    addedAt: '2026-11-19T10:00:00.000Z',
    ...over,
})

let sheetsStore
let filesStore
let resultsStore

beforeEach(async () => {
    vi.resetModules()
    globalThis.indexedDB = createFakeIndexedDB()
    sheetsStore = await import('../composables/localSheetsStore')
    filesStore = await import('../composables/localFilesStore')
    resultsStore = await import('../composables/localResultsStore')
})

describe('base dediee nestorcut-sheets', () => {
    it('cree sa propre base v1 avec le store sheets', async () => {
        await sheetsStore.saveSheet(makeRecord())
        const db = globalThis.indexedDB.open._dbs.get('nestorcut-sheets')
        expect(db.version).toBe(1)
        expect([...db.stores.keys()]).toEqual(['sheets'])
        expect(db.stores.get('sheets').keyPath).toBe('slug')
        expect(db.stores.get('sheets').indexes.get('projectSlug')).toBe('projectSlug')
    })

    it('la base partagee nestorcut-local n est ni ouverte ni montee par les operations de tôles', async () => {
        globalThis.indexedDB.open._seed('nestorcut-local', 3, {
            results: [{ slug: 'job-1', projectSlug: 'proj-1', createdAt: 1 }],
            files: [{ slug: 'f-1.dxf', projectSlug: 'proj-1', addedAt: '2026-08-10T10:00:00.000Z' }],
        })
        await sheetsStore.saveSheet(makeRecord())
        await sheetsStore.rememberRecentSheet(makeRecord(), '2026-11-19T11:00:00.000Z')
        await sheetsStore.listProjectSheets('proj-1')
        await sheetsStore.listRecentSheets()
        await sheetsStore.deleteProjectSheets('proj-1')
        await sheetsStore.forgetRecentSheet('sheet-1')
        const idb = globalThis.indexedDB
        expect(idb.open._calls.length).toBeGreaterThan(0)
        expect(idb.open._calls.every(([name, version]) => name === 'nestorcut-sheets' && version === 1)).toBe(true)
        const shared = idb.open._dbs.get('nestorcut-local')
        expect(shared.version).toBe(3)
        expect([...shared.stores.keys()]).toEqual(['results', 'files'])
        expect([...shared.stores.get('files').data.keys()]).toEqual(['f-1.dxf'])
        expect([...shared.stores.get('results').data.keys()]).toEqual(['job-1'])
        // Les fichiers et resultats restent lisibles par leurs propres stores.
        expect((await filesStore.listLocalFiles('proj-1')).map((f) => f.slug)).toEqual(['f-1.dxf'])
    })

    it('versionchange : la connexion se ferme et la suivante rouvre la base', async () => {
        await sheetsStore.saveSheet(makeRecord())
        const handles = globalThis.indexedDB.open._handles
        expect(handles).toHaveLength(1)
        expect(typeof handles[0].onversionchange).toBe('function')
        handles[0].onversionchange()
        expect(handles[0].closed).toBe(true)
        await sheetsStore.getSheet('sheet-1')
        expect(globalThis.indexedDB.open._calls).toHaveLength(2)
        expect(handles).toHaveLength(2)
        expect(typeof handles[1].onversionchange).toBe('function')
    })

    it('close : une connexion fermée par le navigateur est rouverte au prochain appel', async () => {
        await sheetsStore.saveSheet(makeRecord())
        const handles = globalThis.indexedDB.open._handles
        expect(typeof handles[0].onclose).toBe('function')
        handles[0].onclose()
        expect((await sheetsStore.getSheet('sheet-1'))?.name).toBe('Chute')
        expect(globalThis.indexedDB.open._calls).toHaveLength(2)
        expect(handles).toHaveLength(2)
        expect(typeof handles[1].onclose).toBe('function')
    })

    it('onblocked : rejette indexeddb_blocked, puis retente au prochain appel', async () => {
        globalThis.indexedDB.open._blocked = true
        await expect(sheetsStore.saveSheet(makeRecord())).rejects.toThrow('indexeddb_blocked')
        globalThis.indexedDB.open._blocked = false
        await sheetsStore.saveSheet(makeRecord())
        expect((await sheetsStore.getSheet('sheet-1'))?.name).toBe('Chute')
        expect(globalThis.indexedDB.open._calls).toHaveLength(2)
    })

    it('indexedDB absent : indexeddb_unavailable', async () => {
        delete globalThis.indexedDB
        await expect(sheetsStore.saveSheet(makeRecord())).rejects.toThrow('indexeddb_unavailable')
        await expect(sheetsStore.listRecentSheets()).rejects.toThrow('indexeddb_unavailable')
    })
})

describe('listings existants inchanges', () => {
    it('des tôles (projet ET bibliotheque) n apparaissent ni dans les fichiers ni dans les resultats', async () => {
        await filesStore.saveLocalFile({ slug: 'f-1.dxf', projectSlug: 'proj-1', addedAt: '2026-08-10T10:00:00.000Z' })
        await resultsStore.saveLocalResult?.({ slug: 'job-1', projectSlug: 'proj-1', createdAt: 1 })
        const filesBefore = await filesStore.listLocalFiles('proj-1')
        const filesAllBefore = await filesStore.listLocalFiles(null)
        const resultsBefore = await resultsStore.listLocalResults('proj-1')

        await sheetsStore.saveSheet(makeRecord())
        await sheetsStore.rememberRecentSheet(makeRecord(), '2026-11-19T11:00:00.000Z')

        expect(await filesStore.listLocalFiles('proj-1')).toEqual(filesBefore)
        expect(await filesStore.listLocalFiles(null)).toEqual(filesAllBefore)
        expect(filesAllBefore.map((f) => f.slug)).toEqual(['f-1.dxf'])
        expect(await resultsStore.listLocalResults('proj-1')).toEqual(resultsBefore)
    })
})

describe('localSheetsStore — tôles de projet', () => {
    it('save/get/list par projet, tri par addedAt, get absent = null', async () => {
        await sheetsStore.saveSheet(makeRecord({ id: 'b', addedAt: '2026-11-19T10:02:00.000Z' }))
        await sheetsStore.saveSheet(makeRecord({ id: 'a', addedAt: '2026-11-19T10:01:00.000Z' }))
        await sheetsStore.saveSheet(makeRecord({ id: 'c', projectSlug: 'proj-2' }))
        expect((await sheetsStore.listProjectSheets('proj-1')).map((s) => s.slug)).toEqual(['a', 'b'])
        expect((await sheetsStore.getSheet('c'))?.projectSlug).toBe('proj-2')
        expect(await sheetsStore.getSheet('absent')).toBeNull()
        expect(await sheetsStore.listProjectSheets(null)).toEqual([])
    })

    it('saveSheet remplace le meme slug ; deleteSheet ne touche que le slug vise', async () => {
        await sheetsStore.saveSheet(makeRecord({ id: 'a', name: 'v1' }))
        await sheetsStore.saveSheet(makeRecord({ id: 'a', name: 'v2' }))
        await sheetsStore.saveSheet(makeRecord({ id: 'b' }))
        expect((await sheetsStore.listProjectSheets('proj-1'))).toHaveLength(2)
        expect((await sheetsStore.getSheet('a'))?.name).toBe('v2')
        await sheetsStore.deleteSheet('a')
        expect(await sheetsStore.getSheet('a')).toBeNull()
        expect(await sheetsStore.getSheet('b')).not.toBeNull()
    })

    it('deleteProjectSheets : les tôles du projet partent, pas celles des autres ni la bibliotheque', async () => {
        await sheetsStore.saveSheet(makeRecord({ id: 'a' }))
        await sheetsStore.saveSheet(makeRecord({ id: 'b' }))
        await sheetsStore.saveSheet(makeRecord({ id: 'c', projectSlug: 'proj-2' }))
        await sheetsStore.rememberRecentSheet(makeRecord({ id: 'a' }), '2026-11-19T11:00:00.000Z')
        await sheetsStore.deleteProjectSheets('proj-1')
        expect(await sheetsStore.listProjectSheets('proj-1')).toEqual([])
        expect(await sheetsStore.listProjectSheets('proj-2')).toHaveLength(1)
        expect(await sheetsStore.listRecentSheets()).toHaveLength(1)
        await sheetsStore.deleteProjectSheets(null)
        expect(await sheetsStore.listRecentSheets()).toHaveLength(1)
    })
})

describe('localSheetsStore — bibliotheque des récentes', () => {
    it('rememberRecentSheet range une copie sans projet, l original reste', async () => {
        const rec = makeRecord()
        await sheetsStore.saveSheet(rec)
        await sheetsStore.rememberRecentSheet(rec, '2026-11-19T11:00:00.000Z')
        const recents = await sheetsStore.listRecentSheets()
        expect(recents).toHaveLength(1)
        expect(recents[0]).toMatchObject({ projectSlug: null, name: 'Chute', geometryKey: rec.geometryKey, lastUsedAt: '2026-11-19T11:00:00.000Z' })
        expect(recents[0].slug).not.toBe('sheet-1')
        expect((await sheetsStore.getSheet('sheet-1'))?.projectSlug).toBe('proj-1')
        expect((await sheetsStore.listProjectSheets('proj-1')).map((s) => s.slug)).toEqual(['sheet-1'])
    })

    it('dedoublonnage par geometryKey : rafraichit lastUsedAt, une seule entrée', async () => {
        await sheetsStore.rememberRecentSheet(makeRecord({ id: 'x', name: 'Premier' }), '2026-11-19T11:00:00.000Z')
        await sheetsStore.rememberRecentSheet(makeRecord({ id: 'y', name: 'Second' }), '2026-11-19T12:00:00.000Z')
        const recents = await sheetsStore.listRecentSheets()
        expect(recents).toHaveLength(1)
        expect(recents[0].lastUsedAt).toBe('2026-11-19T12:00:00.000Z')
        expect(recents[0].name).toBe('Premier')
    })

    it('plafond de 12 : la plus ancienne lastUsedAt sort ; liste récente d abord', async () => {
        for (let i = 0; i < 13; i++) {
            const stamp = `2026-11-19T10:${String(i).padStart(2, '0')}:00.000Z`
            await sheetsStore.rememberRecentSheet(makeRecord({ id: `s${i}` }, i), stamp)
        }
        const recents = await sheetsStore.listRecentSheets()
        expect(recents).toHaveLength(12)
        expect(recents[0].lastUsedAt).toBe('2026-11-19T10:12:00.000Z')
        expect(recents.at(-1).lastUsedAt).toBe('2026-11-19T10:01:00.000Z')
        // Rafraichir la plus ancienne la sauve de la prochaine éviction.
        await sheetsStore.rememberRecentSheet(makeRecord({ id: 's1' }, 1), '2026-11-19T11:00:00.000Z')
        await sheetsStore.rememberRecentSheet(makeRecord({ id: 's13' }, 13), '2026-11-19T11:01:00.000Z')
        const after = await sheetsStore.listRecentSheets()
        expect(after).toHaveLength(12)
        expect(after.some((s) => s.lastUsedAt === '2026-11-19T10:01:00.000Z')).toBe(false)
        expect(after.some((s) => s.lastUsedAt === '2026-11-19T11:00:00.000Z')).toBe(true)
        expect(after.some((s) => s.lastUsedAt === '2026-11-19T10:02:00.000Z')).toBe(false)
        expect(after.some((s) => s.lastUsedAt === '2026-11-19T10:03:00.000Z')).toBe(true)
    })

    it('forgetRecentSheet : retire une récente, refuse une tôle de projet', async () => {
        await sheetsStore.saveSheet(makeRecord())
        await sheetsStore.rememberRecentSheet(makeRecord(), '2026-11-19T11:00:00.000Z')
        const [recent] = await sheetsStore.listRecentSheets()
        await sheetsStore.forgetRecentSheet('sheet-1')
        expect(await sheetsStore.getSheet('sheet-1')).not.toBeNull()
        await sheetsStore.forgetRecentSheet(recent.slug)
        expect(await sheetsStore.listRecentSheets()).toEqual([])
    })

    it('fromSlug : une tôle à défauts remplace les versions à défauts de la MÊME tôle ; la propre reste', async () => {
        const withDefects = (id, key, over = {}) => ({
            ...makeRecord({ id }), geometryKey: key, drawn: [{ id: 'd1' }], ...over,
        })
        await sheetsStore.rememberRecentSheet(makeRecord({ id: 'sheet-1' }), '2026-11-19T11:00:00.000Z') // propre
        await sheetsStore.rememberRecentSheet(withDefects('sheet-1', 'g2-aaa'), '2026-11-19T12:00:00.000Z')
        await sheetsStore.rememberRecentSheet(withDefects('sheet-2', 'g2-zzz'), '2026-11-19T12:30:00.000Z') // autre tôle
        let recents = await sheetsStore.listRecentSheets()
        expect(recents.map((r) => r.fromSlug).sort()).toEqual(['sheet-1', 'sheet-1', 'sheet-2'])
        // la tôle 1 est retouchée : nouvelle version à défauts
        await sheetsStore.rememberRecentSheet(withDefects('sheet-1', 'g2-bbb'), '2026-11-19T13:00:00.000Z')
        recents = await sheetsStore.listRecentSheets()
        expect(recents.map((r) => r.geometryKey).sort()).toEqual(
            [makeRecord().geometryKey, 'g2-bbb', 'g2-zzz'].sort(),
        )
        // une version PROPRE n'efface rien
        await sheetsStore.rememberRecentSheet(makeRecord({ id: 'sheet-1' }, 5), '2026-11-19T14:00:00.000Z')
        expect(await sheetsStore.listRecentSheets()).toHaveLength(4)
    })
})

// ---------------------------------------------------------------------------
// files.js : tôle importée dans les réglages (même harnais que
// nestUnfitScope.test.js : vrai store, globales Nuxt stubbées).
// ---------------------------------------------------------------------------
describe('files.js — tôle importée', () => {
    let store
    let fetchMock

    beforeEach(async () => {
        vi.resetModules()
        vi.stubGlobal('ref', ref)
        vi.stubGlobal('API_ROUTES', API_ROUTES)
        vi.stubGlobal('globalStore', { actions: { getProjects: vi.fn(async () => {}), setModalNestData: vi.fn() } })
        vi.stubGlobal('authStore', { actions: { setUser: vi.fn(async () => {}) } })
        const nuxtApp = { runWithContext: (fn) => fn() }
        vi.stubGlobal('tryUseNuxtApp', () => nuxtApp)
        vi.stubGlobal('navigateTo', vi.fn())
        fetchMock = vi.fn(async () => ({
            name: 'p',
            files: [{ slug: 'f1', name: 'f1.dxf', processingStatus: processingType.done }],
        }))
        vi.stubGlobal('$fetch', fetchMock)
        store = (await import('~/composables/files')).filesStore
        await store.actions.getProject(API_ROUTES.PROJECT('p'))
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    const record = () => makeRecord({ id: 'shape-1', name: 'Disque 100' }, 23.5)

    // Avec un résultat déjà là, l'import s'AJOUTE à la tôle d'usine (le remplacement : nestGuards.test.js).
    it('addSheetFromShape : shapeId, nom et boite englobante (mm) dans les réglages, pas de géométrie', () => {
        store.actions.addSheetFromShape(record(), { hasResult: true })
        const sheets = store.getters.params.sheets
        expect(sheets).toHaveLength(2)
        expect(sheets[1]).toEqual({ width: '123.5', height: '60', count: '1', shapeId: 'shape-1', name: 'Disque 100' })
        // Ce que le snapshot sessionStorage copie (JSON de params) ne porte aucune géométrie.
        const snapshotText = JSON.stringify(store.getters.params)
        expect(snapshotText).not.toContain('contours')
        expect(snapshotText).not.toContain('ring')
        expect(store.getters.nestRequestError).toBe('')
    })

    it('updateSheet : width/height/shapeId/name ignorés sur une tôle importée, count éditable', () => {
        store.actions.addSheetFromShape(record(), { hasResult: true })
        store.actions.updateSheet(1, { width: '1', height: '2', shapeId: 'autre', name: 'x', count: '3' })
        expect(store.getters.params.sheets[1]).toEqual({ width: '123.5', height: '60', count: '3', shapeId: 'shape-1', name: 'Disque 100' })
        // Une tôle ordinaire reste entièrement éditable.
        store.actions.updateSheet(0, { width: '500' })
        expect(store.getters.params.sheets[0].width).toBe('500')
    })

    it('replaceSheetShape : révision de forme, et Nest redevient disponible même si le corps de la requête est inchangé', async () => {
        store.actions.addSheetFromShape(record(), { hasResult: true })
        expect(store.getters.shapeRevision).toBe(0)
        await store.actions.nest('p')
        expect(store.getters.isNewParams).toBe(false)
        // retouche : même boîte, même nom, même shapeId -> corps identique
        store.actions.replaceSheetShape(1, record())
        expect(store.getters.shapeRevision).toBe(1)
        expect(store.getters.isNewParams).toBe(true)
        // index invalide : rien ne change
        store.actions.replaceSheetShape(9, record())
        expect(store.getters.shapeRevision).toBe(1)
        // aucun champ de plus dans l'entrée de tôle
        expect(Object.keys(store.getters.params.sheets[1]).sort()).toEqual(['count', 'height', 'name', 'shapeId', 'width'])
    })

    it('replaceSheetShape : change la forme, garde la quantité ; index invalide sans effet', () => {
        store.actions.addSheetFromShape(record(), { hasResult: true })
        store.actions.updateSheet(1, { count: '4' })
        store.actions.replaceSheetShape(1, makeRecord({ id: 'shape-2', name: 'Autre' }))
        expect(store.getters.params.sheets[1]).toEqual({ width: '100', height: '60', count: '4', shapeId: 'shape-2', name: 'Autre' })
        const before = JSON.stringify(store.getters.params.sheets)
        store.actions.replaceSheetShape(9, record())
        expect(JSON.stringify(store.getters.params.sheets)).toBe(before)
        // Remplacer la tôle ordinaire 0 par une forme.
        store.actions.replaceSheetShape(0, record())
        expect(store.getters.params.sheets[0].shapeId).toBe('shape-1')
    })

    it('validation des réglages (isInvalidParams via nestRequestError) : une tôle avec shapeId et nom est valide, une quantité invalide la rend invalide', () => {
        store.actions.addSheetFromShape(record(), { hasResult: true })
        expect(store.getters.params.sheets[1]).toMatchObject({ shapeId: 'shape-1', name: 'Disque 100' })
        expect(store.getters.nestRequestError).toBe('')
        store.actions.updateSheet(1, { count: '0' })
        expect(store.getters.nestRequestError).toBe('project.invalidParams')
        store.actions.updateSheet(1, { count: '2' })
        expect(store.getters.nestRequestError).toBe('')
    })

    it('distance au bord invalide, champ grisé : ne bloque pas Nest (valeur non envoyée)', () => {
        // Projet « Nos serveurs », calcul navigateur coupé : champ grisé.
        store.actions.updateEdgeDistance('abc')
        expect(store.getters.edgeBlock).toBe('off')
        expect(store.getters.nestRequestError).toBe('')
    })

    it('distance au bord invalide, champ actif : bloque Nest ; valeur valide : débloque', () => {
        vi.stubGlobal('useRuntimeConfig', () => ({ public: { localComputeEnabled: true } }))
        store.actions.updateEdgeDistance('abc')
        expect(store.getters.edgeBlock).toBe(null)
        expect(store.getters.nestRequestError).toBe('project.invalidParams')
        store.actions.updateEdgeDistance('3')
        expect(store.getters.nestRequestError).toBe('')
    })

    it('removeSheet et addSheet : la copie d une tôle importée est une tôle simple', () => {
        store.actions.addSheetFromShape(record(), { hasResult: true })
        store.actions.addSheet()
        const last = store.getters.params.sheets.at(-1)
        expect(last).toEqual({ width: '123.5', height: '60', count: '1' })
        store.actions.removeSheet(1)
        expect(store.getters.params.sheets.map((s) => s.shapeId)).toEqual([undefined, undefined])
    })

    it('corps POST /nest : { width, height, count } + shapeId (chaîne courte) pour la tôle importée ; jamais de nom ni de géométrie', async () => {
        store.actions.addSheetFromShape(record(), { hasResult: true })
        store.actions.updateSheet(1, { count: '2' })
        await store.actions.nest('p')
        const call = fetchMock.mock.calls.find(([url]) => url === API_ROUTES.NEST('p'))
        expect(call).toBeTruthy()
        const text = call[1].body
        const body = JSON.parse(text)
        expect(body.params.sheets).toEqual([
            { width: 1000, height: 2000, count: 1 },
            { width: 123.5, height: 60, count: 2, shapeId: 'shape-1' },
        ])
        // La tôle ordinaire n'a toujours que trois clés ; l'importée en a une de plus, et une seule.
        expect(Object.keys(body.params.sheets[0]).sort()).toEqual(['count', 'height', 'width'])
        expect(Object.keys(body.params.sheets[1]).sort()).toEqual(['count', 'height', 'shapeId', 'width'])
        expect(typeof body.params.sheets[1].shapeId).toBe('string')
        expect(body.params.sheets[1].shapeId.length).toBeLessThanOrEqual(64)
        for (const leak of ['Disque 100', 'contours', 'forbidden', 'ring', 'geometryKey']) {
            expect(text).not.toContain(leak)
        }
    })
})
