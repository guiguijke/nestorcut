/**
 * « Import avancé » — lots E1, E1-bis puis **E3**
 * (`docs/PLAN-ECLATEMENT-2026-09-12.md` §3 puis §6) : éclatement d'un dessin
 * multi-pièces et mise à l'échelle.
 *
 * ---------------------------------------------------------------------------
 * CE QUE LE LOT E3 CHANGE, ET POURQUOI (constat du propriétaire, 13/09 20 h).
 *
 * Ce qui était en production n'était pas ce qu'il avait demandé : il fallait
 * ouvrir un PANNEAU REPLIÉ sur la page projet AVANT de déposer, et l'import
 * ordinaire ne proposait jamais le choix. Sa demande :
 *
 *   - un INTERRUPTEUR « Import avancé » à la création du projet et sur sa
 *     page, dont l'état est une propriété du PROJET (et non de la session :
 *     le panneau du lot E1 vivait dans `sessionStorage`, il mourait avec
 *     l'onglet et ne suivait pas le projet) ;
 *   - allumé, une FENÊTRE DE CHOIX à chaque dépôt : « import automatique »
 *     (le défaut, exactement l'import ordinaire) ou « éclater en pièces et
 *     mettre à l'échelle » (l'aperçu sur tôle du lot E1-bis) ;
 *   - éteint, RIEN : aucune fenêtre, aucune lecture de plus, la chaîne
 *     d'avant le lot E1.
 *
 * Le panneau replié disparaît : deux chemins pour le même réglage, c'était
 * précisément le reproche.
 *
 * ---------------------------------------------------------------------------
 * L'ÉCHELLE se donne de trois façons : un facteur, une largeur cible ou une
 * hauteur cible du dessin COMPLET. Les deux dernières ne peuvent être
 * résolues qu'après lecture du dessin (on ne connaît sa taille qu'importé) :
 * `resolveScale` fait ce calcul, la chaîne d'import l'appelle avec l'étendue
 * mesurée. C'est le sens de « l'un calcule l'autre ».
 *
 * L'APERÇU (E1-bis) montre les contours posés sur une tôle ; tirer la poignée
 * d'angle règle la LARGEUR CIBLE du dessin — c'est-à-dire le mode `width`,
 * pas une seconde façon de calculer une échelle. Rien n'est importé avant
 * validation.
 *
 * ---------------------------------------------------------------------------
 * UN `.job` SHEETCAM N'EST JAMAIS CONCERNÉ : il porte déjà sa tôle et ses
 * quantités, il n'y a rien à éclater ni à mettre à l'échelle. Il passe AVANT
 * la fenêtre, dans `files.js` (règle du lot J4).
 */
import { reactive } from 'vue'

export const SCALE_MODES = ['factor', 'width', 'height']

function blank() {
    return {
        // L'INTERRUPTEUR, porté par le PROJET (champ `advancedImport` du
        // document projet, additif, absent = éteint). Il n'est pas persisté
        // ici : la page le pose depuis le projet chargé, et le repose quand
        // l'utilisateur le change.
        enabled: false,
        projectSlug: null,
        // Réglages de la fenêtre de choix, quand l'utilisateur choisit
        // « éclater et mettre à l'échelle ».
        explode: false,
        mode: 'factor',
        value: 1,
    }
}

