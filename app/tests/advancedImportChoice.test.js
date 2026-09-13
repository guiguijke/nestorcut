/**
 * Verrous du lot E3 — l'interrupteur « Import avancé » porté par le PROJET et
 * la fenêtre de choix au dépôt (`docs/PLAN-ECLATEMENT-2026-09-12.md` §6.2).
 *
 * Ce qui est mesuré ici, et pourquoi aucune de ces mesures n'est vide :
 *
 *   1. **éteint ⇒ rien** : options neutres, aucune fenêtre, aucune lecture
 *      de plus — le contrôle négatif du lot ;
 *   2. **« Import automatique » ⇒ l'import ordinaire**, pas « l'import avancé
 *      avec des réglages à zéro » : la fiche produite est comparée CHAMP PAR
 *      CHAMP à celle du chemin ordinaire, et les appels wasm sont comptés ;
 *   3. **« Éclater » ⇒ la chaîne E1/E1-bis inchangée** : l'aperçu reprend les
 *      fichiers DÉJÀ lus, sans relecture ;
 *   4. **l'état est celui du projet** : posé au chargement, absent = éteint.
 *
 * Le wasm est mocké — la géométrie est verrouillée par les tests Rust.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
    imported: null,
    canonical: null,
    calls: [],
    saved: [],
}))

vi.mock('../composables/geometryClient', () => ({
    geoImportFile: vi.fn(async () => {
        state.calls.push('import')
        return state.imported
    }),
    geoCanonicalDxf: vi.fn(async () => {
        state.calls.push('canonical')
        return state.canonical
    }),
    geoCanonicalDxfScaled: vi.fn(async () => {
        state.calls.push('scaled')
        return state.canonical
    }),
    geoCanonicalDxfPart: vi.fn(async () => {
        state.calls.push('part')
        return state.canonical
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
    needsChoice,
    useAdvancedImport,
} from '../composables/advancedImport'

const part = (id, w, h) => ({
    coordinates: [[0, 0], [w, 0], [w, h], [0, h], [0, 0]],
    holes: [],
    width: w,
    height: h,
    handles: [`H${id}`],
})

function fakeFile(name) {
    const bytes = new Uint8Array([1, 2, 3])
    return { name, size: 3, arrayBuffer: async () => bytes.buffer }
}

/** Ce qui distingue deux fiches, hors ce qui dépend de l'horloge et du
 *  hasard : le nom, la géométrie, les handles, la provenance. */
const shape = (record) => ({
    name: record.name,
    parts: record.parts.map((p) => ({ coordinates: p.coordinates, holes: p.holes })),
    explodedFrom: record.explodedFrom ?? null,
    importScale: record.importScale ?? null,
    findings: (record.findings || []).map((f) => f.kind),
})

beforeEach(() => {
    state.imported = {
        parts: [part(1, 10, 20), part(2, 30, 40), part(3, 50, 60)],
        source_units: 4,
        entity_count: 3,
        warnings: [],
        findings: [],
    }
    state.canonical = new Uint8Array([9, 9, 9])
    state.calls = []
    state.saved = []
    useAdvancedImport().reset()
})

describe('E3 — l’interrupteur est une propriété du PROJET', () => {
    it('éteint par défaut : aucune fenêtre, options neutres', () => {
        expect(needsChoice()).toBe(false)
        expect(advancedImportOptions()).toEqual({ scale: 1, explode: false })
    })

    it('un projet SANS le champ le lit comme éteint', () => {
        const adv = useAdvancedImport()
        // Le document d'un projet d'avant le lot ne porte pas le champ :
        // `Boolean(undefined)` vaut faux, et la chaîne est celle d'avant.
        adv.setEnabled(Boolean(undefined), 'vieux-projet')
        expect(needsChoice()).toBe(false)
        expect(adv.state.enabled).toBe(false)
    })

    it('allumé, chaque dépose passe par la fenêtre', () => {
        const adv = useAdvancedImport()
        adv.setEnabled(true, 'p1')
        expect(needsChoice()).toBe(true)
        expect(adv.state.projectSlug).toBe('p1')
    })

    it('éteindre referme la fenêtre et vide la dépose en attente', async () => {
        const adv = useAdvancedImport()
        adv.setEnabled(true, 'p1')
        await adv.openChoice([fakeFile('a.dxf')], { projectSlug: 'p1' })
        expect(adv.choice.open).toBe(true)
        expect(adv.preview.pending).toHaveLength(1)
        adv.setEnabled(false, 'p1')
        expect(adv.choice.open).toBe(false)
        expect(adv.preview.pending).toHaveLength(0)
    })
})

