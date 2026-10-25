import { describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

const state = vi.hoisted(() => ({ db: null }))
vi.mock('~~/server/db/mongo', () => ({
    connectDB: async () => state.db,
}))

import { getResults, RESULTS_LIMIT } from '~~/server/features/results/resultcontroller'

// Mini collection qui APPLIQUE réellement { projection, sort, limit } comme le
// pilote Mongo (inclusion, chemins pointés à travers les tableaux). Avec
// `honorOptions = false` elle rend les documents entiers : la comparaison des
// deux sorties prouve que la projection ne retire aucun champ lu par le mapping.
function project(doc, keys) {
    const out = {}
    for (const key of keys) {
        const [head, ...rest] = key.split('.')
        if (!(head in doc)) continue
        if (!rest.length) {
            out[head] = doc[head]
        } else if (Array.isArray(doc[head])) {
            out[head] ??= doc[head].map(() => ({}))
            doc[head].forEach((el, i) => {
                if (el && rest[0] in el) out[head][i][rest[0]] = el[rest[0]]
            })
        }
    }
    return out
}

function dbOver(docs, { honorOptions }) {
    const seen = []
    return {
        seen,
        collection() {
            return {
                find(filter, options = {}) {
                    seen.push(options)
                    let rows = docs.filter((d) =>
                        Object.entries(filter).every(([k, v]) => d[k] === v))
                    // Référence « document entier » : même ordre (createdAt desc).
                    rows = [...rows].sort((a, b) => b.createdAt - a.createdAt)
                    if (honorOptions) {
                        if (options.limit) rows = rows.slice(0, options.limit)
                        if (options.projection) rows = rows.map((d) => project(d, Object.keys(options.projection)))
                    }
                    return { toArray: async () => rows }
                },
            }
        },
    }
}

// Document « plein » : chaque champ lu par le mapping + du lourd que l'app ne
// lit pas (instance en clair, params, géométrie des alternatives).
const fullJob = (i, extra = {}) => ({
    _id: `id${i}`,
    slug: `job-${i}`,
    ownerId: 'u1',
    projectSlug: 'p1',
    status: 'done',
    createdAt: new Date(2026, 9, 1, 0, i),
    startAt: new Date(2026, 9, 1, 0, i),
    finishedAt: new Date(2026, 9, 1, 1, i),
    update_ts: new Date(2026, 9, 1, 1, i),
    layoutCount: 2,
    localOnly: false,
    purgedAt: new Date(2026, 9, 2),
    placed: 10,
    requested: 12,
    discardedAlternatives: [{ why: 'overlap' }],
    information: 'info',
    unfit: { reason: 'partial' },
    progress: { stage: 's', done: 1, total: 2 },
    liveLayout: { sheets: [[1, 2]] },
    itemMap: { 0: { slug: 'a', part: 0 } },
    compute: { vcores: 4 },
    dxf_files: [`job-${i}_1.dxf`, `job-${i}_2.dxf`],
    svg_files: [`job-${i}_1.svg`],
    alternatives: [
        {
            alt_id: 'a', seed: 123n, density: 0.8, usedSheetShare: 0.5, strategy: 'compact',
            offcut: { width: 1, height: 2, area: 2 }, layoutCount: 2,
            report: { totals: { placed: 10 } },
            svg_files: ['a.svg'], dxf_files: ['a.dxf'],
            layouts: [{ placed_items: new Array(50).fill({}) }], // lourd, non lu
        },
    ],
    localPayload: { instance: { items: new Array(500).fill(1) } }, // lourd, non lu
    params: { sheets: [] },
    files: [{ slug: 'f' }],
    charge: { type: 'free' },
    ...extra,
})

describe('getResults — projection, borne et index', () => {
    it('la projection ne retire aucun champ lu : sortie identique au document entier', async () => {
        const docs = [fullJob(1), fullJob(2, { status: 'error', error: 'boom' }), fullJob(3, { status: 'processing' })]
        state.db = dbOver(docs, { honorOptions: false })
        const full = await getResults('u1')
        state.db = dbOver(docs, { honorOptions: true })
        const projected = await getResults('u1')
        expect(projected).toEqual(full)
        expect(projected.items).toHaveLength(3)
        // Sanity : le mapping sort bien les champs profonds (pas un test vide).
        const done = projected.items.find((i) => i.slug === 'job-1')
        expect(done.alternatives[0]).toMatchObject({ altId: 'a', strategy: 'compact', svgs: ['/api/files/result/svg/a.svg'] })
        expect(done.zipDownloadUrl).toBe('/api/files/result/zip/job-1')
    })

    it('ne rapatrie ni localPayload ni params/files/charge ni la géométrie des alternatives', async () => {
        state.db = dbOver([fullJob(1)], { honorOptions: false })
        await getResults('u1')
        const { projection } = state.db.seen[0]
        expect(projection).toBeTruthy()
        for (const heavy of ['localPayload', 'params', 'files', 'charge', 'engineConfig', 'alternatives.layouts']) {
            expect(projection[heavy]).toBeUndefined()
        }
        expect(projection.alternatives).toBeUndefined() // pas de $-projection du tableau entier
    })

    it('tri createdAt desc + limite RESULTS_LIMIT poussés au serveur Mongo', async () => {
        const docs = Array.from({ length: RESULTS_LIMIT + 25 }, (_, i) => fullJob(i, { slug: `j${i}` }))
        state.db = dbOver(docs, { honorOptions: true })
        const res = await getResults('u1')
        expect(state.db.seen[0]).toMatchObject({ sort: { createdAt: -1 }, limit: RESULTS_LIMIT })
        expect(res.items).toHaveLength(RESULTS_LIMIT)
        // Les plus récents d'abord ; les 25 plus anciens sont ceux écartés.
        expect(res.items[0].slug).toBe(`j${RESULTS_LIMIT + 24}`)
        expect(res.items.map((i) => i.slug)).not.toContain('j0')
    })
})
