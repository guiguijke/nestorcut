import { describe, expect, it } from 'vitest'
import { reportExportState, reportPdfState } from '~~/app/utils/reportExport'

// D-RAP-11: report content visible on every plan; exports (copy/CSV) are
// Unlimited+. The gate is commercial and 100% client-side — the resolver is
// the only logic worth locking (the template wiring stays thin).
describe('reportExportState (D-RAP-11)', () => {
    it('enabled for paid tiers (D-RAP-4 regression: exports work)', () => {
        expect(reportExportState('standard', false)).toBe('enabled')
        expect(reportExportState('privacy', false)).toBe('enabled')
        expect(reportExportState('standard', true)).toBe('enabled')
        expect(reportExportState('privacy', true)).toBe('enabled')
    })

    it('locked in free (visible buttons + explicit label, click opens paywall)', () => {
        expect(reportExportState('free', false)).toBe('locked')
    })

    it('disabled (silently, NO paywall) when NUXT_PUBLIC_PAID_PLANS_DISABLED (D-PAY-7)', () => {
        expect(reportExportState('free', true)).toBe('disabled')
    })

    it('never grants export on an unknown/absent level (jamais de premium silencieux)', () => {
        expect(reportExportState(null, false)).toBe('locked')
        expect(reportExportState(undefined, false)).toBe('locked')
        expect(reportExportState('pro-max-ultra', false)).toBe('locked')
    })
})

// Rapport PDF : le PDF de base est offert à tous ; l'avancé suit le verrou d'export.
describe('reportPdfState', () => {
    it('base toujours disponible, avancé ouvert aux offres payantes', () => {
        for (const flag of [false, true]) {
            expect(reportPdfState('standard', flag)).toEqual({ base: 'enabled', advanced: 'enabled' })
            expect(reportPdfState('privacy', flag)).toEqual({ base: 'enabled', advanced: 'enabled' })
        }
    })

    it('free : base ouvert, avancé verrouillé (ou désactivé sans paywall si les offres sont coupées)', () => {
        expect(reportPdfState('free', false)).toEqual({ base: 'enabled', advanced: 'locked' })
        expect(reportPdfState('free', true)).toEqual({ base: 'enabled', advanced: 'disabled' })
    })

    it('niveau absent ou inconnu : aucun avancé offert', () => {
        expect(reportPdfState(null, false)).toEqual({ base: 'enabled', advanced: 'locked' })
        expect(reportPdfState(undefined, true)).toEqual({ base: 'enabled', advanced: 'disabled' })
        expect(reportPdfState('autre', false).advanced).toBe('locked')
    })

    it('avancé identique à reportExportState dans tous les cas', () => {
        for (const lvl of ['free', 'standard', 'privacy', null, undefined, 'x']) {
            for (const flag of [false, true]) expect(reportPdfState(lvl, flag).advanced).toBe(reportExportState(lvl, flag))
        }
    })
})
