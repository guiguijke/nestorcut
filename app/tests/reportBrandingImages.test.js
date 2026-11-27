import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRANDING_KEY, clearBranding, loadBranding, saveBranding } from '~~/app/utils/reportBranding'
import { fitInside, nonWhiteBox, rgbaToImage, scaleToLongSide, whiteToAlpha } from '~~/app/utils/reportImages'

const memory = (opts = {}) => {
    const m = new Map()
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => {
            if (opts.full) {
                const e = new Error('plein')
                e.name = 'QuotaExceededError'
                throw e
            }
            m.set(k, v)
        },
        removeItem: (k) => m.delete(k),
        _m: m,
    }
}

describe('marque de l\'entreprise (localStorage)', () => {
    const LOGO = 'data:image/png;base64,AAAA'
    it('aller-retour, clé versionnée', () => {
        const st = memory()
        expect(loadBranding(st)).toEqual({ company: '', line: '', logo: null })
        expect(saveBranding({ company: 'ACME', line: 'Rue 1', logo: LOGO }, st)).toEqual({ ok: true })
        expect(BRANDING_KEY).toMatch(/\.v1$/)
        expect(st._m.has(BRANDING_KEY)).toBe(true)
        expect(loadBranding(st)).toEqual({ company: 'ACME', line: 'Rue 1', logo: LOGO })
        clearBranding(st)
        expect(loadBranding(st)).toEqual({ company: '', line: '', logo: null })
    })
    it('quota plein : un message clair possible (reason quota), jamais d\'exception', () => {
        expect(saveBranding({ company: 'A', logo: LOGO }, memory({ full: true }))).toEqual({ ok: false, reason: 'quota' })
        expect(saveBranding({ company: 'A' }, null)).toEqual({ ok: false, reason: 'unavailable' })
    })
    it('contenu abîmé ou data URI étrangère : ignoré', () => {
        const st = memory()
        st.setItem(BRANDING_KEY, '{pas du json')
        expect(loadBranding(st).logo).toBeNull()
        st.setItem(BRANDING_KEY, JSON.stringify({ company: 'X', logo: 'data:text/html;base64,AAAA' }))
        expect(loadBranding(st)).toEqual({ company: 'X', line: '', logo: null })
        const broken = { getItem: () => { throw new Error('bloqué') }, removeItem: () => { throw new Error('bloqué') } }
        expect(loadBranding(broken).company).toBe('')
        expect(() => clearBranding(broken)).not.toThrow()
    })
    it('la déconnexion efface la marque (auth.js appelle clearBranding)', () => {
        const src = readFileSync(path.resolve(__dirname, '../composables/auth.js'), 'utf8')
        const logout = src.slice(src.indexOf('async function logout()'), src.indexOf('export const authStore'))
        expect(logout).toContain('clearBranding()')
    })
})

describe('images du rapport (calculs purs)', () => {
    it('tailles', () => {
        expect(fitInside(4000, 1000, 800, 400)).toEqual({ width: 800, height: 200 })
        expect(fitInside(100, 50, 800, 400)).toEqual({ width: 100, height: 50 }) // jamais agrandi
        expect(scaleToLongSide(2000, 1000, 1600)).toEqual({ width: 1600, height: 800 })
        expect(scaleToLongSide(500, 1000, 1600)).toEqual({ width: 800, height: 1600 })
    })
    it('marges blanches rognées', () => {
        const w = 10
        const h = 8
        const px = new Uint8Array(w * h * 4).fill(255)
        for (const [x, y] of [[3, 2], [6, 5]]) px.set([20, 30, 40, 255], (y * w + x) * 4)
        expect(nonWhiteBox(px, w, h)).toEqual({ x: 3, y: 2, width: 4, height: 4 })
        expect(nonWhiteBox(new Uint8Array(w * h * 4).fill(255), w, h)).toBeNull()
    })
    it('fond blanc -> transparent, couleur d\'une encre pleine conservée', () => {
        const px = Uint8Array.from([255, 255, 255, 255, 20, 30, 40, 255, 128, 128, 255, 255])
        whiteToAlpha(px)
        expect(px[3]).toBe(0)
        expect(px[7]).toBe(235)
        // Posé sur du blanc, un pixel d'encre retrouve sa valeur d'origine (à 1 près).
        for (let c = 0; c < 3; c++) expect(Math.abs(px[4 + c] * (235 / 255) + 255 * (20 / 255) - [20, 30, 40][c])).toBeLessThanOrEqual(1)
        // Posé sur du blanc, le pixel mi-teinté retrouve sa valeur d'origine (à 1 près).
        const a = px[11] / 255
        for (let c = 0; c < 3; c++) expect(Math.abs(px[8 + c] * a + 255 * (1 - a) - [128, 128, 255][c])).toBeLessThanOrEqual(1)
    })
    it('RGBA -> image du rapport, avec ou sans canal alpha', () => {
        const px = Uint8Array.from([10, 20, 30, 255, 0, 0, 0, 0])
        const withA = rgbaToImage(px, 2, 1, { withAlpha: true })
        expect(Array.from(withA.rgb)).toEqual([10, 20, 30, 0, 0, 0])
        expect(Array.from(withA.alpha)).toEqual([255, 0])
        expect(Array.from(rgbaToImage(px, 2, 1).rgb)).toEqual([10, 20, 30, 255, 255, 255]) // transparent -> blanc
    })
})

