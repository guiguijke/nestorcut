/**
 * Tôles à « quantité illimitée » : les règles partagées par l'écran, la requête,
 * le constructeur de payload et les passes d'après-calcul. Module PUR.
 *
 * Donnée : `params.sheets[].unlimited === true`, clé ABSENTE sinon (jamais
 * `false`). La quantité saisie de la ligne reste gardée telle quelle. Seuls les
 * projets « Cet appareil » (calcul navigateur) la lisent : ailleurs la clé est
 * ignorée et la quantité saisie vaut (`sheetsForProject`).
 *
 * La règle : les tôles à quantité fixe (« le stock ») sont remplies d'abord, les
 * illimitées complètent. Sans aucune tôle illimitée, chaque fonction rend son
 * entrée (même référence) ou null : le chemin d'avant, à l'octet.
 */
import { MAX_SHEETS_PER_JOB } from '~~/shared/constants/payment.constants'

export const isUnlimitedSheet = (row) => row?.unlimited === true

export const hasUnlimitedSheet = (rows) => Array.isArray(rows) && rows.some(isUnlimitedSheet)

/** Lignes de réglages telles que le projet les lit : hors d'un projet « Cet
 * appareil » (`local` faux), la clé `unlimited` est retirée. Rien à retirer :
 * la liste elle-même. */
export function sheetsForProject(rows, local) {
    if (local || !hasUnlimitedSheet(rows)) return rows
    return rows.map((row) => {
        if (!isUnlimitedSheet(row)) return row
        const rest = { ...row }
        delete rest.unlimited
        return rest
    })
}

/** Quantité retenue pour CHAQUE tôle illimitée d'un calcul : ce que la borne
 * technique laisse après le stock, partagé à parts égales, et au moins une (le
 * stock peut prendre toute la borne). Ne dépend pas du nombre de pièces (le
 * contrôle de capacité doit voir la vraie borne). */
export function unlimitedQuantity(rows, max = MAX_SHEETS_PER_JOB) {
    let finite = 0
    let open = 0
    for (const row of rows || []) {
        if (isUnlimitedSheet(row)) {
            open += 1
            continue
        }
        const count = Math.trunc(Number(row?.count))
        if (count > 0) finite += count
    }
    return open ? Math.max(1, Math.floor((max - finite) / open)) : 0
}

/** Lignes de réglages où la quantité saisie d'une tôle illimitée est remplacée
 * par sa quantité effective (chaîne, comme les champs). Aucune illimitée : la
 * liste elle-même. */
export function effectiveSheets(rows, max = MAX_SHEETS_PER_JOB) {
    if (!hasUnlimitedSheet(rows)) return rows
    const count = String(unlimitedQuantity(rows, max))
    return rows.map((row) => (isUnlimitedSheet(row) ? { ...row, count } : row))
}

/**
 * Conteneurs moteur d'un calcul multi-tôles qui mêle stock et tôles illimitées
 * (recette essayée avec le vrai moteur, qui n'est pas modifié) :
 *  - chaque format du stock devient la première tôle (stock 1, coût 0), puis le
 *    reste (stock n − 1, coût 1) quand n > 1 ;
 *  - le stock d'abord (ordre de saisie), puis les illimitées ;
 *  - une illimitée coûte (T + 1) × c : T = somme des coûts de tout le stock,
 *    c = aire / plus petite aire illimitée × 100 (au moins 1). Une seule tôle
 *    neuve coûte ainsi plus que tout le stock réuni.
 * Un coût 0 pour tout le stock ouvrait une deuxième tôle de stock pour une
 * seule pièce ; un petit coût positif laissait la chute vide quand une neuve
 * était de toute façon nécessaire. Le pool joue aussi le coût 0 sur un walk sur
 * deux (`walkInstance`) : le choix entre les recherches écarte la tôle ouverte
 * pour rien.
 *
 * @param {Array<{count: number, unlimited: boolean, area: number}>} formats
 *   formats actifs (count > 0), dans l'ordre de saisie ; les autres champs
 *   sont recopiés.
 * @returns {Array|null} les entrées dans l'ordre des conteneurs moteur, avec
 *   `count` (stock moteur) et `cost` ; null quand il n'y a pas à la fois du
 *   stock et une illimitée (les coûts d'avant valent).
 */
