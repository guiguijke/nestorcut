/**
 * Fichier de projet `.nestorcut` : enregistrer puis rouvrir redonne le même
 * projet ; un fichier abîmé, modifié, trop récent ou trop gros est refusé.
 * Note du coffre : « Fichier de projet nestorcut ».
 */
import { describe, it, expect } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
    PROJECT_FILE_FORMAT,
    PROJECT_FILE_READER,
    ProjectFileError,
    isProjectFileName,
    materializeProject,
    projectFileName,
    readProjectFile,
    writeProjectFile,
} from '../utils/projectFile.js'
import { bindCut, makeSheetRecord } from '../utils/sheetShape.js'

const enc = new TextEncoder()
const bytesOf = (text) => enc.encode(text).buffer

const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]
// Contour comme l'import de tôle le rend (anneau fermé, aire, cadre).
const contour = (x, y, s, depth, parent) => ({ ring: square(x, y, s), depth, parent, areaMm2: s * s, bbox: [x, y, x + s, y + s] })

function plainSheet(slug) {
    return makeSheetRecord({
        id: slug,
        projectSlug: 'proj-a',
        name: 'Chute 1200 × 800',
        sourceFileName: 'chute.dxf',
        sourceUnits: 4,
        contours: [contour(0, 0, 1000, 0, null), contour(100, 100, 50, 1, 0)],
        outlineIndex: 0,
        forbidden: [1],
        addedAt: '2026-11-27T10:00:00.000Z',
    })
}

function defectSheet(slug) {
    const contours = [contour(0, 0, 500, 0, null)]
    const drawn = [{ id: 'd1', kind: 'rect', ring: square(10, 10, 20) }]
    const cut = bindCut({
        outer: square(0, 0, 500),
        holes: [square(10, 10, 20)],
        hazards: [square(10, 10, 20)],
        lostPieces: [],
        usableArea: 249600,
        lostArea: 0,
        removedArea: 400,
        pieces: 1,
    }, contours, 0, [], drawn)
    return makeSheetRecord({
        id: slug,
        projectSlug: 'proj-a',
        name: 'Tôle fendue',
        sourceFileName: 'fendue.dxf',
        sourceUnits: 4,
        contours,
        outlineIndex: 0,
        forbidden: [],
        addedAt: '2026-11-27T11:00:00.000Z',
        drawn,
        cut,
    })
}

const part = (x, s, color) => ({
    coordinates: square(x, 0, s),
    holes: [square(x + 2, 2, 1)],
    width: s,
    height: s,
    handles: ['1A', '1B'],
    color,
})

