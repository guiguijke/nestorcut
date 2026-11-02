import { beforeEach, describe, expect, it, vi } from 'vitest'
import './helpers/h3Shims'

// O2 (02/11) : verrou SERVEUR de la route DXF d'un résultat. Un Free ne
// reçoit que les tôles numérotées 1..2 de chaque alternative (numéro lu dans
// le NOM, d4) ; démo (d3), flag K (d2) et payant reçoivent tout. Le resolver
// du plafond est simulé (comportement verrouillé par downloadSheetCap.test.js).

const state = vi.hoisted(() => ({ job: null, cap: 2, findOne: null }))

vi.mock('~~/server/db/mongo', () => {
    state.findOne = vi.fn(async () => state.job)
    return {
        connectDB: async () => ({ collection: () => ({ findOne: state.findOne }) }),
        getDxfResultBucket: async () => ({ bucket: 'result-dxf' }),
    }
})
vi.mock('~~/server/utils/files', () => ({
    sendOwnedBucketFile: vi.fn(async () => 'STREAM'),
}))
vi.mock('~~/server/tracking/add', () => ({ trackEvent: vi.fn() }))
vi.mock('~~/server/utils/entitlement', () => ({
    downloadSheetCapForUser: vi.fn(async () => state.cap),
    isWithinFreeDownloadCap: (n) => Number.isSafeInteger(n) && n >= 1 && n <= 2,
}))

import dxfRoute from '~~/server/api/files/result/dxf/[file].get.js'
import { sendOwnedBucketFile } from '~~/server/utils/files'
import { trackEvent } from '~~/server/tracking/add'
import { downloadSheetCapForUser } from '~~/server/utils/entitlement'
import {
    RESULT_DXF_JOB_SLUG_RE,
    filterDownloadableNames,
    isDemoJob,
    jobSlugFromResultFile,
    sheetDownloadLockedError,
} from '~~/server/utils/sheetDownloadGate'

const ev = (file, { auth = { userId: 'u1' } } = {}) => ({ context: auth ? { auth } : {}, _params: { file } })

beforeEach(() => {
    state.job = { projectSlug: 'p1' }
    state.cap = 2
    state.findOne.mockClear()
    vi.mocked(sendOwnedBucketFile).mockClear()
    vi.mocked(trackEvent).mockClear()
    vi.mocked(downloadSheetCapForUser).mockClear()
})

const lockedCalls = () =>
    vi.mocked(trackEvent).mock.calls.filter(([, action]) => action === 'download_nested_result_dxf_locked')