export function stockPriorityBins(formats) {
    const stock = formats.filter((f) => !f.unlimited)
    const open = formats.filter((f) => f.unlimited)
    if (!stock.length || !open.length) return null
    const out = []
    let stockCost = 0
    for (const f of stock) {
        out.push({ ...f, count: 1, cost: 0 })
        if (f.count > 1) {
            out.push({ ...f, count: f.count - 1, cost: 1 })
            stockCost += f.count - 1
        }
    }
    const minArea = Math.min(...open.map((f) => f.area))
    for (const f of open) {
        out.push({ ...f, cost: (stockCost + 1) * Math.max(1, Math.round(f.area / minArea * 100)) })
    }
    return out
}

/**
 * Le test « cette tôle posée vient-elle d'une tôle illimitée ? » d'un payload
 * (`stockPriority.unlimitedBins`, ids des conteneurs moteur), ou null pour un
 * calcul sans tôle illimitée. En bande, l'unique conteneur est le 0 : le
 * `container_id` que le moteur y écrit n'a pas de sens, il n'est pas lu.
 * @returns {((layout: object) => boolean)|null}
 */
export function unlimitedLayoutTest(payload) {
    const ids = payload?.stockPriority?.unlimitedBins
    if (!Array.isArray(ids)) return null
    const unlimited = new Set(ids)
    const strip = !Array.isArray(payload?.instance?.bins)
    return (layout) => unlimited.has(strip ? 0 : (layout?.container_id ?? 0))
}

/**
 * Tôles données au walk de rang `w` d'un calcul multi-tôles à tôle illimitée.
 * Deux recettes de coût, réparties par rang : celle du constructeur (première
 * tôle de chaque format du stock à 0, le reste à 1), et une où TOUT le stock
 * coûte 0 (sinon la deuxième tôle d'un format ne sert presque jamais). Les tôles
 * à prévoir gardent leur coût. Par tranches de `classes` walks (une par sens) :
 * chaque sens reçoit les deux recettes dès que les walks y suffisent.
 * @returns l'instance elle-même quand il n'y a rien à changer (aucune tôle
 *   illimitée, bande, tranche de la première recette, tout le stock déjà à 0).
 */
export function walkInstance(instance, payload, w, classes) {
    const isNew = unlimitedLayoutTest(payload)
    if (!isNew || !Array.isArray(instance?.bins)) return instance
    if (Math.floor(w / Math.max(1, classes)) % 2 === 0) return instance
    const paid = (bin) => !isNew({ container_id: bin.id }) && bin.cost > 0
    if (!instance.bins.some(paid)) return instance
    return { ...instance, bins: instance.bins.map((bin) => (paid(bin) ? { ...bin, cost: 0 } : bin)) }
}

/** Deux aires de pièces à moins d'un mm² près sont la même (arrondis des rapports
 * et des sommes). */
const AREA_TOL_MM2 = 1

/**
 * Le choix entre deux résultats d'un calcul à tôle illimitée, LE MÊME partout
 * (avant la fusion, fusion en échec, ordre des options affichées) : le moins de
 * pièces non posées ; puis le moindre coût des seules tôles à prévoir ; puis la
 * plus grande aire de pièces sur le stock ; puis le moins de tôles du stock
 * touchées. 0 : égalité complète.
 */
export function compareStockScores(a, b) {
    return (a.unplaced - b.unplaced)
        || (a.newCost - b.newCost)
        || (Math.abs(a.stockArea - b.stockArea) > AREA_TOL_MM2 ? b.stockArea - a.stockArea : 0)
        || (a.stockSheets - b.stockSheets)
}

/** `sheets` : les tôles posées `{ isNew, cost, area, pieces }` ; une tôle sans
 * pièce ne compte pas. */
function stockScore(unplaced, sheets) {
    const score = { unplaced: Number(unplaced) || 0, newCost: 0, stockArea: 0, stockSheets: 0 }
    for (const sheet of sheets) {
        if (!(sheet.pieces > 0)) continue
        if (sheet.isNew) {
            score.newCost += sheet.cost
        } else {
            score.stockArea += sheet.area
            score.stockSheets += 1
        }
    }
    return score
}

/** Coût d'une tôle posée : celui de son conteneur moteur (le même dans les deux
 * recettes pour une tôle à prévoir) ; en bande, sans conteneur, 1. */
function sheetCost(payload, layout) {
    const bins = payload?.instance?.bins
    return Array.isArray(bins) ? Number(bins[layout?.container_id ?? 0]?.cost) || 0 : 1
}

