/**
 * Scène au repos (avant tout calcul) : un PANNEAU par type de tôle déclaré,
 * côte à côte, chacun à sa taille et avec sa forme. Logique PURE (pas de DOM,
 * pas d'E/S). La disposition est celle de la vue live (`livePaneLayout`) pour
 * que les deux écrans posent les tôles de la même façon.
 */
import { livePaneLayout } from './sheetView'

/** Même plafond que la vue live (MAX_LIVE_SHEETS) ; le reste devient « +N ». */
export const MAX_IDLE_SHEETS = 6

const DEFAULT_W = 1000
const DEFAULT_H = 2000

const num = (v) => Number(String(v).replace(',', '.'))

/**
 * @param sheets      réglages : [{ width, height, count, shapeId?, name? }] (unité d'affichage)
 * @param formatSize  (w, h) → « 1000 mm × 1000 mm », arrondi comme la ligne des réglages
 * @returns { panes, truncated, totalW, totalH, gap } ; chaque panneau porte
 *   index (rang dans les réglages), w, h, viewW, viewH, landscape, dx,
 *   shapeId (null si rectangle), count, label.
 * Une tôle de quantité 0 n'est pas dessinée ; si toutes le sont, la première
 * reste affichée (comme avant).
 */
export function idlePaneModel(sheets, { formatSize, max = MAX_IDLE_SHEETS } = {}) {
    const list = (Array.isArray(sheets) && sheets.length ? sheets : [{ width: DEFAULT_W, height: DEFAULT_H }])
        .map((s, index) => {
            const c = num(s?.count ?? 1)
            return {
                index,
                w: num(s?.width) || DEFAULT_W,
                h: num(s?.height) || DEFAULT_H,
                count: Number.isFinite(c) ? c : 1,
                shapeId: s?.shapeId ? String(s.shapeId) : null,
                name: s?.shapeId && s?.name ? String(s.name) : '',
            }
        })
    let kept = list.filter((s) => s.count > 0)
    if (!kept.length) kept = [{ ...list[0], count: 1 }]
    const layout = livePaneLayout(
        kept.map((s) => [s.w, s.h]),
        kept.map((_, i) => i),
        max
    )
    const panes = layout.panes.map((p) => {
        const s = kept[p.bin]
        const base = s.name || formatSize(s.w, s.h)
        return {
            index: s.index,
            w: s.w,
            h: s.h,
            viewW: p.viewW,
            viewH: p.viewH,
            landscape: p.landscape,
            dx: p.dx,
            shapeId: s.shapeId,
            count: s.count,
            label: s.count > 1 ? `${base} × ${s.count}` : base,
        }
    })
    return {
        panes,
        truncated: layout.truncated,
        totalW: layout.totalW,
        totalH: layout.totalH,
        gap: layout.gap,
    }
}
