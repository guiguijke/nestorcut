/**
 * Rapport PDF : partie NAVIGATEUR (lecture des aperçus, rastérisation, logos,
 * téléchargement). La mise en page et le contenu sont dans des modules purs
 * (`reportPdfModel.js`, `reportPdf.js`). Rien ne part au serveur : le PDF est
 * fabriqué ici ; seules les images d'aperçu d'un résultat serveur sont LUES
 * (même origine, cookies compris).
 *
 * Le plan d'une tôle est une IMAGE (aperçu rastérisé), jamais des traits : un
 * PDF en traits se reconvertirait en DXF et contournerait le verrou des
 * fichiers de coupe du compte Free.
 */
import { parseSheetSvg, svgTextFromDataUri } from '~/utils/sheetSvgReport'
import { buildReportPdfModel } from '~/utils/reportPdfModel'
import { buildReportPdf } from '~/utils/reportPdf'
import { LOGO_MAX_BYTES } from '~/utils/reportBranding'
import { fitInside, nonWhiteBox, rgbaToImage, scaleToLongSide, whiteToAlpha } from '~/utils/reportImages'

const PLAN_LONG_SIDE = 1600
const PLAN_LONG_SIDE_MANY = 1200 // beaucoup de tôles : on ménage la mémoire
const MANY_SHEETS = 8
const NESTORCUT_LOGO_URL = '/brand/nestorcut-logo-light-master.png'
const NESTORCUT_LOGO_WIDTH = 600
const COMPANY_LOGO_MAX = { width: 800, height: 400 }
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

// ---- images (navigateur) ------------------------------------------------------

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('image_unreadable'))
        img.src = src
    })
}

function makeCanvas(width, height) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('canvas_unavailable')
    return { canvas, ctx }
}

/** Libère la mémoire d'un canvas (Safari garde le tampon sinon). */
function releaseCanvas(canvas) {
    canvas.width = 0
    canvas.height = 0
}

/**
 * Texte SVG d'un aperçu : texte brut, data URI (résultat « Cet appareil ») ou URL
 * (résultat serveur : fetch même origine, cookies compris).
 * @returns {Promise<string|null>} null si illisible (jamais d'exception)
 */
export async function svgTextOf(src) {
    try {
        if (typeof src !== 'string' || !src) return null
        if (src.trimStart().startsWith('<')) return src
        if (src.startsWith('data:')) return svgTextFromDataUri(src)
        const res = await fetch(src, { credentials: 'same-origin' })
        if (!res.ok) return null
        return await res.text()
    } catch {
        return null
    }
}

/**
 * SVG de tôle -> image RVB, fond blanc, côté long `longSide` px.
 * @returns {Promise<{ width: number, height: number, rgb: Uint8Array }|null>}
 */
