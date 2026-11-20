import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
    alternativesHoldImportedSheet,
    lockedSheetsTrackData,
    resultHasImportedSheet,
    sheetGateModel,
} from '../utils/sheetDownloadGate'
import { importedSheetLockVisible, sheetDownloadState } from '../utils/sheetDownloadState'
import { effectiveSheetCap, isSheetFileAllowed } from '../../shared/constants/sheetDownload.constants'
import {
    downloadLocalDxf,
    downloadLocalJob,
    downloadLocalJobs,
    downloadLocalResult,
    downloadLocalZip,
} from '../composables/localDownloads'
import en from '../utils/i18n/en'
import fr from '../utils/i18n/fr'
import de from '../utils/i18n/de'
import es from '../utils/i18n/es'
import it_ from '../utils/i18n/it'
import pt from '../utils/i18n/pt'

// Essai Free d'une tôle importée (20/11) : tout le job est verrouillé pour un
// compte Free, l'export seul ; les jobs sans tôle importée gardent la règle
// des 2 premières tôles.

const SHAPED_TOTALS = { totals: { shapedSheetCount: 1 } }
const SHAPED_ROW = { sheets: [{ index: 0, shaped: true }] }
const dxf = (n) => ({ fileName: `rec_alt0_part_${n}.dxf`, content: `0\nEND${n}` })
const job = (n) => ({ fileName: `rec_tole${n}.job`, bytes: new Uint8Array([n]) })
const record = (report) => ({
    slug: 'rec',
    alternatives: [{ layoutCount: 3, report, dxfs: [dxf(1), dxf(2), dxf(3)], jobs: [job(1), job(2), job(3)] }],
})

// Forme du rapport stocké quand le wasm échoue : markUnresolvedShapes →
// verify { shapeVerified: false } recopié à plat, totals null, aucune tôle.
const FAILED = { shapeVerified: false, verifyStatus: 'skipped', totals: null, sheets: [] }
const FINAL_FRAME = { stage: 'final', binFormats: [0, 0, 0] }
const withFrame = (rep, liveLayout) => ({ ...record(rep), liveLayout })

describe('lecture de la tôle importée dans le résultat stocké', () => {
    it('totals.shapedSheetCount > 0, ou une ligne shaped:true', () => {
        expect(alternativesHoldImportedSheet([{ report: SHAPED_TOTALS }])).toBe(true)
        expect(alternativesHoldImportedSheet([{ report: SHAPED_ROW }])).toBe(true)
    })
    it('ancien résultat sans ces champs : false (règle d’aujourd’hui)', () => {
        expect(alternativesHoldImportedSheet([{ report: { totals: { sheetCount: 2 }, sheets: [{ index: 0 }] } }])).toBe(false)
        expect(alternativesHoldImportedSheet([{ report: null }, {}])).toBe(false)
        expect(alternativesHoldImportedSheet(undefined)).toBe(false)
        expect(resultHasImportedSheet(null)).toBe(false)
    })
    it('lu aussi dans le record local, sans la fiche de la tôle', () => {
        expect(resultHasImportedSheet({ localRecord: record(SHAPED_TOTALS) })).toBe(true)
        expect(resultHasImportedSheet({ alternatives: [{ report: SHAPED_ROW }] })).toBe(true)
    })
})

describe('plafond effectif', () => {
    it('verrouillé + importée : 0 ; ouvert ou sans importée : inchangé', () => {
        expect(effectiveSheetCap(2, true)).toBe(0)
        expect(effectiveSheetCap(2, false)).toBe(2)
        expect(effectiveSheetCap(Infinity, true)).toBe(Infinity)
    })
    it('plafond 0 : même un nom illisible est refusé', () => {
        expect(isSheetFileAllowed('autre.dxf', 0)).toBe(false)
        expect(isSheetFileAllowed('autre.dxf', 2)).toBe(true)
    })
})

