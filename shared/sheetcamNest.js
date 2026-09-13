/**
 * Conversion d'un résultat de nesting en poses `.job` SheetCam — lot J2 de
 * `docs/ETUDE-JOB-SHEETCAM-2026-09-11.md` §8.
 *
 * UN SEUL CODE navigateur + serveur, sans dépendance : l'appelant fournit des
 * poses moteur et les anneaux importés, ce module rend les poses `.job` et
 * l'ordre de coupe, et `shared/sheetcamJob.js` (lot J1) écrit le fichier.
 *
 * ---------------------------------------------------------------------------
 * LA RÈGLE 3 de l'étude, et pourquoi elle n'est pas évidente.
 *
 * Notre moteur pose une pièce par une rotation θ autour de l'origine DU
 * DESSIN puis une translation t : un point p du dessin arrive en
 * `R(θ)·p + t` (c'est exactement ce que fait l'export DXF,
 * `workers/nesting/core/main.py` : `z_rotate(angle) * translate(x, y)`).
 *
 * SheetCam, lui, ne stocke pas une translation : `XPos`/`YPos` sont la
 * position du **centre de la boîte englobante de la pièce posée**, et
 * `Angle` tourne dans l'autre sens (radians, positif = horaire). D'où :
 *
 *     XPos, YPos = t + R(θ)·c        Angle = −θ
 *
 * où `c` est le centre de boîte du dessin **non tourné**, mesuré sur les
 * anneaux tels que NOUS les importons. Se tromper de convention ne décale
 * pas « un peu » : sur une pièce non centrée à l'origine, l'erreur vaut
 * R(θ)·c − c, soit ici près de 34 mm à 180°.
 *
 * Vérifié sur le moulinet du 11/09 : le dessin de l'éventail a pour centre
 * de boîte (0 ; 16,8284) — il n'est PAS centré sur l'origine —, et les
 * quatre poses du fichier de référence sortent d'un seul jeu d'entrées
 * propre : t = (50 ; 50) pour les quatre, θ = 0, π/2, π, 3π/2. C'est le
 * verrou du lot (`sheetcamNest.test.js`).
 */
// L'extension `.js` est OBLIGATOIRE : Vite la devine, Node nu non
// (ERR_MODULE_NOT_FOUND). Le module est censé tourner des deux côtés — un
// script serveur, un outil de recette ou un plugin Nitro le charge sans
// bundler. Verrou : `sheetcamNest.test.js` « se charge en Node nu ».
import {
    OPTIMISATION_MANUAL_KEEP_PARTS,
    SheetCamJobError,
    writeNestedSheetCamJob,
} from './sheetcamJob.js'

/**
 * Centre de la boîte englobante d'un dessin, sur les anneaux importés.
 *
 * `parts` est la géométrie que nous stockons pour un fichier : une liste de
 * `{ coordinates, holes }` (les trous ne changent pas la boîte, ils sont à
 * l'intérieur — on les prend quand même, un anneau intérieur mal orienté ne
 * doit pas pouvoir sortir de la boîte en silence).
 */
