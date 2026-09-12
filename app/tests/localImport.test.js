import { beforeEach, describe, expect, it, vi } from 'vitest'

// J-090 — flux d'import navigateur : gardes-fous (extension, entités, pièces
// vides) + chaînage parse → canonical → couleurs → store. Le wasm
// (geometryClient) et le store IndexedDB sont mockés : la géométrie elle-
// même est verrouillée par les goldens Rust/côté crates.
const state = vi.hoisted(() => ({
    imported: null,
    canonical: null,
    saved: [],
}))

vi.mock('../composables/geometryClient', () => ({
    geoImportFile: vi.fn(async () => state.imported),
    geoCanonicalDxf: vi.fn(async () => state.canonical),
    // Lot 2a : bornes de l'import, miroirs des constantes Rust/Python.
    IMPORT_MAX_ENTITIES: 10000,
    IMPORT_TIME_BUDGET_MS: 20000,
}))

vi.mock('../composables/localFilesStore', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        saveLocalFile: vi.fn(async (record) => {
            state.saved.push(record)
        }),
    }
})

import { importLocalFile, localRecordToUiFile } from '../composables/localImport'
import { translate } from '../utils/i18n'

const squarePart = {
    coordinates: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    holes: [],
    width: 10,
    height: 10,
    handles: ['A1'],
}

function fakeFile(name, bytes = new Uint8Array([1, 2, 3])) {
    return {
        name,
        arrayBuffer: async () => bytes.buffer,
    }
}

beforeEach(() => {
    state.imported = {
        parts: [squarePart],
        source_units: 4,
        entity_count: 1,
        warnings: [],
    }
    state.canonical = new Uint8Array([9, 9, 9])
    state.saved = []
})