/** État de la FENÊTRE DE CHOIX (lot E3) — vidé après décision. */
function blankChoice() {
    return { open: false, projectSlug: null }
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

const state = reactive(blank())
const preview = reactive(blankPreview())
const choice = reactive(blankChoice())

/**
 * L'interrupteur du projet est-il allumé ? C'est le SEUL point de décision :
 * éteint, la dépose ne lit rien de plus et suit la chaîne d'avant le lot E1.
 */
export function isAdvancedActive() {
    return state.enabled === true
}

/**
 * La dépose doit-elle passer par la FENÊTRE DE CHOIX ? (lot E3)
 *
 * Vrai exactement quand l'interrupteur du projet est allumé. Le lot E1
 * regardait ici l'ouverture d'un panneau de session ; c'est ce que le
 * propriétaire a jugé non conforme.
 */
export function needsChoice() {
    return state.enabled === true
}

/**
 * Les options passées à la chaîne d'import. `scale` est un FACTEUR quand il
 * est connu d'avance ; en mode largeur/hauteur cible, `scaleTarget` porte la
 * cible en MILLIMÈTRES (la conversion d'unité est faite par l'appelant —
 * frontière UI, AGENTS #25) et la chaîne résout le facteur après lecture.
 */
export function advancedImportOptions() {
    // Interrupteur éteint ⇒ options NEUTRES, quoi que portent les autres
    // champs : le contrôle négatif du lot E1 (« éteint ne change rien »)
    // tient parce que la décision est ici et nulle part ailleurs.
    if (!state.enabled) return { scale: 1, explode: false }
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
        choice,

        /**
         * Pose l'interrupteur du PROJET (lot E3). La page le lit sur le
         * document projet au chargement, et le repose quand l'utilisateur le
         * change — c'est l'appelant qui écrit côté serveur (`PATCH
         * /api/project/:slug/advanced-import`), pas ce module : la géométrie
         * et le réseau ne se mélangent pas.
         */
        setEnabled(v, projectSlug = null) {
            state.enabled = v === true
            if (projectSlug) state.projectSlug = projectSlug
            if (!state.enabled) {
                Object.assign(choice, blankChoice())
                Object.assign(preview, blankPreview())
            }
        },
        setExplode(v) {
            state.explode = v === true
        },
        setMode(m) {
            if (!SCALE_MODES.includes(m)) return
            state.mode = m
            // Changer de mode change le sens du nombre : on repart d'une
            // valeur neutre plutôt que d'interpréter « 1 » comme 1 mm.
            state.value = m === 'factor' ? 1 : 0
        },
        setValue(v) {
            const n = Number(v)
            state.value = Number.isFinite(n) ? n : 0
        },
        reset() {
            Object.assign(state, blank())
            Object.assign(preview, blankPreview())
            Object.assign(choice, blankChoice())
        },

        // ------------------------------------------- fenêtre de choix (E3)

        /**
         * Ouvre la fenêtre de choix sur une dépose, après avoir LU chaque
         * fichier une fois — la fenêtre montre ce que l'import a lu (nombre
         * de pièces, étendue), pas une promesse. Aucune fiche n'est créée.
         *
         * C'est la même lecture que celle de l'aperçu E1-bis : si
         * l'utilisateur choisit « éclater », rien n'est relu.
         */
        async openChoice(files, { projectSlug = null, readFile = null } = {}) {
            choice.projectSlug = projectSlug
            choice.open = true
            // Une dépose passe par la fenêtre avec des réglages NEUFS : le
            // choix vaut pour le lot déposé, pas pour le précédent.
            state.explode = false
            state.mode = 'factor'
            state.value = 1
            await this.stage(files, { projectSlug, readFile })
        },

        /** « Annuler » : rien n'est créé, rien n'est gardé. */
        cancelChoice() {
            Object.assign(choice, blankChoice())
            Object.assign(preview, blankPreview())
        },

        /**
         * « Éclater en pièces et mettre à l'échelle » : la fenêtre se ferme
         * et l'aperçu sur tôle prend la main, sur les fichiers DÉJÀ lus.
         */
        chooseExplode() {
            state.explode = true
            choice.open = false
        },

        /**
         * « Import automatique » : la fenêtre se ferme, les réglages
         * retombent à neutre et l'appelant importe comme d'ordinaire.
         * Rend les fichiers à importer — l'appelant fait l'import, ce module
         * ne touche pas au stockage.
         */
        chooseAuto() {
            const files = preview.pending.map((p) => p.file)
            const projectSlug = choice.projectSlug
            state.explode = false
            state.mode = 'factor'
            state.value = 1
            Object.assign(choice, blankChoice())
            Object.assign(preview, blankPreview())
            return { files, projectSlug }
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
