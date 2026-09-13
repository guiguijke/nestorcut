/**
 * Verrous du lot J4 — le DÉPÔT d'un `.job` SheetCam (point 1 et 2 de la
 * consigne §5 de `docs/REPRISE-2026-09-13.md`).
 *
 * Ce qui est mesuré :
 *   - un `.job` est reconnu dans une dépose PAR SA SIGNATURE, même renommé,
 *     et un DXF renommé `.job` ne l'est pas (piège #31) ;
 *   - les dessins réclamés sont appariés par NOM DE FICHIER, casse ignorée
 *     (règle 9 : le `.job` ne connaît de ses dessins qu'un chemin Windows) ;
 *   - ce qui manque est NOMMÉ, pas avalé ;
 *   - les réglages pré-remplis viennent du fichier et de nulle part ailleurs,
 *     et un `.job` sans kerf exploitable ne pré-remplit PAS l'espacement.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { readSheetCamJob } from '../composables/localImport'
import {
    cutSettingsFor,
    matchDrawings,
    prefillFromJob,
    splitSheetCamDrop,
} from '../composables/sheetcamJobImport'

const FIX = path.resolve(__dirname, 'fixtures/sheetcam')
const JOB_BYTES = new Uint8Array(fs.readFileSync(path.join(FIX, 'x4-reference.job')))
const DXF_BYTES = new TextEncoder().encode('0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n')

/** Un `File` de test — `arrayBuffer()` suffit à tout ce qu'on appelle. */
const fileOf = (name, bytes) => ({
    name,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
})

describe('J4 — reconnaître le `.job` dans une dépose', () => {
    it('par signature, même renommé — et pas un DXF renommé `.job`', async () => {
        const renomme = await splitSheetCamDrop([fileOf('job-renomme.dxf', JOB_BYTES)])
        expect(renomme).not.toBeNull()
        expect(renomme.jobFile.name).toBe('job-renomme.dxf')

        // CONTRÔLE NÉGATIF : l'extension ne décide de rien.
        const leurre = await splitSheetCamDrop([fileOf('dessin.job', DXF_BYTES)])
        expect(leurre).toBeNull()

        // Et une dépose ordinaire ne paie rien : `null`, chemin inchangé.
        expect(await splitSheetCamDrop([fileOf('a.dxf', DXF_BYTES)])).toBeNull()
        expect(await splitSheetCamDrop([])).toBeNull()
    })

    it('sépare le `.job` de ses dessins', async () => {
        const job = fileOf('mon-job.job', JOB_BYTES)
        const a = fileOf('Piece_Trou.DXF', DXF_BYTES)
        const b = fileOf('Piece_Fillx4.DXF', DXF_BYTES)
        const drop = await splitSheetCamDrop([a, job, b])
        expect(drop.jobFile).toBe(job)
        expect(drop.drawings.map((f) => f.name)).toEqual(['Piece_Trou.DXF', 'Piece_Fillx4.DXF'])
        expect(drop.extraJobs).toBe(0)
    })

    it('deux `.job` dans la même dépose : le premier fait foi, et c’est dit', async () => {
        // Deux `.job`, ce sont deux jobs de découpe : on ne les fusionne pas.
        const drop = await splitSheetCamDrop([
            fileOf('un.job', JOB_BYTES),
            fileOf('deux.job', JOB_BYTES),
        ])
        expect(drop.jobFile.name).toBe('un.job')
        expect(drop.extraJobs).toBe(1)
    })
})

