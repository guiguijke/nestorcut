/**
 * Verrous du lot J8-b (étude §9.73 point 12) — les amorces SE VOIENT, avant
 * et pendant le nesting, sans jamais contredire la réserve.
 *
 *   1. `leadWorldPaths` : un arc rendu COMMENCE au point de départ décalé de
 *      kerf/2 vers la chute et FINIT au bout libre, à 1e-9 ;
 *   2. PARITÉ avec la réserve : l'enveloppe convexe des chemins rendus est
 *      INCLUSE dans `leadEnvelopePoints` (mêmes entrées) — sinon la place
 *      gardée au nesting et le trait montré à l'atelier se contrediraient ;
 *   3. la tangente se dessine en ZONE (trois points d'éventail), jamais en
 *      droite certaine ; « aucune » ne dessine rien ;
 *   4. `drawingLeadShapes` n'invente rien : un point non posable est OMIS ;
 *   5. l'aperçu avec amorces porte le trait fin ambré et le disque de
 *      perçage ; une fiche sans `.job` rend un aperçu IDENTIQUE (négatif).
 *
 * Et les TEXTES FIGÉS du lot J8-e (point 30) — parité EN/FR exacte.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
    LEAD_ARC, LEAD_NONE, LEAD_PERPENDICULAR, LEAD_TANGENT,
    leadEnvelopePoints, leadFramesAt, leadWorldPaths, drawingLeadShapes,
    pierceDisc, pierceRadiusFromKerf,
} from '../../shared/sheetcamReserve'
import { previewSvgWithLeads } from '../composables/localImport'

// --- hull convexe + containment (le verrou de parité) -----------------------

function convexHull(points) {
    const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const lower = []
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
        lower.push(p)
    }
    const upper = []
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i]
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
        upper.push(p)
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1))
}

function insideHull(p, hull) {
    // Orientation-agnostique : intérieur = « tout du même côté » de chaque
    // arête (à l'epsilon près — le bord compte comme dedans).
    let pos = 0
    let neg = 0
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i]
        const b = hull[(i + 1) % hull.length]
        const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
        if (c > 1e-9) pos++
        if (c < -1e-9) neg++
    }
    return pos === 0 || neg === 0
}

// --- les entrées de référence ------------------------------------------------

const KERF = 2
const ARGS = {
    point: [10, 20],
    startFrame: { tangent: [1, 0], normal: [0, 1] },
    endFrame: { tangent: [1, 0], normal: [0, 1] },
    leadIn: 5,
    leadInType: LEAD_ARC,
    leadOut: 10,
    leadOutType: LEAD_ARC,
    kerf: KERF,
}

describe('J8-b — leadWorldPaths', () => {
    it('un arc commence au point décalé de kerf/2 vers la chute, finit au bout libre (1e-9)', () => {
        const { inPath, outPath, pierce } = leadWorldPaths(ARGS)
        expect(inPath.kind).toBe('arc')
        // Départ = point + normale · (kerf/2) — le chemin d'outil est décalé
        // du demi-kerf VERS la chute, comme la réserve.
        expect(inPath.points[0][0]).toBeCloseTo(10, 9)
        expect(inPath.points[0][1]).toBeCloseTo(20 + KERF / 2, 9)
        // Arrivée = le bout libre (point de perçage), r = 0,64 × 5 = 3,2.
        const r = 0.64 * 5
        expect(inPath.points[inPath.points.length - 1][0]).toBeCloseTo(10 - r, 9)
        expect(inPath.points[inPath.points.length - 1][1]).toBeCloseTo(20 + KERF / 2 + r, 9)
        // La SORTIE part du même point décalé, vers l'autre sens.
        expect(outPath.kind).toBe('arc')
        expect(outPath.points[0][1]).toBeCloseTo(20 + KERF / 2, 9)
        // Le disque de perçage : au bout libre de l'entrée, 2 × kerf (§9.51).
        expect(pierce.c[0]).toBeCloseTo(inPath.points[inPath.points.length - 1][0], 9)
        expect(pierce.r).toBeCloseTo(pierceRadiusFromKerf(KERF).radius, 9)
    })

    it('parité avec la réserve : tout point rendu est DANS l\'enveloppe réservée', () => {
        for (const type of [LEAD_ARC, LEAD_TANGENT, LEAD_PERPENDICULAR]) {
            const args = { ...ARGS, leadInType: type, leadOutType: type }
            const hull = convexHull(leadEnvelopePoints(args))
            expect(hull.length).toBeGreaterThan(2)
            const { inPath, outPath, pierce } = leadWorldPaths(args)
            const rendered = [
                ...(inPath.points || []),
                ...(outPath.points || []),
                ...(inPath.zone || []),
                ...(outPath.zone || []),
                // MÊME échantillonnage que l'enveloppe (polygone CIRCONSCRIT :
                // un découpage plus grossier dépasserait le bord par
                // construction, ce ne serait pas un défaut de parité).
                ...pierceDisc(pierce.c, pierce.r),
            ]
            const out = rendered.filter((p) => !insideHull(p, hull))
            expect(out).toEqual([]) // type ${type}
        }
    })

    it('la tangente est une ZONE (éventail), pas une droite certaine', () => {
        const { inPath } = leadWorldPaths({ ...ARGS, leadInType: LEAD_TANGENT })
        expect(inPath.kind).toBe('tangent')
        expect(inPath.points).toBeNull()
        expect(inPath.zone).toHaveLength(3)
        expect(inPath.zone[0][1]).toBeCloseTo(20 + KERF / 2, 9)
    })

    it('« aucune » ne dessine rien ; longueur nulle non plus', () => {
        const none = leadWorldPaths({ ...ARGS, leadInType: LEAD_NONE, leadOutType: LEAD_NONE })
        expect(none.inPath.kind).toBe('none')
        expect(none.outPath.kind).toBe('none')
        const zero = leadWorldPaths({ ...ARGS, leadIn: 0, leadOut: 0 })
        expect(zero.inPath.kind).toBe('none')
        // Et le perçage existe TOUJOURS (§9.51 : la torche perce).
        expect(zero.pierce.r).toBeGreaterThan(0)
    })

    it('leadFramesAt pose les repères sur l\'anneau, ou refuse', () => {
        const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
        const frames = leadFramesAt(square, [5, 0], false)
        expect(frames).not.toBeNull()
        const t = frames.start.tangent
        expect(Math.hypot(t[0], t[1])).toBeCloseTo(1, 9)
        expect(t[0] * frames.start.normal[0] + t[1] * frames.start.normal[1]).toBeCloseTo(0, 9)
        // Anneau dégénéré / point absent : null, le consommateur ne dessine
        // rien — il n'invente pas.
        expect(leadFramesAt([[0, 0], [1, 1]], [0, 0], false)).toBeNull()
        expect(leadFramesAt(square, null, false)).toBeNull()
    })
})

describe('J8-b — drawingLeadShapes (n\'invente rien)', () => {
    const outer = [[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]]
    const hole = [[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]
    const base = {
        rings: [outer, hole],
        isHole: [false, true],
        origin: [0, 0],
        kerf: 1.5,
        leadIn: 5, leadInType: LEAD_ARC,
        leadOut: 10, leadOutType: LEAD_ARC,
    }

    it('chaque point posable a SA forme, sur SON anneau', () => {
        const shapes = drawingLeadShapes({
            ...base,
            starts: [{ offset: [15, 0] }, { offset: [15, 10] }],
        })
        expect(shapes).toHaveLength(2)
        expect(shapes[0].ringIndex).toBe(0) // contour
        expect(shapes[1].ringIndex).toBe(1) // trou
        expect(shapes[0].inPath.kind).toBe('arc')
    })

    it('un point non posable est OMIS, jamais rapproché de force', () => {
        const shapes = drawingLeadShapes({
            ...base,
            starts: [{ offset: [15, 0] }, { offset: [500, 500] }],
        })
        expect(shapes).toHaveLength(1)
    })

    it('l\'origine du `.job` s\'applique (offset + origin = dessin)', () => {
        // Les anneaux sont DÉJÀ en coordonnées du dessin : l'origine du
        // `.job` ramène l'offset LU sur ces anneaux (même règle
        // qu'assignJobBlocks). Contour posé à (100, 50) :
        const shifted = [[100, 50], [130, 50], [130, 80], [100, 80], [100, 50]]
        const shapes = drawingLeadShapes({
            ...base,
            rings: [shifted],
            origin: [100, 50],
            starts: [{ offset: [15, 0] }], // + origine (100, 50) → (115, 50)
        })
        expect(shapes).toHaveLength(1)
        // L'amorce part du point de départ du DESSIN (115, …), pas de
        // l'offset brut (15, …) — décalée du demi-kerf vers la chute.
        expect(shapes[0].inPath.points[0][0]).toBeCloseTo(115, 6)
    })
})

describe('J8-b — l\'aperçu des fiches porte les amorces (et rien sans .job)', () => {
    const part = (color) => ({
        coordinates: [[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]],
        holes: [], width: 30, height: 30, handles: [], color,
    })

    it('une fiche `.job` avec points posables : trait ambré + disque de perçage', () => {
        const record = {
            parts: [part('#2563EB')],
            sheetcam: {
                starts: [{ offset: [15, 0], leadIn: 5, leadInType: LEAD_ARC, leadOut: 10, leadOutType: LEAD_ARC }],
                origin: [0, 0],
                kerfWidth: 1.5,
                leadIn: 5, leadInType: LEAD_ARC, leadOut: 10, leadOutType: LEAD_ARC,
            },
        }
        const svg = decodeURIComponent(previewSvgWithLeads(record))
        expect(svg).toContain('#D97706') // trait fin de l'amorce
        expect(svg).toContain('stroke-dasharray') // disque de perçage pointillé
    })

    it('contrôle négatif : sans `.job`, l\'aperçu est identique à l\'import', () => {
        const plain = { parts: [part('#2563EB')], sheetcam: null }
        const withEmpty = { parts: [part('#2563EB')], sheetcam: { starts: [], origin: null, kerfWidth: 1.5 } }
        const a = previewSvgWithLeads(plain)
        const b = previewSvgWithLeads(withEmpty)
        expect(a).toBe(b) // aucun leads ⇒ même sortie exacte
        expect(a).not.toContain('#D97706')
    })

    // Lot J11-ter (verrou exigé par la vérification §5.2) : les tracés
    // d'amorce se COMPTENT dans le SVG de la vue (> 0 dès que la fiche
    // porte des points), et le viewBox les COUVRE — une amorce part du
    // contour vers l'EXTÉRIEUR, un viewBox calé sur la seule pièce les
    // coupait en moitié (capturé au NO-GO J11-bis).
    it('verrou J11-ter : > 0 tracés d\'amorce comptés, viewBox les couvrant', () => {
        const record = {
            parts: [part('#2563EB')],
            sheetcam: {
                starts: [{ offset: [15, 0], leadIn: 5, leadInType: LEAD_ARC, leadOut: 10, leadOutType: LEAD_ARC }],
                origin: [0, 0],
                kerfWidth: 1.5,
                leadIn: 5, leadInType: LEAD_ARC, leadOut: 10, leadOutType: LEAD_ARC,
            },
        }
        const svg = decodeURIComponent(previewSvgWithLeads(record))
        const leadTraces = (svg.match(/#D97706/g) || []).length
        expect(leadTraces).toBeGreaterThan(0)
        // Le start [15,0] est sur le bord BAS (y=0 en entrée, flip y en
        // sortie) : l'amorce plonge SOUS le bord — le viewBox doit démarrer
        // AVANT 0 pour la couvrir entière.
        const vb = svg.match(/viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/)
        expect(vb).not.toBeNull()
        const [, x, y, w, h] = vb.map(Number)
        // l'amorce (au plus 15 mm sous le bord) vit DANS le viewBox
        expect(y).toBeLessThan(0)
        expect(h).toBeGreaterThanOrEqual(30)
        // la pièce reste entière
        expect(x).toBeLessThanOrEqual(0)
        expect(x + w).toBeGreaterThanOrEqual(30)
    })
})

// --- les textes FIGÉS du lot J8-e (point 30) ---------------------------------

// Lot L0 : les dictionnaires vivent dans un fichier PAR LANGUE.
const enBlock = readFileSync(fileURLToPath(new URL('../utils/i18n/en.js', import.meta.url)), 'utf8').split('export default {')[1]
const frBlock = readFileSync(fileURLToPath(new URL('../utils/i18n/fr.js', import.meta.url)), 'utf8').split('export default {')[1]
const line = (block, key) => {
    const l = block.split('\n').find((x) => x.includes(`'${key}':`))
    return l ? l.trim() : null
}

describe('J8-e — légendes et messages : textes figés, EN et FR', () => {
    it('les deux légendes du point 30, AU CARACTÈRE PRÈS', () => {
        expect(line(enBlock, 'upload.limitDevice'))
            .toBe("'upload.limitDevice': 'DXF, SVG or SheetCam .job — max 5 MB per file',")
        expect(line(frBlock, 'upload.limitDevice'))
            .toBe("'upload.limitDevice': \"DXF, SVG ou .job SheetCam — 5 Mo max par fichier\",")
        expect(line(enBlock, 'upload.limit'))
            .toBe("'upload.limit': 'DXF, SVG or DWG — max 5 MB per file',")
        expect(line(frBlock, 'upload.limit'))
            .toBe("'upload.limit': \"DXF, SVG ou DWG — 5 Mo max par fichier\",")
    })

    it('les erreurs d\'envoi s\'affichent (plus jamais muettes) : la clé existe EN/FR', () => {
        expect(line(enBlock, 'upload.batchFailed')).toContain('{names}')
        expect(line(frBlock, 'upload.batchFailed')).toContain('{names}')
    })

    it('J8-a/J8-d : libellés et cartes, EN et FR', () => {
        for (const block of [enBlock, frBlock]) {
            expect(line(block, 'jobImport.downloadAllJobs')).toBeTruthy()
            expect(line(block, 'results.downloadDxf')).toBeTruthy()
            expect(line(block, 'results.downloadAllDxf')).toBeTruthy()
            expect(line(block, 'privacy.device.body')).toMatch(/\.job/)
            expect(line(block, 'privacy.cloud.body')).toMatch(/\.job/)
        }
    })
})

// --- J8-a : le « tout télécharger les .job » (downloadLocalJobs) -------------
//
// Le DOM n'existe pas en node : on stubbe le strict minimum (createElement,
// click, URL.createObjectURL) pour compter les TÉLÉCHARGEMENTS déclenchés —
// un par tôle, chacun avec SON nom, étalés de 300 ms (garde anti-rafale).

describe('J8-a — downloadLocalJobs : un .job par tôle, en un clic', () => {
    it('déclenche autant de téléchargements que de tôles, chacun nommé', async () => {
        const clicks = []
        const created = []
        const realCreate = globalThis.document?.createElement
        globalThis.document = globalThis.document || {}
        globalThis.document.createElement = (tag) => {
            const el = {
                tag, style: {},
                set href(v) { created.push(v) },
                click: () => clicks.push(el),
                // §9.75 point 3 : le VRAI élément du navigateur a un
                // remove() — le faux doit l'avoir aussi, sinon les
                // setTimeout du lot lèvent une exception non rattrapée et
                // la suite sort en code 1 même avec tous ses tests verts.
                remove: () => {},
            }
            return el
        }
        globalThis.document.body = globalThis.document.body || { appendChild: () => {} }
        const realUrl = globalThis.URL
        class FakeURL {
            static createObjectURL(blob) { return 'blob:' + blob.size }
            static revokeObjectURL() {}
        }
        globalThis.URL = FakeURL
        try {
            const { downloadLocalJobs } = await import('../composables/localDownloads')
            const bytes = new Uint8Array([1, 2, 3])
            const record = {
                slug: 'rec-a',
                alternatives: [{
                    jobs: [
                        { bytes: bytes.slice(), fileName: 'a_tole1.job' },
                        { bytes: bytes.slice(), fileName: 'a_tole2.job' },
                        { bytes: bytes.slice(), fileName: 'a_tole3.job' },
                    ],
                }],
            }
            downloadLocalJobs(record)
            // Les téléchargements sont ÉTALÉS (0/300/600 ms) : à +900 ms les
            // trois sont partis, ni avant ni plus.
            await new Promise((r) => setTimeout(r, 150))
            expect(clicks).toHaveLength(1)
            await new Promise((r) => setTimeout(r, 900))
            expect(clicks).toHaveLength(3)
            // Chacun porte SON nom (l'ordre du bloc binaire, un par tôle) et
            // PAS d'archive : un `.job` s'ouvre tel quel dans SheetCam.
            expect(clicks.map((c) => c.download)).toEqual(['a_tole1.job', 'a_tole2.job', 'a_tole3.job'])
            // Contrôle négatif : sans job, la fonction REFUSE (elle ne rend
            // pas un téléchargement vide).
            expect(() => downloadLocalJobs({ alternatives: [{}] })).toThrow(/job_unavailable/)
        } finally {
            if (realCreate) globalThis.document.createElement = realCreate
            else delete globalThis.document
            globalThis.URL = realUrl
        }
    })
})

// --- J11-b : la version produit et le journal ---------------------------------

describe('J11-b — version produit et journal unique', () => {
    it('package.json porte la version 0.9.x, le journal en parle', () => {
        const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'))
        expect(pkg.version).toMatch(/^0\.9\.\d+$/)
        const md = readFileSync(fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url)), 'utf8')
        expect(md).toMatch(/^## V0\.9/m)
        // FR puis EN dans CHAQUE entrée (règle du §9.77bis : jamais après).
        for (const chunk of md.split(/^## /m).slice(1)) {
            expect(chunk).toMatch(/\*FR\*/)
            expect(chunk).toMatch(/\*EN\*/)
        }
    })

    it('le parseur du journal découpe versions et blocs FR/EN', async () => {
        const { useAppChangelog } = await import('../utils/changelogParser')
        const versions = useAppChangelog()
        expect(versions.length).toBeGreaterThanOrEqual(1)
        expect(versions[0].title).toMatch(/^V0\.9/)
        // L0-bis : une entrée de CORRECTIF peut n'avoir qu'une puce — la
        // taille pleine (≥ 4) reste exigée d'AU MOINS une version.
        expect(versions[0].fr.length).toBeGreaterThanOrEqual(1)
        expect(versions[0].en.length).toBeGreaterThanOrEqual(1)
        expect(versions.some((v) => v.fr.length >= 4 && v.en.length >= 4)).toBe(true)
    })
})