describe('sheetGateModel avec tôle importée', () => {
    const names = ['a_part_1.dxf', 'a_part_2.dxf', 'a_part_3.dxf']
    it('Free + importée : tout est verrouillé', () => {
        const g = sheetGateModel(names, 'locked', 3, { importedSheet: true })
        expect(g.locked).toEqual([true, true, true])
        expect(g.anyLocked).toBe(true)
        expect(g.importedLock).toBe(true)
        expect(g.maxSheet).toBe(0)
    })
    it('Free sans importée : les 2 premières comme avant', () => {
        const g = sheetGateModel(names, 'locked', 3)
        expect(g.locked).toEqual([false, false, true])
        expect(g.importedLock).toBe(false)
    })
    it('payant (enabled) + importée : rien de verrouillé', () => {
        const g = sheetGateModel(names, 'enabled', 3, { importedSheet: true })
        expect(g.anyLocked).toBe(false)
        expect(g.importedLock).toBe(false)
    })
    it('démo, forfaits payants désactivés : enabled, donc ouvert', () => {
        const demo = sheetDownloadState(null, { projectSlug: 'demo' })
        const off = sheetDownloadState(null, { paidPlansDisabled: true, projectSlug: 'x' })
        expect(sheetGateModel(names, demo, 3, { importedSheet: true }).anyLocked).toBe(false)
        expect(sheetGateModel(names, off, 3, { importedSheet: true }).anyLocked).toBe(false)
    })
    it('suivi : raison en chaîne, sans slug ni nom', () => {
        const g = sheetGateModel(names, 'locked', 3, { importedSheet: true })
        const d = lockedSheetsTrackData('modal', g, true)
        expect(d.reason).toBe('imported_sheet')
        expect(Object.values(d).every((v) => typeof v === 'string')).toBe(true)
        expect('reason' in lockedSheetsTrackData('modal', sheetGateModel(names, 'locked', 3), true)).toBe(false)
    })
    it('note annoncée avant le calcul : verrouillé seulement', () => {
        expect(importedSheetLockVisible('locked', true)).toBe(true)
        expect(importedSheetLockVisible('enabled', true)).toBe(false)
        expect(importedSheetLockVisible('locked', false)).toBe(false)
    })
})

describe('point d’étranglement localDownloads', () => {
    let downloads
    let realDocument
    let realUrl
    beforeEach(() => {
        downloads = []
        realDocument = globalThis.document
        realUrl = globalThis.URL
        globalThis.document = {
            createElement: () => {
                const el = { style: {}, href: '', download: '', click: () => downloads.push(el.download), remove: () => {} }
                return el
            },
            body: { appendChild: () => {} },
        }
        globalThis.URL = class {
            static createObjectURL() { return 'blob:x' }
            static revokeObjectURL() {}
        }
    })
    afterEach(() => {
        if (realDocument === undefined) delete globalThis.document
        else globalThis.document = realDocument
        globalThis.URL = realUrl
    })

    it('Free + importée : DXF, ZIP, .job, tout livré = rien', () => {
        const rec = record(SHAPED_TOTALS)
        expect(() => downloadLocalDxf(rec, 0, 0, { maxSheet: 2 })).toThrow(/sheet_locked/)
        expect(() => downloadLocalZip(rec, null, { maxSheet: 2 })).toThrow(/sheet_locked/)
        expect(() => downloadLocalJob(rec, 0, 0, { maxSheet: 2 })).toThrow(/sheet_locked/)
        expect(() => downloadLocalJobs(rec, 0, { maxSheet: 2 })).toThrow(/sheet_locked/)
        expect(() => downloadLocalResult(rec, 0, { maxSheet: 2 })).toThrow(/sheet_locked/)
        expect(downloads).toHaveLength(0)
    })
    it('ligne shaped:true seule (sans totals) : verrouillé aussi', () => {
        expect(() => downloadLocalDxf(record(SHAPED_ROW), 0, 0, { maxSheet: 2 })).toThrow(/sheet_locked/)
    })
    it('compte ouvert (Infinity) + importée : tout est livré', () => {
        downloadLocalDxf(record(SHAPED_TOTALS), 0, 2, { maxSheet: Infinity })
        expect(downloads).toEqual(['rec_alt0_part_3.dxf'])
    })
    it('Free sans tôle importée, ou ancien résultat sans rapport : 2 premières tôles', () => {
        for (const rep of [{ totals: { sheetCount: 3 } }, null, undefined]) {
            downloads.length = 0
            downloadLocalDxf(record(rep), 0, 1, { maxSheet: 2 })
            expect(downloads).toEqual(['rec_alt0_part_2.dxf'])
            expect(() => downloadLocalDxf(record(rep), 0, 2, { maxSheet: 2 })).toThrow(/sheet_locked/)
        }
    })

    it('Free + rapport en échec : plus rien n’est livré', () => {
        const rec = record(FAILED)
        expect(() => downloadLocalDxf(rec, 0, 0, { maxSheet: 2 })).toThrow(/sheet_locked/)
        expect(() => downloadLocalZip(rec, null, { maxSheet: 2 })).toThrow(/sheet_locked/)
        expect(() => downloadLocalJob(rec, 0, 0, { maxSheet: 2 })).toThrow(/sheet_locked/)
        expect(downloads).toHaveLength(0)
    })
    it('Free + record sans rapport mais frame binFormats : verrouillé', () => {
        const rec = withFrame(null, FINAL_FRAME)
        expect(() => downloadLocalDxf(rec, 0, 0, { maxSheet: 2 })).toThrow(/sheet_locked/)
        expect(() => downloadLocalJobs(rec, 0, { maxSheet: 2 })).toThrow(/sheet_locked/)
        expect(downloads).toHaveLength(0)
        // compte ouvert : livré
        downloadLocalDxf(rec, 0, 2, { maxSheet: Infinity })
        expect(downloads).toEqual(['rec_alt0_part_3.dxf'])
    })
    it('ancien record sans aucun de ces champs : 2 premières tôles', () => {
        downloadLocalDxf(withFrame(null, { stage: 'final' }), 0, 1, { maxSheet: 2 })
        expect(downloads).toEqual(['rec_alt0_part_2.dxf'])
    })
})

