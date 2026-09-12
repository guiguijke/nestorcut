import { beforeEach, describe, expect, it, vi } from 'vitest'

// Lot 2c — les constats d'import et le refus de la garde (lot 2a) doivent
// SORTIR du serveur : `importReport.findings` et `importRefusal` sont des
// champs additifs du document fichier, et un fichier GARÉ par la garde ne
// doit plus s'afficher « en cours » pour toujours (constat du vérificateur,
// 12/09 : aucun code de `app/` ni de `server/` ne lisait ces champs).

const state = vi.hoisted(() => ({ db: null }))

vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))

vi.mock('~~/server/utils/vault', () => ({
    requireFileAccess: vi.fn(async () => {}),
    resolvePolygonParts: vi.fn(async (_userId, file) => file.polygonParts ?? []),
}))

vi.mock('~~/server/utils/colors', () => ({
    resolvePartColor: vi.fn(() => '#2563EB'),
}))

import { DOMAINS } from '~~/server/core/domains'
import { getProjectFiles } from '~~/server/core/project/service'
import { fakeDb } from './helpers/fakeMongo'

const PROJECT = { slug: 'p1', name: 'Projet', ownerId: 'u1' }

function dbWith(files) {
    return fakeDb({
        projects: [PROJECT],
        user_dxf_files: files.map((f) => ({
            ownerId: 'u1',
            projectSlug: 'p1',
            uploadAt: new Date(),
            ...f,
        })),
    })
}

beforeEach(() => {
    state.db = null
})

describe('constats d\'import côté serveur (lot 2c)', () => {
    it('porte les constats jusqu\'à la forme UI', async () => {
        const findings = [
            { code: 'import.entitiesSkipped', level: 'attention', count: 27, types: ['ACAD_PROXY_ENTITY'] },
            { code: 'import.contoursDropped', level: 'attention', count: 9 },
        ]
        state.db = dbWith([
            {
                slug: 'f1',
                name: 'plaque.dxf',
                processingStatus: 'completed',
                svgFileSlug: 's1',
                polygonParts: [{ width: 10.04, height: 5.96 }],
                importReport: { findings },
            },
        ])
        const { files } = await getProjectFiles(DOMAINS.bin, 'u1', 'p1')
        expect(files[0].findings).toEqual(findings)
        expect(files[0].processingStatus).toBe('done')
    })

    it('rend une liste vide (jamais undefined) pour les fichiers d\'avant le lot', async () => {
        state.db = dbWith([
            { slug: 'f2', name: 'vieux.dxf', processingStatus: 'completed', svgFileSlug: 's2', polygonParts: [] },
        ])
        const { files } = await getProjectFiles(DOMAINS.bin, 'u1', 'p1')
        expect(files[0].findings).toEqual([])
        expect(files[0].importRefusal).toBeNull()
    })

    it('un fichier garé par la garde d\'import est en ERREUR, avec sa cause', async () => {
        const importRefusal = {
            reason: 'entities',
            entityCount: 12345,
            maxEntities: 10000,
        }
        state.db = dbWith([
            {
                slug: 'f3',
                name: 'trop-gros.dxf',
                // Le worker a garé le fichier : il reste « pending » en base
                // et aucun worker ne le reprendra.
                processingStatus: 'pending',
                worker_tag: '1k_entity_count',
                importRefusal,
            },
        ])
        const { files } = await getProjectFiles(DOMAINS.bin, 'u1', 'p1')
        expect(files[0].processingStatus).toBe('error')
        expect(files[0].importRefusal).toEqual(importRefusal)
    })

    it('un fichier réellement en cours reste « en cours »', async () => {
        state.db = dbWith([
            { slug: 'f4', name: 'en-cours.dxf', processingStatus: 'processing' },
        ])
        const { files } = await getProjectFiles(DOMAINS.bin, 'u1', 'p1')
        expect(files[0].processingStatus).toBe('in-progress')
    })
})
