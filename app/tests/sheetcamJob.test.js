/**
 * Verrous du lot J1 (`docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §8) — lecteur /
 * écrivain de `.job` SheetCam.
 *
 * Les deux verrous demandés par la consigne :
 *
 *   1. **lire puis écrire sans modification = octets identiques**, sur les
 *      fixtures anonymisées ET sur les quatorze `.job` réels du propriétaire
 *      quand ils sont présents (`.testparts/`, gitignoré — la suite reste
 *      verte sans eux, mais alors elle DIT qu'elle n'a pas mesuré) ;
 *   2. le fichier produit pour le **moulinet ×4** est celui de la référence
 *      du 11/09, à l'octet près sur le texte et à 1e−9 sur les flottants.
 *
 * Plus la forme mesurée : le bloc binaire intact, `Count`, `copyOf`,
 * `Optimisation=3`, `[OpOrder]`, les chemins absolus masqués, le format
 * `%.15g` et son zéro négatif.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
    OPTIMISATION_MANUAL_KEEP_PARTS,
    SUPPORTED_JOB_VERSIONS,
    SheetCamJobError,
    formatJobNumber,
    jobDrawingName,
    jobSheet,
    parseSheetCamJob,
    serializeSheetCamJob,
    writeNestedSheetCamJob,
} from '../../shared/sheetcamJob'

const FIX = path.resolve(__dirname, 'fixtures/sheetcam')
const read = (p) => new Uint8Array(fs.readFileSync(p))
const SOURCE = read(path.join(FIX, 'source.job'))
const X4 = read(path.join(FIX, 'x4-reference.job'))

const CRLF = '\r\n'
const text = (bytes) => Buffer.from(bytes).toString('latin1')
const textPart = (bytes) => {
    const s = text(bytes)
    return s.slice(0, s.indexOf('[BinaryDataStart]'))
}

// Les poses du moulinet ×4, LUES dans le fichier de référence : le lot J1
// écrit ce qu'on lui donne, la conversion depuis une pose moteur est le lot
// J2. Angle −0 sur le premier exemplaire : c'est ce que porte la référence.
const X4_PLACEMENTS = [
    { part: 0, xPos: 50, yPos: 50, angle: 0 },
    { part: 1, xPos: 50, yPos: 66.828, angle: -0 },
    { part: 1, xPos: 33.172, yPos: 50, angle: -1.5707963267948966 },
    { part: 1, xPos: 50, yPos: 33.172, angle: -3.141592653589793 },
    { part: 1, xPos: 66.828, yPos: 50, angle: -4.712388980384690 },
]
// Nichées d'abord (rangs 1 à 4), hôte en dernier (rang 0) — règle 8.
const X4_ORDER = [[1, 0], [2, 0], [3, 0], [4, 0], [0, 0]]

describe('J1 — lecture', () => {
    it('lit la tôle, le kerf, les pièces et leurs amorces', () => {
        const job = parseSheetCamJob(SOURCE)
        expect(job.fileVersion).toBe(1003)
        expect(SUPPORTED_JOB_VERSIONS).toContain(job.fileVersion)
        expect(jobSheet(job)).toEqual({ width: 1000, height: 1250 })
        expect(job.kerfWidth).toBe(1.5)
        expect(job.count).toBe(2)
        expect(job.optimisation).toBe(0)

        expect(job.parts).toHaveLength(2)
        const [host, fan] = job.parts
        expect(host.name).toBe('Piece_Trou')
        expect(host.copyOf).toBe(-1)
        expect([host.xPos, host.yPos, host.angle]).toEqual([50, 50, 0])
        expect(fan.name).toBe('Piece_Fillx4')
        expect([fan.xPos, fan.yPos]).toEqual([135, 50.41421356235])

        // Amorces : longueur ET type, plus le coin de départ — la géométrie
        // de l'amorce, elle, n'est pas dans le fichier (§7 de l'étude).
        expect(host.operations).toHaveLength(1)
        const op = host.operations[0]
        expect(op.type).toBe('JetOperation')
        expect([op.leadIn, op.leadInType, op.leadOut, op.leadOutType]).toEqual([5, 1, 5, 1])
        expect(op.startPosition).toBe(0)
        expect(op.enabled).toBe(true)
    })

    it('masque le chemin absolu que l’utilisateur nous a confié (règle 9)', () => {
        const job = parseSheetCamJob(SOURCE)
        expect(job.parts[0].drawingFile).toBe('C:\\jobs\\Piece_Trou.DXF')
        expect(job.parts[0].drawingName).toBe('Piece_Trou.DXF')
        expect(jobDrawingName('/home/u/dessins/a.dxf')).toBe('a.dxf')
        expect(jobDrawingName('a.dxf')).toBe('a.dxf')
        expect(jobDrawingName(null)).toBe('')
    })

    it('garde le bloc binaire en octets, sans le décoder', () => {
        const job = parseSheetCamJob(SOURCE)
        // 2 700 octets pour deux dessins — la valeur mesurée par l'étude.
        expect(job.binary.length).toBe(2700)
        expect(text(job.binary).startsWith('[BinaryDataStart]')).toBe(true)
        // Le marqueur n'est PAS suivi d'un saut de ligne (mesuré) : écrire
        // un CRLF ici décalerait tout le cache géométrique de SheetCam.
        expect(text(job.binary)[17]).not.toBe('\r')
    })

    it('refuse ce qu’il ne sait pas lire, plutôt que de deviner', () => {
        expect(() => parseSheetCamJob('pas des octets')).toThrow(SheetCamJobError)
        expect(() => parseSheetCamJob(new Uint8Array([1, 2, 3])))
            .toThrow(/sheetcamJob.noBinaryBlock/)

        const bumped = new Uint8Array(
            Buffer.from(text(SOURCE).replace('FileVersion=1003', 'FileVersion=1099'), 'latin1'),
        )
        try {
            parseSheetCamJob(bumped)
            throw new Error('aurait dû refuser')
        } catch (err) {
            expect(err.code).toBe('sheetcamJob.unsupportedVersion')
            expect(err.params).toEqual({ version: '1099', supported: '1003' })
        }
    })
})

describe('J1 — lire puis écrire ne change pas un octet', () => {
    it('sur les deux fixtures anonymisées', () => {
        for (const bytes of [SOURCE, X4]) {
            const out = serializeSheetCamJob(parseSheetCamJob(bytes))
            expect(out.length).toBe(bytes.length)
            expect(Buffer.compare(Buffer.from(out), Buffer.from(bytes))).toBe(0)
        }
    })

    it('sur les .job réels du propriétaire (s’ils sont là)', () => {
        const dir = path.resolve(__dirname, '../../.testparts')
        const jobs = fs.existsSync(dir)
            ? fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.job'))
            : []
        // Dossier privé et gitignoré : en CI il n'existe pas. On ne fait pas
        // passer un verrou pour vert alors qu'il n'a rien mesuré.
        if (!jobs.length) {
            expect(jobs).toEqual([])
            return
        }
        const rebuilt = jobs.filter((f) => {
            const bytes = read(path.join(dir, f))
            const out = serializeSheetCamJob(parseSheetCamJob(bytes))
            return Buffer.compare(Buffer.from(out), Buffer.from(bytes)) === 0
        })
        expect(rebuilt.length).toBe(jobs.length)
        expect(jobs.length).toBeGreaterThanOrEqual(14)
    })
})

describe('J1 — écriture du moulinet ×4', () => {
    const written = writeNestedSheetCamJob(parseSheetCamJob(SOURCE), {
        placements: X4_PLACEMENTS,
        order: X4_ORDER,
        // La référence du 11/09 porte encore les chemins : pour comparer
        // ligne à ligne, on ne masque pas ici (le masquage a son propre test).
        maskPaths: false,
    })

    it('rend le fichier de référence, texte identique', () => {
        expect(textPart(written)).toBe(textPart(X4))
    })

    it('rend le bloc binaire de la référence, octet pour octet', () => {
        const bin = (b) => Buffer.from(b).subarray(text(b).indexOf('[BinaryDataStart]'))
        expect(Buffer.compare(bin(written), bin(X4))).toBe(0)
    })

    it('et donc le fichier entier', () => {
        expect(Buffer.compare(Buffer.from(written), Buffer.from(X4))).toBe(0)
    })

    it('contrôle négatif : le verrou sait échouer', () => {
        // Les deux fixtures sont bien DIFFÉRENTES (sinon le test ci-dessus
        // passerait sans rien écrire) …
        expect(textPart(SOURCE)).not.toBe(textPart(X4))
        // … et une pose fausse d'un dixième de degré ne passe pas.
        const wrong = writeNestedSheetCamJob(parseSheetCamJob(SOURCE), {
            placements: X4_PLACEMENTS.map((p, i) => (
                i === 1 ? { ...p, angle: 0 } : p)),
            order: X4_ORDER,
            maskPaths: false,
        })
        expect(textPart(wrong)).not.toBe(textPart(X4))
        // Le seul écart est le zéro négatif : « Angle=0 » contre « Angle=-0 ».
        const refLines = textPart(X4).split(CRLF)
        const diff = textPart(wrong).split(CRLF).filter((l, k) => l !== refLines[k])
        expect(diff).toEqual(['Angle=0'])
    })

    it('pose Count, copyOf, Optimisation=3 et l’ordre de coupe', () => {
        const job = parseSheetCamJob(written)
        expect(job.count).toBe(5)
        expect(job.optimisation).toBe(OPTIMISATION_MANUAL_KEEP_PARTS)
        expect(job.parts.map((p) => p.copyOf)).toEqual([-1, -1, 1, 1, 1])
        // Les originaux n'ont pas changé de rang (règle 6 : le bloc binaire
        // est lié aux sections par leur rang).
        expect(job.parts.slice(0, 2).map((p) => p.name))
            .toEqual(['Piece_Trou', 'Piece_Fillx4'])
        const ops = textPart(written)
            .split('\r\n')
            .filter((l) => /^Op\d{6}=/.test(l))
        expect(ops).toEqual([
            'Op000000=1,0', 'Op000001=2,0', 'Op000002=3,0',
            'Op000003=4,0', 'Op000004=0,0',
        ])
    })

    it('les copies portent le dessin et le nom de leur original', () => {
        const job = parseSheetCamJob(written)
        for (const copy of job.parts.filter((p) => p.copyOf >= 0)) {
            const original = job.parts.find((p) => p.index === copy.copyOf)
            expect(copy.drawingFile).toBe(original.drawingFile)
            expect(copy.name).toBe(original.name)
            expect(copy.enabled).toBe(true)
        }
    })

    it('masque les chemins quand on le demande (le défaut du produit)', () => {
        const masked = writeNestedSheetCamJob(parseSheetCamJob(SOURCE), {
            placements: X4_PLACEMENTS, order: X4_ORDER,
        })
        const files = parseSheetCamJob(masked).parts.map((p) => p.drawingFile)
        expect(files).toEqual([
            'Piece_Trou.DXF', 'Piece_Fillx4.DXF',
            'Piece_Fillx4.DXF', 'Piece_Fillx4.DXF', 'Piece_Fillx4.DXF',
        ])
        expect(textPart(masked)).not.toContain('C:\\jobs')
    })

    it('désactive une pièce que le nesting n’a pas posée, sans la supprimer', () => {
        // Supprimer la section décalerait les rangs, donc le bloc binaire.
        const only = writeNestedSheetCamJob(parseSheetCamJob(SOURCE), {
            placements: [{ part: 1, xPos: 10, yPos: 20, angle: 0 }],
        })
        const job = parseSheetCamJob(only)
        expect(job.parts[0].enabled).toBe(false)
        expect(job.parts[1].enabled).toBe(true)
        expect(job.parts).toHaveLength(2)
    })

    it('refuse une pose sans pièce, et une liste vide', () => {
        const job = parseSheetCamJob(SOURCE)
        expect(() => writeNestedSheetCamJob(job, { placements: [] }))
            .toThrow(/noPlacements/)
        expect(() => writeNestedSheetCamJob(job, {
            placements: [{ part: 7, xPos: 0, yPos: 0, angle: 0 }],
        })).toThrow(/unknownPart/)
    })
})

describe('J1 — format des nombres (%.15g, mesuré sur la référence)', () => {
    it('quinze chiffres significatifs, zéros de queue retirés', () => {
        expect(formatJobNumber(-Math.PI / 2)).toBe('-1.5707963267949')
        expect(formatJobNumber(-Math.PI)).toBe('-3.14159265358979')
        expect(formatJobNumber(-3 * Math.PI / 2)).toBe('-4.71238898038469')
        expect(formatJobNumber(66.828)).toBe('66.828')
        expect(formatJobNumber(50)).toBe('50')
        expect(formatJobNumber(50.41421356235)).toBe('50.41421356235')
    })

    it('écrit le zéro NÉGATIF « -0 », comme la référence', () => {
        // `String(-0)` rend « 0 » en JavaScript : un octet d'écart sur le
        // fichier rendu, et le verrou du ×4 tombe.
        expect(formatJobNumber(-0)).toBe('-0')
        expect(formatJobNumber(0)).toBe('0')
    })

    it('bascule en exponentielle comme %g, et refuse l’infini', () => {
        expect(formatJobNumber(1e-5)).toBe('1e-05')
        expect(formatJobNumber(1e16)).toBe('1e+16')
        expect(formatJobNumber(0.0001)).toBe('0.0001')
        expect(() => formatJobNumber(Infinity)).toThrow(/badNumber/)
        expect(() => formatJobNumber('abc')).toThrow(/badNumber/)
    })
})
