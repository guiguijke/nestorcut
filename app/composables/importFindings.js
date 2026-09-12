/**
 * Constats d'import → une ligne pour la carte fichier, une liste pour la
 * fiche (lot 2c, `docs/PLAN-IMPORT-2026-09-09.md` §9.2 ; règles de
 * composition du §4 de `docs/qa/import-2026-09-09/rapport-reparation.md`).
 *
 * Les constats arrivent IDENTIQUES des deux chemins : le wasm les met dans
 * `ImportResult.findings` (stockés dans IndexedDB par localImport), le
 * worker Python dans le champ additif `importReport.findings` du document
 * fichier. Ce module ne décide rien de leur contenu — il décide seulement
 * ce qui tient sur une ligne.
 *
 * Les quatre règles du §4, dans l'ordre :
 *   1. gravité d'abord (refus > attention > info), puis compte décroissant ;
 *   2. au plus TROIS fragments sur la carte ;
 *   3. au-delà, « … et N autres » (la fiche montre tout) ;
 *   4. rien à dire ⇒ RIEN d'affiché (pas de « 0 avertissement », pas de
 *      pastille verte — le bruit désamorce l'ambre).
 */

export const FINDING_LEVELS = { info: 0, attention: 1, refusal: 2 }

/**
 * Constats visibles sur la CARTE. Les autres n'existent que dans la fiche :
 * `unitAssumed` touche un fichier sur cinq (le DXF 2D sans `$INSUNITS` est
 * la norme d'une bonne partie des CAO) et un ambre sur 22 % des imports
 * banalise l'ambre ; annotations, splines et blocs aplatis sont des choix
 * normaux, pas des pertes. Arbitrage consigné au §3.1 du catalogue,
 * réversible d'une ligne.
 */
const CARD_CODES = new Set([
    'import.entitiesSkipped',
    'import.contoursDropped',
    'import.partsDropped',
    'import.unitUnknown',
    'import.unitImplausible',
    'import.unitConverted',
])

const MAX_CARD_FRAGMENTS = 3

/** Niveau le plus grave de la liste, ou null si elle est vide. */
export function worstLevel(findings) {
    let worst = null
    for (const f of findings || []) {
        const rank = FINDING_LEVELS[f?.level] ?? 0
        if (worst === null || rank > FINDING_LEVELS[worst]) worst = f.level
    }
    return worst
}

/** Tri de la règle 1 : gravité décroissante puis compte décroissant. */
export function sortFindings(findings) {
    return [...(findings || [])].sort((a, b) => {
        const la = FINDING_LEVELS[a?.level] ?? 0
        const lb = FINDING_LEVELS[b?.level] ?? 0
        if (la !== lb) return lb - la
        return (b?.count ?? 0) - (a?.count ?? 0)
    })
}

/**
 * Paramètres i18n d'un constat : le compte, les types (trois au plus sur la
 * carte, tous dans la fiche) et la valeur nue quand il y en a une.
 */
export function findingParams(finding, { maxTypes = 3 } = {}) {
    const types = Array.isArray(finding?.types) ? finding.types : []
    const shown = maxTypes > 0 ? types.slice(0, maxTypes) : types
    return {
        n: finding?.count ?? 0,
        types: shown.join(', ') + (types.length > shown.length ? '…' : ''),
        value: finding?.value ?? '',
    }
}

/**
 * La LIGNE de la carte fichier : au plus trois fragments, séparés par « , »,
 * puis « … et N autres » s'il en reste. Rend `null` quand il n'y a rien à
 * dire (règle 4) — l'appelant n'affiche alors aucun élément.
 *
 * `t` est le traducteur (useLocale) ; `fmt` formate les nombres dans la
 * locale (piège #24 : « 1 337 tracés ouverts », jamais « 1337 »).
 */
export function composeCardLine(findings, t, fmt = (v) => String(v)) {
    const shown = sortFindings(findings).filter((f) => CARD_CODES.has(f?.code))
    if (!shown.length) return null
    const head = shown.slice(0, MAX_CARD_FRAGMENTS)
    const rest = shown.length - head.length
    const fragments = head.map((f) => {
        const p = findingParams(f)
        return t(f.code, { ...p, n: fmt(p.n) })
    })
    let line = fragments.join(', ')
    if (rest > 0) line += `, ${t('import.andMore', { n: fmt(rest) })}`
    return { level: worstLevel(shown), line, hidden: rest }
}

/**
 * La LISTE de la fiche fichier : tous les constats, chacun avec son niveau
 * et son texte complet (tous les types, pas trois). Jamais de résumé ici.
 */
export function composeFindingList(findings, t, fmt = (v) => String(v)) {
    return sortFindings(findings).map((f) => {
        const p = findingParams(f, { maxTypes: 0 })
        return { code: f.code, level: f.level, text: t(f.code, { ...p, n: fmt(p.n) }) }
    })
}

/**
 * Message d'un REFUS serveur (`importRefusal`, lot 2a) : la cause décide de
 * la clé, et les nombres voyagent avec. Sans refus → null.
 */
export function refusalMessage(refusal, t, fmt = (v) => String(v)) {
    if (!refusal || !refusal.reason) return null
    const n = fmt(refusal.entityCount ?? 0)
    if (refusal.reason === 'entities') {
        return t('localImport.tooManyEntities', { n, max: fmt(refusal.maxEntities ?? 0) })
    }
    if (refusal.reason === 'time') {
        return t('import.serverTooSlow', {
            n,
            seconds: fmt(Math.round((refusal.timeBudgetMs ?? 0) / 1000)),
        })
    }
    return null
}