describe('rapport en échec ou absent sur un job à tôle importée (F1)', () => {

    it('rapport : shapedSheets > 0 ou shapeVerified booléen suffisent', () => {
        expect(alternativesHoldImportedSheet([{ report: FAILED }])).toBe(true)
        expect(alternativesHoldImportedSheet([{ report: { shapeVerified: true } }])).toBe(true)
        expect(alternativesHoldImportedSheet([{ report: { shapedSheets: 2 } }])).toBe(true)
        expect(alternativesHoldImportedSheet([{ report: { shapedSheets: 0 } }])).toBe(false)
        expect(alternativesHoldImportedSheet([{ report: { shapeVerified: 'oui' } }])).toBe(false)
    })
    it('record : binFormats de la frame finale, rapport absent ou vide', () => {
        expect(resultHasImportedSheet({ localRecord: withFrame(null, FINAL_FRAME) })).toBe(true)
        expect(resultHasImportedSheet({ isLocal: true, localRecord: withFrame({ totals: null, sheets: [] }, FINAL_FRAME), alternatives: [{ report: null }] })).toBe(true)
        // job rectangulaire ou ancien record : pas de binFormats, règle des 2 tôles
        expect(resultHasImportedSheet({ localRecord: withFrame(null, { stage: 'final' }) })).toBe(false)
        expect(resultHasImportedSheet({ localRecord: withFrame(null, undefined) })).toBe(false)
    })
})

describe('verrou lisible à l’écran et chaînes', () => {
    it('phrase de la fenêtre d’abonnement, notes et drapeau transmis (F2, F3, F4)', () => {
        const read2 = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
        expect(read2('../components/UserResultItem.vue')).toContain('importedSheet: g.importedLock === true')
        expect(read2('../components/ResultModal.vue')).toContain('importedSheet: gate.importedLock === true')
        expect(read2('../components/ResultModal.vue')).toContain('!unref(hasImportedSheet) && freeDownloadNoteVisible(')
        const page = read2('../pages/project/[slug].vue')
        expect(page).toContain('Boolean(s?.shapeId) && Number(s?.count) > 0')
        expect(page).toContain('v-if="ctaImportedNote && !capacityPanel"')
    })
    const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    it('les surfaces lisent la tôle importée dans le résultat', () => {
        expect(read('../components/ResultModal.vue')).toContain('resultHasImportedSheet(unref(resultModalData))')
        expect(read('../components/UserResultItem.vue')).toContain('importedSheet: resultHasImportedSheet(props.result)')
    })
    it('le point d’étranglement applique le plafond 0 lui-même', () => {
        const src = read('../composables/localDownloads.js')
        expect(src).toContain('alternativesHoldImportedSheet(record?.alternatives)')
        expect(src).toContain("verrou d'INTERFACE")
    })
    it('note avant calcul (page) et avant confirmation (fenêtre)', () => {
        expect(read('../pages/project/[slug].vue')).toContain('importedSheetLockVisible(unref(downloadState)')
        expect(read('../components/SheetImportDialog.vue')).toContain('importedSheetLockVisible(')
    })
    const KEYS = [
        'nest.importedSheetNote',
        'sheetImport.trialNote',
        'results.importedLocked',
        'results.unlockImported',
        'results.unlockImportedShort',
    ]
    it.each([['en', en], ['fr', fr], ['de', de], ['es', es], ['it', it_], ['pt', pt]])('%s : cinq clés non vides', (_l, dict) => {
        for (const k of KEYS) expect(typeof dict[k] === 'string' && dict[k].length > 5).toBe(true)
    })
    it('fr : jamais d’espace simple avant : ; ? !', () => {
        for (const k of KEYS) expect(/ [:;?!]/.test(fr[k])).toBe(false)
    })
})
