/**
 * « Échelle » d'une fiche — lots E1, E1-bis, E3 puis **E4**
 * (`docs/PLAN-ECLATEMENT-2026-09-12.md` §8) : l'aperçu sur tôle du lot E1-bis,
 * désormais ouvert DEPUIS UNE FICHE (action « Échelle »).
 *
 * ---------------------------------------------------------------------------
 * CE QUE LE LOT E4 CHANGE (consigne du 14/09, §8.2/§8.4).
 *
 * La fenêtre de choix au dépôt et l'interrupteur « Import avancé » du projet
 * ont DISPARU : un dessin déposé se neste comme un bloc rigide (E4-a), et
 * l'échelle/l'éclatement sont des actions SUR LA FICHE, après import. Ce
 * composable ne porte donc plus ni interrupteur ni fenêtre : seulement
 * l'aperçu sur tôle, ouvert sur la fiche choisie.
 *
 * L'ÉCHELLE se donne de trois façons, toutes équivalentes : une largeur
 * cible, une hauteur cible (rapport conservé : le panneau recalcule l'autre)
 * ou un facteur. Cibles et facteur ne se mélangent pas : `state` garde le
 * DERNIER mode édité et sa valeur — `resolveScale` fait le calcul sur
 * l'étendue mesurée de la fiche.
 *
 * La POIGNÉE d'angle de l'aperçu tire la LARGEUR CIBLE du dessin — c'est le
 * mode `width`, pas une seconde façon de calculer une échelle. Rien n'est
 * appliqué avant « Appliquer » : ce composable ne touche ni au stockage ni
 * au réseau ; l'application est à l'appelant (`files.js`).
 */
import { reactive } from 'vue'

function blank() {
    return {
        // Réglages du panneau, remis à NEUTRE à chaque ouverture : le choix
        // vaut pour CETTE application, pas pour la précédente.
        mode: 'factor',
        value: 1,
    }
}

/** État de l'aperçu — vidé après application ou annulation. */
function blankPreview() {
    return {
        // La fiche en cours de mise à l'échelle : géométrie DÉJÀ connue
        // (enregistrement local ou réponse de l'API géométrie — aucune
        // lecture wasm ici). `ficheSlug` désigne la fiche à remplacer.
        pending: [],
        // Tôle de référence, en MILLIMÈTRES (la conversion d'affichage est
        // faite par le composant — frontière UI, AGENTS #25).
        sheet: null,
        // « utiliser cette tôle pour le projet » : ne s'applique qu'à la
        // validation, et seulement sur la largeur/hauteur du premier format.
        useSheet: false,
        // Lecture en cours (une fiche serveur demande sa géométrie à l'API).
        loading: false,
        error: null,
    }
}

const state = reactive(blank())
const preview = reactive(blankPreview())

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
        preview,

        // ------------------------------------------------ aperçu (E1-bis/E4-b)

        /**
         * Ouvre l'aperçu sur CETTE fiche (lot E4-b). La géométrie est celle
         * de la fiche — enregistrement IndexedDB en local, réponse de
         * `/api/files/project/geometry/:slug` côté serveur — aucune lecture
         * wasm, aucune fiche créée. L'appelant pré-remplit la tôle de
         * référence s'il le veut (`setSheet`).
         */
        openFicheScale({ slug, name, parts }) {
            Object.assign(state, blank())
            preview.error = null
            preview.pending = [{
                ficheSlug: slug,
                file: null,
                name: name || 'part.dxf',
                parts: (parts || []).map((p) => ({
                    coordinates: p.coordinates || [],
                    holes: p.holes || [],
                })),
                extent: drawingExtent(parts),
                refusal: null,
            }]
            return preview.pending[0]
        },

        /** Abandonne : la fiche n'est pas touchée. */
        cancel() {
            Object.assign(preview, blankPreview())
        },

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

        /** Largeur cible (mm) — saisie au clavier ou poignée tirée. */
        setTargetWidth(mm) {
            const n = Number(mm)
            if (!Number.isFinite(n) || n <= 0) return
            state.mode = 'width'
            state.value = n
        },
        /** Hauteur cible (mm) — le panneau recalcule la largeur (rapport conservé). */
        setTargetHeight(mm) {
            const n = Number(mm)
            if (!Number.isFinite(n) || n <= 0) return
            state.mode = 'height'
            state.value = n
        },
        /** Facteur — la troisième façon de dire la même échelle. */
        setFactor(f) {
            const n = Number(f)
            if (!Number.isFinite(n) || n <= 0) return
            state.mode = 'factor'
            state.value = n
        },

        /** Les options d'application, résolues par l'appelant sur l'étendue. */
        targetOptions() {
            const value = Number(state.value)
            if (state.mode === 'factor') {
                return { scale: Number.isFinite(value) && value > 0 ? value : 1 }
            }
            if (!Number.isFinite(value) || value <= 0) return { scale: 1 }
            return { scale: 1, scaleTarget: { mode: state.mode, mm: value } }
        },

        reset() {
            Object.assign(state, blank())
            Object.assign(preview, blankPreview())
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
