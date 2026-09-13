/**
 * Verrous du lot J4, premier maillon : le `.job` SheetCam est ACCEPTÉ à la
 * dépose d'un projet « cet appareil », et il est ROUTÉ vers son lecteur, pas
 * vers le wasm géométrie.
 *
 * Ce qui est mesuré ici :
 *
 *  1. un `.job` réel (fixture anonymisée) ne provoque AUCUN appel au wasm
 *     (`geoImportFile` / `geoCanonicalDxf`), et rend un refus à clé i18n qui
 *     nomme les dessins manquants — contrôle négatif : un DXF, lui, part bien
 *     au wasm et crée sa fiche ;
 *  2. la détection est la SIGNATURE, pas l'extension (piège #31) : un `.job`
 *     renommé `.dxf` est reconnu, un DXF nommé `.job` repart au wasm ;
 *  3. `readSheetCamJobFile` rend les bonnes quantités sur la fixture
 *     `x4-reference.job` (5 exemplaires : 1 hôte + 4 copies d'un même
 *     dessin), avec la tôle, le kerf et l'opération de coupe ;
 *  4. les clés i18n neuves existent en EN ET en FR.
 *
 * Le wasm est mocké : la géométrie est verrouillée ailleurs (goldens Rust).
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
    imported: null,
    canonical: null,
    saved: [],
}))

vi.mock('../composables/geometryClient', () => ({
    geoImportFile: vi.fn(async () => state.imported),
    geoCanonicalDxf: vi.fn(async () => state.canonical),
    geoCanonicalDxfScaled: vi.fn(async () => new Uint8Array([0])),
    geoCanonicalDxfPart: vi.fn(async () => new Uint8Array([0])),
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

import { geoImportFile } from '../composables/geometryClient'
import {
    importLocalFiles, readSheetCamJob, readSheetCamJobFile,
} from '../composables/localImport'

const JOB_BYTES = new Uint8Array(readFileSync(
    fileURLToPath(new URL('./fixtures/sheetcam/x4-reference.job', import.meta.url)),
))

// Un « DXF » de contrôle : le contenu n'a pas besoin d'être un vrai DXF, le
// wasm est mocké — il doit seulement ne PAS porter la signature `.job`.
const DXF_BYTES = new Uint8Array([...'0\r\nSECTION\r\n'].map((c) => c.charCodeAt(0)))

function fakeFile(name, bytes) {
    return {
        name,
        size: bytes.length,
        arrayBuffer: async () => bytes.buffer.slice(
            bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
        ),
    }
}

beforeEach(() => {
    state.imported = {
        parts: [{
            coordinates: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
            holes: [],
            width: 10,
            height: 10,
            handles: ['A1'],
        }],
        source_units: 4,
        entity_count: 1,
        warnings: [],
    }
    state.canonical = new Uint8Array([9, 9, 9])
    state.saved = []
    geoImportFile.mockClear()
})

describe('dépôt d\'un `.job` SheetCam (lot J4)', () => {
    it('un `.job` n\'est JAMAIS envoyé au wasm, et le refus nomme ses dessins', async () => {
        await expect(importLocalFiles(fakeFile('x4-reference.job', JOB_BYTES), 'p1'))
            .rejects.toMatchObject({ message: 'jobImport.dropDrawings' })
        expect(geoImportFile).not.toHaveBeenCalled()
        expect(state.saved).toHaveLength(0)
    })

    it('le refus porte les noms de dessins et leurs quantités (piège #24)', async () => {
        const err = await importLocalFiles(fakeFile('x4-reference.job', JOB_BYTES), 'p1')
            .catch((e) => e)
        expect(err.params.n).toBe(2)
        // Les chemins absolus du disque de l'utilisateur sont réduits au nom
        // de fichier (règle 9 de l'étude) : rien de `C:\jobs\…` à l'écran.
        expect(err.params.names).toContain('Piece_Trou.DXF (× 1)')
        expect(err.params.names).toContain('Piece_Fillx4.DXF (× 4)')
        expect(err.params.names).not.toContain('C:\\')
    })

    it('contrôle négatif : un DXF part bien au wasm et crée sa fiche', async () => {
        const records = await importLocalFiles(fakeFile('carre.dxf', DXF_BYTES), 'p1')
        expect(geoImportFile).toHaveBeenCalled()
        expect(records).toHaveLength(1)
        expect(state.saved).toHaveLength(1)
    })

    // Piège #31 : la vérité est la SIGNATURE de contenu, jamais l'extension.
    it('un `.job` renommé `.dxf` est quand même reconnu comme `.job`', async () => {
        await expect(importLocalFiles(fakeFile('deguise.dxf', JOB_BYTES), 'p1'))
            .rejects.toMatchObject({ message: 'jobImport.dropDrawings' })
        expect(geoImportFile).not.toHaveBeenCalled()
    })

    it('un DXF nommé `.job` repart dans la chaîne DXF', async () => {
        await importLocalFiles(fakeFile('menteur.job', DXF_BYTES), 'p1')
        expect(geoImportFile).toHaveBeenCalled()
        expect(state.saved).toHaveLength(1)
    })

    it('un fichier illisible comme `.job` remonte le code i18n du lecteur', async () => {
        // Signature présente (le fichier COMMENCE par `Config=`, porte
        // `[Misc]` et un `FileVersion=`), version inconnue : le refus est
        // celui du lecteur J1, dont le `code` EST la clé i18n — pas un
        // « erreur d'analyse » générique du wasm.
        const text = 'Config=\r\n[Misc]\r\nFileVersion=9999\r\n[BinaryDataStart]\u0000'
        const bytes = new Uint8Array([...text].map((c) => c.charCodeAt(0)))
        const err = await importLocalFiles(fakeFile('vieux.job', bytes), 'p1').catch((e) => e)
        expect(err.code).toBe('sheetcamJob.unsupportedVersion')
        expect(err.message).toBe('sheetcamJob.unsupportedVersion')
        expect(err.params.version).toBe('9999')
        expect(geoImportFile).not.toHaveBeenCalled()
    })
})

describe('readSheetCamJobFile (lot J4)', () => {
    it('quantités par dessin : 1 hôte + 4 copies du même dessin', async () => {
        const read = await readSheetCamJobFile(fakeFile('x4-reference.job', JOB_BYTES))
        const byName = Object.fromEntries(read.drawings.map((d) => [d.name, d.quantity]))
        expect(byName).toEqual({ 'Piece_Trou.DXF': 1, 'Piece_Fillx4.DXF': 4 })
        // Total = `Count` du fichier : 5 exemplaires à imbriquer.
        expect(read.drawings.reduce((a, d) => a + d.quantity, 0)).toBe(5)
        expect(read.job.count).toBe(5)
    })

    it('rangs des sections `Part N`, copies comprises, dans l\'ordre du fichier', () => {
        const read = readSheetCamJob(JOB_BYTES)
        const byName = Object.fromEntries(read.drawings.map((d) => [d.name, d.parts]))
        expect(byName['Piece_Trou.DXF']).toEqual([0])
        expect(byName['Piece_Fillx4.DXF']).toEqual([1, 2, 3, 4])
    })

    // La tôle est `[Work]` (1000 × 1250 sur la fixture), PAS `[Table]`
    // (1300 × 1300, la course de la machine) : deux sections de mêmes clés
    // X1/X2/Y1/Y2 dans le même fichier.
    it('tôle et kerf lus dans le fichier (réglages pré-remplis)', () => {
        const read = readSheetCamJob(JOB_BYTES)
        expect(read.sheet).toEqual({ width: 1000, height: 1250 })
        expect(read.kerfWidth).toBe(1.5)
    })

    it('opération de coupe : amorce et position de départ de l\'ORIGINAL', () => {
        const read = readSheetCamJob(JOB_BYTES)
        for (const drawing of read.drawings) {
            expect(drawing.leadIn).toBe(5)
            expect(drawing.startPosition).toBe(0)
            expect(drawing.operations.length).toBeGreaterThan(0)
        }
    })

    it('un fichier qui n\'est pas un `.job` lève le code i18n du lecteur', () => {
        expect(() => readSheetCamJob(DXF_BYTES)).toThrowError(/sheetcamJob\./)
    })
})

// ---------------------------------------------------------------------------
// Parité EN/FR des clés neuves. `i18nDict.test.js` vérifie l'unicité et la
// parité GLOBALES ; ici on vérifie que ces clés-là existent bien des deux
// côtés — une clé oubliée en FR afficherait l'anglais à un atelier français.
// ---------------------------------------------------------------------------

const src = readFileSync(fileURLToPath(new URL('../utils/i18n.js', import.meta.url)), 'utf8')
const enBlock = src.split('    en: {')[1].split('    fr: {')[0]
const frBlock = src.split('    fr: {')[1]

const NEW_KEYS = [
    'jobImport.title', 'jobImport.recognised', 'jobImport.dropDrawings',
    'jobImport.missingDrawing', 'jobImport.drawingQuantity',
    'jobImport.sheetFromJob', 'jobImport.kerfFromJob', 'jobImport.spacingFromJob',
    'jobImport.prefilled', 'jobImport.leadInLength', 'jobImport.pierceMargin',
    'jobImport.startCorner', 'jobImport.reserveRefused', 'jobImport.holeDropped',
    'jobImport.holesDropped', 'jobImport.download', 'jobImport.downloadHint',
    'jobImport.downloadJob', 'jobImport.holeTooSmallForLeadIn',
    'sheetcamJob.notBytes', 'sheetcamJob.noBinaryBlock',
    'sheetcamJob.unsupportedVersion', 'sheetcamJob.noParts',
    'sheetcamJob.noPlacements', 'sheetcamJob.unknownPart', 'sheetcamJob.badNumber',
    'sheetcamNest.emptyDrawing', 'sheetcamNest.nestingCycle',
    'sheetcamNest.noSheets', 'sheetcamNest.emptySheet', 'sheetcamNest.missingCentre',
    'sheetcamNest.drawingNotInJob',
    'sheetcamReserve.ringTooSmall', 'sheetcamReserve.nothingToReserve',
    'sheetcamReserve.flatAppendix', 'sheetcamReserve.vertexInsideDisc',
    'sheetcamReserve.reserveCrossesContour', 'sheetcamReserve.holeTooSmall',
    'sheetcamReserve.mouthInsideDisc',
]

describe('libellés du lot J4 : EN et FR', () => {
    it('chaque clé neuve existe dans les deux blocs', () => {
        const missing = []
        for (const key of NEW_KEYS) {
            if (!enBlock.includes(`'${key}':`)) missing.push(`EN ${key}`)
            if (!frBlock.includes(`'${key}':`)) missing.push(`FR ${key}`)
        }
        expect(missing).toEqual([])
    })

    // Le balayage couvre `shared/` ET les composables qui lèvent un
    // `SheetCamJobError` (la sortie `.job` en lève un code de plus,
    // `sheetcamNest.drawingNotInJob`). Un fichier absent est ignoré : ces
    // modules appartiennent à des chantiers parallèles, le verrou ne doit pas
    // rougir parce que l'un d'eux n'est pas encore là.
    it('chaque code d\'erreur levé par le code `.job` a son libellé', () => {
        const files = [
            '../../shared/sheetcamJob.js',
            '../../shared/sheetcamNest.js',
            '../../shared/sheetcamReserve.js',
            '../composables/sheetcamJobResult.js',
        ].map((rel) => fileURLToPath(new URL(rel, import.meta.url)))
        const scanned = files.filter((f) => existsSync(f))
        // Contrôle négatif d'un verrou qui pourrait être vide : au moins les
        // trois modules `shared/` doivent avoir été lus.
        expect(scanned.length).toBeGreaterThanOrEqual(3)
        const src2 = scanned.map((f) => readFileSync(f, 'utf8')).join('\n')
        const codes = [...src2.matchAll(/SheetCamJobError\('([^']+)'/g)].map((m) => m[1])
        const reasons = [...src2.matchAll(/reason: '([a-zA-Z]+)'/g)]
            .map((m) => `sheetcamReserve.${m[1]}`)
        expect(codes.length).toBeGreaterThan(0)
        const orphans = [...new Set([...codes, ...reasons])]
            .filter((k) => !enBlock.includes(`'${k}':`) || !frBlock.includes(`'${k}':`))
        expect(orphans).toEqual([])
    })

    // Un message qui refuse d'écrire le `.job` doit DIRE quel dessin manque et
    // sur quelle tôle : sans ses deux paramètres, l'atelier lit un refus sans
    // rien à corriger.
    it('drawingNotInJob nomme le dessin et la tôle, EN et FR', () => {
        for (const block of [enBlock, frBlock]) {
            const line = block.split('\n').find((l) => l.includes("'sheetcamNest.drawingNotInJob':"))
            expect(line).toBeTruthy()
            expect(line).toContain('{drawing}')
            expect(line).toContain('{sheet}')
        }
    })

    // Piège #20 : une chaîne FR contenant une apostrophe droite doit être
    // entre GUILLEMETS DOUBLES, sinon PARSE_ERROR au build.
    it('aucune chaîne FR neuve ne casse le build sur une apostrophe', () => {
        const bad = []
        for (const line of frBlock.split('\n')) {
            const m = line.match(/^\s*'([^']+)':\s*'(.*)',\s*$/)
            if (m && NEW_KEYS.includes(m[1]) && m[2].includes("'")) bad.push(m[1])
        }
        expect(bad).toEqual([])
    })
})
