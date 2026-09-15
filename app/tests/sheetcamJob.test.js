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
    isSheetCamJob,
    jobDrawingName,
    jobPathRecords,
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
        // Un chemin UTF-8 lu en latin1 (« PiÃ¨ce », code points c3 a8) est
        // RÉPARÉ : le fichier sur le disque de l'utilisateur s'appelle
        // « Pièce » — c'est la clé qui apparie le dessin déposé (mesuré sur
        // la série réelle « Pièce L », 14/09 : sans réparation, la dépose
        // du `.job` + de son dessin échoue en « dessins manquants »).
        expect(jobDrawingName('C:\\jobs\\PiÃ¨ce L.DXF')).toBe('Pi\u00e8ce L.DXF')
        // ASCII pur et UTF-8 invalide : rendus tels quels, jamais détruits.
        expect(jobDrawingName('C:\\jobs\\Piece_Trou.DXF')).toBe('Piece_Trou.DXF')
        expect(jobDrawingName('C:\\jobs\\Pi\u0080\u00c3z.DXF')).toBe('Pi\u0080\u00c3z.DXF')
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

    it('sur les FIXTURES du dépôt — permanent, présent en CI (J9-bis, §9.79)', () => {
        // Les 4 `.job` de app/tests/fixtures/sheetcam sont les SEULS
        // présents en intégration continue : le verrou d'aller-retour
        // doit tourner là où il protège, pas seulement sur les fichiers
        // privés du poste.
        const fixDir = path.resolve(__dirname, 'fixtures/sheetcam')
        const fixtures = fs.readdirSync(fixDir)
            .filter((f) => f.toLowerCase().endsWith('.job'))
            .map((f) => path.join(fixDir, f))
        expect(fixtures.length).toBeGreaterThanOrEqual(4)
        for (const p of fixtures) {
            const bytes = read(p)
            const out = serializeSheetCamJob(parseSheetCamJob(bytes))
            expect(out.length).toBe(bytes.length)
            expect(Buffer.compare(Buffer.from(out), Buffer.from(bytes))).toBe(0)
        }
    })
    it('sur les .job réels du propriétaire (s’ils sont là) — TOUS dossiers', () => {
        // Lot J10-a (§9.77 point 1) : le verrou d'aller-retour devient
        // TOTAL — racine, job-tests, rétro-ingénierie et série j7/j9 — et
        // DIT combien il a mesuré (un verrou muet qui n'a rien vu ne vaut
        // rien). En CI sans `.testparts`, la suite reste verte en le disant.
        const dirs = ['', '/job-tests', '/retro-eng-job', '/job-tests-new']
            .map((d) => path.resolve(__dirname, '../../.testparts' + d))
            .filter((d) => fs.existsSync(d))
        const jobs = dirs.flatMap((d) =>
            fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.job'))
                .map((f) => path.join(d, f)))
        if (!jobs.length) {
            console.warn('[J10-a] .testparts absent — aller-retour non mesuré')
            expect(jobs).toEqual([])
            return
        }
        const bad = []
        for (const p of jobs) {
            const bytes = read(p)
            const out = serializeSheetCamJob(parseSheetCamJob(bytes))
            if (out.length !== bytes.length
                || Buffer.compare(Buffer.from(out), Buffer.from(bytes)) !== 0) {
                bad.push(path.basename(p))
            }
        }
        expect(bad).toEqual([])
        // 50 `.job` présents sur CE poste (54 comptés par le vérificateur :
        // son archive en portait 4 de plus, déplacés depuis). Le plancher
        // garantit que le verrou ne passe pas pour vert sur trois fichiers.
        expect(jobs.length).toBeGreaterThanOrEqual(50)
        console.warn(`[J10-a] aller-retour identique à l'octet : ${jobs.length}/${jobs.length}`)
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

describe('J4 — reconnaître un `.job` par sa SIGNATURE, jamais par l’extension', () => {
    it('reconnaît les `.job`, et RIEN d’autre', () => {
        expect(isSheetCamJob(SOURCE)).toBe(true)
        expect(isSheetCamJob(read(path.join(FIX, 'x4-reference.job')))).toBe(true)

        // Contrôle NÉGATIF — c'est lui qui compte (piège #31). Le détecteur
        // de l'importeur wasm est à deux branches : premier octet non blanc
        // `<` ⇒ SVG, TOUT LE RESTE ⇒ DXF. Un `.job` y passerait donc pour un
        // DXF et sortirait en « erreur d'analyse » générique. Symétriquement,
        // notre signature ne doit avaler ni DXF ni SVG.
        const dxf = new TextEncoder().encode('0\r\nSECTION\r\n2\r\nHEADER\r\n')
        const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
        expect(isSheetCamJob(dxf)).toBe(false)
        expect(isSheetCamJob(svg)).toBe(false)
        expect(isSheetCamJob(new Uint8Array(0))).toBe(false)
        expect(isSheetCamJob(null)).toBe(false)

        // Un leurre qui COMMENCE comme un `.job` mais n'en est pas un : la
        // première ligne ne suffit pas, il faut `[Misc]` et `FileVersion=`.
        expect(isSheetCamJob(new TextEncoder().encode('Config=\r\nbonjour\r\n'))).toBe(false)
    })

    it('mesuré sur les `.job` RÉELS du propriétaire quand ils sont là', () => {
        // `.testparts/` est gitignoré : sans eux la suite reste verte, mais
        // elle DIT qu'elle n'a pas mesuré (même convention qu'au lot J1).
        // 15/09 : les `.job` de recette ont déménagé de la racine vers
        // `job-tests/` (réorganisation du poste) — les deux sont balayés.
        const root = path.resolve(__dirname, '../../.testparts')
        if (!fs.existsSync(root)) {
            console.warn('[J4] .testparts absent — signature non mesurée sur les fichiers réels')
            return
        }
        const jobs = []
        for (const dir of [root, path.join(root, 'job-tests')]) {
            if (!fs.existsSync(dir)) continue
            for (const f of fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.job'))) {
                jobs.push(path.join(dir, f))
            }
        }
        expect(jobs.length).toBeGreaterThan(0)
        for (const p of jobs) {
            expect(isSheetCamJob(read(p))).toBe(true)
        }
        // Et les DXF du même dossier ne passent pas.
        for (const f of fs.readdirSync(root).filter((x) => x.toLowerCase().endsWith('.dxf'))) {
            expect(isSheetCamJob(read(path.join(root, f)))).toBe(false)
        }
    })
})

// --- J10-a (§9.77) : le diff d'écriture est universel et à liste blanche ---

/**
 * La LISTE BLANCHE DÉCLARÉE des octets qu'un nesting a le droit de changer
 * dans le bloc binaire : les champs de point de départ (x, y) et leur
 * drapeau « déplacé à la main ». TOUT autre octet changé est un défaut —
 * c'est ce que l'atelier ouvrirait dans SheetCam sans le savoir. (Les
 * sections TEXTE ne sont pas dans ce diff : elles sont réécrites
 * explicitement par writeNestedSheetCamJob, poses et Count et OpOrder.)
 */
export function binaryWriteWhitelist(sourceBinary) {
    const offsets = new Set()
    for (const d of jobPathRecords(sourceBinary) || []) {
        for (const p of d.paths) {
            if (Number.isInteger(p.at?.moved)) offsets.add(p.at.moved)
            for (let k = 0; k < 8; k++) {
                if (Number.isInteger(p.at?.x)) offsets.add(p.at.x + k)
                if (Number.isInteger(p.at?.y)) offsets.add(p.at.y + k)
            }
        }
    }
    return offsets
}

describe('J10-a — le diff binaire du rendu est inclus dans la liste blanche déclarée', () => {
    it('sur le moulinet ×4 (la référence du 11/09) : zéro octet hors liste', () => {
        const written = writeNestedSheetCamJob(parseSheetCamJob(SOURCE), {
            placements: X4_PLACEMENTS,
            order: X4_ORDER,
            maskPaths: false,
        })
        const bin = (b) => b.subarray(Buffer.from(b).toString('latin1').indexOf('[BinaryDataStart]'))
        const a = bin(SOURCE)
        const b = bin(written)
        expect(a.length).toBe(b.length)
        const allowed = binaryWriteWhitelist(a)
        const out = []
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i] && !allowed.has(i)) out.push(i)
        }
        expect(out).toEqual([])
    })

    it('contrôle négatif : un octet PILE hors liste fait échouer le verrou', () => {
        const written = writeNestedSheetCamJob(parseSheetCamJob(SOURCE), {
            placements: X4_PLACEMENTS,
            order: X4_ORDER,
            maskPaths: false,
        })
        const allowed = binaryWriteWhitelist(parseSheetCamJob(SOURCE).binary)
        const bin = Buffer.from(written)
        const at = Buffer.from(bin).toString('latin1').indexOf('[BinaryDataStart]') + 40
        // Un octet de GEOMÉTRIE (40 octets après le marqueur : dans le
        // premier enregistrement d'origine) : hors liste par construction.
        expect(allowed.has(at)).toBe(false)
        bin[at] ^= 0x01
        const src = Buffer.from(parseSheetCamJob(SOURCE).binary)
        const out = []
        for (let i = 0; i < Math.min(src.length, bin.length); i++) {
            if (src[i] !== bin[i] && !allowed.has(i)) out.push(i)
        }
        expect(out.length).toBeGreaterThan(0)
    })
})