// --- J11-c : le badge « Nouveau » qui expire tout seul ------------------------

describe('J11-c — le badge « Nouveau » expire à 7 jours', () => {
    it("à J+6 il est nouveau, à J+8 il ne l'est plus", async () => {
        const { isNewFeature, WHATS_NEW } = await import('../utils/whatsNew')
        // Une clé réelle du registre — le verrou suit sa DATE (promue au
        // déploiement), jamais une date copiée qui dériverait.
        const key = 'job-download-primary'
        const released = new Date(WHATS_NEW['job-download-primary'])
        const at = (days) => new Date(released.getTime() + days * 86400000)
        expect(isNewFeature(key, at(6))).toBe(true)
        expect(isNewFeature(key, at(8))).toBe(false)
    })

    it('une clé inconnue n\'est jamais nouvelle ; le registre est vivant', async () => {
        const { isNewFeature, WHATS_NEW } = await import('../utils/whatsNew')
        expect(isNewFeature('cle-inexistante')).toBe(false)
        expect(Object.keys(WHATS_NEW).length).toBeGreaterThanOrEqual(3)
        // Discipline : aucune entrée de plus de 30 jours (le lot doit vider).
        const now = new Date()
        for (const [k, d] of Object.entries(WHATS_NEW)) {
            const age = (now - new Date(d)) / 86400000
            expect(age).toBeLessThan(30)
        }
    })

    // Lot J11-bis (R3) : tant que le registre a une entrée ACTIVE, la clé
    // est posée sur au moins un point de montage — un badge retiré du
    // template pendant que le registre le promet serait une nouveauté
    // fantôme (annoncée nulle part).
    it('chaque clé active du registre est montée dans au moins un composant', async () => {
        const { WHATS_NEW, isNewFeature } = await import('../utils/whatsNew')
        const comps = readdirSync(fileURLToPath(new URL('../components', import.meta.url)))
            .filter((f) => f.endsWith('.vue'))
            .map((f) => readFileSync(fileURLToPath(new URL('../components/' + f, import.meta.url)), 'utf8'))
            .join('\n')
        for (const key of Object.keys(WHATS_NEW)) {
            if (!isNewFeature(key)) continue
            expect(comps).toContain(`feature="${key}"`)
        }
    })
})

// --- J11-a : le titre de projet ne mange plus le suffixe (k/N) ----------------

describe('J11-a — titre de projet et suffixe (k/N)', () => {
    it('« X.dxf (3/4) » donne « X (3/4) », jamais « 4) »', async () => {
        const { titleFromFileName } = await import('../utils/projectTitle')
        expect(titleFromFileName('c16__marine.dxf (3/4)')).toBe('c16__marine (3/4)')
        expect(titleFromFileName(String.raw`C:\jobs\mon.dxf`)).toBe('mon')
        expect(titleFromFileName('Piece_Trou.DXF')).toBe('Piece_Trou')
    })
})