export async function rasterizeSheetSvg(svgText, widthMm, heightMm, longSide = PLAN_LONG_SIDE) {
    try {
        const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`)
        const { width, height } = scaleToLongSide(widthMm, heightMm, longSide)
        const { canvas, ctx } = makeCanvas(width, height)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        const data = ctx.getImageData(0, 0, width, height).data
        releaseCanvas(canvas)
        return rgbaToImage(data, width, height)
    } catch {
        return null
    }
}

let nestorcutLogoPromise = null
/** Logo NestorCut : marges blanches rognées, ~600 px de large, fond transparent. */
export function loadNestorcutLogo() {
    if (!nestorcutLogoPromise) {
        nestorcutLogoPromise = (async () => {
            try {
                const img = await loadImage(NESTORCUT_LOGO_URL)
                const full = makeCanvas(img.naturalWidth, img.naturalHeight)
                full.ctx.drawImage(img, 0, 0)
                const box = nonWhiteBox(full.ctx.getImageData(0, 0, full.canvas.width, full.canvas.height).data, full.canvas.width, full.canvas.height)
                if (!box) return null
                const pad = 4
                const sx = Math.max(0, box.x - pad)
                const sy = Math.max(0, box.y - pad)
                const sw = Math.min(full.canvas.width - sx, box.width + 2 * pad)
                const sh = Math.min(full.canvas.height - sy, box.height + 2 * pad)
                const { width, height } = fitInside(sw, sh, NESTORCUT_LOGO_WIDTH, 100000)
                const out = makeCanvas(width, height)
                out.ctx.drawImage(full.canvas, sx, sy, sw, sh, 0, 0, width, height)
                const rgba = whiteToAlpha(out.ctx.getImageData(0, 0, width, height).data)
                releaseCanvas(full.canvas)
                releaseCanvas(out.canvas)
                return rgbaToImage(rgba, width, height, { withAlpha: true })
            } catch {
                nestorcutLogoPromise = null // un échec réseau ne reste pas figé
                return null
            }
        })()
    }
    return nestorcutLogoPromise
}

/** Data URI PNG du logo de l'entreprise -> image du rapport (alpha gardé). */
export async function dataUriToImage(dataUri) {
    try {
        if (typeof dataUri !== 'string' || !dataUri.startsWith('data:image/')) return null
        const img = await loadImage(dataUri)
        const { canvas, ctx } = makeCanvas(img.naturalWidth, img.naturalHeight)
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        const out = rgbaToImage(data, canvas.width, canvas.height, { withAlpha: true })
        releaseCanvas(canvas)
        return out
    } catch {
        return null
    }
}

const fileKind = (file) => {
    if (LOGO_TYPES.includes(file?.type)) return file.type
    const ext = /\.([a-z0-9]+)$/i.exec(file?.name || '')?.[1]?.toLowerCase()
    return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || null
}

/**
 * Fichier de logo -> data URI PNG réduite (800 x 400 px au plus), pour le
 * stockage local. Refus : `tooBig` (plus de 5 Mo), `badType`, `unreadable`.
 * @returns {Promise<{ ok: true, dataUri: string } | { ok: false, reason: 'tooBig'|'badType'|'unreadable' }>}
 */
export async function processCompanyLogo(file) {
    if (!file) return { ok: false, reason: 'unreadable' }
    const kind = fileKind(file)
    if (!kind) return { ok: false, reason: 'badType' }
    if (file.size > LOGO_MAX_BYTES) return { ok: false, reason: 'tooBig' }
    let url = null
    try {
        // Un SVG est dessiné par <img> : aucun script ne s'exécute.
        const blob = kind === 'image/svg+xml' ? new Blob([await file.text()], { type: 'image/svg+xml' }) : file
        url = URL.createObjectURL(blob)
        const img = await loadImage(url)
        const w = img.naturalWidth || 300
        const h = img.naturalHeight || 150
        const { width, height } = fitInside(w, h, COMPANY_LOGO_MAX.width, COMPANY_LOGO_MAX.height)
        const { canvas, ctx } = makeCanvas(width, height)
        ctx.drawImage(img, 0, 0, width, height)
        const dataUri = canvas.toDataURL('image/png')
        releaseCanvas(canvas)
        return dataUri.startsWith('data:image/png') ? { ok: true, dataUri } : { ok: false, reason: 'unreadable' }
    } catch {
        return { ok: false, reason: 'unreadable' }
    } finally {
        if (url) URL.revokeObjectURL(url)
    }
}

// ---- fabrication ------------------------------------------------------------------

/**
 * Fabrique le PDF. `wantAdvanced` : le choix de l'utilisateur, déjà autorisé par
 * l'appelant ; `stillAdvanced()` est relu JUSTE AVANT de construire le modèle
 * (après la rastérisation, qui prend du temps) : une offre perdue entre-temps
 * donne le PDF de base. Le contenu avancé n'existe que si les deux sont vrais.
 *
 * @param {object} opts
 * @param {object} opts.input Données du rapport (voir `ReportPdfInput`), sans
 *   `advanced`, `previews`, `images`, `branding`, `fields`, `nestorcutLogo`
 * @param {(string|null)[]} opts.svgSources Aperçu de chaque tôle (texte, data URI ou URL)
 * @param {boolean} opts.wantAdvanced
 * @param {() => boolean} opts.stillAdvanced
 * @param {{ company: string, line: string, logo: string|null }} [opts.branding]
 * @param {object} [opts.fields]
 * @returns {Promise<{ bytes: Uint8Array, advanced: boolean }>}
 */
export async function generateReportPdf({ input, svgSources, wantAdvanced, stillAdvanced, branding = null, fields = null }) {
    const sources = Array.isArray(svgSources) ? svgSources : []
    const longSide = sources.length > MANY_SHEETS ? PLAN_LONG_SIDE_MANY : PLAN_LONG_SIDE
    const previews = []
    const images = []
    // Une tôle après l'autre : la mémoire ne garde qu'une rastérisation en cours.
    for (const src of sources) {
        const text = await svgTextOf(src)
        const parsed = text ? parseSheetSvg(text) : null
        previews.push(parsed)
        images.push(parsed ? await rasterizeSheetSvg(text, parsed.widthMm, parsed.heightMm, longSide) : null)
    }
    const nestorcutLogo = await loadNestorcutLogo()
    const companyLogo = wantAdvanced && branding?.logo ? await dataUriToImage(branding.logo) : null
    const advanced = Boolean(wantAdvanced) && stillAdvanced() === true
    const model = buildReportPdfModel({
        ...input,
        advanced,
        previews,
        images,
        nestorcutLogo,
        branding: advanced && branding ? { logo: companyLogo, company: branding.company, line: branding.line } : null,
        fields: advanced ? fields : null,
    })
    return { bytes: buildReportPdf(model), advanced }
}

/** Nom du fichier : même nettoyage du slug que le CSV du rapport. */
export function reportPdfFileName(resultSlug, altNumber) {
    const slug = String(resultSlug || 'job').replace(/[^a-zA-Z0-9_-]+/g, '-')
    return `nesting-report-${slug}-alt${altNumber}.pdf`
}

/** Téléchargement ; la révocation différée évite d'avorter le téléchargement (m-7). */
export function downloadPdfBytes(bytes, fileName) {
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}
