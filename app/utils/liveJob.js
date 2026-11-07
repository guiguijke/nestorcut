/** Phases d'un job du registre local qui n'est pas encore terminé. */
const ACTIVE_LOCAL_PHASES = new Set(['queued', 'running', 'finalizing'])

export function isActiveLocalPhase(phase) {
    return ACTIVE_LOCAL_PHASES.has(phase)
}

/**
 * Bind a results-list item to the project page currently on screen.
 * SSE reconnects on navigation (UserResults lives in the layout) so the
 * list can still hold the PREVIOUS project's jobs for a tick — never pick
 * an item whose projectSlug is missing or belongs to someone else.
 */
export function belongsToProject(item, projectSlug) {
    if (!item || !projectSlug) return false
    if (!item.projectSlug) return false
    return item.projectSlug === projectSlug
}

export function pickAwaitingLocal(list, projectSlug) {
    return (list || []).find(
        (r) => r.status === 'awaiting_local' && belongsToProject(r, projectSlug),
    ) || null
}

export function pickLiveJob(list, projectSlug) {
    return (list || []).find(
        (r) => r.liveLayout && belongsToProject(r, projectSlug),
    ) || null
}

export function pickRunningJob(list, projectSlug) {
    return (list || []).find(
        (r) => r.isInProgress && belongsToProject(r, projectSlug),
    ) || null
}

/**
 * Dernier job du projet vu par le flux serveur (la liste SSE arrive du plus
 * récent au plus ancien) : c'est lui qui parle pour le projet, un échec plus
 * ancien se tait dès qu'un nouveau job part.
 * Phases : `running` sur le worker, `local` calculé dans ce navigateur (le
 * registre local le suit, y compris son échec), `error`, `done` (une annulation
 * n'est pas un échec).
 */
export function serverJobState(list, projectSlug) {
    const job = (list || []).find((r) => belongsToProject(r, projectSlug))
    if (!job) return null
    let phase = 'done'
    if (job.status === 'awaiting_local') phase = 'local'
    else if (job.isInProgress) phase = 'running'
    else if (job.status === 'failed' && !job.wasCancelled) phase = 'error'
    return { slug: job.slug, phase, job }
}

// ---------------------------------------------------------------------------
// Champion live — UNE définition partagée (registre + LiveNestingView).
// R-6 (audit 2026-08-31 §R-6) : la couche registre filtrait les frames avec
// une égalité stricte sur strip_width, court-circuitant en amont la fenêtre
// de corridor phase 2 et le critère remnant du plateau BPP — la vue ne
// voyait plus que des frames « déjà meilleures » et figeait (« 1 maj et
// c'est tout », régression du fix B.4). Toute évolution du critère se fait
// ICI, les deux consommateurs suivent.
// ---------------------------------------------------------------------------

// sparrow has NO hard sheet bound: a collision-free ("feasible") solution
// can still be wider than the sheet. Only layouts that actually fit count
// as presentable — otherwise the champion locks on over-width garbage.
export function frameFitsSheet(s) {
    if (!s?.feasible) return false
    const w = s.sheets?.[0]?.[0]
    if (w != null && s.strip_width != null) return s.strip_width <= w + 0.5
    return true
}

// Fenêtre d'égalité SPP : les frames phase 2 vivent à largeur ≈ champion
// phase 1 + slack moteur (corridor = phase1 + 1 mm) — dans cette fenêtre le
// départage se fait sur la hauteur utilisée (critère secondaire du merge),
// sinon toute la compression de hauteur de la phase 2 est invisible.
export const SPP_TIE_WINDOW_MM = 1.0

