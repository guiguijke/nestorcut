/**
 * Verrous des lots E1 → E4 — la chaîne d'import et les actions SUR LA FICHE.
 *
 * Ce qui est mesuré ici :
 *
 *   - le DÉPÔT est l'import ordinaire, sans aucun appel wasm de plus (le
 *     contrôle négatif historique du lot E1, devenu la règle au lot E4-d) ;
 *   - `scaleLocalFiche` (E4-b) remplace la fiche EN PLACE, garde les octets
 *     d'origine à la PREMIÈRE application, et compose les facteurs ;
 *   - `resetLocalFicheScale` (E4-b) rend les octets d'origine BIT-IDENTIQUES ;
 *   - `explodeLocalFiche` (E4-c) fabrique des fiches NORMALES « (k/N) »,
 *     ordonnées au rang du parent, et supprime la fiche d'origine.
 *
 * Le wasm est mocké — la géométrie elle-même est verrouillée par les tests
 * Rust (nest-import/tests/advanced_import.rs).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
    imported: null,
    canonical: null,
    scaled: null,
    partBytes: null,
    partImports: [],
    calls: [],
    saved: [],
    deleted: [],
}))

vi.mock('../composables/geometryClient', () => ({
    geoImportFile: vi.fn(async (bytes) => {
        state.calls.push(['import', bytes?.[0] ?? null])
        // Un DXF de pièce (marqué par son premier octet) rend UNE pièce.
        if (bytes && bytes[0] === 77) return state.partImports.shift()
        return state.imported
    }),
    geoCanonicalDxf: vi.fn(async () => {
        state.calls.push(['canonical'])
        return state.canonical
    }),
    geoCanonicalDxfScaled: vi.fn(async (bytes, factor) => {
        state.calls.push(['scaled', factor, bytes?.[0] ?? null])
        return state.scaled
    }),
    geoCanonicalDxfPart: vi.fn(async (bytes, handles) => {
        state.calls.push(['part', handles.join(',')])
        return state.partBytes
    }),
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
        deleteLocalFile: vi.fn(async (slug) => {
            state.deleted.push(slug)
        }),
    }
})

import { importLocalFiles, scaleLocalFiche, resetLocalFicheScale, explodeLocalFiche } from '../composables/localImport'
import { resolveScale } from '../composables/advancedImport'

const part = (id, w, h) => ({
    coordinates: [[0, 0], [w, 0], [w, h], [0, h], [0, 0]],
    holes: [],
    width: w,
    height: h,
    handles: [`H${id}`],
})

function fakeFile(name, first = 1) {
    const bytes = new Uint8Array([first, 2, 3])
    return { name, size: 3, arrayBuffer: async () => bytes.buffer }
}

const FICHE = {
    slug: 'f-deadbeef.dxf',
    projectSlug: 'p1',
    name: 'logo.dxf',
    addedAt: new Date(Date.UTC(2026, 8, 14, 10, 0, 0)).toISOString(),
    dxfBytes: new Uint8Array([1, 2, 3]).buffer,
    parts: [part(1, 10, 20), part(2, 30, 40), part(3, 50, 60)],
    sourceUnits: 4,
    entityCount: 3,
    warnings: [],
    findings: [{ code: 'import.unitsAssumed', level: 'attention', count: 1 }],
}

beforeEach(() => {
    state.imported = {
        parts: [part(1, 10, 20), part(2, 30, 40), part(3, 50, 60)],
        source_units: 4,
        entity_count: 3,
        warnings: [],
        findings: [],
    }
    state.canonical = new Uint8Array([9, 9, 9])
    state.scaled = new Uint8Array([8, 8, 8])
    state.partBytes = new Uint8Array([77, 7, 7])
    state.partImports = []
    state.calls = []
    state.saved = []
    state.deleted = []
})

describe('E4-d — le dépôt est l’import ordinaire', () => {
    it('une fiche, nom intact, AUCUN appel wasm de plus', async () => {
        const out = await importLocalFiles(fakeFile('plaque.dxf'), 'p1')
        expect(out).toHaveLength(1)
        expect(out[0].name).toBe('plaque.dxf')
        expect(out[0].parts).toHaveLength(3)
        expect(out[0].importScale).toBeUndefined()
        expect(out[0].explodedFrom).toBeUndefined()
        // Exactement l'import + le canonique d'avant le lot E1 : ni mesure,
        // ni mise à l'échelle, ni éclatement — le dépôt ne décide plus rien.
        expect(state.calls).toEqual([['import', 1], ['canonical']])
    })
})

describe('E1 — résolution de l’échelle par cible', () => {
    it('largeur cible : facteur = cible / étendue mesurée', () => {
        const f = resolveScale(
            { scaleTarget: { mode: 'width', mm: 1000 } },
            { width: 1612.6, height: 230.6 },
        )
        expect(Math.round(f * 1000) / 1000).toBe(0.62)
    })

    it('hauteur cible : facteur = cible / hauteur', () => {
        const f = resolveScale(
            { scaleTarget: { mode: 'height', mm: 100 } },
            { width: 1612.6, height: 200 },
        )
        expect(f).toBe(0.5)
    })

    it('un dessin dégénéré ne fabrique pas un facteur infini', () => {
        expect(resolveScale({ scaleTarget: { mode: 'width', mm: 100 } }, { width: 0 })).toBe(1)
        expect(resolveScale({ scaleTarget: { mode: 'width', mm: 0 } }, { width: 10 })).toBe(1)
    })

    it('sans cible, le facteur est celui donné', () => {
        expect(resolveScale({ scale: 2 }, null)).toBe(2)
        expect(resolveScale({}, null)).toBe(1)
    })
})

describe('E4-b — scaleLocalFiche : la fiche remplacée EN PLACE', () => {
    it('cible largeur : facteur déduit de l’étendue MESURÉE, fiche intacte par ailleurs', async () => {
        // Étendue des trois pièces mockées : 50 × 60. Cible 25 ⇒ facteur 0,5.
        const out = await scaleLocalFiche(FICHE, { scaleTarget: { mode: 'width', mm: 25 } })
        // La chaîne : le canonique de la fiche mis à l'échelle, puis relu.
        expect(state.calls).toEqual([['scaled', 0.5, 1], ['import', 8]])
        expect(out.slug).toBe(FICHE.slug)
        expect(out.name).toBe(FICHE.name)
        expect(out.addedAt).toBe(FICHE.addedAt)
        expect(out.importScaleApplied).toBe(true)
        expect(out.importScale).toBe(0.5)
        // Les octets DXF sont ceux du dessin MIS À L'ÉCHELLE.
        expect(new Uint8Array(out.dxfBytes)[0]).toBe(8)
        // Les constats sont ceux du RÉ-IMPORT (ils décrivent les nouveaux
        // octets — les constats d'unité & co se régénèrent), PLUS le constat
        // d'échelle : un dessin n'est jamais multiplié en silence.
        const codes = (out.findings || []).map((f) => f.code)
        expect(codes).toEqual(['import.scaleApplied'])
        expect(state.saved).toHaveLength(1)
    })

    it('la PREMIÈRE application garde les octets d’origine — la deuxième ne les écrase pas', async () => {
        const once = await scaleLocalFiche(FICHE, { scale: 0.5 })
        expect(new Uint8Array(once.origDxfBytes)).toEqual(new Uint8Array(FICHE.dxfBytes))
        const twice = await scaleLocalFiche(once, { scale: 0.5 })
        // Facteur composé : 0,5 × 0,5 ; l'original reste L'ORIGINAL.
        expect(twice.importScale).toBe(0.25)
        expect(new Uint8Array(twice.origDxfBytes)).toEqual(new Uint8Array(FICHE.dxfBytes))
    })

    it('un facteur de 1 ne touche à rien', async () => {
        const out = await scaleLocalFiche(FICHE, { scale: 1 })
        expect(out).toBe(FICHE)
        expect(state.calls).toEqual([])
    })
})

describe('E4-b — resetLocalFicheScale : retour BIT-IDENTIQUE', () => {
    it('re-importe les octets d’origine, TELS QUELS, et retire les drapeaux', async () => {
        const scaled = await scaleLocalFiche(FICHE, { scale: 0.5 })
        state.calls = []
        state.saved = []
        const back = await resetLocalFicheScale(scaled)
        // AUCUNE remise à l'échelle : l'import ordinaire des octets d'origine.
        expect(state.calls).toEqual([['import', 1]])
        expect(new Uint8Array(back.dxfBytes)).toEqual(new Uint8Array(FICHE.dxfBytes))
        expect(back.importScaleApplied).toBeUndefined()
        expect(back.importScale).toBeUndefined()
        expect(back.origDxfBytes).toBeUndefined()
        expect((back.findings || []).map((f) => f.code)).not.toContain('import.scaleApplied')
        expect(back.slug).toBe(FICHE.slug)
        expect(back.addedAt).toBe(FICHE.addedAt)
    })

    it('une fiche jamais mise à l’échelle reste telle quelle', async () => {
        const out = await resetLocalFicheScale(FICHE)
        expect(out).toBe(FICHE)
        expect(state.calls).toEqual([])
    })
})

describe('E4-c — explodeLocalFiche : N fiches NORMALES, le parent disparaît', () => {
    beforeEach(() => {
        state.partImports = [1, 2, 3].map((k) => ({
            parts: [part(k, 10 * k, 20 * k)],
            source_units: 4,
            entity_count: 1,
            warnings: [],
            findings: [],
        }))
    })

    it('une fiche par pièce, « nom (k/N) », au RANG du parent, ordre des pièces', async () => {
        const out = await explodeLocalFiche(FICHE)
        expect(out).toHaveLength(3)
        expect(out.map((r) => r.name)).toEqual([
            'logo (1/3).dxf', 'logo (2/3).dxf', 'logo (3/3).dxf',
        ])
        expect(out.every((r) => r.parts.length === 1)).toBe(true)
        expect(out.map((r) => r.explodedIndex)).toEqual([1, 2, 3])
        expect(out.every((r) => r.explodedFrom === 'logo.dxf')).toBe(true)
        expect(out.every((r) => r.explodedFromSlug === FICHE.slug)).toBe(true)
        // Au rang du parent : la première fille porte SON addedAt, les
        // suivantes une milliseconde de plus (miroir du serveur).
        const times = out.map((r) => Date.parse(r.addedAt))
        expect(times[0]).toBe(Date.parse(FICHE.addedAt))
        expect(times).toEqual([...times].sort((a, b) => a - b))
        // Les octets DXF d'une fille sont ceux de SA pièce.
        expect(new Uint8Array(out[0].dxfBytes)[0]).toBe(77)
        // Le parent est supprimé, chaque fille est stockée.
        expect(state.deleted).toEqual([FICHE.slug])
        expect(state.saved).toHaveLength(3)
        expect(out.every((r) => typeof r.previewSvg === 'string')).toBe(true)
    })

    it('l’échelle déjà appliquée et la provenance .job sont héritées', async () => {
        const scaled = await scaleLocalFiche(FICHE, { scale: 0.5 })
        state.calls = []
        const out = await explodeLocalFiche({
            ...scaled,
            sheetcam: { leadIn: 2 },
            sheetcamJobBytes: new Uint8Array([5, 5]).buffer,
        })
        expect(out.every((r) => r.importScaleApplied === true)).toBe(true)
        expect(out.every((r) => r.importScale === 0.5)).toBe(true)
        expect(out.every((r) => r.sheetcam?.leadIn === 2)).toBe(true)
        expect(out.every((r) => new Uint8Array(r.sheetcamJobBytes)[0] === 5)).toBe(true)
    })

    it('une pièce qui ne se referme pas seule n’est PAS perdue', async () => {
        state.partImports = [
            { parts: [], warnings: [], findings: [] },
            { parts: [part(2, 30, 40)], warnings: [], findings: [] },
            { parts: [part(3, 50, 60)], warnings: [], findings: [] },
        ]
        const out = await explodeLocalFiche(FICHE)
        expect(out).toHaveLength(3)
        expect(out[0].explodeFallback).toBe(true)
        expect(out[0].parts).toHaveLength(1)
        expect(out[0].parts[0].width).toBe(10)
        expect(out[1].explodeFallback).toBeUndefined()
    })

    it('une fiche à une seule pièce : rien à éclater, rien de supprimé', async () => {
        const out = await explodeLocalFiche({ ...FICHE, parts: [part(1, 10, 20)] })
        expect(out).toEqual([])
        expect(state.deleted).toEqual([])
        expect(state.saved).toEqual([])
    })
})