describe('câblage : rien de nouveau ne part au serveur, le verrou passe par onExportClick', () => {
    const read = (f) => readFileSync(path.resolve(__dirname, f), 'utf8')
    const modal = read('../components/ResultModal.vue')

    it('le bouton « Rapport PDF » n\'a jamais de cadenas et n\'émet qu\'une intention', () => {
        const rep = read('../components/ResultReport.vue')
        const at = rep.indexOf('data-testid="report-pdf"')
        const btn = rep.slice(rep.lastIndexOf('<MainButton', at), rep.indexOf('/>', at))
        expect(btn).not.toContain('iconType.lock')
        expect(btn).not.toContain('isDisable')
        expect(btn).toContain("$emit('report-pdf')")
    })

    it('l\'avancé suit le chemin verrouillé des exports et relit l\'état au clic', () => {
        const at = modal.indexOf('const onReportPdfDownload')
        const body = modal.slice(at, modal.indexOf('\n}\n', at))
        expect(body).toContain("onExportClick(() => makeReportPdf(payload), 'report_pdf_locked_click')")
        expect(body).toContain("'disabled'")
        // Le contenu avancé exige l'état 'enabled' relu, deux fois (au départ et avant le modèle).
        expect(modal).toContain("const advancedPdfEnabled = () => unref(pdfState).advanced === 'enabled'")
        expect(modal).toContain('wantAdvanced: advanced === true && advancedPdfEnabled()')
        expect(modal).toContain('stillAdvanced: advancedPdfEnabled')
        // Même source d'offre que le verrou des exports.
        expect(modal).toMatch(/const pdfState = computed\(\(\) => reportPdfState\(\s*unref\(userData\)\?\.compute\?\.level \?\? null,\s*flagOn\(config\.public\.paidPlansDisabled\),/)
        expect(modal).toMatch(/const exportState = computed\(\(\) =>\s*reportExportState\(\s*unref\(userData\)\?\.compute\?\.level \?\? null,\s*flagOn\(config\.public\.paidPlansDisabled\),/)
    })

    it('ni logo, ni champs, ni PDF dans une requête ; le suivi ne porte que altId et advanced', () => {
        for (const f of ['../composables/reportPdfExport.js', '../components/ReportPdfDialog.vue', '../utils/reportBranding.js']) {
            const src = read(f)
            const calls = [...src.matchAll(/(\$fetch|useApiFetch|useFetch|sendBeacon)\(/g)]
            expect(calls, f).toHaveLength(0)
        }
        // Le seul fetch lit un aperçu (GET, même origine), sans corps.
        const exp = read('../composables/reportPdfExport.js')
        expect([...exp.matchAll(/\bfetch\(([^)]*)\)/g)].map((m) => m[1])).toEqual(["src, { credentials: 'same-origin' }"])
        expect(modal).toContain("trackEvent('report_pdf_exported', { altId: unref(activeAlt), advanced: out.advanced })")
    })
})