// Strict quality order: fits-the-sheet first, then narrowest strip / fewest
// bins, then least used height, then densest. Ties keep the incumbent
// (stability), sauf égalité PARFAITE en BPP où la frame fraîche gagne
// (rotation entre incumbents des walks à ~1 Hz — sans ça la vue fige sur le
// premier layout pendant tout le plateau du recuit).
export function frameIsBetter(a, b) {
    if (!a) return false
    if (!b) return true
    const fa = frameFitsSheet(a), fb = frameFitsSheet(b)
    if (fa !== fb) return fa
    const aw = a.strip_width ?? Infinity, bw = b.strip_width ?? Infinity
    if (aw !== bw) {
        const tie = a.isSpp && b.isSpp && Math.abs(aw - bw) <= SPP_TIE_WINDOW_MM
        if (!tie) return aw < bw
        const tha = a.used_height ?? Infinity, thb = b.used_height ?? Infinity
        if (tha !== thb) return tha < thb
        // fenêtre + hauteurs égales : l'incumbent reste (stabilité)
        return false
    }
    const ab = a.bins ?? Infinity, bb = b.bins ?? Infinity
    if (ab !== bb) return ab < bb
    // BPP : à nombre de tôles égal, le « remnant » (marge résiduelle du
    // recuit) est LE critère qui progresse pendant le plateau.
    // D1 (audit 2026-09-03) : le moteur maximise le remnant (Cost.cmp_key
    // le NÉGATIF : plus grand = chute plus propre) — le sens était
    // inversé ici, verrouillé par un test faux : la vue vivait la frame
    // la MOINS compacte. Et une frame sans remnant (reveal/final
    // post-passée, D2) vaut Infinity : elle bat tout champion live à
    // tôles égales — avant, elle perdait TOUJOURS et le panneau vivait
    // une frame moteur brute dentelée pendant que le modal montrait le
    // résultat post-passé.
    const ar = a.remnant ?? Infinity, br = b.remnant ?? Infinity
    if (ar !== br) return ar > br
    const ah = a.used_height ?? Infinity, bh = b.used_height ?? Infinity
    if (ah !== bh) return ah < bh
    if ((a.density || 0) > (b.density || 0) + 1e-9) return true
    if ((b.density || 0) > (a.density || 0) + 1e-9) return false
    // Same packing quality: prefer the hole-filled frame so the live
    // view matches the result modal (fillers in cutouts).
    if ((a.holesFilled || 0) !== (b.holesFilled || 0)) {
        return (a.holesFilled || 0) > (b.holesFilled || 0)
    }
    if ((a.items?.length || 0) !== (b.items?.length || 0)) {
        return (a.items?.length || 0) > (b.items?.length || 0)
    }
    // Égalité parfaite : BPP accepte la frame fraîche ; SPP garde
    // l'incumbent (stabilité du corridor phase 2).
    return a.isSpp === false && b.isSpp === false
}

/**
 * Stage shown in the live header. P4's `finalizing` frame is the same
 * geometry as the champion (the post-pass has not produced a new layout
 * yet), so offerChampion keeps the engine's last `final` — without this
 * override the user never sees « Finalisation… ».
 */
export function resolveLiveStage(result, championStage) {
    const incoming = result?.progress?.stage || result?.liveLayout?.stage
    if (incoming === 'finalizing') return 'finalizing'
    return championStage || incoming || null
}

// ---- badge de l'en-tête live ---------------------------------------------------
/** Étape finale : le calcul est terminé, la frame est le résultat. */
export function isFinalStage(stage) {
    return stage === 'final' || stage === 'reveal'
}

/**
 * Ce que dit le badge de l'en-tête live :
 *  - 'done'      : étape finale seulement (le calcul est fini) ;
 *  - 'fits'      : en cours de recherche, la meilleure disposition tient sur
 *                  la tôle (ce n'est PAS « terminé » : le moteur continue) ;
 *  - 'searching' : rien de présentable pour l'instant ;
 *  - null        : pas de frame, pas de badge.
 */
export function liveBadgeKind(frame, stage) {
    if (!frame) return null
    if (!frameFitsSheet(frame)) return 'searching'
    return isFinalStage(stage) ? 'done' : 'fits'
}

/**
 * Longueur de tôle utilisée (mm canoniques) d'une frame SPP en cours de
 * recherche, ou null. Elle diminue quand le moteur progresse. Une valeur
 * absente, non finie, nulle, ou plus grande que la tôle (frame qui ne tient
 * pas) n'est pas affichée. Hors SPP ou à l'étape finale : null.
 */
export function liveUsedLength(frame, stage) {
    if (!frame || !frame.isSpp || isFinalStage(stage)) return null
    if (!frameFitsSheet(frame)) return null
    const n = Number(frame.strip_width)
    if (frame.strip_width == null || !Number.isFinite(n) || n <= 0) return null
    const w = Number(frame.sheets?.[0]?.[0])
    if (Number.isFinite(w) && w > 0 && n > w + 0.5) return null
    return n
}