describe('GET /api/files/result/dxf/[file] — verrou des tôles (O2)', () => {
    it('tôle 1, Free : servie, aucune requête de palier ni de job', async () => {
        await expect(dxfRoute(ev('x_alt0_part_1.dxf'))).resolves.toBe('STREAM')
        expect(downloadSheetCapForUser).not.toHaveBeenCalled()
        expect(state.findOne).not.toHaveBeenCalled()
    })

    it('tôle 2, Free : servie, aucune requête', async () => {
        await expect(dxfRoute(ev('x_alt0_part_2.dxf'))).resolves.toBe('STREAM')
        expect(downloadSheetCapForUser).not.toHaveBeenCalled()
        expect(state.findOne).not.toHaveBeenCalled()
    })

    it('tôle 3, Free, job ordinaire : 403 sheet_download_locked, rien servi, événement serveur', async () => {
        const event = ev('x_alt0_part_3.dxf')
        let caught = null
        try {
            await dxfRoute(event)
        } catch (err) {
            caught = err
        }
        expect(caught).toMatchObject({ statusCode: 403, statusMessage: 'sheet_download_locked' })
        expect(caught.data).toEqual({ reason: 'sheet_download_locked', cap: 2, sheet: 3 })
        expect(sendOwnedBucketFile).not.toHaveBeenCalled()
        expect(trackEvent).toHaveBeenCalledWith(event, 'download_nested_result_dxf_locked', { sheet: '3' })
        expect(vi.mocked(trackEvent).mock.calls.some(([, a]) => a === 'download_nested_result_dxf_file')).toBe(false)
        // Job retrouvé par son slug sur l'index `slug` — aucun $or.
        expect(state.findOne).toHaveBeenCalledTimes(1)
        expect(state.findOne.mock.calls[0][0]).toEqual({ slug: 'x', ownerId: 'u1' })
    })

    it('tôle 3, payant (plafond Infinity, reprise Stripe comprise) : servie', async () => {
        state.cap = Infinity
        await expect(dxfRoute(ev('x_alt0_part_3.dxf'))).resolves.toBe('STREAM')
        expect(downloadSheetCapForUser).toHaveBeenCalledTimes(1)
        expect(lockedCalls()).toHaveLength(0)
    })

    it('tôle 3, Free, job du projet démo : servie', async () => {
        state.job = { projectSlug: 'demo' }
        await expect(dxfRoute(ev('x_alt0_part_3.dxf'))).resolves.toBe('STREAM')
        expect(lockedCalls()).toHaveLength(0)
    })

    it('tôle 3, Free, job au profil démo (params.computeLevel) : servie', async () => {
        state.job = { projectSlug: 'p1', params: { computeLevel: 'demo' } }
        await expect(dxfRoute(ev('x_alt0_part_3.dxf'))).resolves.toBe('STREAM')
    })

    it("flag paidPlansDisabled 'true' : transmis tel quel au resolver", async () => {
        const prev = globalThis.useRuntimeConfig
        globalThis.useRuntimeConfig = () => ({ public: { paidPlansDisabled: 'true' } })
        try {
            state.cap = Infinity
            await expect(dxfRoute(ev('x_alt0_part_3.dxf'))).resolves.toBe('STREAM')
            expect(downloadSheetCapForUser).toHaveBeenCalledWith('u1', { paidPlansDisabled: 'true' })
        } finally {
            globalThis.useRuntimeConfig = prev
        }
    })

    it('tôle 3, Free, job introuvable : 403 (fail-closed)', async () => {
        state.job = null
        await expect(dxfRoute(ev('x_alt0_part_3.dxf'))).rejects.toMatchObject({
            statusCode: 403,
            statusMessage: 'sheet_download_locked',
        })
        expect(sendOwnedBucketFile).not.toHaveBeenCalled()
    })

    it('nom illisible, Free : servi (D2), aucune requête', async () => {
        await expect(dxfRoute(ev('weird.dxf'))).resolves.toBe('STREAM')
        expect(state.findOne).not.toHaveBeenCalled()
        expect(downloadSheetCapForUser).not.toHaveBeenCalled()
    })

    it('tôle 12 d’une autre alternative, Free : 403, sheet 12', async () => {
        await expect(dxfRoute(ev('x_alt1_part_12.dxf'))).rejects.toMatchObject({
            statusCode: 403,
            data: { reason: 'sheet_download_locked', cap: 2, sheet: 12 },
        })
        expect(state.findOne.mock.calls[0][0]).toEqual({ slug: 'x', ownerId: 'u1' })
        expect(lockedCalls()[0][2]).toEqual({ sheet: '12' })
    })

    it('nom hérité sans _alt, Free : job cherché par son slug', async () => {
        await expect(dxfRoute(ev('old-job_part_3.dxf'))).rejects.toMatchObject({ statusCode: 403 })
        expect(state.findOne.mock.calls[0][0]).toEqual({ slug: 'old-job', ownerId: 'u1' })
    })

    it('sans session : sendOwnedBucketFile répond (401), aucun resolver appelé', async () => {
        await expect(dxfRoute(ev('x_alt0_part_3.dxf', { auth: null }))).resolves.toBe('STREAM')
        expect(sendOwnedBucketFile).toHaveBeenCalledTimes(1)
        expect(downloadSheetCapForUser).not.toHaveBeenCalled()
        expect(state.findOne).not.toHaveBeenCalled()
    })
})

describe('sheetDownloadGate — fonctions pures', () => {
    it('jobSlugFromResultFile lit le slug du job dans le nom', () => {
        expect(jobSlugFromResultFile('a-b-0123456789ab_alt2_part_3.dxf')).toBe('a-b-0123456789ab')
        expect(jobSlugFromResultFile('j_part_1.dxf')).toBe('j')
        expect(jobSlugFromResultFile('weird.dxf')).toBeNull()
        expect(jobSlugFromResultFile('')).toBeNull()
        expect(jobSlugFromResultFile(null)).toBeNull()
        expect(RESULT_DXF_JOB_SLUG_RE.test('x_alt0_part_3.svg')).toBe(false)
    })

    it('isDemoJob : projet démo ou profil démo ; null ⇒ non démo', () => {
        expect(isDemoJob({ projectSlug: 'demo' })).toBe(true)
        expect(isDemoJob({ params: { computeLevel: 'demo' } })).toBe(true)
        expect(isDemoJob({ projectSlug: 'p1', params: { computeLevel: 'browser' } })).toBe(false)
        expect(isDemoJob(null)).toBe(false)
    })

    it("filterDownloadableNames garde l'ordre et les noms illisibles", () => {
        const names = ['j_alt0_part_3.dxf', 'a.dxf', 'j_alt0_part_1.dxf', 'j_alt0_part_2.dxf']
        expect(filterDownloadableNames(names, 2)).toEqual(['a.dxf', 'j_alt0_part_1.dxf', 'j_alt0_part_2.dxf'])
        expect(filterDownloadableNames(names, Infinity)).toEqual(names)
        expect(filterDownloadableNames(undefined, 2)).toEqual([])
    })

    it('sheetDownloadLockedError : 403 stable', () => {
        expect(sheetDownloadLockedError(5, 2)).toMatchObject({
            statusCode: 403,
            statusMessage: 'sheet_download_locked',
            data: { reason: 'sheet_download_locked', cap: 2, sheet: 5 },
        })
    })
})
