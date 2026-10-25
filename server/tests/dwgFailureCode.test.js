import { beforeEach, describe, expect, it, vi } from 'vitest'

// Lot A-15 — la cause stable d'un échec DWG (`importErrorCode`) doit SORTIR
// du serveur : sans ce champ, la fiche n'affiche que « Échec de l'import ».

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

describe('cause d\'échec DWG côté serveur (A-15)', () => {
    it('expose le code de cause d\'un DWG en erreur', async () => {
        state.db = dbWith([
            {
                slug: 'd1',
                name: 'plan.dwg',
                processingStatus: 'error',
                importErrorCode: 'dwg_version_unsupported',
            },
        ])
        const { files } = await getProjectFiles(DOMAINS.bin, 'u1', 'p1')
        expect(files[0].processingStatus).toBe('error')
        expect(files[0].importErrorCode).toBe('dwg_version_unsupported')
    })

    it('un fichier d\'avant le champ rend importErrorCode null (repli)', async () => {
        state.db = dbWith([
            { slug: 'd2', name: 'vieux.dwg', processingStatus: 'error', processingError: 'boom' },
        ])
        const { files } = await getProjectFiles(DOMAINS.bin, 'u1', 'p1')
        expect(files[0].importErrorCode).toBeNull()
        expect(files[0].processingError).toBeUndefined()
    })
})