describe('J4 — apparier les dessins, et nommer ce qui manque', () => {
    const read = readSheetCamJob(JOB_BYTES)

    it('le fichier réclame ses deux dessins, avec leurs quantités', () => {
        // La référence pose 5 pièces : l'hôte une fois, l'éventail quatre
        // fois (un original + trois `copyOf`, règle 4).
        expect(read.drawings.map((d) => [d.name, d.quantity]))
            .toEqual([['Piece_Trou.DXF', 1], ['Piece_Fillx4.DXF', 4]])
    })

    it('apparie en ignorant la casse (un `.job` Windows écrit `.DXF`)', () => {
        const { matched, missing } = matchDrawings(read, [
            fileOf('piece_trou.dxf', DXF_BYTES),
            fileOf('PIECE_FILLX4.DXF', DXF_BYTES),
        ])
        expect(missing).toEqual([])
        expect(matched.map((m) => m.file.name)).toEqual(['piece_trou.dxf', 'PIECE_FILLX4.DXF'])
    })

    it('un dessin absent est NOMMÉ, jamais avalé', () => {
        const { matched, missing } = matchDrawings(read, [fileOf('Piece_Trou.DXF', DXF_BYTES)])
        expect(matched).toHaveLength(1)
        expect(missing.map((d) => d.name)).toEqual(['Piece_Fillx4.DXF'])
    })
})

describe('J4 — les réglages pré-remplis viennent du fichier', () => {
    const read = readSheetCamJob(JOB_BYTES)

    it('tôle depuis [Work], espacement depuis le kerf de [Tool0]', () => {
        const p = prefillFromJob(read)
        expect(p.sheet).toEqual({ width: 1000, height: 1250, count: 1 })
        expect(p.kerf).toBe('1.5')
        expect(p.safety).toBe('0.25')
        expect(p.space).toBe(2)          // 1,5 + 2 × 0,25, règle 3.10
    })

    it('la sécurité pré-remplie est celle de la RÈGLE, pas celle du projet', () => {
        // Un projet neuf porte la sécurité d'usine (1 mm), qui donnerait
        // 3,5 mm pour ce kerf — alors que l'atelier coupe ce job à 2 mm.
        // L'écart n'est pas cosmétique : mesuré au harnais navigateur, à
        // 3,5 mm les quatre éventails de la recette ne tiennent plus dans le
        // trou de l'hôte et sortent posés à côté ; à 2 mm ils s'y nichent.
        expect(prefillFromJob(read).space).toBe(2)
        // La valeur reste une ENTRÉE : un appelant qui sait ce qu'il fait
        // peut en imposer une autre.
        expect(prefillFromJob(read, { safetyMm: 1 }).space).toBe(3.5)
    })

    it('sans kerf exploitable, l’espacement n’est PAS pré-rempli', () => {
        // On ne remplit pas un champ avec une valeur inventée : un `.job`
        // sans kerf laisse l'espacement du projet tel quel.
        const sansKerf = { ...read, kerfWidth: null }
        const p = prefillFromJob(sansKerf)
        expect(p.space).toBeUndefined()
        expect(p.kerf).toBeUndefined()
        expect(p.sheet).toBeTruthy()      // la tôle, elle, reste lisible
    })
})

describe('J4 — les réglages de coupe transmis au nesting', () => {
    const read = readSheetCamJob(JOB_BYTES)

    it('amorce et coin de départ viennent de l’opération du dessin', () => {
        const cut = cutSettingsFor(read.drawings[0], { jobName: 'mon-job.job' })
        expect(cut.leadIn).toBe(5)
        expect(cut.startPosition).toBe(0)
        expect(cut.pierceMarginMm).toBe(3)
        expect(cut.drawingName).toBe('Piece_Trou.DXF')
        expect(cut.jobName).toBe('mon-job.job')
    })

    it('`startPositionConfirmed` est FAUX tant que la machine n’a pas parlé', () => {
        // C'est ce faux qui fait réserver les QUATRE coins candidats au lieu
        // du seul coin prédit : juste quelle que soit la table
        // `Start position` → coin, qui n'est pas confirmée (question ouverte
        // §9 de l'étude). Le jour où le propriétaire répond, ce drapeau
        // passe à vrai et la réserve tombe de ~4,6 % à ~1,1 % de l'aire du
        // trou. Ce verrou existe pour que ce passage soit un CHOIX, pas un
        // oubli.
        expect(cutSettingsFor(read.drawings[0]).startPositionConfirmed).toBe(false)
    })
})
