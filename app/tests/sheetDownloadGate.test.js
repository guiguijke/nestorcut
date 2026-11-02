import { describe, expect, it } from 'vitest'
import { FREE_DOWNLOAD_SHEET_CAP } from '~~/shared/constants/payment.constants'
import {
    altJobNames,
    altLayoutCount,
    altSheetNames,
    fileNameFromUrl,
    lockedSheetsTrackData,
    sheetGateModel,
} from '../utils/sheetDownloadGate'

// O2/d4 (02/11) : verrou de téléchargement PAR NOMS (sheetDownloadState est
// testé en WP-0, sheetDownloadState.test.js).
const P = (n, alt = 0) => `job-1_alt${alt}_part_${n}.dxf`

describe('sheetGateModel', () => {
    it('3 tôles, compte verrouillé : seule la tôle 3 est verrouillée', () => {
        const g = sheetGateModel([P(1), P(2), P(3)], 'locked')
        expect(g.locked).toEqual([false, false, true])
        expect(g.lockedCount).toBe(1)
        expect(g.anyLocked).toBe(true)
        expect(g.total).toBe(3)
        expect(g.cap).toBe(FREE_DOWNLOAD_SHEET_CAP)
        expect(g.maxSheet).toBe(FREE_DOWNLOAD_SHEET_CAP)
        expect(g.state).toBe('locked')
    })

    it('compte débloqué : rien de verrouillé', () => {
        const g = sheetGateModel([P(1), P(2), P(3)], 'enabled')
        expect(g.anyLocked).toBe(false)
        expect(g.lockedCount).toBe(0)
        expect(g.locked).toEqual([false, false, false])
        expect(g.maxSheet).toBe(Infinity)
    })

    it('d4 désalignement : le verrou suit le NOM, pas l’index (part_2 sauté)', () => {
        const g = sheetGateModel([P(1), P(3), P(4)], 'locked')
        expect(g.locked).toEqual([false, true, true])
        expect(g.lockedCount).toBe(2)
    })

    it('D2 : un nom illisible n’est jamais verrouillé', () => {
        const g = sheetGateModel(['weird.dxf', null, P(1)], 'locked')
        expect(g.locked).toEqual([false, false, false])
        expect(g.anyLocked).toBe(false)
    })

    it('layoutCount plus grand que la liste des noms : total = layoutCount', () => {
        expect(sheetGateModel([P(1), P(2), P(3)], 'locked', 4).total).toBe(4)
        expect(sheetGateModel([P(1), P(2), P(3)], 'locked', 2).total).toBe(3)
        expect(sheetGateModel([P(1)], 'locked', null).total).toBe(1)
    })

    it('liste absente : modèle vide, rien de verrouillé', () => {
        const g = sheetGateModel(undefined, 'locked')
        expect(g.locked).toEqual([])
        expect(g.total).toBe(0)
        expect(g.anyLocked).toBe(false)
    })
})

describe('fileNameFromUrl', () => {
    it('dernier segment d’une URL serveur', () => {
        expect(fileNameFromUrl('/api/files/result/dxf/a_alt0_part_3.dxf')).toBe('a_alt0_part_3.dxf')
    })

    it('blob:, data:, local:, vide, null → null', () => {
        expect(fileNameFromUrl('blob:http://localhost:3000/1234-5678')).toBeNull()
        expect(fileNameFromUrl('data:image/svg+xml;base64,AAAA')).toBeNull()
        expect(fileNameFromUrl('local:x')).toBeNull()
        expect(fileNameFromUrl('')).toBeNull()
        expect(fileNameFromUrl(null)).toBeNull()
        expect(fileNameFromUrl(42)).toBeNull()
    })

    it('%20 décodé ; séquence malformée → segment brut ; nom nu rendu tel quel', () => {
        expect(fileNameFromUrl('/api/files/result/dxf/a%20b_part_1.dxf')).toBe('a b_part_1.dxf')
        expect(fileNameFromUrl('/api/files/result/dxf/a%E0%A4_part_1.dxf')).toBe('a%E0%A4_part_1.dxf')
        expect(fileNameFromUrl('x_part_2.dxf')).toBe('x_part_2.dxf')
    })
})