function sampleProject() {
    const scaled = {
        slug: 'f-aaaaaaaaaaaaaaaa.dxf',
        projectSlug: 'proj-a',
        name: 'bride.dxf',
        addedAt: '2026-11-27T09:00:00.000Z',
        dxfBytes: bytesOf('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n'),
        origDxfBytes: bytesOf('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n999\norig\n'),
        parts: [part(0, 10, '#1f77b4')],
        sourceUnits: 4,
        entityCount: 3,
        warnings: [],
        findings: [{ code: 'import.scaleApplied', level: 'info', count: 1, value: '2' }],
        previewSvg: 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E',
        importScale: 2,
        importScaleApplied: true,
    }
    const child = {
        slug: 'f-bbbbbbbbbbbbbbbb.dxf',
        projectSlug: 'proj-a',
        name: 'plaque (1/2).dxf',
        addedAt: '2026-11-27T09:01:00.000Z',
        dxfBytes: bytesOf('0\nEOF\nchild1\n'),
        parts: [part(0, 20, '#ff7f0e')],
        sourceUnits: 4,
        entityCount: 1,
        warnings: [],
        findings: [],
        previewSvg: 'data:image/svg+xml;utf8,%3Csvg%3E1%3C/svg%3E',
        explodedFrom: 'plaque.dxf',
        explodedIndex: 0,
        explodedFromSlug: 'f-cccccccccccccccc.dxf',
    }
    const sibling = {
        ...child,
        slug: 'f-dddddddddddddddd.dxf',
        name: 'plaque (2/2).dxf',
        addedAt: '2026-11-27T09:01:01.000Z',
        dxfBytes: bytesOf('0\nEOF\nchild2\n'),
        explodedIndex: 1,
    }
    const fromJob = {
        slug: 'f-eeeeeeeeeeeeeeee.dxf',
        projectSlug: 'proj-a',
        name: 'support.dxf',
        addedAt: '2026-11-27T09:02:00.000Z',
        dxfBytes: bytesOf('0\nEOF\njob\n'),
        parts: [part(0, 30, '#2ca02c'), part(40, 5, '#d62728')],
        sourceUnits: 4,
        entityCount: 7,
        warnings: ['w1'],
        findings: [{ code: 'sheetcam.jobGeometry', level: 'info', count: 1 }],
        previewSvg: 'data:image/svg+xml;utf8,%3Csvg%3Ejob%3C/svg%3E',
        sheetcam: {
            drawingName: 'support', partIndex: 0, jobName: 'atelier.job', leadIn: 2, kerfWidth: 1.5,
            blockIndex: 1, starts: [{ pathIndex: 0, offset: [1, 2], leadIn: 2, order: 1, moved: true }],
        },
        sheetcamJobBytes: new Uint8Array([0, 1, 2, 250, 251, 252]).buffer,
        source: 'job',
    }
    const sheetA = plainSheet('sheet-a')
    const sheetB = defectSheet('sheet-b')
    const params = {
        sheets: [
            { width: '1000', height: '1000', count: '2', shapeId: 'sheet-a' },
            { width: '500', height: '500', count: '1', shapeId: 'sheet-b' },
            { width: '1250', height: '2500', count: '3' },
        ],
        kerf: '0,5',
        safety: '2',
        space: '3',
        edgeDistance: '-4',
        addOutShape: false,
        fillHoles: true,
        rotationCount: 8,
        directions: ['left', 'bottom'],
        demoWalks: 4,
    }
    return {
        input: {
            title: 'Bride et plaques',
            appVersion: '0.9.24',
            savedAt: '2026-11-27T12:00:00.000Z',
            unit: 'mm',
            params,
            paramsUnit: 'mm',
            pieces: [
                { record: scaled, count: 12, rotation: null },
                { record: child, count: 3, rotation: '[0,90]' },
                { record: sibling, count: 3, rotation: null },
                { record: fromJob, count: 0, rotation: null },
            ],
            sheets: [sheetA, sheetB],
        },
        records: [scaled, child, sibling, fromJob],
        sheets: [sheetA, sheetB],
    }
}

function deps() {
    let f = 0
    let s = 0
    return {
        projectSlug: 'proj-new',
        newFileSlug: (name) => `f-new${++f}${/\.svg$/i.test(String(name)) ? '.svg' : '.dxf'}`,
        newSheetSlug: () => `sheet-new${++s}`,
        makeSheetRecord,
        snapshotVersion: 2,
    }
}