describe('E3 — la fenêtre de choix', () => {
    it('lit chaque fichier UNE fois et ne crée AUCUNE fiche', async () => {
        const adv = useAdvancedImport()
        adv.setEnabled(true, 'p1')
        await adv.openChoice([fakeFile('a.dxf'), fakeFile('b.dxf')], { projectSlug: 'p1' })
        expect(adv.choice.open).toBe(true)
        expect(state.calls.filter((c) => c === 'import')).toHaveLength(2)
        expect(state.saved).toHaveLength(0)
        // Ce que la fenêtre affiche vient de la lecture, pas d'une promesse.
        expect(adv.preview.pending[0].parts).toHaveLength(3)
        expect(adv.preview.pending[0].extent).toEqual({ width: 50, height: 60 })
    })

    it('une dépose neuve repart de réglages NEUFS', async () => {
        const adv = useAdvancedImport()
        adv.setEnabled(true, 'p1')
        adv.setExplode(true)
        adv.setValue(0.5)
        await adv.openChoice([fakeFile('a.dxf')], { projectSlug: 'p1' })
        // Le choix vaut pour LE LOT DÉPOSÉ : la dépose précédente ne décide
        // pas de celle-ci.
        expect(adv.state.explode).toBe(false)
        expect(adv.state.mode).toBe('factor')
        expect(adv.state.value).toBe(1)
    })

    it('« Annuler » ne crée rien et ne garde rien', async () => {
        const adv = useAdvancedImport()
        adv.setEnabled(true, 'p1')
        await adv.openChoice([fakeFile('a.dxf')], { projectSlug: 'p1' })
        adv.cancelChoice()
        expect(adv.choice.open).toBe(false)
        expect(adv.preview.pending).toHaveLength(0)
        expect(state.saved).toHaveLength(0)
        // L'interrupteur, lui, reste allumé : annuler une dépose n'est pas
        // changer le réglage du projet.
        expect(adv.state.enabled).toBe(true)
    })

    it('« Éclater » passe la main à l’aperçu, SANS relire', async () => {
        const adv = useAdvancedImport()
        adv.setEnabled(true, 'p1')
        await adv.openChoice([fakeFile('a.dxf')], { projectSlug: 'p1' })
        const lectures = state.calls.filter((c) => c === 'import').length
        adv.chooseExplode()
        expect(adv.choice.open).toBe(false)
        // L'aperçu reprend les fichiers DÉJÀ lus.
        expect(adv.preview.pending).toHaveLength(1)
        expect(state.calls.filter((c) => c === 'import')).toHaveLength(lectures)
        expect(advancedImportOptions().explode).toBe(true)
    })

    it('« Import automatique » rend les fichiers et remet les réglages à neutre', async () => {
        const adv = useAdvancedImport()
        adv.setEnabled(true, 'p1')
        adv.setExplode(true)
        await adv.openChoice([fakeFile('a.dxf'), fakeFile('b.dxf')], { projectSlug: 'p1' })
        const { files, projectSlug } = adv.chooseAuto()
        expect(files.map((f) => f.name)).toEqual(['a.dxf', 'b.dxf'])
        expect(projectSlug).toBe('p1')
        expect(adv.choice.open).toBe(false)
        expect(adv.preview.pending).toHaveLength(0)
        expect(advancedImportOptions()).toEqual({ scale: 1, explode: false })
    })
})

describe('E3 — « Import automatique » EST l’import ordinaire', () => {
    it('même fiche, champ par champ, que l’interrupteur éteint', async () => {
        // Chemin ORDINAIRE (interrupteur éteint).
        const ordinaire = await importLocalFiles(fakeFile('logo.dxf'), 'p1', advancedImportOptions())
        const callsOrdinaire = [...state.calls]

        // Chemin FENÊTRE puis « Import automatique ».
        state.calls = []
        state.saved = []
        const adv = useAdvancedImport()
        adv.setEnabled(true, 'p1')
        await adv.openChoice([fakeFile('logo.dxf')], { projectSlug: 'p1' })
        const { files } = adv.chooseAuto()
        const auto = await importLocalFiles(files[0], 'p1', { scale: 1, explode: false })

        expect(ordinaire).toHaveLength(1)
        expect(auto).toHaveLength(1)
        expect(shape(auto[0])).toEqual(shape(ordinaire[0]))
        // Une seule fiche : le dessin multi-pièces reste entier.
        expect(auto[0].parts).toHaveLength(3)
        expect(auto[0].explodedFrom).toBeUndefined()
        // Les appels wasm de l'IMPORT sont les mêmes ; la fenêtre en ajoute
        // UN, sa lecture — c'est le prix annoncé de l'interrupteur allumé, et
        // il ne se paie que là.
        expect(state.calls.filter((c) => c === 'import')).toHaveLength(
            callsOrdinaire.filter((c) => c === 'import').length + 1,
        )
    })

    it('CONTRÔLE NÉGATIF : « Éclater » ne rend PAS la même chose', async () => {
        // Sans ce contrôle, le test ci-dessus passerait sur une fenêtre qui
        // n'aurait aucun effet.
        const adv = useAdvancedImport()
        adv.setEnabled(true, 'p1')
        await adv.openChoice([fakeFile('logo.dxf')], { projectSlug: 'p1' })
        adv.chooseExplode()
        const fiches = await importLocalFiles(
            fakeFile('logo.dxf'), 'p1', advancedImportOptions(),
        )
        expect(fiches.length).toBeGreaterThan(1)
        expect(fiches[0].explodedFrom).toBe('logo.dxf')
    })
})