describe('altSheetNames / altJobNames / altLayoutCount', () => {
    const localItem = {
        isLocal: true,
        alternatives: [{ layoutCount: 3 }, { layoutCount: 2 }],
        localRecord: {
            slug: 'rec',
            alternatives: [
                {
                    dxfs: [
                        { fileName: 'rec_alt0_part_1.dxf', content: '0\nEOF' },
                        { fileName: 'rec_alt0_part_2.dxf', content: '' }, // sans contenu : filtré
                        { fileName: 'rec_alt0_part_3.dxf', content: '0\nEOF' },
                        { fileName: 42, content: '0\nEOF' },
                    ],
                    jobs: [
                        { fileName: 'rec_tole1.job', bytes: new Uint8Array([1]) },
                        { fileName: 'rec_tole2.job' }, // sans octets : filtré
                        { fileName: 'rec_tole3.job', bytes: new Uint8Array([1]) },
                    ],
                },
                { dxfs: [{ fileName: 'rec_alt1_part_1.dxf', content: 'x' }] },
            ],
        },
    }

    it('item local : noms du record, MÊME filtre que localHydrate (content)', () => {
        expect(altSheetNames(localItem, 0)).toEqual(['rec_alt0_part_1.dxf', 'rec_alt0_part_3.dxf', null])
        expect(altSheetNames(localItem, 1)).toEqual(['rec_alt1_part_1.dxf'])
        expect(altSheetNames(localItem, 5)).toEqual([])
    })

    it('item serveur à alternatives : noms tirés des URL de l’alternative', () => {
        const item = {
            dxfs: ['/api/files/result/dxf/legacy_part_1.dxf'],
            alternatives: [
                { dxfs: ['/api/files/result/dxf/j_alt0_part_1.dxf', '/api/files/result/dxf/j_alt0_part_2.dxf'] },
                { dxfs: ['/api/files/result/dxf/j_alt1_part_1.dxf'] },
            ],
        }
        expect(altSheetNames(item, 0)).toEqual(['j_alt0_part_1.dxf', 'j_alt0_part_2.dxf'])
        expect(altSheetNames(item, 1)).toEqual(['j_alt1_part_1.dxf'])
    })

    it('item serveur hérité (dxfs seul)', () => {
        const item = { alternatives: [], dxfs: ['/api/files/result/dxf/old_part_1.dxf', '/api/files/result/dxf/old_part_3.dxf'] }
        expect(altSheetNames(item, 0)).toEqual(['old_part_1.dxf', 'old_part_3.dxf'])
        expect(altSheetNames(null)).toEqual([])
    })

    it('altJobNames : local seulement, filtré sur les octets', () => {
        expect(altJobNames(localItem, 0)).toEqual(['rec_tole1.job', 'rec_tole3.job'])
        expect(altJobNames(localItem, 1)).toEqual([])
        expect(altJobNames({ alternatives: [{ jobs: [{ fileName: 'x_tole1.job' }] }] }, 0)).toEqual([])
    })

    it('altLayoutCount : > 0 seulement', () => {
        expect(altLayoutCount(localItem, 0)).toBe(3)
        expect(altLayoutCount(localItem, 1)).toBe(2)
        expect(altLayoutCount({ alternatives: [{ layoutCount: 0 }] }, 0)).toBeNull()
        expect(altLayoutCount({}, 0)).toBeNull()
        expect(altLayoutCount(null)).toBeNull()
    })

    it('D23 : 2 DXF mais 3 .job → la rangée .job verrouille, pas la rangée DXF', () => {
        const r = {
            isLocal: true,
            localRecord: {
                alternatives: [{
                    dxfs: [
                        { fileName: 'r_alt0_part_1.dxf', content: 'a' },
                        { fileName: 'r_alt0_part_2.dxf', content: 'b' },
                    ],
                    jobs: [1, 2, 3].map((n) => ({ fileName: `r_tole${n}.job`, bytes: new Uint8Array([n]) })),
                }],
            },
        }
        expect(sheetGateModel(altSheetNames(r, 0), 'locked').anyLocked).toBe(false)
        expect(sheetGateModel(altJobNames(r, 0), 'locked').anyLocked).toBe(true)
    })
})

describe('lockedSheetsTrackData', () => {
    it('toutes les valeurs sont des chaînes, aucune clé slug', () => {
        const gate = sheetGateModel([P(1), P(2), P(3)], 'locked', 3)
        for (const isLocal of [true, false]) {
            const data = lockedSheetsTrackData('modal', gate, isLocal)
            expect(data).toEqual({
                surface: 'modal',
                sheets: '3',
                cap: String(FREE_DOWNLOAD_SHEET_CAP),
                compute: isLocal ? 'browser' : 'server',
            })
            for (const v of Object.values(data)) expect(typeof v).toBe('string')
            expect(Object.keys(data).some((k) => /slug/i.test(k))).toBe(false)
        }
    })
})