const hex = (bytes) => Buffer.from(bytes).toString('hex')
async function sha256(bytes) {
    return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

/** Ouvre l'archive, applique `edit` aux éléments décodés, recalcule (ou non) les empreintes. */
async function tamper(fileBytes, edit, { rehash = true } = {}) {
    const files = unzipSync(fileBytes)
    const manifest = JSON.parse(strFromU8(files['manifest.json']))
    await edit({ files, manifest })
    if (rehash) {
        for (const path of Object.keys(manifest.hashes)) {
            if (files[path]) manifest.hashes[path] = await sha256(files[path])
        }
    }
    const manifestBytes = strToU8(JSON.stringify(manifest))
    files['manifest.json'] = manifestBytes
    if (rehash) files['manifest.sha256'] = strToU8(`${await sha256(manifestBytes)}\n`)
    return zipSync(files)
}

async function expectCode(promise, code) {
    let err = null
    try {
        await promise
    } catch (e) {
        err = e
    }
    expect(err).toBeInstanceOf(ProjectFileError)
    expect(err.code).toBe(code)
    return err
}

const u8 = (buf) => new Uint8Array(buf)

describe('fichier de projet .nestorcut : aller-retour', () => {
    it('enregistrer puis rouvrir redonne le même projet', async () => {
        const { input, records, sheets } = sampleProject()
        const file = await writeProjectFile(input)
        const read = await readProjectFile(file)
        const out = materializeProject(read, deps())

        expect(read.title).toBe('Bride et plaques')
        expect(read.app).toBe('0.9.24')
        expect(read.version).toBe(1)

        // Fiches : tout, champ pour champ, sauf les identifiants du poste.
        expect(out.fileRecords).toHaveLength(4)
        const strip = (r) => {
            const { slug, projectSlug, explodedFromSlug, dxfBytes, origDxfBytes, sheetcamJobBytes, ...rest } = r
            return rest
        }
        out.fileRecords.forEach((rec, i) => {
            expect(strip(rec)).toEqual(strip(records[i]))
            expect(rec.projectSlug).toBe('proj-new')
            expect(u8(rec.dxfBytes)).toEqual(u8(records[i].dxfBytes))
            expect(rec.dxfBytes).toBeInstanceOf(ArrayBuffer)
        })
        expect(u8(out.fileRecords[0].origDxfBytes)).toEqual(u8(records[0].origDxfBytes))
        expect(out.fileRecords[0].origDxfBytes).toBeInstanceOf(ArrayBuffer)
        expect(u8(out.fileRecords[3].sheetcamJobBytes)).toEqual(u8(records[3].sheetcamJobBytes))
        expect(out.fileRecords[3].sheetcamJobBytes).toBeInstanceOf(ArrayBuffer)
        expect('origDxfBytes' in out.fileRecords[1]).toBe(false)
        expect('sheetcamJobBytes' in out.fileRecords[0]).toBe(false)

        // Identifiants neufs, et les deux filles d'un même éclatement restent ensemble.
        const slugs = out.fileRecords.map((r) => r.slug)
        expect(new Set(slugs).size).toBe(4)
        expect(slugs.some((s) => records.some((r) => r.slug === s))).toBe(false)
        expect(out.fileRecords[1].explodedFromSlug).toBeTruthy()
        expect(out.fileRecords[1].explodedFromSlug).toBe(out.fileRecords[2].explodedFromSlug)
        expect(slugs).not.toContain(out.fileRecords[1].explodedFromSlug)
        expect(out.fileRecords[0].explodedFromSlug).toBeUndefined()

        // Tôles : reconstruites à l'identique (champs dérivés compris).
        expect(out.sheetRecords).toHaveLength(2)
        out.sheetRecords.forEach((rec, i) => {
            const { slug, projectSlug, ...rest } = rec
            const { slug: s0, projectSlug: p0, ...orig } = sheets[i]
            expect(rest).toEqual(orig)
            expect(projectSlug).toBe('proj-new')
        })
        expect(out.sheetRecords[1].drawn).toHaveLength(1)
        expect(out.sheetRecords[1].geometryKey).toBe(sheets[1].geometryKey)

        // Réglages : identiques, la tôle citée par son nouvel identifiant ; la démo ne voyage pas.
        const { demoWalks, ...expectedParams } = input.params
        expect(out.snapshot.params).toEqual({
            ...expectedParams,
            sheets: [
                { ...input.params.sheets[0], shapeId: out.sheetRecords[0].slug },
                { ...input.params.sheets[1], shapeId: out.sheetRecords[1].slug },
                input.params.sheets[2],
            ],
        })
        expect(out.snapshot.paramsUnit).toBe('mm')
        expect(out.snapshot.v).toBe(2)
        expect(out.snapshot.countBySlug).toEqual({ [slugs[0]]: 12, [slugs[1]]: 3, [slugs[2]]: 3, [slugs[3]]: 0 })
        expect(out.snapshot.rotationBySlug).toEqual({ [slugs[0]]: null, [slugs[1]]: '[0,90]', [slugs[2]]: null, [slugs[3]]: null })
    })

    it('un deuxième aller-retour ne change plus rien', async () => {
        const { input } = sampleProject()
        const first = materializeProject(await readProjectFile(await writeProjectFile(input)), deps())
        const again = await writeProjectFile({
            ...input,
            params: first.snapshot.params,
            pieces: first.fileRecords.map((record) => ({
                record,
                count: first.snapshot.countBySlug[record.slug],
                rotation: first.snapshot.rotationBySlug[record.slug],
            })),
            sheets: first.sheetRecords,
        })
        const second = materializeProject(await readProjectFile(again), deps())
        expect(second.fileRecords.map((r) => ({ ...r, dxfBytes: u8(r.dxfBytes) })))
            .toEqual(first.fileRecords.map((r) => ({ ...r, dxfBytes: u8(r.dxfBytes) })))
        expect(second.sheetRecords).toEqual(first.sheetRecords)
        expect(second.snapshot).toEqual(first.snapshot)
    })

    it("ne garde ni résultat, ni compte, ni identifiant du poste", async () => {
        const { input } = sampleProject()
        const file = await writeProjectFile({ ...input, pieces: input.pieces.map((p) => ({ ...p, record: { ...p.record, results: ['x'] } })) })
        const files = unzipSync(file)
        const all = Object.entries(files).map(([path, data]) => (/\.(json|sha256)$/.test(path) ? strFromU8(data) : '')).join('\n')
        expect(all).not.toContain('proj-a')
        expect(all).not.toContain('f-aaaaaaaaaaaaaaaa')
        expect(all).not.toContain('sheet-a')
        expect(all).not.toContain('"results"')
        expect(Object.keys(files).every((p) => /^(manifest\.(json|sha256)|pieces\/p\d+\.(json|dxf|orig\.dxf|job)|toles\/s\d+\.json)$/.test(p))).toBe(true)
    })

    it("une tôle introuvable ne voyage pas : la ligne garde ses cotes, sans forme", async () => {
        const { input } = sampleProject()
        const file = await writeProjectFile({ ...input, sheets: [input.sheets[1]] })
        const read = await readProjectFile(file)
        expect(read.params.sheets[0]).toEqual({ width: '1000', height: '1000', count: '2' })
        expect(read.params.sheets[1].shapeId).toBe('s1')
    })
})

describe('fichier de projet .nestorcut : ordre et champs', () => {
    it("garde l'ordre des fiches nées à la même milliseconde", async () => {
        const { input } = sampleProject()
        const same = '2026-11-27T09:00:00.000Z'
        const pieces = input.pieces.map((p) => ({ ...p, record: { ...p.record, addedAt: same } }))
        const out = materializeProject(await readProjectFile(await writeProjectFile({ ...input, pieces })), deps())
        const times = out.fileRecords.map((r) => Date.parse(r.addedAt))
        expect(times.every((t, i) => i === 0 || t > times[i - 1])).toBe(true)
        expect(out.fileRecords[0].addedAt).toBe(same)
        expect(out.fileRecords.map((r) => r.name)).toEqual(input.pieces.map((p) => p.record.name))
    })

    it("n'écrit ni ne relit un champ de fiche inconnu", async () => {
        const { input } = sampleProject()
        const file = await writeProjectFile(input)
        const edited = await tamper(file, ({ files }) => {
            const meta = JSON.parse(strFromU8(files['pieces/p1.json']))
            meta.intrus = 'x'.repeat(1000)
            meta.slug = 'f-autre'
            files['pieces/p1.json'] = strToU8(JSON.stringify(meta))
        })
        const out = materializeProject(await readProjectFile(edited), deps())
        expect(out.fileRecords[0].intrus).toBeUndefined()
        expect(out.fileRecords[0].slug).toBe('f-new1.dxf')
    })

    it('refait le cadre et l’aire d’un contour de tôle qui ne les porte pas', async () => {
        const { input } = sampleProject()
        const file = await writeProjectFile(input)
        const edited = await tamper(file, ({ files }) => {
            const sheet = JSON.parse(strFromU8(files['toles/s1.json']))
            delete sheet.contours[1].bbox
            delete sheet.contours[1].areaMm2
            files['toles/s1.json'] = strToU8(JSON.stringify(sheet))
        })
        const out = materializeProject(await readProjectFile(edited), deps())
        expect(out.sheetRecords[0].contours[1].bbox).toEqual([100, 100, 150, 150])
        expect(out.sheetRecords[0].contours[1].areaMm2).toBe(2500)
    })
})

describe('fichier de projet .nestorcut : refus', () => {
    it("refuse ce qui n'est pas un projet", async () => {
        await expectCode(readProjectFile(enc.encode('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n')), 'not_project')
        await expectCode(readProjectFile(zipSync({ 'autre.txt': strToU8('x') })), 'not_project')
        await expectCode(readProjectFile(zipSync({ 'manifest.json': strToU8('{"format":"autre"}') })), 'not_project')
        await expectCode(readProjectFile(new Uint8Array(0)), 'not_project')
    })

    it('refuse un fichier tronqué', async () => {
        const file = await writeProjectFile(sampleProject().input)
        await expectCode(readProjectFile(file.slice(0, Math.floor(file.length / 2))), 'damaged')
    })

    it('refuse un élément modifié sans recalculer son empreinte', async () => {
        const file = await writeProjectFile(sampleProject().input)
        const edited = await tamper(file, ({ files }) => {
            files['pieces/p1.dxf'] = strToU8('0\nEOF\nautre\n')
        }, { rehash: false })
        // Le manifeste n'a pas changé : seule l'empreinte de l'élément trahit la modification.
        await expectCode(readProjectFile(edited), 'damaged')
    })

    it("refuse un manifeste modifié (quantité) sans recalculer l'empreinte de l'ensemble", async () => {
        const file = await writeProjectFile(sampleProject().input)
        const files = unzipSync(file)
        const manifest = JSON.parse(strFromU8(files['manifest.json']))
        manifest.pieces[0].count = 500
        files['manifest.json'] = strToU8(JSON.stringify(manifest))
        await expectCode(readProjectFile(zipSync(files)), 'damaged')
    })

    it('refuse un élément manquant', async () => {
        const file = await writeProjectFile(sampleProject().input)
        const files = unzipSync(file)
        delete files['pieces/p2.json']
        await expectCode(readProjectFile(zipSync(files)), 'damaged')
    })

    it('contrôle les valeurs même quand les empreintes ont été recalculées', async () => {
        const file = await writeProjectFile(sampleProject().input)
        const cases = [
            ({ manifest }) => { manifest.pieces[0].count = 5000 },
            ({ manifest }) => { manifest.pieces[0].rotation = 'tourne' },
            ({ manifest }) => { manifest.settings.params.space = '2; drop' },
            ({ manifest }) => { manifest.settings.params.sheets[0].shapeId = 's9' },
            ({ manifest }) => { manifest.pieces[0].meta = '../../etc/passwd' },
            ({ manifest }) => { manifest.pieces[1].id = 'p1' },
            ({ files }) => {
                const meta = JSON.parse(strFromU8(files['pieces/p1.json']))
                meta.parts[0].coordinates = [[0, 0], [1, 'x'], [2, 2]]
                files['pieces/p1.json'] = strToU8(JSON.stringify(meta))
            },
            ({ files }) => {
                const meta = JSON.parse(strFromU8(files['pieces/p1.json']))
                meta.previewSvg = 'javascript:alert(1)'
                files['pieces/p1.json'] = strToU8(JSON.stringify(meta))
            },
            ({ files }) => {
                const meta = JSON.parse(strFromU8(files['pieces/p1.json']))
                meta.parts = []
                files['pieces/p1.json'] = strToU8(JSON.stringify(meta))
            },
            ({ files }) => {
                const meta = JSON.parse(strFromU8(files['pieces/p4.json']))
                meta.sheetcam.starts = { moved: true }
                files['pieces/p4.json'] = strToU8(JSON.stringify(meta))
            },
            ({ files }) => {
                const meta = JSON.parse(strFromU8(files['pieces/p4.json']))
                meta.sheetcam.partIndex = 'zéro'
                files['pieces/p4.json'] = strToU8(JSON.stringify(meta))
            },
            ({ files }) => {
                const meta = JSON.parse(strFromU8(files['pieces/p1.json']))
                meta.parts[0].handles = [{ html: '<b>' }]
                files['pieces/p1.json'] = strToU8(JSON.stringify(meta))
            },
            ({ files }) => {
                const sheet = JSON.parse(strFromU8(files['toles/s1.json']))
                sheet.contours = Array.from({ length: 6000 }, (_, i) => contour(i, 0, 1, 1, 0))
                files['toles/s1.json'] = strToU8(JSON.stringify(sheet))
            },
            ({ files }) => {
                const sheet = JSON.parse(strFromU8(files['toles/s1.json']))
                sheet.forbidden = Array.from({ length: 300 }, () => 1)
                files['toles/s1.json'] = strToU8(JSON.stringify(sheet))
            },
            ({ files }) => {
                const sheet = JSON.parse(strFromU8(files['toles/s1.json']))
                sheet.contours[1].parent = 7
                files['toles/s1.json'] = strToU8(JSON.stringify(sheet))
            },
        ]
        for (const edit of cases) {
            await expectCode(readProjectFile(await tamper(file, edit)), 'invalid')
        }
    })

    it('refuse une tôle dont la géométrie ne se reconstruit pas', async () => {
        const file = await writeProjectFile(sampleProject().input)
        const edited = await tamper(file, ({ files }) => {
            const sheet = JSON.parse(strFromU8(files['toles/s2.json']))
            sheet.drawn[0].ring = square(30, 30, 40) // défaut déplacé : la coupe ne lui correspond plus
            files['toles/s2.json'] = strToU8(JSON.stringify(sheet))
        })
        const read = await readProjectFile(edited)
        expect(() => materializeProject(read, deps())).toThrow(ProjectFileError)
        try {
            materializeProject(read, deps())
        } catch (err) {
            expect(err.code).toBe('invalid')
        }
    })

    it('refuse un fichier écrit pour un lecteur plus récent', async () => {
        const file = await writeProjectFile(sampleProject().input)
        const edited = await tamper(file, ({ manifest }) => {
            manifest.version = PROJECT_FILE_READER + 3
            manifest.minReader = PROJECT_FILE_READER + 1
        })
        await expectCode(readProjectFile(edited), 'too_new')
    })

    it("ouvre un fichier plus récent qui reste lisible, et ignore ce qu'il ne connaît pas", async () => {
        const file = await writeProjectFile(sampleProject().input)
        const edited = await tamper(file, ({ manifest, files }) => {
            manifest.version = PROJECT_FILE_READER + 1
            manifest.minReader = 1
            manifest.futur = { rien: true }
            files['futur/extra.bin'] = new Uint8Array([1, 2, 3])
        })
        const read = await readProjectFile(edited)
        expect(read.version).toBe(PROJECT_FILE_READER + 1)
        expect(read.pieces).toHaveLength(4)
    })

    it('refuse une archive trop grosse une fois décompressée', async () => {
        const big = zipSync({ 'pieces/p1.dxf': new Uint8Array(2 * 1024 * 1024) }, { level: 9 })
        const file = await writeProjectFile(sampleProject().input)
        const files = unzipSync(file)
        files['pieces/p1.dxf'] = unzipSync(big)['pieces/p1.dxf']
        await expectCode(readProjectFile(zipSync(files, { level: 9 }), { limits: { unpackedBytes: 1024 * 1024 } }), 'too_large')
        await expectCode(readProjectFile(file, { limits: { fileBytes: 100 } }), 'too_large')
    })

    it("porte le bon format dans le manifeste", async () => {
        const files = unzipSync(await writeProjectFile(sampleProject().input))
        const manifest = JSON.parse(strFromU8(files['manifest.json']))
        expect(manifest.format).toBe(PROJECT_FILE_FORMAT)
        expect(manifest.minReader).toBe(1)
        expect(strFromU8(files['manifest.sha256']).trim()).toBe(await sha256(files['manifest.json']))
    })
})

describe('fichier de projet .nestorcut : noms', () => {
    it('reconnaît l’extension', () => {
        expect(isProjectFileName('Atelier.NESTORCUT')).toBe(true)
        expect(isProjectFileName('piece.dxf')).toBe(false)
        expect(isProjectFileName(null)).toBe(false)
    })

    it('nettoie le titre pour le nom proposé', () => {
        expect(projectFileName('Bride / plaques : lot 3')).toBe('Bride plaques lot 3.nestorcut')
        expect(projectFileName('  ')).toBe('projet.nestorcut')
        expect(projectFileName('fin.')).toBe('fin.nestorcut')
    })
})