/** Aire du contour extérieur d'un item de l'instance moteur. */
function outerArea(shape) {
    const ring = shape?.data?.outer || shape?.data || []
    let sum = 0
    for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[(i + 1) % ring.length]
        sum += x1 * y2 - x2 * y1
    }
    return Math.abs(sum) / 2
}

/**
 * Le score d'une recherche du moteur (`compareStockScores`), avant la finition :
 * aires des items de l'instance moteur (contour extérieur : un hôte compte avec
 * les pièces qui iront dans ses trous). null pour un calcul sans tôle illimitée
 * ou en bande.
 * @returns {((run: object) => object)|null}
 */
export function runScorer(payload) {
    const isNew = unlimitedLayoutTest(payload)
    if (!isNew || !Array.isArray(payload?.instance?.bins)) return null
    const areas = new Map((payload.instance.items || []).map((it) => [it.id, outerArea(it.shape)]))
    return (run) => stockScore(run?.cost_detail?.unplaced, (run?.solution?.layouts || []).map((layout) => ({
        isNew: isNew(layout),
        cost: sheetCost(payload, layout),
        area: (layout.placed_items || []).reduce((sum, p) => sum + (areas.get(p.item_id) || 0), 0),
        pieces: layout.placed_items?.length || 0,
    })))
}

/**
 * Le score d'une option LIVRÉE : son rapport (`sheets[].supply`, aire des pièces
 * posées) et sa solution (conteneurs des tôles, au même rang). null quand le
 * rapport ne dit pas l'origine des tôles.
 */
export function deliveredScore(report, solution, payload) {
    const rows = report?.sheets || []
    if (!rows.some((row) => row?.supply)) return null
    const layouts = solution?.layouts || (solution?.layout ? [solution.layout] : [])
    return stockScore(report.unplaced, rows.map((row, i) => ({
        isNew: row.supply === 'new',
        cost: sheetCost(payload, layouts[i]),
        area: Number(row.partsAreaMm2) || 0,
        pieces: row.partCount ?? 1,
    })))
}

/**
 * Les runs tels que la fusion les compare : `bin_cost` devient le coût des seules
 * tôles à prévoir, comparable d'une recette à l'autre. La fusion ne repasse donc
 * pas par-dessus le choix pour un coût de tôle du stock ; à égalité, elle
 * départage comme avant. Sans tôle illimitée ou en bande : la liste elle-même.
 */
export function mergeRuns(runs, payload) {
    const score = runScorer(payload)
    if (!score) return runs
    return runs.map((run) => (run?.cost_detail
        ? { ...run, cost_detail: { ...run.cost_detail, bin_cost: score(run).newCost } }
        : run))
}

/**
 * Choix parmi les recherches d'un calcul multi-tôles à tôle illimitée, AVANT la
 * fusion du moteur. À coût égal le moteur est indifférent au stock, et son
 * départage (chute restante) livre volontiers le stock le moins servi. Pour
 * chaque sens (`bias`) ne restent que les runs à égalité avec le meilleur
 * (`compareStockScores`). Un run sans `cost_detail` reste (on ne peut pas le
 * juger) ; chaque sens garde au moins un run.
 *
 * Limite : ce qu'aucune recherche n'a trouvé n'est pas rattrapé.
 *
 * @returns les runs gardés, dans leur ordre, tels que la fusion les compare
 *   (`mergeRuns`) ; la liste elle-même sans tôle illimitée ou en bande.
 */
export function preferStockRuns(runs, payload) {
    const score = runScorer(payload)
    if (!score) return runs
    const scores = runs.map((run) => (run?.cost_detail ? score(run) : null))
    const best = new Map()
    runs.forEach((run, i) => {
        if (scores[i] && (!best.has(run.bias) || compareStockScores(scores[i], best.get(run.bias)) < 0)) {
            best.set(run.bias, scores[i])
        }
    })
    return mergeRuns(
        runs.filter((run, i) => !scores[i] || compareStockScores(scores[i], best.get(run.bias)) === 0),
        payload)
}

/** Tri stable EN PLACE des tôles posées : le stock d'abord (tôle 1 = stock),
 * les illimitées ensuite (`isNew` : `unlimitedLayoutTest`).
 * @returns {number[]} pour chaque nouveau rang, l'ancien. */
export function sortStockFirst(layouts, isNew) {
    const rank = (i) => Number(isNew(layouts[i]))
    const order = layouts.map((_, i) => i).sort((a, b) => (rank(a) - rank(b)) || (a - b))
    const sorted = order.map((i) => layouts[i])
    sorted.forEach((layout, i) => { layouts[i] = layout })
    return order
}
