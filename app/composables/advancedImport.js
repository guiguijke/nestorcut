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
 *
 * LOT E1-BIS — l'aperçu contre une tôle. Quand le panneau est OUVERT, une
 * dépose ne crée aucune fiche : le fichier est lu UNE fois (l'import
 * ordinaire, celui qui produira les fiches), et l'aperçu montre ses contours
 * posés sur une tôle. Tirer la poignée d'angle règle la LARGEUR CIBLE du
 * dessin — c'est-à-dire exactement le mode `width` ci-dessus, pas une
 * seconde façon de calculer une échelle. Le facteur déduit s'affiche, la
 * tôle sert de référence (et peut pré-remplir celle du projet), et rien
 * n'est importé avant validation.
 *
 * Panneau FERMÉ : `needsPreview()` est faux, `addFiles` importe comme avant
 * le lot E1 — aucune lecture de plus (verrou du cas A).
 */
import { reactive } from 'vue'

const KEY = 'nestorcut.advancedImport'

export const SCALE_MODES = ['factor', 'width', 'height']

function blank() {
    return { open: false, explode: false, mode: 'factor', value: 1 }
}

/** État de l'aperçu (lot E1-bis) — vidé après import ou annulation. */
function blankPreview() {
    return {
        // Fichiers en attente de validation (File + géométrie lue une fois).
        pending: [],
        // Tôle de référence, en MILLIMÈTRES (la conversion d'affichage est
        // faite par le composant — frontière UI, AGENTS #25).
        sheet: null,
        // « utiliser cette tôle pour le projet » : ne s'applique qu'à la
        // validation, et seulement sur la largeur/hauteur du premier format.
        useSheet: false,
        // Lecture en cours (une dépose lourde prend quelques secondes).
        loading: false,
        error: null,
    }
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
const preview = reactive(blankPreview())

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

/**
 * Le panneau doit-il intercepter la dépose ? (ouvert = aperçu, fermé = import
 * direct). C'est le seul point de décision : fermé, rien n'est lu de plus.
 */
export function needsPreview() {
    return state.open === true
}

/**
 * Facteur d'une poignée tirée : la largeur cible visée sur le dessin, divisée
 * par sa largeur mesurée. Rendu 1 si l'un des deux n'a pas de sens — on ne
 * multiplie jamais une géométrie par l'infini.
 */
export function scaleFromHandle(targetWidthMm, sourceWidthMm) {
    const t = Number(targetWidthMm)
    const w = Number(sourceWidthMm)
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(w) || w <= 1e-9) return 1
    return t / w
}

/**
 * Le dessin mis à l'échelle tient-il sur la tôle ? Les deux orientations de
 * la TÔLE sont acceptées (une tôle est un rectangle qu'on pose comme on
 * veut) ; la pièce, elle, n'est pas tournée ici — c'est le moteur qui le
 * fera, pièce par pièce.
 */
export function fitsSheet(extent, scale, sheet) {
    const w = Number(extent?.width) * (Number(scale) || 1)
    const h = Number(extent?.height) * (Number(scale) || 1)
    const sw = Number(sheet?.width)
    const sh = Number(sheet?.height)
    if (!Number.isFinite(w) || !Number.isFinite(h)) return true
    if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw <= 0 || sh <= 0) return true
    return (w <= sw && h <= sh) || (w <= sh && h <= sw)
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
            Object.assign(preview, blankPreview())
            persist()
        },

        // ------------------------------------------------ aperçu (E1-bis)
        preview,

        /** Tôle de référence (mm) — pré-remplie par l'appelant. */
        setSheet(width, height) {
            const w = Number(width)
            const h = Number(height)
            preview.sheet = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
                ? { width: w, height: h }
                : null
        },
        setUseSheet(v) {
            preview.useSheet = v === true
        },

        /**
         * Met les fichiers déposés en attente et lit leur géométrie UNE fois
         * (`geoImportFile`, l'import ordinaire). Aucune fiche n'est créée.
         * `readFile` est injectable pour les tests.
         */
        async stage(files, { projectSlug = null, readFile = null } = {}) {
            preview.error = null
            preview.loading = true
            preview.pending = []
            try {
                const read = readFile || (async (file) => {
                    const { geoImportFile } = await import('./geometryClient')
                    const bytes = new Uint8Array(await file.arrayBuffer())
                    return geoImportFile(bytes)
                })
                for (const file of files || []) {
                    const imported = await read(file)
                    const parts = Array.isArray(imported?.parts) ? imported.parts : []
                    preview.pending.push({
                        file,
                        projectSlug,
                        name: file.name || 'part.dxf',
                        parts: parts.map((p) => ({
                            coordinates: p.coordinates || [],
                            holes: p.holes || [],
                        })),
                        extent: drawingExtent(parts),
                        refusal: imported?.refusal || null,
                    })
                }
            } catch (e) {
                preview.error = e?.message || 'localImport.parseError'
            } finally {
                preview.loading = false
            }
            return preview.pending
        },

        /** Abandonne la dépose : aucune fiche, aucun octet gardé. */
        cancel() {
            Object.assign(preview, blankPreview())
        },

        /** Largeur cible tirée à la poignée : écrit le mode `width`. */
        dragToWidth(targetWidthMm) {
            const t = Number(targetWidthMm)
            if (!Number.isFinite(t) || t <= 0) return
            state.mode = 'width'
            state.value = t
            persist()
        },
    }
}

/** Étendue du DESSIN COMPLET (bbox de toutes les pièces), en mm. */
export function drawingExtent(parts) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of parts || []) {
        for (const [x, y] of p.coordinates || []) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
        }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { width: 0, height: 0 }
    return { width: maxX - minX, height: maxY - minY }
}