export function drawingBoxCentre(parts) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const part of parts || []) {
        const rings = [part.coordinates, ...(part.holes || [])]
        for (const ring of rings) {
            for (const point of ring || []) {
                const x = Number(point[0])
                const y = Number(point[1])
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
    }
    if (!Number.isFinite(minX)) {
        throw new SheetCamJobError('sheetcamNest.emptyDrawing')
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2]
}

/**
 * Ramène l'angle `.job` dans l'intervalle que SheetCam écrit lui-même.
 *
 * CET INTERVALLE EST (−2π, 0], ET IL EST MESURÉ, pas choisi. Le fichier de
 * référence posé À LA MAIN dans SheetCam
 * (`app/tests/fixtures/sheetcam/x4-reference.job`) porte, pour les quatre
 * quarts de tour, `Angle = −0, −1.5707963267949, −3.14159265358979,
 * −4.71238898038469`. SheetCam ne réduit donc PAS dans (−π, π] : il garde un
 * tour négatif complet. Normaliser dans (−π, π) — la forme qu'on écrit par
 * réflexe — récrirait −4,712 en +1,571 et ferait diverger notre écriture du
 * fichier de référence, que le verrou du lot J2 compare à 1e-12 près.
 *
 * Ce qu'il fallait corriger, c'est seulement le débordement : la recette du
 * 13/09 porte `Angle=-6.283` parce que le moteur a émis θ = 2π, qui est un
 * tour complet, donc l'identité. Un fichier propre écrit `−0`. Pour tout
 * θ ∈ [0, 2π) — c'est-à-dire tout ce que le moteur produit normalement —
 * cette fonction est l'IDENTITÉ, signe du zéro compris.
 */
export function normalizeJobAngle(angle) {
    const a = Number(angle)
    if (!Number.isFinite(a)) return a
    const turn = 2 * Math.PI
    // `%` conserve le signe du dividende, donc `-0 % τ` vaut `-0` et
    // `−2π % τ` vaut `-0` : le tour complet retombe sur le zéro NÉGATIF que
    // porte la référence.
    const r = a % turn
    return r > 0 ? r - turn : r
}

/**
 * Pose `.job` d'un exemplaire, depuis la pose moteur et le centre de boîte.
 *
 * `pose` : `{ x, y, angle }` — translation en millimètres, rotation en
 * RADIANS trigonométriques (sens moteur). `centre` : `[cx, cy]`, le centre de
 * la boîte englobante du dessin NON TOURNÉ.
 *
 * ---------------------------------------------------------------------------
 * CETTE FORMULE EST CELLE DU LOT J2, ET LE LOT J4 AVAIT EU TORT DE LA
 * REMPLACER (§9.42 de l'étude, NO-GO du vérificateur).
 *
 * Le lot J4 avait lu la règle 3 (« `XPos, YPos` = centre de la boîte de la
 * pièce POSÉE ») comme « centre de la boîte du dessin TOURNÉ », et remplacé
 * `t + R(θ)·c` par ce centre-là. Le fichier « + 45deg » de la série
 * `retro-eng-job` tranche : SheetCam TOURNE LE DESSIN AUTOUR DE
 * `(XPos, YPos)`, qui est la position monde du centre de la boîte NON
 * tournée — sens horaire pour un `Angle` positif. Mesuré sur les trois points
 * de départ du G-code de ce fichier (`Angle` = +0,785 ; `XPos` 90 ;
 * `YPos` 100) :
 *
 *   contour    G-code             `t + R(θ)·c`         boîte TOURNÉE (J4)
 *   rectangle  (37,50 ; 139,42)   écart 0,75 = kerf/2  écart 45,4 mm
 *   extérieur  (−44,88 ; 92,40)   écart 0,75           écart 46,5 mm
 *   fuseau     (−14,65 ; 101,58)  écart 0,75           écart 45,7 mm
 *
 * Les 0,75 restants sont le décalage du chemin d'outil (kerf 1,5), pas une
 * erreur de pose. Les deux formules COÏNCIDENT aux quarts de tour (la boîte
 * tournée est alors la boîte de la boîte) : c'est pourquoi la référence du
 * 11/09, le harnais et tous les verrous du lot J4 sont restés verts alors que
 * toute pose non quart de tour était fausse de 45 mm — et l'UI autorise
 * `rotationCount` de 1 à 360 (piège AGENTS #61).
 *
 * MIROIR (`HRef = 1`) : `x' = 2·XPos − x`, `y` inchangé — vérifié sur les
 * trois contours à 0,75 près. Nous n'écrivons jamais de miroir ; la règle est
 * ici pour le jour où on lira une pose miroir d'un fichier entrant.
 *
 * Le zéro négatif de `Angle` n'est pas une coquetterie : `-0` est ce que
 * porte le fichier de référence pour θ = 0, et `formatJobNumber` (lot J1)
 * l'écrit tel quel.
 */
export function jobPlacement(pose, centre) {
    const theta = Number(pose.angle) || 0
    const [cx, cy] = centre
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    return {
        xPos: Number(pose.x) + (cx * cos - cy * sin),
        yPos: Number(pose.y) + (cx * sin + cy * cos),
        // −θ, ramené dans l'intervalle de SheetCam ; le signe de zéro est
        // conservé (JavaScript : -(0) === -0, et -0 % τ === -0).
        angle: normalizeJobAngle(-theta),
    }
}

/** Centre de boîte d'une liste d'anneaux BRUTS (contour et trous d'un même
 *  dessin), pour les appelants qui n'ont pas la forme `{ coordinates, holes }`. */
export function boxCentreOfRings(rings) {
    return drawingBoxCentre([{ coordinates: [], holes: rings || [] }])
}

/**
 * Profondeur d'imbrication d'un exemplaire : 0 s'il est posé sur la tôle,
 * 1 s'il est dans le trou d'une pièce, 2 s'il est dans le trou d'une pièce
 * elle-même nichée, etc. `nestedIn` porte l'INDEX de l'hôte dans la liste.
 *
 * Une chaîne circulaire (jamais produite par nos post-pass, mais l'appelant
 * peut se tromper) est refusée plutôt que bouclée à l'infini.
 */
export function nestingDepths(items) {
    const depths = new Array(items.length).fill(0)
    for (let i = 0; i < items.length; i++) {
        let depth = 0
        let cursor = items[i].nestedIn
        const seen = new Set([i])
        while (cursor != null) {
            if (seen.has(cursor) || cursor < 0 || cursor >= items.length) {
                throw new SheetCamJobError('sheetcamNest.nestingCycle', {
                    item: String(i),
                })
            }
            seen.add(cursor)
            depth += 1
            cursor = items[cursor].nestedIn
        }
        depths[i] = depth
    }
    return depths
}

/**
 * Ordre de coupe d'une tôle (règle 8 de l'étude) : les pièces NICHÉES
 * d'abord, par profondeur décroissante, puis leurs hôtes — et les pièces
 * d'un même hôte groupées, pour que la torche ne fasse pas l'aller-retour.
 *
 * Pourquoi cet ordre et pas un autre : couper le contour extérieur d'un hôte
 * avant les pièces logées dans son trou libère la pièce, qui bouge ; ce que
 * l'optimiseur de trajet de SheetCam fait spontanément (mesuré : un éventail,
 * puis le contour de l'hôte, puis le trou, puis les trois autres éventails).
 *
 * Rend une liste `[rangDePiece, rangDOperation]` prête pour `[OpOrder]`.
 * `items` : `{ part, op = 0, nestedIn }` dans l'ordre des exemplaires écrits
 * (donc l'index dans cette liste EST le rang `[Part N]` du fichier écrit).
 */
export function cutOrder(items) {
    const depths = nestingDepths(items)
    const maxDepth = depths.length ? Math.max(...depths) : 0
    const out = []
    const pushed = new Set()

    // Des plus profondes aux plus superficielles ; à profondeur égale, on
    // regroupe par hôte en suivant l'ordre d'apparition des hôtes.
    for (let depth = maxDepth; depth >= 1; depth--) {
        const hosts = []
        const byHost = new Map()
        items.forEach((item, index) => {
            if (depths[index] !== depth) return
            const host = item.nestedIn
            if (!byHost.has(host)) {
                byHost.set(host, [])
                hosts.push(host)
            }
            byHost.get(host).push(index)
        })
        for (const host of hosts) {
            for (const index of byHost.get(host)) {
                out.push([index, items[index].op ?? 0])
                pushed.add(index)
            }
        }
    }
    // Puis les pièces posées à plat sur la tôle, dans leur ordre d'écriture.
    items.forEach((item, index) => {
        if (pushed.has(index)) return
        out.push([index, item.op ?? 0])
    })
    return out
}

/**
 * Un `.job` PAR TÔLE (v1 : le format porte une seule `[Work]`, un job à deux
 * tôles fait donc deux fichiers — point 6 de la consigne §6 de l'étude).
 *
 * `job` : le `.job` lu par le lot J1. `sheets` : une liste de tôles, chacune
 * une liste d'exemplaires `{ part, pose: {x, y, angle}, op, nestedIn }` où
 * `part` est le rang `[Part N]` du dessin dans le `.job` d'origine.
 * `centres` : `{ [part]: [cx, cy] }`, les centres de boîte mesurés sur NOS
 * anneaux.
 *
 * Rend `[{ sheet, placements, order, bytes }]` — `bytes` étant le fichier
 * écrit par le lot J1, chemins masqués.
 */
export function nestedJobsPerSheet(job, { sheets, centres, rings, maskPaths = true } = {}) {
    if (!Array.isArray(sheets) || sheets.length === 0) {
        throw new SheetCamJobError('sheetcamNest.noSheets')
    }
    return sheets.map((items, sheetIndex) => {
        if (!Array.isArray(items) || items.length === 0) {
            throw new SheetCamJobError('sheetcamNest.emptySheet', {
                sheet: String(sheetIndex + 1),
            })
        }
        const placements = items.map((item) => {
            // UNE SEULE FORMULE, celle du lot J2 (voir `jobPlacement`). Le lot
            // J4 en avait branché une seconde sur `rings` ; elle est fausse de
            // 45 mm hors quarts de tour (§9.42). `rings` reste accepté et sert
            // seulement à MESURER le centre de boîte, ce que fait déjà
            // `centres` pour les appelants qui l'ont sous la main.
            const centre = centres?.[item.part]
                ?? (rings?.[item.part] ? boxCentreOfRings(rings[item.part]) : null)
            if (!centre) {
                throw new SheetCamJobError('sheetcamNest.missingCentre', {
                    part: String(item.part),
                })
            }
            return { part: item.part, ...jobPlacement(item.pose, centre) }
        })
        // L'ordre de coupe se lit sur les RANGS ÉCRITS : le premier
        // exemplaire d'un dessin garde le rang de son original (règle 6), les
        // suivants prennent les rangs des copies, à la suite. `writtenRanks`
        // reproduit ce que fait l'écrivain du lot J1.
        const ranks = writtenRanks(job, items)
        const order = cutOrder(items.map((item, index) => ({
            part: ranks[index],
            op: item.op ?? 0,
            nestedIn: item.nestedIn ?? null,
        }))).map(([index, op]) => [ranks[index], op])

        return {
            sheet: sheetIndex + 1,
            placements,
            order,
            // Le rang `[Part N]` ÉCRIT de chaque exemplaire, aligné index par
            // index sur `placements`. À ne pas confondre avec
            // `placements[i].part`, qui est le rang du DESSIN d'origine (0 ou
            // 1 ici) et non celui de la section écrite (0 à 4) — la confusion
            // a fait produire des paires de nichage fausses au lot J4-bis.
            ranks,
            bytes: writeNestedSheetCamJob(job, { placements, order, maskPaths }),
        }
    })
}

/**
 * Rangs `[Part N]` que l'écrivain du lot J1 va donner aux exemplaires : le
 * premier exemplaire d'un dessin garde le rang de l'original, les suivants
 * reçoivent les rangs libres à la suite, dans l'ordre où l'écrivain les
 * parcourt (les exemplaires d'un même dessin d'abord).
 */
export function writtenRanks(job, items) {
    const firstSeen = new Map()
    const existing = job.parts.map((p) => p.index)
    let next = existing.length ? Math.max(...existing) + 1 : 0
    const order = []
    for (const item of items) {
        if (!firstSeen.has(item.part)) {
            firstSeen.set(item.part, true)
            order.push(item.part)
        }
    }
    // Miroir EXACT de `writeNestedSheetCamJob` : il regroupe par pièce (Map,
    // donc ordre de première apparition), RÉUTILISE les sections de copie que
    // le fichier porte déjà pour le même original, puis numérote les copies
    // manquantes à la suite.
    //
    // La réutilisation n'est pas une optimisation : sans elle, un `.job` déjà
    // nesté ressortait avec ses anciennes copies ENCORE ACTIVES en plus des
    // nouvelles (5 pièces demandées, 8 sections écrites — mesuré au harnais),
    // et `[OpOrder]` désignait des rangs qui n'étaient pas ceux des poses.
    const freeCopies = new Map()
    for (const part of job.parts) {
        if (part.copyOf < 0) continue
        if (!freeCopies.has(part.copyOf)) freeCopies.set(part.copyOf, [])
        freeCopies.get(part.copyOf).push(part.index)
    }
    const ranks = new Array(items.length)
    for (const part of order) {
        const pool = (freeCopies.get(part) || []).slice()
        let first = true
        items.forEach((item, index) => {
            if (item.part !== part) return
            if (first) {
                ranks[index] = part
                first = false
                return
            }
            const recycled = pool.shift()
            ranks[index] = recycled != null ? recycled : next++
        })
    }
    return ranks
}

export { OPTIMISATION_MANUAL_KEEP_PARTS }
