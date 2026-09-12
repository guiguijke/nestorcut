/**
 * Verrous du lot E1 — « Import avancé » : l'état du panneau, la résolution
 * de l'échelle, et la chaîne d'import (échelle → import → éclatement).
 *
 * Ce qui est mesuré ici : l'option ÉTEINTE ne change rien (aucun appel wasm
 * de plus, une seule fiche, nom intact), et l'option allumée produit une
 * fiche NORMALE par pièce, nommée « (k/N) », avec la provenance en champs
 * additifs. Le wasm est mocké — la géométrie elle-même est verrouillée par
 * les tests Rust (nest-import/tests/advanced_import.rs).
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
        state.calls.push(['scaled', factor])
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
    }
})

import { importLocalFiles } from '../composables/localImport'
import {
    advancedImportOptions,
    resolveScale,
    useAdvancedImport,
} from '../composables/advancedImport'
import { translate } from '../utils/i18n'

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
    useAdvancedImport().reset()
})

describe('E1 — état du panneau « Import avancé »', () => {
    it('éteint par défaut : options neutres', () => {
        expect(advancedImportOptions()).toEqual({ scale: 1, explode: false })
    })

    it('panneau fermé = réglage inerte, même coché', () => {
        const adv = useAdvancedImport()
        adv.setExplode(true)
        adv.setValue(0.5)
        // `open` est faux : rien ne s'applique (le réglage est celui de la
        // dépose, pas une préférence cachée).
        expect(advancedImportOptions()).toEqual({ scale: 1, explode: false })
    })

    it('facteur et éclatement voyagent quand le panneau est ouvert', () => {
        const adv = useAdvancedImport()
        adv.toggleOpen()
        adv.setExplode(true)
        adv.setValue(0.5)
        expect(advancedImportOptions()).toEqual({ scale: 0.5, explode: true })
    })

    it('un facteur absurde ne multiplie rien', () => {
        const adv = useAdvancedImport()
        adv.toggleOpen()
        for (const bad of [0, -2, Number.NaN]) {
            adv.setValue(bad)
            expect(advancedImportOptions().scale).toBe(1)
        }
    })

    it('changer de mode remet la valeur à neutre', () => {
        const adv = useAdvancedImport()
        adv.toggleOpen()
        adv.setValue(2)
        adv.setMode('width')
        expect(adv.state.value).toBe(0)
        adv.setValue(1000)
        expect(advancedImportOptions()).toEqual({
            scale: 1, explode: false, scaleTarget: { mode: 'width', mm: 1000 },
        })
    })
})

describe('E1 — résolution de l’échelle par cible', () => {
    it('largeur cible : facteur = cible / étendue mesurée', () => {
        // Le logo du collègue : 1612,6 mm de large, cible 1000 mm.
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

describe('E1 — chaîne d’import', () => {
    it('options éteintes : une fiche, nom intact, AUCUN appel de plus', async () => {
        const out = await importLocalFiles(fakeFile('plaque.dxf'), 'p1')
        expect(out).toHaveLength(1)
        expect(out[0].name).toBe('plaque.dxf')
        expect(out[0].parts).toHaveLength(3)
        expect(out[0].importScale).toBeUndefined()
        expect(out[0].explodedFrom).toBeUndefined()
        // Exactement l'import + le canonique d'avant le lot E1.
        expect(state.calls).toEqual([['import', 1], ['canonical']])
    })

    it('échelle seule : le DXF mis à l’échelle est celui qu’on importe', async () => {
        const out = await importLocalFiles(fakeFile('plaque.dxf'), 'p1', { scale: 0.5 })
        expect(state.calls[0]).toEqual(['scaled', 0.5])
        // L'import lit les octets MIS À L'ÉCHELLE (8), pas la source (1).
        expect(state.calls[1]).toEqual(['import', 8])
        expect(out).toHaveLength(1)
        expect(out[0].importScale).toBe(0.5)
    })

    it('cible : une lecture de mesure, puis le facteur déduit', async () => {
        // Étendue des trois pièces mockées : 50 mm de large (pièce 3).
        const out = await importLocalFiles(fakeFile('plaque.dxf'), 'p1', {
            scaleTarget: { mode: 'width', mm: 25 },
        })
        expect(state.calls[0]).toEqual(['import', 1])      // mesure
        expect(state.calls[1]).toEqual(['scaled', 0.5])    // 25 / 50
        expect(out[0].importScale).toBe(0.5)
    })

    it('éclatement : une fiche NORMALE par pièce, nommée (k/N)', async () => {
        state.partImports = [1, 2, 3].map((k) => ({
            parts: [part(k, 10 * k, 20 * k)],
            source_units: 4,
            entity_count: 1,
            warnings: [],
            findings: [],
        }))
        const out = await importLocalFiles(fakeFile('logo.dxf'), 'p1', { explode: true })
        expect(out).toHaveLength(3)
        expect(out.map((r) => r.name)).toEqual([
            'logo (1/3).dxf', 'logo (2/3).dxf', 'logo (3/3).dxf',
        ])
        // Chaque fiche porte UNE pièce, sa provenance, et des slugs distincts.
        expect(out.map((r) => r.parts.length)).toEqual([1, 1, 1])
        expect(out.map((r) => r.explodedIndex)).toEqual([1, 2, 3])
        expect(new Set(out.map((r) => r.explodedFrom))).toEqual(new Set(['logo.dxf']))
        expect(new Set(out.map((r) => r.slug)).size).toBe(3)
        // Les octets DXF de la fiche sont ceux de SA pièce.
        expect(new Uint8Array(out[0].dxfBytes)[0]).toBe(77)
        // Et chaque fiche est stockée (fiche normale : quantité, aperçu…).
        expect(state.saved).toHaveLength(3)
        expect(out.every((r) => typeof r.previewSvg === 'string')).toBe(true)
    })

    it('éclatement d’un dessin à une seule pièce : rien à éclater', async () => {
        state.imported = { ...state.imported, parts: [part(1, 10, 20)] }
        const out = await importLocalFiles(fakeFile('seule.dxf'), 'p1', { explode: true })
        expect(out).toHaveLength(1)
        expect(out[0].name).toBe('seule.dxf')
        expect(out[0].explodedIndex).toBeUndefined()
    })

    it('une pièce qui ne se referme pas seule n’est PAS perdue', async () => {
        // Le sous-ensemble rend 0 pièce (deux pièces qui partagent une arête).
        state.partImports = [
            { parts: [], warnings: [], findings: [] },
            { parts: [part(2, 30, 40)], warnings: [], findings: [] },
            { parts: [part(3, 50, 60)], warnings: [], findings: [] },
        ]
        const out = await importLocalFiles(fakeFile('logo.dxf'), 'p1', { explode: true })
        expect(out).toHaveLength(3)
        expect(out[0].explodeFallback).toBe(true)
        expect(out[0].parts).toHaveLength(1)
        expect(out[0].parts[0].width).toBe(10)
        expect(out[1].explodeFallback).toBeUndefined()
    })

    it('échelle ET éclatement se composent dans cet ordre', async () => {
        state.partImports = [1, 2, 3].map((k) => ({
            parts: [part(k, 5 * k, 6 * k)], warnings: [], findings: [],
        }))
        const out = await importLocalFiles(fakeFile('logo.dxf'), 'p1', {
            scale: 0.5, explode: true,
        })
        expect(state.calls[0]).toEqual(['scaled', 0.5])
        expect(state.calls[1]).toEqual(['import', 8])
        expect(state.calls[2]).toEqual(['canonical'])
        expect(out).toHaveLength(3)
        expect(out.every((r) => r.importScale === 0.5)).toBe(true)
    })
})

describe('E1 — libellés', () => {
    it('les clés du panneau existent en FR et EN', () => {
        const keys = [
            'advancedImport.title', 'advancedImport.explode',
            'advancedImport.explodeHint', 'advancedImport.scale',
            'advancedImport.mode.factor', 'advancedImport.mode.width',
            'advancedImport.mode.height', 'advancedImport.scaleHint',
            'import.microVoidsFilled', 'import.spursRemoved',
        ]
        for (const locale of ['fr', 'en']) {
            for (const k of keys) {
                const v = translate(k, locale)
                expect(v, `${k} (${locale})`).not.toBe(k)
                expect(v.length).toBeGreaterThan(1)
            }
        }
    })
})