describe('importLocalFile (J-090)', () => {
    it('stores a full record (geometry + canonical bytes + preview) in IndexedDB', async () => {
        const record = await importLocalFile(fakeFile('bracket.dxf'), 'proj-1')
        expect(record.slug).toMatch(/^f-[0-9a-f]{16}\.dxf$/)
        expect(record.name).toBe('bracket.dxf')
        expect(record.slug).not.toContain('bracket')
        expect(record.projectSlug).toBe('proj-1')
        expect(record.dxfBytes).toBeInstanceOf(ArrayBuffer)
        expect(record.parts).toHaveLength(1)
        expect(record.parts[0].color).toMatch(/^#[0-9A-F]{6}$/)
        expect(record.parts[0].handles).toEqual(['A1'])
        expect(record.previewSvg.startsWith('data:image/svg+xml')).toBe(true)
        expect(state.saved).toHaveLength(1)
    })

    it('rejects DWG with a dedicated i18n key (server-side conversion only)', async () => {
        await expect(importLocalFile(fakeFile('part.dwg'), 'p')).rejects.toThrow('localImport.dwgRejected')
        expect(state.saved).toHaveLength(0)
    })

    it('rejects unsupported types and unparseable files', async () => {
        await expect(importLocalFile(fakeFile('notes.txt'), 'p')).rejects.toThrow('localImport.unsupportedType')
        state.imported = null
        await expect(importLocalFile(fakeFile('broken.dxf'), 'p')).rejects.toThrow('localImport.parseError')
    })

    it('rejects empty geometry like the server pipeline does', async () => {
        state.imported = { parts: [], source_units: 4, entity_count: 3, warnings: [] }
        await expect(importLocalFile(fakeFile('empty.dxf'), 'p')).rejects.toThrow('localImport.noParts')
    })

    // ---------------------------------------------------------------- lot 2a
    // La garde « trop lourd » vit dans le wasm : le flux navigateur ne compare
    // plus un plafond après coup, il TRADUIT le refus. Ce que ces verrous
    // tiennent, c'est le message — clé et nombres.
    // ---------------------------------------------------------------- lot 2c
    it('carries the import findings from the wasm to the UI shape', async () => {
        state.imported = {
            parts: [squarePart],
            source_units: 0,
            entity_count: 12,
            warnings: ['skipped entity HATCH'],
            findings: [
                { code: 'import.entitiesSkipped', level: 'attention', count: 2, types: ['HATCH'] },
                { code: 'import.unitAssumed', level: 'info', count: 1 },
            ],
        }
        const record = await importLocalFile(fakeFile('hatched.dxf'), 'p')
        expect(record.findings).toHaveLength(2)
        // C'est ICI que les constats mouraient avant le lot 2c : la forme UI
        // ne les recopiait pas.
        const ui = localRecordToUiFile(record)
        expect(ui.findings).toEqual(record.findings)
    })

    it('leaves findings empty when the importer has nothing to say', async () => {
        const record = await importLocalFile(fakeFile('clean.dxf'), 'p')
        expect(record.findings).toEqual([])
        expect(localRecordToUiFile(record).findings).toEqual([])
    })

    it('reads a file of 1200 entities (the old 999 cap refused 11 real files)', async () => {
        state.imported = {
            parts: [squarePart],
            source_units: 4,
            entity_count: 1200,
            warnings: [],
        }
        const record = await importLocalFile(fakeFile('lightburn.dxf'), 'p')
        expect(record.entityCount).toBe(1200)
    })

    it('turns an entity refusal into a message carrying the count and the cap', async () => {
        state.imported = {
            refusal: {
                reason: 'entities',
                entities: 12345,
                entitiesAtLeast: false,
                maxEntities: 10000,
                elapsedMs: 8,
                timeBudgetMs: 20000,
            },
        }
        const err = await importLocalFile(fakeFile('huge.dxf'), 'p').catch((e) => e)
        expect(err.message).toBe('localImport.tooManyEntities')
        expect(err.params).toMatchObject({ n: 12345, max: 10000 })
        expect(translate(err.message, 'fr', err.params)).toContain('12345 entités')
        expect(translate(err.message, 'fr', err.params)).toContain('10000 au maximum')
        expect(state.saved).toHaveLength(0)
    })

    it('says « plus de N » when the expansion was cut at the hard ceiling', async () => {
        state.imported = {
            refusal: {
                reason: 'entities',
                entities: 100000,
                entitiesAtLeast: true,
                maxEntities: 10000,
                elapsedMs: 120,
                timeBudgetMs: 20000,
            },
        }
        const err = await importLocalFile(fakeFile('bomb.dxf'), 'p').catch((e) => e)
        expect(err.message).toBe('localImport.tooManyEntitiesAtLeast')
        expect(translate(err.message, 'fr', err.params)).toContain('plus de 100000 entités')
    })

    it('turns a time refusal into its own message, with the budget in seconds', async () => {
        state.imported = {
            refusal: {
                reason: 'time',
                entities: 787,
                entitiesAtLeast: false,
                maxEntities: 10000,
                elapsedMs: 20298,
                timeBudgetMs: 20000,
            },
        }
        const err = await importLocalFile(fakeFile('splines.dxf'), 'p').catch((e) => e)
        expect(err.message).toBe('localImport.tooHeavy')
        expect(err.params).toMatchObject({ n: 787, seconds: 20 })
        const fr = translate(err.message, 'fr', err.params)
        expect(fr).toContain('787 entités')
        expect(fr).toContain('plus de 20 s')
    })

    it('never sends a cyclic-block file to the servers (they refuse it too)', async () => {
        state.imported = {
            refusal: {
                reason: 'blockDepth',
                entities: 0,
                entitiesAtLeast: true,
                maxEntities: 10000,
                elapsedMs: 3,
                timeBudgetMs: 20000,
            },
        }
        const err = await importLocalFile(fakeFile('cyclic.dxf'), 'p').catch((e) => e)
        expect(err.message).toBe('localImport.blockDepth')
        expect(translate(err.message, 'fr', err.params)).not.toMatch(/serveurs/)
    })
})

describe('localRecordToUiFile', () => {
    it('mirrors the server mapper shape (light parts, done, never expired)', () => {
        const ui = localRecordToUiFile({
            slug: 'a.dxf',
            name: 'a.dxf',
            previewSvg: 'data:image/svg+xml;utf8,x',
            parts: [{ width: 10.04, height: 5.96, color: '#2563EB', coordinates: [[0, 0]] }],
        })
        expect(ui).toMatchObject({
            slug: 'a.dxf',
            processingStatus: 'done',
            expired: false,
            local: true,
        })
        // blob: en navigateur, null en environnement test (pas d'URL API).
        expect(ui.dxfUrl === null || String(ui.dxfUrl).startsWith('blob:')).toBe(true)
        expect(ui.parts[0]).toEqual({ width: 10, height: 6, color: '#2563EB' })
        expect(ui.svgUrl).toContain('data:image/svg+xml')
    })
})
