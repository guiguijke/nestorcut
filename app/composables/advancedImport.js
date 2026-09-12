/**
 * « Import avancé » (lot E1 de docs/PLAN-ECLATEMENT-2026-09-12.md §3) :
 * l'état du panneau replié de la dépose — éclatement en pièces unitaires et
 * mise à l'échelle.
 *
 * Deux choix de conception, tous deux demandés par la consigne :
 *
 * - **le réglage vaut pour la DÉPOSE, pas pour le compte** : un état de
 *   module (un objet réactif par onglet) + un miroir `sessionStorage`, jamais
 *   une préférence serveur. Fermer l'onglet remet l'option à zéro ;
 * - **éteint par défaut** : `options()` rend `{ scale: 1, explode: false }`
 *   tant que l'utilisateur n'a rien touché, et la chaîne d'import ne fait
 *   alors AUCUN appel de plus qu'avant le lot.
 *
 * L'échelle se donne de trois façons : un facteur, une largeur cible ou une
 * hauteur cible du dessin COMPLET. Les deux dernières ne peuvent être
 * résolues qu'après lecture du dessin (on ne connaît sa taille qu'importé) :
 * `resolveScale` fait ce calcul, la chaîne d'import l'appelle avec l'étendue
 * mesurée. C'est le sens de « l'un calcule l'autre ».
 */
import { reactive } from 'vue'

const KEY = 'nestorcut.advancedImport'

export const SCALE_MODES = ['factor', 'width', 'height']

function blank() {
    return { open: false, explode: false, mode: 'factor', value: 1 }
}

function load() {
    try {
        const raw = sessionStorage.getItem(KEY)
        if (!raw) return blank()
        const v = JSON.parse(raw)
        return {
            open: v.open === true,
            explode: v.explode === true,
            mode: SCALE_MODES.includes(v.mode) ? v.mode : 'factor',
            value: Number.isFinite(Number(v.value)) ? Number(v.value) : 1,
        }
    } catch {
        // Onglet privé, stockage refusé : l'option repart simplement éteinte.
        return blank()
    }
}

const state = reactive(load())

function persist() {
    try {
        sessionStorage.setItem(KEY, JSON.stringify({ ...state }))
    } catch {
        // Sans stockage, le réglage vit le temps de la page : acceptable.
    }
}

/** Le réglage est-il effectif ? (panneau ouvert ET quelque chose demandé) */
export function isAdvancedActive() {
    if (!state.open) return false
    if (state.explode) return true
    return state.mode !== 'factor' ? Number(state.value) > 0 : Number(state.value) !== 1
}

/**
 * Les options passées à la chaîne d'import. `scale` est un FACTEUR quand il
 * est connu d'avance ; en mode largeur/hauteur cible, `scaleTarget` porte la
 * cible en MILLIMÈTRES (la conversion d'unité est faite par l'appelant —
 * frontière UI, AGENTS #25) et la chaîne résout le facteur après lecture.
 */
export function advancedImportOptions() {
    if (!state.open) return { scale: 1, explode: false }
    const explode = state.explode === true
    const value = Number(state.value)
    if (state.mode === 'factor') {
        return { scale: Number.isFinite(value) && value > 0 ? value : 1, explode }
    }
    if (!Number.isFinite(value) || value <= 0) return { scale: 1, explode }
    return { scale: 1, explode, scaleTarget: { mode: state.mode, mm: value } }
}

/**
 * Facteur d'échelle pour un dessin dont l'étendue mesurée est
 * `{ width, height }` (mm). Rend 1 si la cible n'a pas de sens (dessin
 * dégénéré) : on ne multiplie jamais une géométrie par l'infini.
 */
export function resolveScale(options, extent) {
    const target = options?.scaleTarget
    if (!target) {
        const s = Number(options?.scale)
        return Number.isFinite(s) && s > 0 ? s : 1
    }
    const mm = Number(target.mm)
    const span = target.mode === 'height' ? Number(extent?.height) : Number(extent?.width)
    if (!Number.isFinite(mm) || mm <= 0 || !Number.isFinite(span) || span <= 1e-9) return 1
    return mm / span
}

export function useAdvancedImport() {
    return {
        state,
        toggleOpen() {
            state.open = !state.open
            persist()
        },
        setExplode(v) {
            state.explode = v === true
            persist()
        },
        setMode(m) {
            if (!SCALE_MODES.includes(m)) return
            state.mode = m
            // Changer de mode change le sens du nombre : on repart d'une
            // valeur neutre plutôt que d'interpréter « 1 » comme 1 mm.
            state.value = m === 'factor' ? 1 : 0
            persist()
        },
        setValue(v) {
            const n = Number(v)
            state.value = Number.isFinite(n) ? n : 0
            persist()
        },
        reset() {
            Object.assign(state, blank())
            persist()
        },
    }
}
