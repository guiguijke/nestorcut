/**
 * Calculs d'images du rapport PDF : PURS (tableaux d'octets RGBA, aucun DOM).
 * La partie navigateur (canvas, Image) est dans composables/reportPdfExport.js.
 *
 * @typedef {{ width: number, height: number, rgb: Uint8Array, alpha?: Uint8Array }} Image
 */

/** Taille tenant dans maxW x maxH, proportions gardées, jamais agrandie. */
export function fitInside(w, h, maxW, maxH) {
    if (!(w > 0) || !(h > 0)) return { width: 1, height: 1 }
    const s = Math.min(1, maxW / w, maxH / h)
    return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

/** Taille dont le côté LONG vaut `longSide` (plan d'une tôle). */
export function scaleToLongSide(w, h, longSide) {
    if (!(w > 0) || !(h > 0)) return { width: 1, height: 1 }
    const s = longSide / Math.max(w, h)
    return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

/**
 * Boîte des pixels non blancs d'une image RGBA (le logo NestorCut a de larges
 * marges blanches). `null` si l'image est entièrement blanche ou transparente.
 */
export function nonWhiteBox(rgba, width, height, threshold = 245) {
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4
            if (rgba[i + 3] > 10 && Math.min(rgba[i], rgba[i + 1], rgba[i + 2]) < threshold) {
                if (x < x0) x0 = x
                if (x > x1) x1 = x
                if (y < y0) y0 = y
                if (y > y1) y1 = y
            }
        }
    }
    return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

/**
 * Fond blanc -> transparent (« démattage ») : l'opacité vient de la distance au
 * blanc, la couleur est recalculée pour qu'une fois remis sur du blanc le logo
 * retrouve son aspect. Modifie `rgba` en place et le renvoie.
 */
export function whiteToAlpha(rgba) {
    for (let i = 0; i < rgba.length; i += 4) {
        const m = Math.min(rgba[i], rgba[i + 1], rgba[i + 2])
        if (m >= 250) {
            rgba[i + 3] = 0
            continue
        }
        const a = 255 - m
        for (let c = 0; c < 3; c++) {
            rgba[i + c] = Math.max(0, Math.min(255, Math.round(255 - ((255 - rgba[i + c]) * 255) / a)))
        }
        rgba[i + 3] = Math.min(rgba[i + 3], a)
    }
    return rgba
}

/** RGBA -> image du rapport. `withAlpha` : garde le canal alpha à part. */
export function rgbaToImage(rgba, width, height, { withAlpha = false } = {}) {
    const n = width * height
    const rgb = new Uint8Array(n * 3)
    const alpha = withAlpha ? new Uint8Array(n) : null
    for (let p = 0; p < n; p++) {
        const a = rgba[p * 4 + 3]
        if (alpha) {
            rgb[p * 3] = rgba[p * 4]
            rgb[p * 3 + 1] = rgba[p * 4 + 1]
            rgb[p * 3 + 2] = rgba[p * 4 + 2]
            alpha[p] = a
        } else {
            // Sans canal alpha : composition sur blanc.
            const f = a / 255
            for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.round(rgba[p * 4 + c] * f + 255 * (1 - f))
        }
    }
    return alpha ? { width, height, rgb, alpha } : { width, height, rgb }
}
